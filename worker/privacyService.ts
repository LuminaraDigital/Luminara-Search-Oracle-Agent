/**
 * Self-serve GDPR export / delete for Luminara accounts.
 * Flow patterns (processors, soft-delete window, async jobs) only - no third-party code.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { auditOrgIdFor, recordAuditLogBestEffort } from './auditLog';

const EXPORT_TTL_MS = 48 * 60 * 60 * 1000;
const DELETE_CANCEL_MS = 24 * 60 * 60 * 1000;
const DAILY_JOB_CAP = 3;

export type PrivacyJobKind = 'export' | 'delete';
export type PrivacyJobStatus =
  | 'queued'
  | 'running'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'soft_deleted'
  | 'purged';

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function countRecentJobs(env: Env, accountId: string, kind: PrivacyJobKind): Promise<number> {
  if (!env.DB) return 0;
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM privacy_jobs WHERE account_id = ? AND kind = ? AND created_at >= ?`,
  )
    .bind(accountId, kind, since)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** Collect account-linked JSON for Article 15/20 style export (Luminara processors). */
async function collectExportPayload(env: Env, accountId: string): Promise<Record<string, unknown>> {
  const db = env.DB!;
  const q = async <T>(sql: string, ...binds: unknown[]) => {
    const res = await db.prepare(sql).bind(...binds).all<T>();
    return res.results ?? [];
  };
  const users = await q<Record<string, unknown>>(`SELECT id, source, account_id, telegram_id, firebase_uid FROM users WHERE account_id = ?`, accountId);
  const workspace = await q<{ payload: string; updated_at: number }>(
    `SELECT payload, updated_at FROM user_workspace WHERE account_id = ?`,
    accountId,
  );
  const projects = await q<Record<string, unknown>>(`SELECT * FROM projects WHERE account_id = ?`, accountId);
  const reports = await q<Record<string, unknown>>(
    `SELECT id, project_id, title, summary, skill, created_at FROM agent_reports WHERE account_id = ?`,
    accountId,
  );
  const facts = await q<Record<string, unknown>>(
    `SELECT id, text, source, created_at FROM memory_facts WHERE account_id = ?`,
    accountId,
  );
  const decisions = await q<Record<string, unknown>>(
    `SELECT id, domain, week_key, title, status, created_at, updated_at FROM weekly_decisions WHERE account_id = ?`,
    accountId,
  );
  const audits = await q<Record<string, unknown>>(
    `SELECT id, domain, created_at FROM audit_runs WHERE account_id = ? LIMIT 500`,
    accountId,
  );
  const shareTeasers = await q<Record<string, unknown>>(
    `SELECT id, expires_at, revoked_at, created_at FROM share_teasers WHERE owner_account_id = ?`,
    accountId,
  );
  const ideaScouts = await q<Record<string, unknown>>(
    `SELECT id, idea_text, niche, status, linked_domain, created_at FROM idea_scouts WHERE account_id = ?`,
    accountId,
  );
  const nichePulse = await q<Record<string, unknown>>(`SELECT * FROM niche_pulse_subs WHERE account_id = ?`, accountId);
  const referralCodes = await q<Record<string, unknown>>(
    `SELECT code, created_at FROM referral_codes WHERE account_id = ?`,
    accountId,
  );
  // Counterparty account ids are not exported; only this account's side of each attribution.
  const referralAttributions = await q<Record<string, unknown>>(
    `SELECT CASE WHEN referred_account_id = ? THEN 'referred' ELSE 'referrer' END AS role, attributed_at, qualified_at
       FROM referral_attributions WHERE referred_account_id = ? OR referrer_account_id = ?`,
    accountId,
    accountId,
    accountId,
  );
  const referralRewards = await q<Record<string, unknown>>(
    `SELECT kind, amount, remaining, created_at FROM referral_rewards WHERE account_id = ?`,
    accountId,
  );
  const progression = await q<Record<string, unknown>>(`SELECT * FROM user_progression WHERE account_id = ?`, accountId);
  const missions = await q<Record<string, unknown>>(
    `SELECT mission_key, week_key, status, created_at, completed_at FROM user_missions WHERE account_id = ?`,
    accountId,
  );
  const trustReceipts = await q<Record<string, unknown>>(
    `SELECT id, subject_kind, subject_id, claim, level, payload_json, signature, kid, visibility, revoked_at, revoked_reason, created_at
       FROM trust_receipts WHERE account_id = ?`,
    accountId,
  );
  const domainVerifications = await q<Record<string, unknown>>(
    `SELECT domain, method, status, receipt_id, verified_at, last_checked_at, created_at FROM domain_verifications WHERE account_id = ?`,
    accountId,
  );
  return {
    exportedAt: new Date().toISOString(),
    accountId,
    processors: [
      'users',
      'user_workspace',
      'projects',
      'agent_reports',
      'memory_facts',
      'weekly_decisions',
      'audit_runs',
      'share_teasers',
      'idea_scouts',
      'niche_pulse_subs',
      'referral_codes',
      'referral_attributions',
      'referral_rewards',
      'user_progression',
      'user_missions',
      'trust_receipts',
      'domain_verifications',
    ],
    users,
    workspace: workspace.map((w) => ({
      updatedAt: w.updated_at,
      payloadBytes: w.payload?.length ?? 0,
      payload: (() => {
        try {
          return JSON.parse(w.payload);
        } catch {
          return null;
        }
      })(),
    })),
    projects,
    agentReports: reports,
    memoryFacts: facts,
    weeklyDecisions: decisions,
    auditRuns: audits,
    shareTeasers,
    ideaScouts,
    nichePulse,
    referralCodes,
    referralAttributions,
    referralRewards,
    userProgression: progression,
    userMissions: missions,
    trustReceipts,
    domainVerifications,
    note: 'Financial ledger rows may be retained in minimized form for legal obligations.',
  };
}

async function softDeleteAccount(env: Env, accountId: string): Promise<Record<string, number>> {
  const db = env.DB!;
  const counts: Record<string, number> = {};
  const run = async (label: string, sql: string, ...binds: unknown[]) => {
    const r = await db.prepare(sql).bind(...binds).run();
    counts[label] = Number(r.meta?.changes ?? 0);
  };
  // Fan-out: wipe remote vectors before dropping D1 fact rows (pattern brief invariant).
  const { deleteAccountMemoryVectors } = await import('./memoryRag');
  counts.memory_vectors = await deleteAccountMemoryVectors(env, accountId);
  await run('memory_facts', `DELETE FROM memory_facts WHERE account_id = ?`, accountId);
  await run('memory_chat_extractions', `DELETE FROM memory_chat_extractions WHERE account_id = ?`, accountId);
  await run('memory_history', `DELETE FROM memory_history WHERE account_id = ?`, accountId);
  await run('user_workspace', `DELETE FROM user_workspace WHERE account_id = ?`, accountId);
  await run('product_analytics_events', `DELETE FROM product_analytics_events WHERE account_id = ?`, accountId);
  await run('ai_answer_captures', `DELETE FROM ai_answer_captures WHERE account_id = ?`, accountId);
  await run('prepared_assets', `DELETE FROM prepared_assets WHERE account_id = ?`, accountId);
  await run('reputation_alerts', `DELETE FROM reputation_alerts WHERE account_id = ?`, accountId);
  await run('thin_stack_inventory', `DELETE FROM thin_stack_inventory WHERE account_id = ?`, accountId);
  await run('weekly_decisions', `DELETE FROM weekly_decisions WHERE account_id = ?`, accountId);
  await run('share_teasers', `DELETE FROM share_teasers WHERE owner_account_id = ?`, accountId);
  await run('idea_scouts', `DELETE FROM idea_scouts WHERE account_id = ?`, accountId);
  await run('idea_scout_daily', `DELETE FROM idea_scout_daily WHERE account_id = ?`, accountId);
  await run('niche_pulse_subs', `DELETE FROM niche_pulse_subs WHERE account_id = ?`, accountId);
  await run('user_missions', `DELETE FROM user_missions WHERE account_id = ?`, accountId);
  await run('user_progression', `DELETE FROM user_progression WHERE account_id = ?`, accountId);
  await run('scout_receipts', `DELETE FROM scout_receipts WHERE account_id = ?`, accountId);
  await run('referral_codes', `DELETE FROM referral_codes WHERE account_id = ?`, accountId);
  // Both sides of an attribution name this account; referrer_account_id is NOT NULL, so the row goes.
  await run(
    'referral_attributions',
    `DELETE FROM referral_attributions WHERE referred_account_id = ? OR referrer_account_id = ?`,
    accountId,
    accountId,
  );
  await run('referral_rewards', `DELETE FROM referral_rewards WHERE account_id = ?`, accountId);
  // Trust Network (0020). Deleting receipts makes their public /verify links 404.
  await run('trust_receipts', `DELETE FROM trust_receipts WHERE account_id = ?`, accountId);
  await run('domain_verifications', `DELETE FROM domain_verifications WHERE account_id = ?`, accountId);
  // Anonymize login rows; keep account_id for ledger FK honesty (anonymize path when legal holds exist).
  await run(
    'users_anon',
    `UPDATE users SET telegram_id = NULL, firebase_uid = NULL, email = NULL, display_name = NULL WHERE account_id = ?`,
    accountId,
  );
  return counts;
}

export async function createPrivacyJob(
  env: Env,
  user: HostedIdentity,
  kind: PrivacyJobKind,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable', code: 'DB_UNBOUND' }, 503);
  const accountId = billingId(user);
  const recent = await countRecentJobs(env, accountId, kind);
  if (recent >= DAILY_JOB_CAP) {
    return json({ ok: false, error: `Daily ${kind} limit of ${DAILY_JOB_CAP} reached.`, code: 'RATE_LIMIT' }, 429);
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  const downloadToken = kind === 'export' ? randomToken() : null;
  const confirmToken = kind === 'delete' ? randomToken() : null;
  const downloadHash = downloadToken ? await sha256Hex(downloadToken) : null;
  const confirmHash = confirmToken ? await sha256Hex(confirmToken) : null;

  await env.DB.prepare(
    `INSERT INTO privacy_jobs
      (id, account_id, kind, status, confirm_token_hash, download_token_hash, cancel_until, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      accountId,
      kind,
      confirmHash,
      downloadHash,
      kind === 'delete' ? now + DELETE_CANCEL_MS : null,
      kind === 'export' ? now + EXPORT_TTL_MS : null,
      now,
      now,
    )
    .run();

  await recordAuditLogBestEffort(env, {
    org_id: auditOrgIdFor(accountId),
    actor_id: user.id,
    action: kind === 'export' ? 'privacy_export_requested' : 'privacy_delete_requested',
    target_id: id,
    details: { kind },
  });

  // Process inline for Workers (no separate queue required for v1).
  try {
    if (kind === 'export') {
      await env.DB.prepare(`UPDATE privacy_jobs SET status = 'running', updated_at = ? WHERE id = ?`)
        .bind(now, id)
        .run();
      const payload = await collectExportPayload(env, accountId);
      const body = JSON.stringify(payload, null, 2);
      let r2Key: string | null = null;
      if (env.DESKTOP_RELEASES) {
        r2Key = `privacy-exports/${accountId}/${id}.json`;
        await env.DESKTOP_RELEASES.put(r2Key, body, {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: { accountId, jobId: id },
        });
      }
      // Always keep a KV fallback for download when R2 unset.
      if (env.LUMINARA_KV) {
        await env.LUMINARA_KV.put(`privacy:export:${id}`, body, { expirationTtl: Math.floor(EXPORT_TTL_MS / 1000) });
      }
      await env.DB.prepare(
        `UPDATE privacy_jobs SET status = 'ready', r2_object_key = ?, result_summary_json = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
      )
        .bind(
          r2Key,
          JSON.stringify({ bytes: body.length, processors: payload.processors }),
          Date.now(),
          Date.now(),
          id,
        )
        .run();
      return json({
        ok: true,
        jobId: id,
        status: 'ready',
        downloadToken,
        expiresAt: now + EXPORT_TTL_MS,
        message: 'Export ready. Use downloadToken within 48 hours. Store it now; it is shown once.',
      });
    }

    // Delete: soft-delete immediately; hard purge after cancel window via cron/process.
    await softDeleteAccount(env, accountId);
    await env.DB.prepare(
      `UPDATE privacy_jobs SET status = 'soft_deleted', result_summary_json = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
    )
      .bind(JSON.stringify({ phase: 'soft_deleted' }), Date.now(), Date.now(), id)
      .run();
    return json({
      ok: true,
      jobId: id,
      status: 'soft_deleted',
      confirmToken,
      cancelUntil: now + DELETE_CANCEL_MS,
      message:
        'Personal workspace data soft-deleted. Contact support with confirmToken within 24h to cancel; after that the job is purged.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'privacy_job_failed';
    await env.DB.prepare(`UPDATE privacy_jobs SET status = 'failed', error_text = ?, updated_at = ? WHERE id = ?`)
      .bind(msg.slice(0, 500), Date.now(), id)
      .run();
    return json({ ok: false, error: 'Privacy job failed', code: 'PRIVACY_JOB_FAILED' }, 500);
  }
}

export async function getPrivacyJob(env: Env, user: HostedIdentity, jobId: string): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const accountId = billingId(user);
  const row = await env.DB.prepare(
    `SELECT id, kind, status, expires_at, cancel_until, result_summary_json, error_text, created_at, updated_at, completed_at
     FROM privacy_jobs WHERE id = ? AND account_id = ?`,
  )
    .bind(jobId, accountId)
    .first<Record<string, unknown>>();
  if (!row) return json({ ok: false, error: 'Not found' }, 404);
  return json({ ok: true, job: row });
}

export async function downloadPrivacyExport(
  env: Env,
  user: HostedIdentity,
  jobId: string,
  downloadToken: string,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const accountId = billingId(user);
  const row = await env.DB.prepare(
    `SELECT id, status, download_token_hash, expires_at, r2_object_key FROM privacy_jobs
     WHERE id = ? AND account_id = ? AND kind = 'export'`,
  )
    .bind(jobId, accountId)
    .first<{
      id: string;
      status: string;
      download_token_hash: string | null;
      expires_at: number | null;
      r2_object_key: string | null;
    }>();
  if (!row || row.status !== 'ready') return json({ ok: false, error: 'Export not ready' }, 404);
  if (row.expires_at && row.expires_at < Date.now()) {
    return json({ ok: false, error: 'Export expired', code: 'EXPIRED' }, 410);
  }
  const hash = await sha256Hex(downloadToken);
  if (!row.download_token_hash || hash !== row.download_token_hash) {
    return json({ ok: false, error: 'Invalid download token' }, 403);
  }
  let body: string | null = null;
  if (row.r2_object_key && env.DESKTOP_RELEASES) {
    const obj = await env.DESKTOP_RELEASES.get(row.r2_object_key);
    if (obj) body = await obj.text();
  }
  if (!body && env.LUMINARA_KV) {
    body = await env.LUMINARA_KV.get(`privacy:export:${jobId}`);
  }
  if (!body) return json({ ok: false, error: 'Export payload missing' }, 404);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="luminara-export-${jobId}.json"`,
      'cache-control': 'no-store',
    },
  });
}

export async function cancelPrivacyDelete(
  env: Env,
  user: HostedIdentity,
  jobId: string,
  confirmToken: string,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const accountId = billingId(user);
  const row = await env.DB.prepare(
    `SELECT id, status, confirm_token_hash, cancel_until FROM privacy_jobs
     WHERE id = ? AND account_id = ? AND kind = 'delete'`,
  )
    .bind(jobId, accountId)
    .first<{ id: string; status: string; confirm_token_hash: string | null; cancel_until: number | null }>();
  if (!row) return json({ ok: false, error: 'Not found' }, 404);
  if (row.status !== 'soft_deleted') {
    return json({ ok: false, error: 'Job is not cancellable' }, 409);
  }
  if (row.cancel_until && row.cancel_until < Date.now()) {
    return json({ ok: false, error: 'Cancellation window closed', code: 'WINDOW_CLOSED' }, 410);
  }
  const hash = await sha256Hex(confirmToken);
  if (!row.confirm_token_hash || hash !== row.confirm_token_hash) {
    return json({ ok: false, error: 'Invalid confirm token' }, 403);
  }
  await env.DB.prepare(`UPDATE privacy_jobs SET status = 'cancelled', updated_at = ? WHERE id = ?`)
    .bind(Date.now(), jobId)
    .run();
  await recordAuditLogBestEffort(env, {
    org_id: auditOrgIdFor(accountId),
    actor_id: user.id,
    action: 'privacy_delete_cancelled',
    target_id: jobId,
    details: {},
  });
  return json({
    ok: true,
    status: 'cancelled',
    message: 'Deletion cancelled. Re-sign-in and re-sync workspace from a device backup if needed.',
  });
}

/** Cron helper: mark expired soft deletes as purged (financial rows intentionally retained). */
export async function purgeExpiredPrivacyDeletes(env: Env): Promise<number> {
  if (!env.DB) return 0;
  const now = Date.now();
  const rows = await env.DB.prepare(
    `SELECT id FROM privacy_jobs WHERE kind = 'delete' AND status = 'soft_deleted' AND cancel_until IS NOT NULL AND cancel_until < ?`,
  )
    .bind(now)
    .all<{ id: string }>();
  let n = 0;
  for (const row of rows.results ?? []) {
    await env.DB.prepare(`UPDATE privacy_jobs SET status = 'purged', updated_at = ? WHERE id = ?`)
      .bind(now, row.id)
      .run();
    n += 1;
  }
  return n;
}

export async function handlePrivacyRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
): Promise<Response | null> {
  if (path === '/privacy/export' && request.method === 'POST') {
    return createPrivacyJob(env, user, 'export');
  }
  if (path === '/privacy/delete' && request.method === 'POST') {
    return createPrivacyJob(env, user, 'delete');
  }
  const jobMatch = path.match(/^\/privacy\/jobs\/([^/]+)$/);
  if (jobMatch && request.method === 'GET') {
    return getPrivacyJob(env, user, jobMatch[1]);
  }
  const dlMatch = path.match(/^\/privacy\/export\/([^/]+)\/download$/);
  if (dlMatch && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { downloadToken?: string };
    if (!body.downloadToken) return json({ ok: false, error: 'downloadToken required' }, 400);
    return downloadPrivacyExport(env, user, dlMatch[1], body.downloadToken);
  }
  const cancelMatch = path.match(/^\/privacy\/delete\/([^/]+)\/cancel$/);
  if (cancelMatch && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { confirmToken?: string };
    if (!body.confirmToken) return json({ ok: false, error: 'confirmToken required' }, 400);
    return cancelPrivacyDelete(env, user, cancelMatch[1], body.confirmToken);
  }
  return null;
}
