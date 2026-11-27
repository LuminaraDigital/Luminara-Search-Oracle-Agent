/**
 * Invoice reconcile + hard-stop readiness for Luminara billed-cents budgets.
 * Internal cost_events ledger vs provider invoice cents; never trust a webhook alone.
 */
import type { Env } from './env';
import { countWindowSpend, budgetWindowFor, getBudgetPolicy } from './budgets';
import { json } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import { auditOrgIdFor, recordAuditLogBestEffort } from './auditLog';

export type ReconcileStatus = 'ok' | 'warn' | 'fail' | 'reconciliation_required';

/** Absolute delta (cents) above which reconcile fails. */
export const RECONCILE_FAIL_DELTA_CENTS = 50;
/** Soft warn band. */
export const RECONCILE_WARN_DELTA_CENTS = 10;
/** Maximum accepted invoice total in cents ($1,000,000.00). */
export const MAX_INVOICE_CENTS = 100_000_000;
const MIN_RECONCILE_PERIOD_MS = Date.UTC(2020, 0, 1);
const MAX_RECONCILE_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
const MAX_RECONCILE_PERIOD_SPAN_MS = 366 * 24 * 60 * 60 * 1000;

export function classifyInvoiceDelta(internalCents: number, invoiceCents: number): {
  deltaCents: number;
  status: ReconcileStatus;
} {
  if (
    !Number.isFinite(internalCents) ||
    !Number.isFinite(invoiceCents) ||
    internalCents < 0 ||
    invoiceCents < 0
  ) {
    return { deltaCents: Number.MAX_SAFE_INTEGER, status: 'reconciliation_required' };
  }
  const deltaCents = Math.abs(Math.floor(internalCents) - Math.floor(invoiceCents));
  if (deltaCents > RECONCILE_FAIL_DELTA_CENTS) {
    return { deltaCents, status: 'reconciliation_required' };
  }
  if (deltaCents > RECONCILE_WARN_DELTA_CENTS) {
    return { deltaCents, status: 'warn' };
  }
  return { deltaCents, status: 'ok' };
}

function validateReconcileWindow(periodStart: number, periodEnd: number, now: number): string | null {
  if (!Number.isSafeInteger(periodStart) || !Number.isSafeInteger(periodEnd)) {
    return 'periodStart and periodEnd must be finite integer timestamps.';
  }
  if (periodStart < MIN_RECONCILE_PERIOD_MS) {
    return 'periodStart is earlier than the minimum supported date (2020-01-01).';
  }
  if (periodEnd > now + MAX_RECONCILE_FUTURE_SKEW_MS) {
    return 'periodEnd cannot be more than 24 hours in the future.';
  }
  if (periodStart >= periodEnd) {
    return 'periodStart must be strictly less than periodEnd.';
  }
  if (periodEnd - periodStart > MAX_RECONCILE_PERIOD_SPAN_MS) {
    return 'Reconcile period cannot exceed 366 days.';
  }
  return null;
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
  const now = Date.now();
  if (!Number.isSafeInteger(opts.invoiceCents) || opts.invoiceCents < 0 || opts.invoiceCents > MAX_INVOICE_CENTS) {
    throw new RangeError('invoiceCents must be an integer between 0 and 100000000');
  }
  const periodErr = validateReconcileWindow(opts.periodStart, opts.periodEnd, now);
  if (periodErr) throw new RangeError(periodErr);

  const window = { startMs: opts.periodStart, endMs: opts.periodEnd };
  const spent = await countWindowSpend(env, opts.accountId, window);
  const { deltaCents, status } = classifyInvoiceDelta(spent, opts.invoiceCents);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO invoice_reconcile_runs
      (id, account_id, provider, period_start, period_end, internal_cents, invoice_cents, delta_cents, status, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      opts.accountId,
      opts.provider.trim().slice(0, 64),
      opts.periodStart,
      opts.periodEnd,
      spent,
      opts.invoiceCents,
      deltaCents,
      status,
      (opts.notes || '').slice(0, 500),
      now,
    )
    .run();

  if (opts.actorId) {
    await recordAuditLogBestEffort(env, {
      org_id: auditOrgIdFor(opts.accountId),
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
    org_id: auditOrgIdFor(accountId),
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
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) {
      return json({ ok: false, error: read.error }, read.status);
    }
    if (!read.value || typeof read.value !== 'object' || Array.isArray(read.value)) {
      return json({ ok: false, error: 'JSON object required' }, 400);
    }
    const body = read.value as Record<string, unknown>;
    const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
    if (!provider || provider.length > 64) {
      return json({ ok: false, error: 'provider (1-64 characters) is required' }, 400);
    }
    if (
      typeof body.invoiceCents !== 'number' ||
      !Number.isSafeInteger(body.invoiceCents) ||
      body.invoiceCents < 0 ||
      body.invoiceCents > MAX_INVOICE_CENTS
    ) {
      return json(
        { ok: false, error: `invoiceCents must be an integer between 0 and ${MAX_INVOICE_CENTS}` },
        400,
      );
    }
    if (body.notes !== undefined && typeof body.notes !== 'string') {
      return json({ ok: false, error: 'notes must be a string' }, 400);
    }

    const now = Date.now();
    const periodStart = body.periodStart === undefined ? budgetWindowFor(now).startMs : body.periodStart;
    const periodEnd = body.periodEnd === undefined ? now : body.periodEnd;
    if (typeof periodStart !== 'number' || typeof periodEnd !== 'number') {
      return json({ ok: false, error: 'periodStart and periodEnd must be integer timestamps' }, 400);
    }
    const periodErr = validateReconcileWindow(periodStart, periodEnd, now);
    if (periodErr) {
      return json({ ok: false, error: periodErr }, 400);
    }

    try {
      const result = await recordInvoiceReconcile(env, {
        accountId,
        provider,
        periodStart,
        periodEnd,
        invoiceCents: body.invoiceCents,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
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
