/**
 * Invoice reconcile + hard-stop readiness for Luminara billed-cents budgets.
 * Internal cost_events ledger vs provider invoice cents; never trust a webhook alone.
 */
import type { Env } from './env';
import { countWindowSpend, budgetWindowFor, getBudgetPolicy } from './budgets';
import { json } from './workerUtils';
import { recordAuditLogBestEffort } from './auditLog';

export type ReconcileStatus = 'ok' | 'warn' | 'fail' | 'reconciliation_required';

/** Absolute delta (cents) above which reconcile fails. */
export const RECONCILE_FAIL_DELTA_CENTS = 50;
/** Soft warn band. */
export const RECONCILE_WARN_DELTA_CENTS = 10;

export function classifyInvoiceDelta(internalCents: number, invoiceCents: number): {
  deltaCents: number;
  status: ReconcileStatus;
} {
  const deltaCents = Math.abs(Math.floor(internalCents) - Math.floor(invoiceCents));
  if (deltaCents > RECONCILE_FAIL_DELTA_CENTS) {
    return { deltaCents, status: 'reconciliation_required' };
  }
  if (deltaCents > RECONCILE_WARN_DELTA_CENTS) {
    return { deltaCents, status: 'warn' };
  }
  return { deltaCents, status: 'ok' };
}

export async function recordInvoiceReconcile(
  env: Env,
  opts: {
    accountId: string;
    provider: string;
    periodStart: number;
    periodEnd: number;
    invoiceCents: number;
    notes?: string;
    actorId?: string;
  },
): Promise<{ id: string; status: ReconcileStatus; internalCents: number; deltaCents: number }> {
  if (!env.DB) throw new Error('DB unbound');
  const window = { startMs: opts.periodStart, endMs: opts.periodEnd };
  // Prefer explicit window; fall back to calendar month of periodStart.
  const spent =
    opts.periodEnd > opts.periodStart
      ? await countWindowSpend(env, opts.accountId, window)
      : await countWindowSpend(env, opts.accountId, budgetWindowFor(opts.periodStart));
  const { deltaCents, status } = classifyInvoiceDelta(spent, opts.invoiceCents);
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO invoice_reconcile_runs
      (id, account_id, provider, period_start, period_end, internal_cents, invoice_cents, delta_cents, status, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      opts.accountId,
      opts.provider.slice(0, 64),
      opts.periodStart,
      opts.periodEnd,
      spent,
      Math.floor(opts.invoiceCents),
      deltaCents,
      status,
      (opts.notes || '').slice(0, 500),
      now,
    )
    .run();

  if (opts.actorId) {
    await recordAuditLogBestEffort(env, {
      org_id: opts.accountId,
      actor_id: opts.actorId,
      action: 'invoice_reconcile',
      target_id: id,
      details: { status, deltaCents, provider: opts.provider },
    });
  }

  return { id, status, internalCents: spent, deltaCents };
}

/**
 * Enable hard_stop on the account policy only when the latest reconcile is ok
 * (or warn). Blocks enablement when reconciliation_required / fail.
 */
export async function enableHardStopAfterReconcile(
  env: Env,
  accountId: string,
  actorId: string,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const latest = await env.DB.prepare(
    `SELECT id, status, delta_cents, created_at FROM invoice_reconcile_runs
     WHERE account_id = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(accountId)
    .first<{ id: string; status: string; delta_cents: number; created_at: number }>();

  if (!latest) {
    return json({
      ok: false,
      error: 'No invoice reconcile run found. Record one before enabling hard stops.',
      code: 'RECONCILE_REQUIRED',
    }, 409);
  }
  if (latest.status === 'reconciliation_required' || latest.status === 'fail') {
    return json({
      ok: false,
      error: 'Latest reconcile is not clean; resolve delta before hard stops.',
      code: 'RECONCILE_FAILED',
      reconcileId: latest.id,
      status: latest.status,
    }, 409);
  }

  const existing = await getBudgetPolicy(env, accountId);
  if (!existing) {
    return json({ ok: false, error: 'No budget policy; set monthlyBudgetCents first.' }, 404);
  }

  await env.DB.prepare(
    `UPDATE budget_policies SET hard_stop_enabled = 1, updated_at = ? WHERE id = ?`,
  )
    .bind(Date.now(), existing.id)
    .run();

  await recordAuditLogBestEffort(env, {
    org_id: accountId,
    actor_id: actorId,
    action: 'budget_hard_stop_enabled',
    target_id: existing.id,
    details: { reconcileId: latest.id, delta_cents: latest.delta_cents },
  });

  return json({
    ok: true,
    policyId: existing.id,
    hardStopEnabled: true,
    reconcileId: latest.id,
    message: 'Hard stop enabled. Ensure BUDGET_ENFORCEMENT=hard on the Worker.',
  });
}

export async function handleBudgetReconcileRoute(
  request: Request,
  env: Env,
  accountId: string,
  actorId: string,
  path: string,
): Promise<Response | null> {
  if (path === '/budgets/self/reconcile' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      provider?: string;
      periodStart?: number;
      periodEnd?: number;
      invoiceCents?: number;
      notes?: string;
    };
    if (!body.provider || typeof body.invoiceCents !== 'number') {
      return json({ ok: false, error: 'provider and invoiceCents required' }, 400);
    }
    const now = Date.now();
    const periodStart = Number(body.periodStart) || budgetWindowFor(now).startMs;
    const periodEnd = Number(body.periodEnd) || now;
    try {
      const result = await recordInvoiceReconcile(env, {
        accountId,
        provider: body.provider,
        periodStart,
        periodEnd,
        invoiceCents: body.invoiceCents,
        notes: body.notes,
        actorId,
      });
      return json({ ok: true, ...result });
    } catch {
      return json({ ok: false, error: 'Reconcile store unavailable' }, 503);
    }
  }
  if (path === '/budgets/self/hard-stop' && request.method === 'POST') {
    return enableHardStopAfterReconcile(env, accountId, actorId);
  }
  return null;
}

/** Keep upsertBudgetPolicy available for callers that enable hard stop after set. */
export { upsertBudgetPolicy } from './budgets';
