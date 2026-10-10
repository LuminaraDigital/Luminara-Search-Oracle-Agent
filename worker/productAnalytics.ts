/**
 * Server-side product analytics ingest (separate from exception monitoring).
 * Browser productTelemetry can flush anonymized events here when signed in.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';

const ALLOWED_TYPES = new Set([
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
