/**
 * Server-side product analytics ingest (separate from exception monitoring).
 * Browser productTelemetry can flush anonymized events here when signed in.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';

export const ALLOWED_TYPES = new Set([
  'session_started',
  'page_view',
  'onboarding_started',
  'onboarding_step_completed',
  'onboarding_completed',
  'time_to_first_value',
  'core_action_completed',
  'error_encountered',
  'funnel_abandoned',
  'draft_restored',
  'probe_completed',
  'signup_completed',
  'instant_audit_completed',
  'paywall_viewed',
  'checkout_started',
  'payment_completed',
  'strategy_saved',
  'share_cta_clicked',
  'share_link_created',
  'share_link_opened',
  'mcp_key_created',
  'mcp_snippet_copied',
  'mcp_first_used',
  'privacy_export_started',
  'privacy_delete_started',
  'weekly_decision_committed',
  'upgrade_prompt_shown',
  'upgrade_prompt_clicked',
  'upgrade_prompt_dismissed',
  'share_clicked',
  'share_page_view',
  'fix_shipped',
  'mission_completed',
  'plan_expiring',
  'plan_expired',
  'survey_answered',
]);

const MAX_BATCH = 40;
const MAX_PAYLOAD_CHARS = 2000;

function scrubPayload(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '{}';
  const obj = { ...(raw as Record<string, unknown>) };
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('email') ||
      lower.includes('token') ||
      lower.includes('password') ||
      lower.includes('secret') ||
      lower.includes('authorization')
    ) {
      delete obj[key];
    }
  }
  const text = JSON.stringify(obj);
  return text.length > MAX_PAYLOAD_CHARS ? text.slice(0, MAX_PAYLOAD_CHARS) : text;
}

export async function ingestProductAnalytics(
  request: Request,
  env: Env,
  user: HostedIdentity | null,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    events?: Array<{ type?: string; path?: string; data?: unknown; timestamp?: number }>;
  } | null;
  if (!body?.events || !Array.isArray(body.events)) {
    return json({ ok: false, error: 'events array required' }, 400);
  }

  const accountId = user ? billingId(user) : null;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 80) : null;
  const slice = body.events.slice(0, MAX_BATCH);
  const now = Date.now();
  let inserted = 0;

  for (const ev of slice) {
    const type = String(ev.type || '');
    if (!ALLOWED_TYPES.has(type)) continue;
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO product_analytics_events
        (id, account_id, session_id, event_type, path, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        accountId,
        sessionId,
        type,
        typeof ev.path === 'string' ? ev.path.slice(0, 200) : null,
        scrubPayload(ev.data),
        typeof ev.timestamp === 'number' ? ev.timestamp : now,
      )
      .run();
    inserted += 1;
  }

  return json({ ok: true, inserted });
}

/**
 * Best-effort server-side analytics event insert (e.g., Stripe webhook payment_completed).
 * Never throws so webhook and billing routes remain unaffected if D1 is unavailable.
 */
export async function recordServerAnalyticsEvent(
  env: Env,
  input: {
    accountId?: string | null;
    sessionId?: string | null;
    type: string;
    path?: string | null;
    data?: unknown;
    timestamp?: number;
  },
): Promise<void> {
  if (!env.DB) return;
  const type = String(input.type || '');
  if (!ALLOWED_TYPES.has(type)) return;
  try {
    await env.DB.prepare(
      `INSERT INTO product_analytics_events
        (id, account_id, session_id, event_type, path, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        input.accountId ? String(input.accountId).slice(0, 120) : null,
        input.sessionId ? String(input.sessionId).slice(0, 80) : null,
        type,
        typeof input.path === 'string' ? input.path.slice(0, 200) : null,
        scrubPayload(input.data),
        typeof input.timestamp === 'number' ? input.timestamp : Date.now(),
      )
      .run();
  } catch {
    // Best-effort analytics write; never disrupt billing or webhook processing.
  }
}

export const CC5_FUNNEL_STAGES = [
  'probe_completed',
  'signup_completed',
  'instant_audit_completed',
  'paywall_viewed',
  'checkout_started',
  'payment_completed',
  'funnel_abandoned',
  'fix_shipped',
  'mission_completed',
  'weekly_decision_committed',
  'plan_expiring',
  'plan_expired',
  'survey_answered',
] as const;

export type FunnelStageCounts = {
  events: number;
  distinctSessions: number;
  distinctAccounts: number;
};

function ratePct(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Operator-only CC5 anonymous-to-paid funnel and payer cohort aggregation.
 * Reads D1 `product_analytics_events` and `stripe_credited_sessions`.
 */
export async function getProductFunnelSummary(
  env: Env,
  opts?: { days?: number; nowMs?: number },
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const rawDays = Number(opts?.days);
  const windowDays = Number.isFinite(rawDays) && rawDays >= 1 ? Math.min(365, Math.floor(rawDays)) : 30;
  const nowMs = typeof opts?.nowMs === 'number' ? opts.nowMs : Date.now();
  const sinceMs = nowMs - windowDays * 86_400_000;

  const stages: Record<string, FunnelStageCounts> = {};
  for (const stage of CC5_FUNNEL_STAGES) {
    stages[stage] = { events: 0, distinctSessions: 0, distinctAccounts: 0 };
  }

  try {
    const res = await env.DB.prepare(
      `SELECT
         event_type,
         COUNT(*) AS events,
         COUNT(DISTINCT session_id) AS distinct_sessions,
         COUNT(DISTINCT account_id) AS distinct_accounts
       FROM product_analytics_events
       WHERE created_at >= ?
       GROUP BY event_type`,
    )
      .bind(sinceMs)
      .all<{
        event_type: string;
        events: number;
        distinct_sessions: number;
        distinct_accounts: number;
      }>();

    for (const row of res.results || []) {
      const key = String(row.event_type || '');
      if (!key) continue;
      stages[key] = {
        events: Number(row.events || 0),
        distinctSessions: Number(row.distinct_sessions || 0),
        distinctAccounts: Number(row.distinct_accounts || 0),
      };
    }
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message || 'Funnel query failed') }, 503);
  }

  let creditedStripeSessions = 0;
  let distinctStripePayers = 0;
  let totalStripeAmountCents = 0;
  try {
    const ledgerRow = await env.DB.prepare(
      `SELECT
         COUNT(*) AS credited_sessions,
         COUNT(DISTINCT account_id) AS distinct_payers,
         COALESCE(SUM(amount_total), 0) AS total_amount_cents
       FROM stripe_credited_sessions
       WHERE credited_at >= ? AND reversal IS NULL`,
    )
      .bind(sinceMs)
      .first<{
        credited_sessions: number;
        distinct_payers: number;
        total_amount_cents: number;
      }>();
    if (ledgerRow) {
      creditedStripeSessions = Number(ledgerRow.credited_sessions || 0);
      distinctStripePayers = Number(ledgerRow.distinct_payers || 0);
      totalStripeAmountCents = Number(ledgerRow.total_amount_cents || 0);
    }
  } catch {
    // Table may be absent in minimal unit-test harnesses; degrade gracefully.
  }

  const probeSessions = stages.probe_completed.distinctSessions || stages.probe_completed.events;
  const signupSessions = stages.signup_completed.distinctSessions || stages.signup_completed.events;
  const auditSessions = stages.instant_audit_completed.distinctSessions || stages.instant_audit_completed.events;
  const checkoutSessions = stages.checkout_started.distinctSessions || stages.checkout_started.events;
  const paidCount = Math.max(
    stages.payment_completed.distinctAccounts || stages.payment_completed.events,
    distinctStripePayers,
  );

  return json({
    ok: true,
    windowDays,
    sinceMs,
    stages,
    conversions: {
      probeToSignupPct: ratePct(signupSessions, probeSessions),
      signupToAuditPct: ratePct(auditSessions, signupSessions),
      auditToCheckoutPct: ratePct(checkoutSessions, auditSessions),
      checkoutToPaidPct: ratePct(paidCount, checkoutSessions),
    },
    cohort: {
      creditedStripeSessions,
      distinctStripePayers,
      totalStripeAmountCents,
      targetPayers: 10,
      payerGoalProgressPct: Math.min(100, Math.round((distinctStripePayers / 10) * 100)),
    },
  });
}
