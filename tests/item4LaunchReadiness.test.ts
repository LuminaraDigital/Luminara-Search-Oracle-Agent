import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { describeAppCheckReadiness } from '../worker/appCheck';
import { getProductFunnelSummary, recordServerAnalyticsEvent } from '../worker/productAnalytics';
import { handleStripeWebhook } from '../worker/stripePayment';
import { productTelemetry } from '../services/analytics/productTelemetry';
import type { Env } from '../worker/env';

function createMockAnalyticsDb() {
  const analyticsRows: Array<{
    id: string;
    account_id: string | null;
    session_id: string | null;
    event_type: string;
    path: string | null;
    payload_json: string;
    created_at: number;
  }> = [];
  const stripeSessions: Array<{
    session_id: string;
    account_id: string;
    plan_id: string;
    amount_total: number;
    credited_at: number;
    reversal: string | null;
  }> = [];

  const prepare = (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const buildBound = (args: unknown[]) => ({
      async run() {
        if (normalized.startsWith('INSERT INTO product_analytics_events')) {
          analyticsRows.push({
            id: String(args[0] || ''),
            account_id: args[1] != null ? String(args[1]) : null,
            session_id: args[2] != null ? String(args[2]) : null,
            event_type: String(args[3] || ''),
            path: args[4] != null ? String(args[4]) : null,
            payload_json: String(args[5] || '{}'),
            created_at: Number(args[6] || Date.now()),
          });
        } else if (normalized.startsWith('INSERT INTO stripe_credited_sessions')) {
          stripeSessions.push({
            session_id: String(args[0] || ''),
            account_id: String(args[3] || ''),
            plan_id: String(args[5] || ''),
            amount_total: Number(args[6] || 0),
            credited_at: Number(args[12] || Date.now()),
            reversal: args[11] != null ? String(args[11]) : null,
          });
        }
        return { success: true, meta: { changes: 1 } };
      },
      async all<T>() {
        if (normalized.includes('FROM product_analytics_events')) {
          const since = Number(args[0] || 0);
          const filtered = analyticsRows.filter((r) => r.created_at >= since);
          const byType = new Map<string, typeof analyticsRows>();
          for (const row of filtered) {
            const list = byType.get(row.event_type) || [];
            list.push(row);
            byType.set(row.event_type, list);
          }
          const results = Array.from(byType.entries()).map(([event_type, list]) => ({
            event_type,
            events: list.length,
            distinct_sessions: new Set(list.map((r) => r.session_id).filter(Boolean)).size,
            distinct_accounts: new Set(list.map((r) => r.account_id).filter(Boolean)).size,
          }));
          return { results: results as unknown as T[] };
        }
        return { results: [] as T[] };
      },
      async first<T>() {
        if (normalized.includes('FROM stripe_credited_sessions') && normalized.includes('COUNT(*)')) {
          const since = Number(args[0] || 0);
          const active = stripeSessions.filter((s) => s.credited_at >= since && s.reversal === null);
          return {
            credited_sessions: active.length,
            distinct_payers: new Set(active.map((s) => s.account_id).filter(Boolean)).size,
            total_amount_cents: active.reduce((acc, s) => acc + s.amount_total, 0),
          } as unknown as T;
        }
        return null as T | null;
      },
    });
    return {
      bind: (...args: unknown[]) => buildBound(args),
      run: () => buildBound([]).run(),
      all: <T>() => buildBound([]).all<T>(),
      first: <T>() => buildBound([]).first<T>(),
    };
  };

  return {
    db: { prepare } as unknown as D1Database,
    analyticsRows,
    stripeSessions,
  };
}

async function signStripePayload(payload: string, secret: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${payload}`));
  const hex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `t=${ts},v1=${hex}`;
}

describe('Item 4 MVP Launch Readiness: Operator Diagnostics, Lifecycle Telemetry & CC5 Funnel', () => {
  beforeEach(() => {
    productTelemetry.resetForTesting();
  });

  afterEach(() => {
    productTelemetry.resetForTesting();
    vi.restoreAllMocks();
  });

  it('describes App Check readiness accurately and exposes diagnostics only on admin /api/health', async () => {
    const env: Env = {
      ADMIN_SECRET: 'adm_test_secret_token_123456',
      APPCHECK_ENFORCE: 'log',
      REQUIRE_APP_CHECK: 'false',
      FIREBASE_PROJECT_NUMBER: '123456789012',
      ENVIRONMENT: 'staging',
      STRIPE_SECRET_KEY: 'sk_test_example123',
      STRIPE_WEBHOOK_SECRET: 'whsec_example123',
      STRIPE_CHECKOUT_LIVE: 'true',
    };

    const readiness = describeAppCheckReadiness(env);
    expect(readiness).toEqual({
      mode: 'log',
      requireAppCheck: false,
      projectNumberConfigured: true,
      ready: true,
    });

    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

    // Unauthenticated /api/health must keep the exact 8 locked public keys
    const pubRes = await worker.fetch(new Request('https://luminarasuite.com/api/health'), env, ctx);
    expect(pubRes.status).toBe(200);
    const pubBody = (await pubRes.json()) as Record<string, unknown>;
    expect(Object.keys(pubBody).sort()).toEqual([
      'hostedGemini',
      'jettonCheckout',
      'lumens',
      'ok',
      'plans',
      'stripeCheckout',
      'ton',
      'trust',
    ]);

    // Admin-authorized /api/health surfaces appCheckMode, appCheckProjectNumberConfigured, and stripeConfigured
    const admRes = await worker.fetch(
      new Request('https://luminarasuite.com/api/health', {
        headers: { 'x-admin-secret': 'adm_test_secret_token_123456' },
      }),
      env,
      ctx,
    );
    expect(admRes.status).toBe(200);
    const admBody = (await admRes.json()) as Record<string, unknown>;
    expect(admBody.appCheckMode).toBe('log');
    expect(admBody.appCheckProjectNumberConfigured).toBe(true);
    expect(admBody.stripeConfigured).toBe(true);
    expect(admBody.stripeCheckout).toBe(true);
  });

  it('emits server-side payment_completed analytics row when Stripe checkout.session.completed credits a plan', async () => {
    const { db, analyticsRows, stripeSessions } = createMockAnalyticsDb();
    const kvStore = new Map<string, string>();
    const kv = {
      get: async (k: string, type?: string) => {
        const raw = kvStore.get(k);
        if (!raw) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      put: async (k: string, v: string) => {
        kvStore.set(k, v);
      },
    } as unknown as KVNamespace;

    const env: Env = {
      DB: db,
      LUMINARA_KV: kv,
      ENVIRONMENT: 'staging',
      STRIPE_SECRET_KEY: 'sk_test_example123',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
      STRIPE_CHECKOUT_LIVE: 'true',
    };

    const eventPayload = JSON.stringify({
      id: 'evt_test_001',
      type: 'checkout.session.completed',
      livemode: false,
      data: {
        object: {
          id: 'cs_test_session_001',
          mode: 'payment',
          payment_status: 'paid',
          amount_total: 7900,
          currency: 'aud',
          payment_intent: 'pi_test_001',
          customer: 'cus_test_001',
          metadata: {
            userId: 'fb:user_abc',
            accountId: 'fb:user_abc',
            planId: 'starter',
          },
        },
      },
    });

    const sig = await signStripePayload(eventPayload, 'whsec_test_secret');
    const res = await handleStripeWebhook(
      new Request('https://luminarasuite.com/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
        body: eventPayload,
      }),
      env,
    );

    expect(res.status).toBe(200);
    expect(stripeSessions).toHaveLength(1);
    expect(analyticsRows).toHaveLength(1);
    expect(analyticsRows[0]?.event_type).toBe('payment_completed');
    expect(analyticsRows[0]?.account_id).toBe('fb:user_abc');
    expect(JSON.parse(analyticsRows[0]?.payload_json || '{}')).toMatchObject({
      planId: 'starter',
      method: 'stripe',
      sessionId: 'cs_test_session_001',
      amountCents: 7900,
    });
  });

  it('tracks deduplicated plan_expiring, plan_expired, and survey_answered events in productTelemetry', () => {
    const trackSpy = vi.spyOn(productTelemetry, 'track');
    const now = 1_700_000_000_000;
    const threeDaysLater = now + 3 * 86_400_000;

    // 1. Plan expiring within 7 days emits plan_expiring once per expiry timestamp
    expect(productTelemetry.checkPlanLifecycle('starter', threeDaysLater, now)).toBe('expiring');
    expect(productTelemetry.checkPlanLifecycle('starter', threeDaysLater, now + 1000)).toBeNull();
    expect(trackSpy).toHaveBeenCalledWith('plan_expiring', {
      plan: 'starter',
      expiresAt: threeDaysLater,
      daysLeft: 3,
    });

    // 2. Once past expiresAt, emits plan_expired once
    expect(productTelemetry.checkPlanLifecycle('starter', threeDaysLater, threeDaysLater + 1)).toBe('expired');
    expect(productTelemetry.checkPlanLifecycle('starter', threeDaysLater, threeDaysLater + 5000)).toBeNull();
    expect(trackSpy).toHaveBeenCalledWith('plan_expired', {
      plan: 'starter',
      expiresAt: threeDaysLater,
    });

    // 3. PMF survey helper emits survey_answered
    productTelemetry.recordSurveyAnswer('very_disappointed', 'Need weekly citation diffs');
    expect(trackSpy).toHaveBeenCalledWith('survey_answered', {
      disappointment: 'very_disappointed',
      feedback: 'Need weekly citation diffs',
    });
  });

  it('serves CC5 funnel and payer cohort metrics on GET /api/admin/analytics/funnel and blocks non-admins', async () => {
    const { db, stripeSessions } = createMockAnalyticsDb();
    const now = Date.now();
    const env: Env = {
      DB: db,
      ADMIN_SECRET: 'adm_funnel_secret_999',
    };

    await recordServerAnalyticsEvent(env, {
      sessionId: 'anon_guest_1',
      type: 'probe_completed',
      timestamp: now - 5000,
    });
    await recordServerAnalyticsEvent(env, {
      accountId: 'fb:user_1',
      sessionId: 'anon_guest_1',
      type: 'signup_completed',
      timestamp: now - 4000,
    });
    await recordServerAnalyticsEvent(env, {
      accountId: 'fb:user_1',
      sessionId: 'anon_guest_1',
      type: 'instant_audit_completed',
      timestamp: now - 3000,
    });
    await recordServerAnalyticsEvent(env, {
      accountId: 'fb:user_1',
      sessionId: 'anon_guest_1',
      type: 'checkout_started',
      timestamp: now - 2000,
    });
    await recordServerAnalyticsEvent(env, {
      accountId: 'fb:user_1',
      sessionId: 'anon_guest_1',
      type: 'payment_completed',
      timestamp: now - 1000,
    });
    stripeSessions.push({
      session_id: 'cs_live_1',
      account_id: 'fb:user_1',
      plan_id: 'starter',
      amount_total: 7900,
      credited_at: now - 1000,
      reversal: null,
    });

    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

    // Unauthenticated request is rejected with 401
    const unauth = await worker.fetch(
      new Request('https://luminarasuite.com/api/admin/analytics/funnel'),
      env,
      ctx,
    );
    expect(unauth.status).toBe(401);

    // Authorized admin HTTP request receives full CC5 funnel + cohort summary
    const httpAuthRes = await worker.fetch(
      new Request('https://luminarasuite.com/api/admin/analytics/funnel?days=30', {
        headers: { 'x-admin-secret': 'adm_funnel_secret_999' },
      }),
      env,
      ctx,
    );
    expect(httpAuthRes.status).toBe(200);

    // Direct helper call with deterministic nowMs
    const authRes = await getProductFunnelSummary(env, { days: 30, nowMs: now });
    expect(authRes.status).toBe(200);
    const body = (await authRes.json()) as {
      ok: boolean;
      windowDays: number;
      stages: Record<string, { events: number; distinctSessions: number; distinctAccounts: number }>;
      conversions: {
        probeToSignupPct: number;
        signupToAuditPct: number;
        auditToCheckoutPct: number;
        checkoutToPaidPct: number;
      };
      cohort: {
        creditedStripeSessions: number;
        distinctStripePayers: number;
        totalStripeAmountCents: number;
        targetPayers: number;
        payerGoalProgressPct: number;
      };
    };

    expect(body.ok).toBe(true);
    expect(body.windowDays).toBe(30);
    expect(body.stages.probe_completed.events).toBe(1);
    expect(body.stages.signup_completed.events).toBe(1);
    expect(body.stages.payment_completed.events).toBe(1);
    expect(body.conversions).toEqual({
      probeToSignupPct: 100,
      signupToAuditPct: 100,
      auditToCheckoutPct: 100,
      checkoutToPaidPct: 100,
    });
    expect(body.cohort).toEqual({
      creditedStripeSessions: 1,
      distinctStripePayers: 1,
      totalStripeAmountCents: 7900,
      targetPayers: 10,
      payerGoalProgressPct: 10,
    });
  });
});
