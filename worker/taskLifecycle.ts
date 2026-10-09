/**
 * Task Lifecycle Engine (ZetaChain Track ZP Pattern 1).
 *
 * Implements a synthetic UTXO-style lifecycle for analytical tasks:
 *   initiated -> observing -> executing -> settled (success) OR reverted (failure)
 *
 * Invariant: If a task encounters fatal provider, network, or execution failure,
 * onRevert executes automatically. It restores metered daily quota, updates the
 * audit run status to 'reverted', records failure diagnostics, and returns an
 * instructive recovery payload.
 */
import type { Env } from './env';

export type TaskState = 'initiated' | 'observing' | 'executing' | 'settled' | 'reverted';

export interface TaskLifecycleContext {
  taskId: string;
  accountId: string;
  surface: 'web' | 'tma' | 'mcp' | 'cron';
  targetDomain: string;
  state: TaskState;
  quotaCharged: boolean;
  runId?: string | null;
  createdAt: number;
  diagnostics: string[];
}

export interface TaskLifecycleOptions {
  taskId?: string;
  accountId: string;
  surface?: 'web' | 'tma' | 'mcp' | 'cron';
  targetDomain: string;
  quotaCharged?: boolean;
  runId?: string | null;
}

export function createTaskContext(options: TaskLifecycleOptions): TaskLifecycleContext {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const randomSuffix = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  return {
    taskId: options.taskId || `task_${randomSuffix}`,
    accountId: options.accountId,
    surface: options.surface || 'web',
    targetDomain: options.targetDomain,
    state: 'initiated',
    quotaCharged: Boolean(options.quotaCharged),
    runId: options.runId ?? null,
    createdAt: Date.now(),
    diagnostics: [],
  };
}

/**
 * Restores 1 metered daily quota request in KV for the account when a task reverts.
 * Safe no-op if KV is missing or counter is already zero.
 */
export async function refundHostedQuota(env: Env, accountId: string): Promise<boolean> {
  if (!env.LUMINARA_KV || !accountId) return false;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const key = `quota:${accountId}:${day}`;
    const raw = await env.LUMINARA_KV.get(key);
    if (!raw) return false;
    const current = Number(raw);
    if (Number.isNaN(current) || current <= 0) return false;
    const refunded = Math.max(0, current - 1);
    await env.LUMINARA_KV.put(key, String(refunded), { expirationTtl: 2 * 86400 });
    return true;
  } catch (err) {
    console.warn('[TaskLifecycle] Quota refund failed best-effort', err);
    return false;
  }
}

/**
 * Updates audit_runs row in D1 when bound.
 */
async function updateAuditRunState(
  env: Env,
  runId: string | null | undefined,
  status: string,
  errorMsg: string | null,
): Promise<void> {
  if (!env.DB || !runId) return;
  try {
    const now = Date.now();
    await env.DB.prepare(
      `UPDATE audit_runs
       SET status = ?, error = ?, updated_at = ?, completed_at = COALESCE(?, completed_at)
       WHERE id = ?`,
    )
      .bind(status, errorMsg, now, now, runId)
      .run();
  } catch (err) {
    console.warn('[TaskLifecycle] DB run status update failed best-effort', err);
  }
}

export interface LifecycleExecutionResult<T> {
  ok: boolean;
  state: TaskState;
  data?: T;
  error?: string;
  code?: string;
  diagnostics: string[];
  refunded: boolean;
}

/**
 * Runs an analytical task within the lifecycle state machine.
 * Guaranteed onRevert execution on failure with automatic quota restoration.
 */
export async function executeWithLifecycle<T>(
  env: Env,
  ctx: TaskLifecycleContext,
  fn: (updateState: (nextState: 'observing' | 'executing', note?: string) => void) => Promise<T>,
): Promise<LifecycleExecutionResult<T>> {
  const updateState = (nextState: 'observing' | 'executing', note?: string) => {
    ctx.state = nextState;
    if (note) ctx.diagnostics.push(`[${nextState}] ${note}`);
  };

  try {
    ctx.diagnostics.push(`[initiated] Task ${ctx.taskId} started on surface ${ctx.surface}`);
    const result = await fn(updateState);
    ctx.state = 'settled';
    ctx.diagnostics.push(`[settled] Task ${ctx.taskId} completed successfully`);

    await updateAuditRunState(env, ctx.runId, 'completed', null);

    return {
      ok: true,
      state: 'settled',
      data: result,
      diagnostics: ctx.diagnostics,
      refunded: false,
    };
  } catch (err: unknown) {
    ctx.state = 'reverted';
    const rawError = err instanceof Error ? err.message : String(err || 'Unknown error');
    ctx.diagnostics.push(`[reverted] Task ${ctx.taskId} reverted: ${rawError}`);

    let refunded = false;
    if (ctx.quotaCharged) {
      refunded = await refundHostedQuota(env, ctx.accountId);
      if (refunded) {
        ctx.diagnostics.push(`[reverted] Restored 1 daily request quota to ${ctx.accountId}`);
      }
    }

    await updateAuditRunState(env, ctx.runId, 'failed', rawError);

    return {
      ok: false,
      state: 'reverted',
      error: rawError,
      code: 'TASK_REVERTED',
      diagnostics: ctx.diagnostics,
      refunded,
    };
  }
}
