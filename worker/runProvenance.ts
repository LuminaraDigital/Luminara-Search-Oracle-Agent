/**
 * Run Provenance: per-invocation tracing for every agent surface.
 *
 * Every surface that does agent work (Oracle chat, queued audits, the drift
 * sentinel cron, MCP tools, the crawler sidecar) opens a run here so an
 * operator can reconstruct cause -> effect after the fact:
 *   sentinel tick -> spawned audit -> spawned oracle summary.
 *
 * Design notes:
 * - Additive only: nothing else in the Worker depends on this table; failures
 *   here must never take a user-facing request down (same tradeoff as
 *   auditLog.ts recordAuditLogBestEffort).
 * - Privacy: inputPayload is summarized by the caller (message LENGTH, flags),
 *   never raw user text. We store only its SHA-256 for replay detection.
 * - Requires migrations/0010_run_provenance_and_agent_skills.sql. Gracefully
 *   no-ops when env.DB is unset (KV-only mode) or the table does not exist.
 */
import type { UserStoreEnv } from './userStore';
import { sha256Hex } from './workerUtils';

export type RunSurface =
  | 'oracle_chat'
  | 'queued_audit'
  | 'sentinel'
  | 'mcp_tool'
  | 'crawler';

export type RunStatus = 'running' | 'completed' | 'failed' | 'budget_halted';

export type StartRunParams = {
  surface: RunSurface;
  accountId?: string;
  orgId?: string;
  parentRunId?: string;
  wakeReason?: 'user_invoke' | 'cron_tick' | 'queue_drain' | 'mcp_call' | 'retry';
  wakeComment?: string;
  /** Summarized payload (shape only: lengths, flags). Raw user text is forbidden. */
  inputPayload?: Record<string, unknown>;
};

export type RunRow = {
  run_id: string;
  parent_run_id: string | null;
  surface: string;
  account_id: string | null;
  org_id: string | null;
  started_at: number;
  completed_at: number | null;
  wake_reason: string | null;
  wake_comment: string | null;
  input_hash: string | null;
  status: string;
};

const isMissingTableError = (err: unknown): boolean =>
  err instanceof Error && /no such table: run_provenance/i.test(err.message);

/**
 * Open a new run. Returns the runId so the caller can complete it later and
 * attach it to any child runs it spawns. Returns null when persistence is
 * unavailable; callers must treat provenance as best-effort.
 */
export async function startRun(
  env: UserStoreEnv,
  params: StartRunParams,
): Promise<{ runId: string } | null> {
  if (!env.DB) return null;
  const runId = crypto.randomUUID();
  try {
    const inputHash = params.inputPayload
      ? await sha256Hex(`luminara-run:${JSON.stringify(params.inputPayload)}`)
      : null;
    await env.DB.prepare(
      `INSERT INTO run_provenance
       (run_id, parent_run_id, surface, account_id, org_id, started_at, wake_reason, wake_comment, input_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')`,
    )
      .bind(
        runId,
        params.parentRunId ?? null,
        params.surface,
        params.accountId ?? null,
        params.orgId ?? null,
        Date.now(),
        params.wakeReason ?? null,
        params.wakeComment?.slice(0, 256) ?? null,
        inputHash,
      )
      .run();
    return { runId };
  } catch (err) {
    if (!isMissingTableError(err)) {
      console.error('[run-provenance] startRun failed (continuing without provenance):', err);
    }
    return null;
  }
}

/** Close a run. Best-effort: completion loss only degrades analytics. */
export async function completeRun(
  env: UserStoreEnv,
  runId: string,
  status: Exclude<RunStatus, 'running'> = 'completed',
): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `UPDATE run_provenance SET completed_at = ?, status = ? WHERE run_id = ?`,
    )
      .bind(Date.now(), status, runId)
      .run();
  } catch (err) {
    if (!isMissingTableError(err)) {
      console.error('[run-provenance] completeRun failed:', err);
    }
  }
}

/**
 * Walk the parent chain from a child run up to its root, returned root-first.
 * Uses a recursive CTE with a hard depth cap so a bad parent link can never
 * loop the query.
 */
export async function getRunChain(env: UserStoreEnv, runId: string, maxDepth = 32): Promise<RunRow[]> {
  if (!env.DB) return [];
  try {
    const result = await env.DB.prepare(
      `WITH RECURSIVE chain(run_id, depth) AS (
         SELECT run_id, 0 FROM run_provenance WHERE run_id = ?
         UNION ALL
         SELECT rp.run_id, chain.depth + 1
         FROM run_provenance rp
         JOIN chain ON rp.run_id = (SELECT parent_run_id FROM run_provenance WHERE run_id = chain.run_id)
         WHERE chain.depth < ?
       )
       SELECT rp.* FROM run_provenance rp JOIN chain ON rp.run_id = chain.run_id
       ORDER BY rp.started_at ASC, chain.depth DESC`,
    )
      .bind(runId, maxDepth)
      .all();
    const rows = (result.results ?? []) as unknown as RunRow[];
    // Root-first ordering: the deepest ancestor first. depth DESC puts the
    // highest-depth row first; ties broken by started_at ASC.
    return rows.sort((a, b) => a.started_at - b.started_at);
  } catch (err) {
    if (!isMissingTableError(err)) {
      console.error('[run-provenance] getRunChain failed:', err);
    }
    return [];
  }
}

/** Recent runs for an account, newest first. Used by future ops surfaces. */
export async function listRunsForAccount(
  env: UserStoreEnv,
  accountId: string,
  limit = 50,
): Promise<RunRow[]> {
  if (!env.DB) return [];
  try {
    const result = await env.DB.prepare(
      `SELECT * FROM run_provenance WHERE account_id = ? ORDER BY started_at DESC LIMIT ?`,
    )
      .bind(accountId, Math.min(Math.max(1, limit), 200))
      .all();
    return (result.results ?? []) as unknown as RunRow[];
  } catch (err) {
    if (!isMissingTableError(err)) {
      console.error('[run-provenance] listRunsForAccount failed:', err);
    }
    return [];
  }
}
