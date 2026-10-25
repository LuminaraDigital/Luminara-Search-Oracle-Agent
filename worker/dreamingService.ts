/**
 * Luminara Dreaming Master Service (Cloudflare Worker).
 * Coordinates event queues, deterministic wake gates, Dream Agent runs,
 * approval review workflows, and atomic rollbacks.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import type {
  BusinessMemoryItem,
  BusinessMemoryRow,
  DreamProposal,
  DreamProposalRow,
  DreamRun,
  DreamRunRow,
  DreamTriggerReason,
} from './dreamingTypes';
import {
  enqueueDreamEvent,
  getPendingDreamEvents,
  markEventsConsolidated,
  type EnqueueEventInput,
} from './dreamingQueue';
import { evaluateWakeGate } from './dreamingWakeGate';
import { hasHostedDreamModel, runDreamAgent } from './dreamAgent';
import { checkHostedQuota, QUOTA_CAPACITY_ERROR, refundMeteredQuota } from './quotaMiddleware';

const DREAM_RUN_LIMIT_ERROR =
  "Run now uses one of your free daily requests on free plans, and today's are used up. Upgrade for unlimited runs, or try again after 00:00 UTC.";

export async function getActiveBusinessMemories(
  env: Env,
  accountId: string,
  domain: string,
): Promise<BusinessMemoryItem[]> {
  if (!env.DB) return [];
  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];

  const rows = await env.DB.prepare(
    `SELECT id, account_id, project_id, domain, memory_type, title, content,
            structured_data_json, confidence, status, source_refs_json,
            created_at, updated_at, last_verified_at, expires_at
     FROM business_memories
     WHERE account_id = ? AND domain = ? AND status = 'active'
     ORDER BY updated_at DESC`,
  )
    .bind(accountId, cleanDomain)
    .all<BusinessMemoryRow>();

  return (rows.results || []).map((r) => {
    let structuredData: Record<string, unknown> = {};
    let sourceRefs: string[] = [];
    try {
      structuredData = JSON.parse(r.structured_data_json);
    } catch {
      /* fallback */
    }
    try {
      sourceRefs = JSON.parse(r.source_refs_json);
    } catch {
      /* fallback */
    }
    return {
      id: r.id,
      accountId: r.account_id,
      projectId: r.project_id,
      domain: r.domain,
      memoryType: r.memory_type,
      title: r.title,
      content: r.content,
      structuredData,
      confidence: r.confidence,
      status: r.status,
      sourceRefs,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastVerifiedAt: r.last_verified_at,
      expiresAt: r.expires_at,
    };
  });
}

export async function executeDreamRun(
  env: Env,
  accountId: string,
  domain: string,
  triggerReason: DreamTriggerReason,
  opts: { force?: boolean; projectId?: string; threshold?: number } = {},
): Promise<
  | { ok: true; woke: false; reason: string; signalScore: number }
  | { ok: true; woke: true; run: DreamRun; proposals: DreamProposal[] }
  | { ok: false; error: string }
> {
  if (!env.DB) return { ok: false, error: 'Database unavailable' };
  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
  if (!cleanDomain) return { ok: false, error: 'Domain required' };

  const pendingEvents = await getPendingDreamEvents(env, accountId, cleanDomain, 30);
  const activeMemories = await getActiveBusinessMemories(env, accountId, cleanDomain);

  const wakeResult = evaluateWakeGate({
    pendingEvents,
    activeMemories,
    triggerReason,
    threshold: opts.threshold,
  });

  if (!wakeResult.shouldWake && !opts.force) {
    return {
      ok: true,
      woke: false,
      reason: wakeResult.reason,
      signalScore: wakeResult.signalScore,
    };
  }

  const startTime = Date.now();
  const agentOutput = await runDreamAgent(env, {
    domain: cleanDomain,
    pendingEvents,
    activeMemories,
    detectedConflictSummary: wakeResult.detectedConflictSummary,
    expiredMemoryIds: wakeResult.expiredMemoryIds,
  });
  const durationMs = Date.now() - startTime;

  const runId = `drun_${crypto.randomUUID()}`;
  // One timestamp for the run: a create's memory and its proposal share it, and a rollback
  // finds the memory by it.
  const now = Date.now();
  const db = env.DB;

  let autoAppliedCount = 0;
  let pendingReviewCount = 0;
  const createdProposals: DreamProposal[] = [];
  // Every write of the run lands in one batch, so a failure leaves no memory changed, no
  // proposal or run recorded, and the events pending for the next run.
  const writes: D1PreparedStatement[] = [];

  for (const p of agentOutput.proposals) {
    const proposalId = `dprop_${crypto.randomUUID()}`;
    let previousSnapshot: Partial<BusinessMemoryItem> | null = null;

    if (p.memoryId) {
      const existing = activeMemories.find((m) => m.id === p.memoryId);
      if (existing) {
        previousSnapshot = {
          id: existing.id,
          title: existing.title,
          content: existing.content,
          structuredData: existing.structuredData,
          status: existing.status,
        };
      }
    }

    const requiresApproval = Boolean(p.requiresApproval);
    const initialStatus = requiresApproval ? 'pending' : 'auto_applied';

    if (requiresApproval) {
      pendingReviewCount++;
    } else {
      autoAppliedCount++;
      // Auto-apply mutation directly to business_memories
      if (p.action === 'create') {
        const memId = `mem_${crypto.randomUUID()}`;
        writes.push(
          db
            .prepare(
              `INSERT INTO business_memories (
            id, account_id, project_id, domain, memory_type, title, content,
            structured_data_json, confidence, status, source_refs_json,
            created_at, updated_at, last_verified_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL)`,
            )
            .bind(
              memId,
              accountId,
              opts.projectId || null,
              cleanDomain,
              p.memoryType,
              p.title,
              p.content,
              JSON.stringify(p.structuredData || {}),
              p.confidence,
              JSON.stringify(p.sourceRefs),
              now,
              now,
              now,
            ),
        );
      } else if (p.action === 'update' && p.memoryId) {
        writes.push(
          db
            .prepare(
              `UPDATE business_memories SET
            title = ?, content = ?, structured_data_json = ?,
            confidence = ?, source_refs_json = ?, updated_at = ?, last_verified_at = ?
           WHERE id = ? AND account_id = ?`,
            )
            .bind(
              p.title,
              p.content,
              JSON.stringify(p.structuredData || {}),
              p.confidence,
              JSON.stringify(p.sourceRefs),
              now,
              now,
              p.memoryId,
              accountId,
            ),
        );
      } else if (p.action === 'deprecate' && p.memoryId) {
        writes.push(
          db
            .prepare(
              `UPDATE business_memories SET status = 'archived', updated_at = ?
           WHERE id = ? AND account_id = ?`,
            )
            .bind(now, p.memoryId, accountId),
        );
      }
    }

    writes.push(
      db
        .prepare(
          `INSERT INTO dream_proposals (
        id, dream_run_id, account_id, domain, action, memory_id,
        memory_type, title, proposed_content, structured_data_json,
        confidence, requires_approval, status, rationale, source_refs_json,
        previous_snapshot_json, reviewed_by, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
        )
        .bind(
          proposalId,
          runId,
          accountId,
          cleanDomain,
          p.action,
          p.memoryId || null,
          p.memoryType,
          p.title,
          p.content,
          JSON.stringify(p.structuredData || {}),
          p.confidence,
          requiresApproval ? 1 : 0,
          initialStatus,
          p.rationale,
          JSON.stringify(p.sourceRefs),
          previousSnapshot ? JSON.stringify(previousSnapshot) : null,
          now,
        ),
    );

    createdProposals.push({
      id: proposalId,
      dreamRunId: runId,
      accountId,
      domain: cleanDomain,
      action: p.action,
      memoryId: p.memoryId || null,
      memoryType: p.memoryType,
      title: p.title,
      proposedContent: p.content,
      structuredData: p.structuredData || {},
      confidence: p.confidence,
      requiresApproval,
      status: initialStatus,
      rationale: p.rationale,
      sourceRefs: p.sourceRefs,
      previousSnapshot,
      createdAt: now,
    });
  }

  writes.push(
    db
      .prepare(
        `INSERT INTO dream_runs (
      id, account_id, project_id, domain, trigger_reason,
      events_evaluated_count, proposals_count, auto_applied_count,
      pending_review_count, rejected_count, summary, model_id,
      duration_ms, created_at, rolled_back_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        runId,
        accountId,
        opts.projectId || null,
        cleanDomain,
        triggerReason,
        pendingEvents.length,
        createdProposals.length,
        autoAppliedCount,
        pendingReviewCount,
        agentOutput.summary,
        agentOutput.modelId,
        durationMs,
        now,
      ),
  );
  const consolidated = markEventsConsolidated(db, pendingEvents.map((e) => e.id), runId);
  if (consolidated) writes.push(consolidated);
  await db.batch(writes);

  const run: DreamRun = {
    id: runId,
    accountId,
    projectId: opts.projectId || null,
    domain: cleanDomain,
    triggerReason,
    eventsEvaluatedCount: pendingEvents.length,
    proposalsCount: createdProposals.length,
    autoAppliedCount,
    pendingReviewCount,
    rejectedCount: 0,
    summary: agentOutput.summary,
    modelId: agentOutput.modelId,
    durationMs,
    createdAt: now,
  };

  return { ok: true, woke: true, run, proposals: createdProposals };
}

export async function reviewDreamProposal(
  env: Env,
  accountId: string,
  proposalId: string,
  reviewAction: 'approve' | 'reject',
  reviewedBy: string,
  editedContent?: string,
): Promise<{ ok: true; proposal: DreamProposal } | { ok: false; error: string; status?: number }> {
  if (!env.DB) return { ok: false, error: 'Database unavailable' };

  const row = await env.DB.prepare(
    `SELECT * FROM dream_proposals WHERE id = ? AND account_id = ?`,
  )
    .bind(proposalId, accountId)
    .first<DreamProposalRow>();

  if (!row) return { ok: false, error: 'Proposal not found', status: 404 };
  if (row.status !== 'pending') {
    return { ok: false, error: `Proposal already resolved (${row.status})`, status: 400 };
  }

  const now = Date.now();
  const finalContent = editedContent !== undefined ? editedContent : row.proposed_content;

  if (reviewAction === 'reject') {
    await env.DB.prepare(
      `UPDATE dream_proposals SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
    )
      .bind(reviewedBy, now, proposalId)
      .run();
  } else if (reviewAction === 'approve') {
    if (row.action === 'create') {
      const memId = `mem_${crypto.randomUUID()}`;
      await env.DB.prepare(
        `INSERT INTO business_memories (
          id, account_id, project_id, domain, memory_type, title, content,
          structured_data_json, confidence, status, source_refs_json,
          created_at, updated_at, last_verified_at, expires_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL)`,
      )
        .bind(
          memId,
          accountId,
          row.domain,
          row.memory_type,
          row.title,
          finalContent,
          row.structured_data_json,
          row.confidence,
          row.source_refs_json,
          now,
          now,
          now,
        )
        .run();
    } else if (row.action === 'update' && row.memory_id) {
      await env.DB.prepare(
        `UPDATE business_memories SET
          title = ?, content = ?, structured_data_json = ?,
          confidence = ?, updated_at = ?, last_verified_at = ?
         WHERE id = ? AND account_id = ?`,
      )
        .bind(
          row.title,
          finalContent,
          row.structured_data_json,
          row.confidence,
          now,
          now,
          row.memory_id,
          accountId,
        )
        .run();
    } else if (row.action === 'deprecate' && row.memory_id) {
      await env.DB.prepare(
        `UPDATE business_memories SET status = 'archived', updated_at = ?
         WHERE id = ? AND account_id = ?`,
      )
        .bind(now, row.memory_id, accountId)
        .run();
    }

    await env.DB.prepare(
      `UPDATE dream_proposals SET status = 'approved', proposed_content = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
    )
      .bind(finalContent, reviewedBy, now, proposalId)
      .run();
  }

  const updatedRow = await env.DB.prepare(
    `SELECT * FROM dream_proposals WHERE id = ?`,
  )
    .bind(proposalId)
    .first<DreamProposalRow>();

  if (!updatedRow) return { ok: false, error: 'Failed to retrieve updated proposal' };

  return {
    ok: true,
    proposal: {
      id: updatedRow.id,
      dreamRunId: updatedRow.dream_run_id,
      accountId: updatedRow.account_id,
      domain: updatedRow.domain,
      action: updatedRow.action,
      memoryId: updatedRow.memory_id,
      memoryType: updatedRow.memory_type,
      title: updatedRow.title,
      proposedContent: updatedRow.proposed_content,
      structuredData: JSON.parse(updatedRow.structured_data_json || '{}'),
      confidence: updatedRow.confidence,
      requiresApproval: Boolean(updatedRow.requires_approval),
      status: updatedRow.status,
      rationale: updatedRow.rationale,
      sourceRefs: JSON.parse(updatedRow.source_refs_json || '[]'),
      reviewedBy: updatedRow.reviewed_by,
      reviewedAt: updatedRow.reviewed_at,
      createdAt: updatedRow.created_at,
    },
  };
}

export async function rollbackDreamRun(
  env: Env,
  accountId: string,
  runId: string,
): Promise<{ ok: true; revertedProposalsCount: number } | { ok: false; error: string; status?: number }> {
  if (!env.DB) return { ok: false, error: 'Database unavailable' };

  const run = await env.DB.prepare(
    `SELECT * FROM dream_runs WHERE id = ? AND account_id = ?`,
  )
    .bind(runId, accountId)
    .first<DreamRunRow>();

  if (!run) return { ok: false, error: 'Dream run not found', status: 404 };
  if (run.rolled_back_at) {
    return { ok: false, error: 'Dream run has already been rolled back', status: 400 };
  }

  const proposals = await env.DB.prepare(
    `SELECT * FROM dream_proposals WHERE dream_run_id = ? AND status IN ('approved', 'auto_applied')`,
  )
    .bind(runId)
    .all<DreamProposalRow>();

  const now = Date.now();

  for (const p of proposals.results || []) {
    if (p.action === 'create') {
      // The memory a create made carries the exact timestamp of the apply: the run's `now` for
      // auto_applied, the review's `now` (reviewed_at) for approved. Matching on it leaves later
      // memories that share the title alone. A create's memory_id may name an unrelated memory.
      await env.DB.prepare(
        `DELETE FROM business_memories WHERE account_id = ? AND domain = ? AND title = ? AND created_at = ?`,
      )
        .bind(accountId, p.domain, p.title, p.status === 'approved' ? p.reviewed_at : p.created_at)
        .run();
    } else if ((p.action === 'update' || p.action === 'deprecate') && p.memory_id && p.previous_snapshot_json) {
      try {
        const prev = JSON.parse(p.previous_snapshot_json);
        await env.DB.prepare(
          `UPDATE business_memories SET
            title = ?, content = ?, status = ?, updated_at = ?
           WHERE id = ? AND account_id = ?`,
        )
          .bind(prev.title || p.title, prev.content || '', prev.status || 'active', now, p.memory_id, accountId)
          .run();
      } catch {
        /* fallback */
      }
    }

    await env.DB.prepare(
      `UPDATE dream_proposals SET status = 'rolled_back' WHERE id = ?`,
    )
      .bind(p.id)
      .run();
  }

  await env.DB.prepare(
    `UPDATE dream_runs SET rolled_back_at = ? WHERE id = ?`,
  )
    .bind(now, runId)
    .run();

  return { ok: true, revertedProposalsCount: proposals.results?.length || 0 };
}

export async function handleDreamingRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith('/dreaming')) return null;
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const accountId = billingId(user);
  const url = new URL(request.url);

  // GET /api/dreaming/status?domain=
  if (path === '/dreaming/status' && request.method === 'GET') {
    const domain = (url.searchParams.get('domain') || '').trim();
    if (!domain) return json({ ok: false, error: 'domain required' }, 400);

    const pendingEvents = await getPendingDreamEvents(env, accountId, domain);
    const activeMemories = await getActiveBusinessMemories(env, accountId, domain);
    const wake = evaluateWakeGate({
      pendingEvents,
      activeMemories,
      triggerReason: 'post_audit',
    });

    const pendingProposalsCountRow = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM dream_proposals WHERE account_id = ? AND domain = ? AND status = 'pending'`,
    )
      .bind(accountId, domain.toLowerCase())
      .first<{ c: number }>();

    const lastRun = await env.DB.prepare(
      `SELECT * FROM dream_runs WHERE account_id = ? AND domain = ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(accountId, domain.toLowerCase())
      .first<DreamRunRow>();

    return json({
      ok: true,
      domain,
      wake,
      pendingEventsCount: pendingEvents.length,
      activeMemoriesCount: activeMemories.length,
      pendingProposalsCount: pendingProposalsCountRow?.c || 0,
      lastRun: lastRun || null,
    });
  }

  // POST /api/dreaming/events
  if (path === '/dreaming/events' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as Partial<EnqueueEventInput>;
    if (!body.domain || !body.eventType) {
      return json({ ok: false, error: 'domain and eventType required' }, 400);
    }
    const res = await enqueueDreamEvent(env, {
      accountId,
      projectId: body.projectId,
      domain: body.domain,
      eventType: body.eventType,
      sourceId: body.sourceId,
      payload: body.payload || {},
      signalWeight: body.signalWeight,
    });
    return json(res, res.ok ? 201 : 400);
  }

  // POST /api/dreaming/run
  if (path === '/dreaming/run' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      domain?: string;
      triggerReason?: DreamTriggerReason;
      force?: boolean;
    };
    if (!body.domain) return json({ ok: false, error: 'domain required' }, 400);

    // A run that wakes calls the hosted model, so on a free plan it spends a free daily unit.
    // The unit comes back when the run does not wake or fails.
    const quota = hasHostedDreamModel(env) ? await checkHostedQuota(env, user) : null;
    if (quota && !quota.ok) {
      const capacity = quota.error === QUOTA_CAPACITY_ERROR;
      // Only a used-up daily meter has counted anything; any other refusal says why itself.
      return json(
        { ok: false, error: quota.used > 0 ? DREAM_RUN_LIMIT_ERROR : quota.error, code: capacity ? 'HOSTED_CAPACITY' : 'QUOTA_EXHAUSTED' },
        capacity ? 503 : 429,
      );
    }
    const res = await executeDreamRun(
      env,
      accountId,
      body.domain,
      body.triggerReason || 'manual_user',
      { force: body.force ?? false },
    ).catch(async (err: unknown) => {
      await refundMeteredQuota(env, quota);
      throw err;
    });
    if (!res.ok || !res.woke) await refundMeteredQuota(env, quota);
    return json(res, res.ok ? 200 : 500);
  }

  // GET /api/dreaming/memories?domain=
  if (path === '/dreaming/memories' && request.method === 'GET') {
    const domain = (url.searchParams.get('domain') || '').trim();
    if (!domain) return json({ ok: false, error: 'domain required' }, 400);
    const memories = await getActiveBusinessMemories(env, accountId, domain);
    return json({ ok: true, memories });
  }

  // GET /api/dreaming/proposals?domain=
  if (path === '/dreaming/proposals' && request.method === 'GET') {
    const domain = (url.searchParams.get('domain') || '').trim();
    if (!domain) return json({ ok: false, error: 'domain required' }, 400);

    const rows = await env.DB.prepare(
      `SELECT * FROM dream_proposals WHERE account_id = ? AND domain = ? ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(accountId, domain.toLowerCase())
      .all<DreamProposalRow>();

    const proposals = (rows.results || []).map((r) => ({
      id: r.id,
      dreamRunId: r.dream_run_id,
      accountId: r.account_id,
      domain: r.domain,
      action: r.action,
      memoryId: r.memory_id,
      memoryType: r.memory_type,
      title: r.title,
      proposedContent: r.proposed_content,
      structuredData: JSON.parse(r.structured_data_json || '{}'),
      confidence: r.confidence,
      requiresApproval: Boolean(r.requires_approval),
      status: r.status,
      rationale: r.rationale,
      sourceRefs: JSON.parse(r.source_refs_json || '[]'),
      previousSnapshot: r.previous_snapshot_json ? JSON.parse(r.previous_snapshot_json) : null,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      createdAt: r.created_at,
    }));

    return json({ ok: true, proposals });
  }

  // POST /api/dreaming/proposals/:id/review
  const reviewMatch = path.match(/^\/dreaming\/proposals\/([^/]+)\/review$/);
  if (reviewMatch && request.method === 'POST') {
    const proposalId = reviewMatch[1];
    const body = (await request.json().catch(() => ({}))) as {
      action?: 'approve' | 'reject';
      editedContent?: string;
    };
    if (!body.action || (body.action !== 'approve' && body.action !== 'reject')) {
      return json({ ok: false, error: 'action must be "approve" or "reject"' }, 400);
    }
    const res = await reviewDreamProposal(
      env,
      accountId,
      proposalId,
      body.action,
      user.id || 'user',
      body.editedContent,
    );
    return json(res, res.ok ? 200 : res.status || 400);
  }

  // POST /api/dreaming/runs/:id/rollback
  const rollbackMatch = path.match(/^\/dreaming\/runs\/([^/]+)\/rollback$/);
  if (rollbackMatch && request.method === 'POST') {
    const runId = rollbackMatch[1];
    const res = await rollbackDreamRun(env, accountId, runId);
    return json(res, res.ok ? 200 : res.status || 400);
  }

  return null;
}
