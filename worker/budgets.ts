/**
 * Budget Policies and Enforcement (spec 0014; design record at
 * docs/plans/budget-policies-and-enforcement.md).
 *
 * P0 + P1: account-level monthly (UTC calendar month) billed-cents budgets
 * with soft alerts at the policy warn thresholds (default 50/80/95) and a
 * hard stop at 100 percent, enforced at the MCP governance gate. Project
 * lifetime budgets are schema-included (migration 0012) but NOT enforced in
 * this loop; the account scope is the only live control.
 *
 * Money-state rules (mirroring paymentLedger.ts, refined for safe deploys):
 * - Enforcement fails closed when the budget schema is present but a read
 *   errors, or when DB is unbound: never silently allow spend you cannot meter.
 * - Enforcement fails open when budget tables/columns are absent (migrations
 *   not applied yet): treat as unbudgeted so a Worker deploy cannot outage
 *   paid MCP before `db:migrate`. See docs/plans/paperclip-pattern-production-ship.md H1.
 * - `BUDGET_ENFORCEMENT=off|soft|hard` is an operator kill-switch (Env binding).
 * - Alerting writes fail open: a failed incident insert or audit log never
 *   blocks a tool call.
 * - New policies default hard_stop_enabled = 0 (soft-alert era) until an
 *   operator explicitly enables hard stops.
 * - cost_events is the only spend record; window totals are always computed
 *   with SQL SUM so a replay or correction recompute is possible (no mutable
 *   counters).
 * - Window math derives from a single `now` argument per call; callers must
 *   never invoke Date.now() twice for one decision (clock skew between the
 *   policy check and the gate check would disagree on the window).
 */
import type { UserStoreEnv } from './userStore';
import { redactSensitive } from './logRedaction';

export const BUDGET_MIGRATION = 'migrations/0012_budget_policies.sql';

/** Interim per-call cost in cents: Luminara owes provider spend only when the
 * call rides the hosted keys. BYOK (dataForSeoCredential set) bills zero. */
export const HOSTED_PAID_CALL_COST_CENTS = 1;
export const BYOK_PAID_CALL_COST_CENTS = 0;

export const SOFT_THRESHOLDS = [50, 80, 95] as const;

/** Approve-once resume marker: mcp_action_requests.kind = 'budget_override'
 * with this tool_name; the window it covers lives in args_json. */
export const BUDGET_OVERRIDE_TOOL = 'budget_override';

/** Operator kill-switch: off = never halt; soft = honor policies but never
 * hard-stop; hard / unset = policy-driven hard stops (default for prod once
 * soft-alert validation completes). */
export type BudgetEnforcementMode = 'off' | 'soft' | 'hard';

export function budgetEnforcementMode(env: UserStoreEnv): BudgetEnforcementMode {
  const raw = (env.BUDGET_ENFORCEMENT || '').trim().toLowerCase();
  if (raw === 'off' || raw === 'soft' || raw === 'hard') return raw;
  return 'hard';
}

function isBudgetSchemaMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const lower = msg.toLowerCase();
  return (
    lower.includes('no such table') ||
    lower.includes('no such column') ||
    (lower.includes('budget_policies') && lower.includes('does not exist'))
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BudgetPolicyRow = {
  id: string;
  account_id: string;
  scope_type: 'account' | 'project';
  scope_id: string | null;
  metric: string;
  window_kind: 'calendar_month_utc' | 'lifetime';
  amount_cents: number;
  currency: string;
  warn_percents: string;
  hard_stop_enabled: number;
  is_active: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
};

export type BudgetState = 'ok' | 'soft_50' | 'soft_80' | 'soft_95' | 'hard_stop';

export type BudgetIncidentRow = {
  id: string;
  policy_id: string;
  account_id: string;
  scope_type: string;
  scope_id: string | null;
  window_start: number;
  window_end: number | null;
  threshold_percent: number;
  threshold_kind: 'soft' | 'hard';
  amount_limit_cents: number;
  amount_observed_cents: number;
  approval_request_id: string | null;
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  created_at: number;
  resolved_at: number | null;
};

export type BudgetWindow = { startMs: number; endMs: number | null };

export type BudgetStatus = {
  policy: BudgetPolicyRow | null;
  spentCents: number;
  percent: number;
  state: BudgetState;
  openIncident?: BudgetIncidentRow | null;
};

export type CostEventInput = {
  accountId: string;
  toolName?: string;
  runId?: string | null;
  billedCents: number;
  projectId?: string | null;
  provider?: string;
  creditClass?: 'free' | 'paid';
  source?: string;
};

// ---------------------------------------------------------------------------
// Window math (single `now` in, derived values out)
// ---------------------------------------------------------------------------

/** Current UTC calendar month window for `now`: [first-of-month 00:00 UTC, next first-of-month). */
export function budgetWindowFor(now: number): BudgetWindow {
  const d = new Date(now);
  const startMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const endMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { startMs, endMs };
}

function highestWarnCrossed(percent: number, warnPercents: number[]): number | null {
  let crossed: number | null = null;
  for (const t of warnPercents) {
    if (percent >= t && (crossed === null || t > crossed)) crossed = t;
  }
  return crossed;
}

export function stateForPercent(
  percent: number,
  hardStopEnabled: boolean,
  warnPercents: number[] = [...SOFT_THRESHOLDS],
): BudgetState {
  if (hardStopEnabled && percent >= 100) return 'hard_stop';
  const warn = highestWarnCrossed(percent, warnPercents);
  if (warn === 95) return 'soft_95';
  if (warn === 80) return 'soft_80';
  if (warn === 50) return 'soft_50';
  return 'ok';
}

function warnPercentsOf(policy: BudgetPolicyRow): number[] {
  try {
    const parsed = JSON.parse(policy.warn_percents);
    if (Array.isArray(parsed)) {
      return parsed.filter((n) => Number.isFinite(n)).map((n) => Math.floor(Number(n)));
    }
  } catch {
    /* fall through to defaults */
  }
  return [...SOFT_THRESHOLDS];
}

// ---------------------------------------------------------------------------
// Fail-closed / fail-open plumbing
// ---------------------------------------------------------------------------

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isMissingBudgetTable(err: unknown): boolean {
  return /no such table: (budget_policies|cost_events|budget_incidents)/i.test(errorText(err))
    || /no such column: kind/i.test(errorText(err));
}

function reportBudgetFault(operation: string, err?: unknown): void {
  if (err === undefined) {
    console.error(
      `[Budgets] ${operation}: D1 binding DB is not configured. Failing closed on enforcement. Bind DB and apply ${BUDGET_MIGRATION}.`,
    );
  } else if (isMissingBudgetTable(err)) {
    console.error(
      `[Budgets] ${operation}: budget tables are missing. Failing closed on enforcement. Apply ${BUDGET_MIGRATION} and migrations/0013_mcp_action_requests_kind.sql.`,
    );
  } else {
    console.error(`[Budgets] ${operation} failed: ${errorText(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Policy CRUD
// ---------------------------------------------------------------------------

/**
 * Fetch the account-scope monthly policy. `now` is accepted for signature
 * symmetry with the rest of the module and future window-aware reads; the
 * current UTC month has exactly one active account policy by unique index.
 */
export async function getBudgetPolicy(
  env: UserStoreEnv,
  accountId: string,
  _now?: number,
): Promise<BudgetPolicyRow | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT * FROM budget_policies
     WHERE account_id = ? AND scope_type = 'account' AND is_active = 1
     ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(accountId)
    .first<BudgetPolicyRow>();
  return row ?? null;
}

/**
 * Create or replace the account monthly billed-cents budget. Validates
 * `monthlyBudgetCents > 0`; currency defaults to 'usd'. The upsert keys on
 * the one-active-policy-per-account unique index so raising a budget updates
 * in place and never stacks policies.
 */
export async function upsertBudgetPolicy(
  env: UserStoreEnv,
  params: {
    accountId: string;
    monthlyBudgetCents: number;
    currency?: string;
    createdBy?: string | null;
    /** Default false (soft-alert era). Pass true only when enabling hard stops. */
    hardStopEnabled?: boolean;
    now?: number;
  },
): Promise<BudgetPolicyRow> {
  const amount = Math.floor(Number(params.monthlyBudgetCents));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('monthly_budget_cents must be a positive integer');
  }
  if (!env.DB) {
    reportBudgetFault('upsertBudgetPolicy');
    throw new Error('budget store unavailable');
  }
  const now = params.now ?? Date.now();
  const currency = (params.currency || 'usd').trim().toLowerCase() || 'usd';
  const hardStop = params.hardStopEnabled === true ? 1 : 0;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO budget_policies
       (id, account_id, scope_type, scope_id, metric, window_kind, amount_cents, currency,
        warn_percents, hard_stop_enabled, is_active, created_by, created_at, updated_at)
     VALUES (?, ?, 'account', NULL, 'billed_cents', 'calendar_month_utc', ?, ?,
             '[50,80,95]', ?, 1, ?, ?, ?)
     ON CONFLICT(account_id, scope_type, IFNULL(scope_id, '')) WHERE is_active = 1
     DO UPDATE SET amount_cents = excluded.amount_cents,
                   currency = excluded.currency,
                   warn_percents = excluded.warn_percents,
                   hard_stop_enabled = excluded.hard_stop_enabled,
                   updated_at = excluded.updated_at`,
  )
    .bind(id, params.accountId, amount, currency, hardStop, params.createdBy ?? null, now, now)
    .run();
  const policy = await getBudgetPolicy(env, params.accountId, now);
  if (!policy) throw new Error('budget policy upsert failed');
  return policy;
}

// ---------------------------------------------------------------------------
// Cost events
// ---------------------------------------------------------------------------

/**
 * Append one cost event after a successful PAID tool execution. Window totals
 * are never stored, so the concurrent-safe path is a single INSERT; SUM over
 * the window in getBudgetStatus/countWindowSpend cannot double-count because
 * each row lands exactly once per execution.
 *
 * Free tools and BYOK calls bill zero cents; callers on the metering path
 * skip recording entirely for creditClass 'free' (see callTool).
 */
export async function recordCostEvent(
  env: UserStoreEnv,
  params: CostEventInput & { now?: number },
): Promise<{ id: string | null }> {
  if (!env.DB) return { id: null };
  const now = params.now ?? Date.now();
  const billed = Math.max(0, Math.floor(Number(params.billedCents)) || 0);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO cost_events
       (id, account_id, project_id, tool_name, provider, billed_cents, credit_class, source, run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      params.accountId,
      params.projectId ?? null,
      params.toolName ?? 'unknown',
      params.provider ?? 'dataforseo',
      billed,
      params.creditClass ?? 'paid',
      params.source ?? 'rate_card',
      params.runId ?? null,
      now,
    )
    .run();
  return { id };
}

/** SUM of billed_cents for the account inside [windowStart, windowEnd). */
export async function countWindowSpend(
  env: UserStoreEnv,
  accountId: string,
  window: BudgetWindow,
): Promise<number> {
  if (!env.DB) return 0;
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(billed_cents), 0) AS spent
     FROM cost_events
     WHERE account_id = ? AND created_at >= ? AND created_at < ?`,
  )
    .bind(accountId, window.startMs, window.endMs ?? Number.MAX_SAFE_INTEGER)
    .first<{ spent: number }>();
  return Number(row?.spent ?? 0);
}

// ---------------------------------------------------------------------------
// Status / incidents
// ---------------------------------------------------------------------------

/**
 * Current-window budget status for the account. Unbudgeted accounts return
 * policy null, spent 0, state 'ok' and are never halted.
 */
export async function getBudgetStatus(
  env: UserStoreEnv,
  accountId: string,
  now?: number,
): Promise<BudgetStatus> {
  const at = now ?? Date.now();
  const policy = await getBudgetPolicy(env, accountId, at);
  if (!policy) {
    return { policy: null, spentCents: 0, percent: 0, state: 'ok', openIncident: null };
  }
  const window = budgetWindowFor(at);
  const spentCents = await countWindowSpend(env, accountId, window);
  const percent = policy.amount_cents > 0 ? (spentCents / policy.amount_cents) * 100 : 0;
  const state = stateForPercent(percent, policy.hard_stop_enabled === 1, warnPercentsOf(policy));
  const openIncident = await latestOpenIncident(env, accountId, policy.id, window, at);
  return { policy, spentCents, percent, state, openIncident };
}

async function latestOpenIncident(
  env: UserStoreEnv,
  accountId: string,
  policyId: string,
  window: BudgetWindow,
  now: number,
): Promise<BudgetIncidentRow | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT * FROM budget_incidents
     WHERE account_id = ? AND policy_id = ? AND window_start = ? AND status = 'open'
     ORDER BY threshold_percent DESC, created_at DESC LIMIT 1`,
  )
    .bind(accountId, policyId, window.startMs)
    .first<BudgetIncidentRow>();
  void now;
  return row ?? null;
}

/**
 * Record one threshold incident for (policy, threshold, window), deduped by
 * the partial unique index idx_budget_incidents_open: a threshold alerts at
 * most once per window. Returns the row id when a new incident opened.
 */
export async function recordBudgetIncident(
  env: UserStoreEnv,
  accountId: string,
  threshold: number,
  spentCents: number,
  opts?: { kind?: 'soft' | 'hard'; policyId?: string; now?: number; approvalRequestId?: string | null },
): Promise<{ id: string | null; recorded: boolean }> {
  if (!env.DB) return { id: null, recorded: false };
  const now = opts?.now ?? Date.now();
  const policy =
    (opts?.policyId
      ? await env.DB.prepare(`SELECT * FROM budget_policies WHERE id = ?`)
          .bind(opts.policyId)
          .first<BudgetPolicyRow>()
      : await getBudgetPolicy(env, accountId, now)) ?? null;
  if (!policy) return { id: null, recorded: false };

  const window = policy.window_kind === 'lifetime'
    ? { startMs: policy.created_at, endMs: null }
    : budgetWindowFor(now);
  const id = crypto.randomUUID();
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO budget_incidents
       (id, policy_id, account_id, scope_type, scope_id, window_start, window_end,
        threshold_percent, threshold_kind, amount_limit_cents, amount_observed_cents,
        approval_request_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
  )
    .bind(
      id,
      policy.id,
      accountId,
      policy.scope_type,
      policy.scope_id,
      window.startMs,
      window.endMs,
      Math.floor(threshold),
      opts?.kind ?? (threshold >= 100 ? 'hard' : 'soft'),
      policy.amount_cents,
      Math.max(0, Math.floor(spentCents)),
      opts?.approvalRequestId ?? null,
      now,
    )
    .run();
  return { id, recorded: (result.meta?.changes ?? 0) > 0 };
}

// ---------------------------------------------------------------------------
// Hard stop / approve-once resume
// ---------------------------------------------------------------------------

/**
 * True when the account budget hard stop is active for the CURRENT UTC window:
 * spent >= monthly budget and no approve-once override row exists that covers
 * this window.
 *
 * Unbudgeted accounts are never halted. Schema-not-applied fails open (H1).
 * DB unbound or other read errors fail closed (design decision 10). Kill-switch
 * `BUDGET_ENFORCEMENT=off|soft` never hard-stops.
 */
export async function isBudgetHalted(
  env: UserStoreEnv,
  accountId: string,
  now?: number,
): Promise<boolean> {
  const at = now ?? Date.now();
  const mode = budgetEnforcementMode(env);
  if (mode === 'off' || mode === 'soft') return false;
  if (!env.DB) {
    reportBudgetFault('isBudgetHalted');
    return true;
  }
  let policy: BudgetPolicyRow | null;
  let spentCents: number;
  try {
    policy = await getBudgetPolicy(env, accountId, at);
    if (!policy) return false;
    if (policy.hard_stop_enabled !== 1) return false;
    spentCents = await countWindowSpend(env, accountId, budgetWindowFor(at));
  } catch (err) {
    reportBudgetFault('isBudgetHalted', err);
    if (isBudgetSchemaMissingError(err)) return false;
    return true;
  }
  if (spentCents < policy.amount_cents) return false;
  return !(await hasBudgetOverride(env, accountId, at));
}

/** Approve-once resume: an approved, current-window budget_override row. */
export async function hasBudgetOverride(
  env: UserStoreEnv,
  accountId: string,
  now: number,
): Promise<boolean> {
  const window = budgetWindowFor(now);
  try {
    const row = await env.DB!.prepare(
      `SELECT id, args_json FROM mcp_action_requests
       WHERE user_id = ? AND kind = 'budget_override' AND tool_name = ? AND status = 'approved'
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(accountId, BUDGET_OVERRIDE_TOOL)
      .first<{ id: string; args_json: string }>();
    if (!row) return false;
    const args = JSON.parse(row.args_json || '{}') as { kind?: string; windowStart?: number };
    // The override authorizes continued spend for the current UTC window only.
    return args.kind === 'budget_override' && args.windowStart === window.startMs;
  } catch (err) {
    reportBudgetFault('hasBudgetOverride', err);
    return false;
  }
}

/**
 * Create the approve-once override for the CURRENT UTC window. Inserts an
 * approved mcp_action_requests row (kind 'budget_override') whose args_json
 * pins windowStart; isBudgetHalted honors it only while the window matches,
 * so the resume expires with the month. No operator decision flow here: the
 * self-service route passes the caller as adminId. Returns null when the row
 * could not be written (DB unbound), letting callers fail loudly.
 */
export async function approveBudgetResume(
  env: UserStoreEnv,
  accountId: string,
  adminId: string,
  opts?: { now?: number },
): Promise<{ id: string; windowStart: number } | null> {
  if (!env.DB) {
    reportBudgetFault('approveBudgetResume');
    return null;
  }
  const now = opts?.now ?? Date.now();
  const window = budgetWindowFor(now);
  const id = crypto.randomUUID();
  const argsJson = JSON.stringify(
    redactSensitive({
      kind: 'budget_override',
      scopeType: 'account',
      scopeId: null,
      windowStart: window.startMs,
      windowEnd: window.endMs,
    }),
  );
  await env.DB.prepare(
    `INSERT INTO mcp_action_requests
       (id, user_id, project_id, tool_name, args_json, status, decided_by, decided_at, expires_at, created_at, kind)
     VALUES (?, ?, NULL, ?, ?, 'approved', ?, ?, ?, ?, 'budget_override')`,
  )
    // expires_at rides the window end: approve-once authorizes the current
    // month only, so the override dies at the first of next month UTC.
    .bind(id, accountId, BUDGET_OVERRIDE_TOOL, argsJson, adminId, now, window.endMs ?? now, now)
    .run();
  return { id, windowStart: window.startMs };
}

/**
 * Post-paid-call soft threshold evaluation (alerting path: fail open). Given
 * the status recomputed after a cost event landed, record a deduped incident
 * for the highest newly crossed warn threshold. Never throws.
 */
export async function evaluateSoftAlerts(
  env: UserStoreEnv,
  accountId: string,
  status: BudgetStatus,
  now: number,
): Promise<{ threshold: number; recorded: boolean } | null> {
  if (!status.policy) return null;
  const warn = highestWarnCrossed(status.percent, warnPercentsOf(status.policy));
  if (warn === null || status.percent >= 100) return null;
  try {
    const { recorded } = await recordBudgetIncident(env, accountId, warn, status.spentCents, {
      kind: 'soft',
      policyId: status.policy.id,
      now,
    });
    return { threshold: warn, recorded };
  } catch (err) {
    console.error('[Budgets] evaluateSoftAlerts failed (alert only, not blocking):', errorText(err));
    return null;
  }
}
