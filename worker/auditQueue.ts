/**
 * Agency queued audit runs (W7 / AI Functions P4).
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { randomId } from '../services/projects/projectUtils';
import { buildPaidToolRuntime, executePaidTool } from '../services/tools/registry';
import { getProject } from './projectService';

export function isAuditQueueEnabled(env: Env): boolean {
  return String(env.AUDIT_QUEUE_ENABLED || '').toLowerCase() === 'true';
}

export type AuditRunRow = {
  id: string;
  account_id: string;
  project_id: string | null;
  target_url: string;
  status: string;
  result_json: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

type AuditJobMessage = {
  runId: string;
  accountId: string;
  targetUrl: string;
  projectId?: string | null;
};

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function enqueueAuditRun(
  request: Request,
  env: Env,
  user: HostedIdentity,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable', code: 'NO_DB' }, 503);
  if (!env.AUDIT_JOBS) {
    return json({ ok: false, error: 'AUDIT_JOBS queue binding missing', code: 'NO_QUEUE' }, 503);
  }

  const body = (await request.json().catch(() => ({}))) as {
    targetUrl?: string;
    projectId?: string;
  };
  const targetUrl = typeof body.targetUrl === 'string' ? body.targetUrl.trim() : '';
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return json({ ok: false, error: 'targetUrl must be http(s)', code: 'BAD_REQUEST' }, 400);
  }

  const accountId = billingId(user);
  // Never trust a client-supplied projectId without account ownership check.
  let projectId: string | null = null;
  if (typeof body.projectId === 'string' && body.projectId.trim()) {
    const owned = await getProject(env, accountId, body.projectId.trim());
    if (!owned) {
      return json(
        { ok: false, error: 'projectId not found for this account', code: 'PROJECT_NOT_FOUND' },
        404,
      );
    }
    projectId = owned.id;
  }

  const runId = randomId('aud', 12);
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO audit_runs (id, account_id, client_id, domain, focus, status, created_at, completed_at, report_ref, project_id, target_url, result_json, error, updated_at)
     VALUES (?, ?, NULL, ?, 'queued_audit', 'queued', ?, NULL, NULL, ?, ?, NULL, NULL, ?)`,
  )
    .bind(runId, accountId, hostFromUrl(targetUrl), now, projectId, targetUrl, now)
    .run();

  const msg: AuditJobMessage = {
    runId,
    accountId,
    targetUrl,
    projectId,
  };
  await env.AUDIT_JOBS.send(msg);

  return json({ ok: true, runId, status: 'queued' });
}

export async function getAuditRun(
  env: Env,
  user: HostedIdentity,
  runId: string,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const accountId = billingId(user);
  const row = await env.DB.prepare(
    `SELECT id, account_id, project_id, target_url, domain, status, result_json, error, created_at, updated_at
     FROM audit_runs WHERE id = ? AND account_id = ?`,
  )
    .bind(runId, accountId)
    .first<AuditRunRow & { domain?: string }>();

  if (!row) return json({ ok: false, error: 'Not found', code: 'NOT_FOUND' }, 404);

  let result: unknown = null;
  if (row.result_json) {
    try {
      result = JSON.parse(row.result_json);
    } catch {
      result = { raw: row.result_json };
    }
  }

  return json({
    ok: true,
    run: {
      id: row.id,
      projectId: row.project_id,
      targetUrl: row.target_url || null,
      domain: row.domain,
      status: row.status,
      result,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
}

async function markRun(
  env: Env,
  runId: string,
  status: string,
  result: unknown | null,
  error: string | null,
): Promise<void> {
  if (!env.DB) return;
  const now = Date.now();
  const completedAt = status === 'completed' || status === 'failed' ? now : null;
  await env.DB.prepare(
    `UPDATE audit_runs SET status = ?, result_json = ?, error = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?`,
  )
    .bind(status, result ? JSON.stringify(result) : null, error, now, completedAt, runId)
    .run();
}

/**
 * Worker-safe v1 audit: domain overview via DFS when projectId present, else not_measured shell.
 */
export async function processAuditJob(env: Env, msg: AuditJobMessage): Promise<void> {
  await markRun(env, msg.runId, 'running', null, null);
  try {
    const host = new URL(msg.targetUrl).hostname.replace(/^www\./, '');
    let domainOverview: unknown = {
      measurementStatus: 'not_measured',
      code: 'AUDIT_V1_MINIMAL',
      domain: host,
    };

    if (msg.projectId) {
      const rt = buildPaidToolRuntime({
        env,
        accountId: msg.accountId,
        canUsePaid: true,
        dataForSeoCredential: null,
        author: 'oracle',
      });
      const toolResult = await executePaidTool(
        'get_domain_overview',
        { projectId: msg.projectId, domain: host },
        rt,
      );
      domainOverview = toolResult.structuredContent || { text: toolResult.text };
    }

    const result = {
      targetUrl: msg.targetUrl,
      domain: host,
      measurementStatus:
        (domainOverview as { measurementStatus?: string })?.measurementStatus || 'not_measured',
      domainOverview,
      notes:
        'v1 Worker audit: reduced graph. Full CrewOrchestrator port is incremental; missing nodes stay not_measured.',
    };
    await markRun(env, msg.runId, 'completed', result, null);
  } catch (e) {
    await markRun(
      env,
      msg.runId,
      'failed',
      null,
      e instanceof Error ? e.message : 'Audit job failed',
    );
  }
}

export async function processAuditQueueBatch(
  batch: MessageBatch<AuditJobMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processAuditJob(env, message.body);
      message.ack();
    } catch (e) {
      console.error('[auditQueue] job failed', e);
      message.retry();
    }
  }
}
