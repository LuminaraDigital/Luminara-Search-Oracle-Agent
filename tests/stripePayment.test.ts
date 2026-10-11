import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import {
  verifyStripeSignature,
  STRIPE_PLAN_CONFIG,
  STRIPE_CHECKOUT_LIVE,
  CARD_IN_TELEGRAM_ERROR,
  isStripeSecretsConfigured,
  isStripeCheckoutLive,
  diagnoseStripeConfig,
  planRank,
  handleStripeWebhook,
  handleCreateStripeCheckoutSession,
  createStripeCheckoutSession,
} from '../worker/stripePayment';
import { mintOpaqueSession } from '../worker/opaqueSession';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';

const secret = 'whsec_test_secret_12345';
const DAY_MS = 86400_000;
const STAGING_ORIGIN = 'https://staging.luminarasuite.com';

// Assembled, so no key-shaped literal sits in the repo. Neither is a real key.
const TEST_KEY = ['sk', 'test', 'not_a_real_key'].join('_');
const LIVE_KEY = ['sk', 'live', 'not_a_real_key'].join('_');

const PRODUCTION = {
  ENVIRONMENT: 'production',
  STRIPE_SECRET_KEY: LIVE_KEY,
  WEBAPP_URL: 'https://luminarasuite.com/',
  ALLOWED_ORIGINS: 'https://luminarasuite.com,https://www.luminarasuite.com',
};

async function generateValidSignatureHeader(payload: string, webhookSecret: string, timestamp?: number | string): Promise<string> {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${t}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
  const hex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `t=${t},v1=${hex}`;
}

function makeKv() {
  const store = new Map<string, string>();
  let failPut: ((key: string) => boolean) | null = null;
  return {
    store,
    /** Make the next matching put throw, once. */
    failNextPut(match: (key: string) => boolean) {
      failPut = match;
    },
    async get(key: string, type?: string) {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      if (failPut?.(key)) {
        failPut = null;
        throw new Error('KV put failed');
      }
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  const kv = makeKv();
  const env = {
    DB: createSqliteD1(),
    LUMINARA_KV: kv,
    STRIPE_WEBHOOK_SECRET: secret,
    STRIPE_SECRET_KEY: TEST_KEY,
    ENVIRONMENT: 'staging',
    WEBAPP_URL: `${STAGING_ORIGIN}/`,
    ALLOWED_ORIGINS: STAGING_ORIGIN,
    ...overrides,
  } as unknown as Env;
  const sub = (id: string) => {
    const raw = kv.store.get(`sub:${id}`);
    return raw ? (JSON.parse(raw) as Record<string, any>) : null;
  };
  const ledger = (sessionId: string) =>
    (env.DB as any).prepare('SELECT * FROM stripe_credited_sessions WHERE session_id = ?').bind(sessionId).first() as Promise<Record<string, any> | null>;
  return { env, kv, sub, ledger };
}

/** A recorded stand-in for api.stripe.com. */
function stripeApi(reply: unknown = { id: 'cs_test_created', url: 'https://checkout.stripe.com/c/pay/cs_test_created' }, status = 200) {
  const calls: Array<{ url: string; params: URLSearchParams; headers: Record<string, string> }> = [];
  const fetcher = (async (url: unknown, init?: { body?: unknown; headers?: Record<string, string> }) => {
    calls.push({ url: String(url), params: new URLSearchParams(String(init?.body || '')), headers: init?.headers || {} });
    return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

/** A web session cookie for a signed-in buyer, minted the way POST /auth/session does. */
async function signIn(env: Env, uid = 'buyer1', email = 'buyer@example.com') {
  const sid = await mintOpaqueSession(env, { uid, email });
  return { cookie: `__session=${sid}`, userId: `fb:${uid}` };
}

function checkoutRequest(opts: { cookie?: string; body?: unknown; origin?: string; headers?: Record<string, string>; host?: string } = {}) {
  const origin = opts.origin ?? STAGING_ORIGIN;
  return new Request(`${opts.host ?? origin}/api/stripe/create-checkout-session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.headers || {}),
    },
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? { planId: 'growth' }),
  });
}

let eventSeq = 0;

function stripeEvent(type: string, object: Record<string, unknown>, livemode = false) {
  eventSeq += 1;
  return { id: `evt_test_${eventSeq}`, type, livemode, data: { object } };
}

/** A checkout.session.completed event exactly as the Worker's own session produces it. */
function paidSession(o: {
  sessionId: string;
  userId: string;
  planId: string;
  paymentIntent?: string;
  session?: Record<string, unknown>;
  livemode?: boolean;
  type?: string;
}) {
  return stripeEvent(
    o.type ?? 'checkout.session.completed',
    {
      id: o.sessionId,
      object: 'checkout.session',
      mode: 'payment',
      payment_status: 'paid',
      amount_total: STRIPE_PLAN_CONFIG[o.planId]?.amountCents,
      currency: 'usd',
      payment_intent: o.paymentIntent ?? `pi_${o.sessionId}`,
      customer: null,
      metadata: { userId: o.userId, accountId: o.userId, planId: o.planId },
      ...(o.session || {}),
    },
    o.livemode ?? false,
  );
}

async function deliver(env: Env, event: unknown, fetcher?: typeof fetch): Promise<Response> {
  const payload = JSON.stringify(event);
  const req = new Request('https://staging.luminarasuite.com/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': await generateValidSignatureHeader(payload, secret) },
    body: payload,
  });
  return handleStripeWebhook(req, env, { fetcher });
}

/** A record another rail wrote: Stars, TON and licence keys each write a fresh one. */
function otherRailRecord(plan: string, expiresAt: number) {
  return JSON.stringify({ plan, paymentMethod: 'stars', chargeId: 'tg_charge_1', startedAt: Date.now(), expiresAt });
}

// The clock every Date.now() reads, so a test can let days pass between two events.
const realNow = Date.now.bind(Date);
let clockOffsetMs = 0;
const passDays = (days: number) => {
  clockOffsetMs += days * DAY_MS;
};

/** Equal within a minute: a reversal removes the days still ahead, counted from the moment it runs. */
function expectAbout(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThan(60_000);
}

beforeEach(() => {
  clockOffsetMs = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffsetMs);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Stripe Payments & Webhook Verification', () => {
  describe('STRIPE_PLAN_CONFIG', () => {
    it('defines prices matching the self-serve pricing ladder', () => {
      expect(STRIPE_PLAN_CONFIG.starter.amountCents).toBe(4900);
      expect(STRIPE_PLAN_CONFIG.growth.amountCents).toBe(14900);
      expect(STRIPE_PLAN_CONFIG.agency.amountCents).toBe(34900);
      expect(STRIPE_PLAN_CONFIG.starter.days).toBe(30);
      expect(STRIPE_PLAN_CONFIG.growth.days).toBe(30);
      expect(STRIPE_PLAN_CONFIG.agency.days).toBe(30);
    });
  });

  describe('verifyStripeSignature', () => {
    it('fails when signature header or secret is missing', async () => {
      const res1 = await verifyStripeSignature('{}', null, secret);
      expect(res1.ok).toBe(false);
      expect(res1.reason).toBe('missing_signature_or_secret');

      const res2 = await verifyStripeSignature('{}', 't=123,v1=abc', '');
      expect(res2.ok).toBe(false);
      expect(res2.reason).toBe('missing_signature_or_secret');
    });

    it('fails when header format is malformed', async () => {
      const res = await verifyStripeSignature('{}', 'invalid_header', secret);
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('malformed_signature_header');
    });

    it('fails when timestamp is too old (> 300s)', async () => {
      const oldTime = Math.floor(Date.now() / 1000) - 400;
      const header = await generateValidSignatureHeader('{"test": true}', secret, oldTime);
      const res = await verifyStripeSignature('{"test": true}', header, secret, 300);
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('timestamp_out_of_tolerance');
    });

    it('succeeds with a valid timestamp and HMAC signature', async () => {
      const payload = JSON.stringify({ id: 'evt_test_123', type: 'checkout.session.completed' });
      const header = await generateValidSignatureHeader(payload, secret);
      const res = await verifyStripeSignature(payload, header, secret);
      expect(res.ok).toBe(true);
    });

    it('fails when payload is tampered', async () => {
      const payload = JSON.stringify({ id: 'evt_test_123', type: 'checkout.session.completed' });
      const header = await generateValidSignatureHeader(payload, secret);
      const tamperedPayload = JSON.stringify({ id: 'evt_test_123', type: 'checkout.session.completed', tampered: true });
      const res = await verifyStripeSignature(tamperedPayload, header, secret);
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('signature_mismatch');
    });

    // F14. The header below is correctly signed for its own "t", so only the timestamp check can refuse it.
    it.each(['NaN', 'Infinity', '12abc', '-5', ''])('refuses t=%s even when the signature over it is valid', async (t) => {
      const payload = '{"test":true}';
      const header = await generateValidSignatureHeader(payload, secret, t);
      const res = await verifyStripeSignature(payload, header, secret);
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('malformed_signature_header');
    });
  });

  describe('Stripe Checkout Session & Gate Helpers', () => {
    it('isStripeSecretsConfigured returns true only when both secrets are present', () => {
      expect(isStripeSecretsConfigured({} as Env)).toBe(false);
      expect(isStripeSecretsConfigured({ STRIPE_SECRET_KEY: 'sk_test_123' } as Env)).toBe(false);
      expect(isStripeSecretsConfigured({ STRIPE_WEBHOOK_SECRET: 'whsec_123' } as Env)).toBe(false);
      expect(
        isStripeSecretsConfigured({
          STRIPE_SECRET_KEY: 'sk_test_123',
          STRIPE_WEBHOOK_SECRET: 'whsec_123',
        } as Env)
      ).toBe(true);
    });

    it('isStripeCheckoutLive enforces STRIPE_CHECKOUT_LIVE constant safety gate', () => {
      const liveEnv = {
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_WEBHOOK_SECRET: 'whsec_123',
      } as Env;
      // Until STRIPE_CHECKOUT_LIVE is toggled to true, isStripeCheckoutLive must remain false
      expect(isStripeCheckoutLive(liveEnv)).toBe(STRIPE_CHECKOUT_LIVE);
    });

    it('handleCreateStripeCheckoutSession returns 503 STRIPE_NOT_LIVE when checkout is not live', async () => {
      const env = {
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_WEBHOOK_SECRET: 'whsec_123',
      } as Env;

      const req = new Request('https://api.luminara.ai/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: 'growth' }),
      });

      const res = await handleCreateStripeCheckoutSession(req, env);
      expect(res.status).toBe(503);
      const body = await res.json() as any;
      expect(body.ok).toBe(false);
      expect(body.code).toBe('STRIPE_NOT_LIVE');
    });

    it('the routed handler stays shut for a signed-in buyer with live keys in production', async () => {
      const { env } = makeEnv(PRODUCTION);
      const { cookie } = await signIn(env);
      const res = await handleCreateStripeCheckoutSession(checkoutRequest({ cookie, origin: 'https://luminarasuite.com' }), env);
      expect(res.status).toBe(503);
      expect(((await res.json()) as any).code).toBe('STRIPE_NOT_LIVE');
      expect(isStripeCheckoutLive(env)).toBe(false);
    });
  });
});

describe('F1: only a signed-in buyer can start a card checkout', () => {
  it('creates a session for a signed-in buyer, credited to their own id', async () => {
    const { env } = makeEnv();
    const { cookie, userId } = await signIn(env);
    const stripe = stripeApi();
    const res = await createStripeCheckoutSession(checkoutRequest({ cookie }), env, stripe);
    expect(res.status).toBe(200);
    expect((await res.json()) as any).toMatchObject({ ok: true, sessionId: 'cs_test_created', planId: 'growth' });
    expect(stripe.calls).toHaveLength(1);
    const { url, params } = stripe.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(params.get('metadata[userId]')).toBe(userId);
    expect(params.get('metadata[planId]')).toBe('growth');
    expect(params.get('mode')).toBe('payment');
    expect(params.get('line_items[0][price_data][unit_amount]')).toBe('14900');
    expect(params.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(params.get('customer_email')).toBe('buyer@example.com');
  });

  it('answers 401 to a caller who is not signed in, and never calls Stripe', async () => {
    const { env } = makeEnv();
    const stripe = stripeApi();
    const res = await createStripeCheckoutSession(checkoutRequest(), env, stripe);
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).code).toBe('AUTH_REQUIRED');
    expect(stripe.calls).toHaveLength(0);
  });

  it('answers 401 when the session has expired or was revoked, and never calls Stripe', async () => {
    const { env } = makeEnv();
    const stripe = stripeApi();
    const stale = `__session=sid_${'ab'.repeat(24)}`;
    const res = await createStripeCheckoutSession(checkoutRequest({ cookie: stale }), env, stripe);
    expect(res.status).toBe(401);
    expect(stripe.calls).toHaveLength(0);
  });

  it('ignores a userId sent in the body: there is no guest checkout', async () => {
    const { env } = makeEnv();
    const stripe = stripeApi();
    const anonymous = await createStripeCheckoutSession(
      checkoutRequest({ body: { planId: 'growth', userId: 'guest_123' } }),
      env,
      stripe,
    );
    expect(anonymous.status).toBe(401);
    expect(stripe.calls).toHaveLength(0);

    const { cookie, userId } = await signIn(env);
    await createStripeCheckoutSession(checkoutRequest({ cookie, body: { planId: 'growth', userId: 'guest_123' } }), env, stripe);
    expect(stripe.calls).toHaveLength(1);
    expect(stripe.calls[0].params.get('metadata[userId]')).toBe(userId);
    expect(stripe.calls[0].params.toString()).not.toContain('guest_');
  });

  it('the route itself turns an anonymous caller away with 401', async () => {
    const { env } = makeEnv();
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    const res = await worker.fetch(checkoutRequest({ headers: { 'cf-connecting-ip': '203.0.113.10' } }), env, ctx);
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).code).toBe('AUTH_REQUIRED');
  });

  it('a Telegram caller is refused: inside Telegram the only rail is Stars', async () => {
    const { env } = makeEnv();
    const { cookie } = await signIn(env);
    const stripe = stripeApi();
    const res = await createStripeCheckoutSession(
      checkoutRequest({ cookie, headers: { 'x-telegram-init-data': 'query_id=anything' } }),
      env,
      stripe,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as any).toMatchObject({ code: 'CARD_NOT_IN_TELEGRAM', error: CARD_IN_TELEGRAM_ERROR });

    // A Telegram session cookie without the header is still a Telegram surface.
    const sid = await mintOpaqueSession(env, { uid: 'tg:4242', name: 'Buyer' });
    const viaCookie = await createStripeCheckoutSession(checkoutRequest({ cookie: `__session=${sid}` }), env, stripe);
    expect(viaCookie.status).toBe(400);
    expect(((await viaCookie.json()) as any).code).toBe('CARD_NOT_IN_TELEGRAM');
    expect(stripe.calls).toHaveLength(0);
  });
});

describe('F2: the Stripe mode must match the environment', () => {
  it('production needs a live key, everywhere else needs a test key', () => {
    const cfg = (ENVIRONMENT: string | undefined, STRIPE_SECRET_KEY: string) =>
      diagnoseStripeConfig({ ENVIRONMENT, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: secret } as Env);
    expect(cfg('production', LIVE_KEY)).toEqual({ ok: true, livemode: true });
    expect(cfg('production', TEST_KEY).ok).toBe(false);
    expect(cfg('production', 'some_other_key').ok).toBe(false);
    expect(cfg('staging', TEST_KEY)).toEqual({ ok: true, livemode: false });
    expect(cfg(undefined, TEST_KEY)).toEqual({ ok: true, livemode: false });
    expect(cfg('staging', LIVE_KEY).ok).toBe(false);
    expect(cfg('staging', 'some_other_key').ok).toBe(false);
  });

  it('with a test key in production no checkout session is created', async () => {
    const { env } = makeEnv({ ...PRODUCTION, STRIPE_SECRET_KEY: TEST_KEY });
    const { cookie } = await signIn(env);
    const stripe = stripeApi();
    const res = await createStripeCheckoutSession(checkoutRequest({ cookie, origin: 'https://luminarasuite.com' }), env, stripe);
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).code).toBe('STRIPE_NOT_CONFIGURED');
    expect(stripe.calls).toHaveLength(0);
  });

  it('with a test key in production a paid test event grants nothing and is left for redelivery', async () => {
    const { env, sub, ledger } = makeEnv({ ...PRODUCTION, STRIPE_SECRET_KEY: TEST_KEY });
    const res = await deliver(env, paidSession({ sessionId: 'cs_test_4242', userId: 'fb:buyer1', planId: 'agency' }));
    expect(res.status).toBe(503);
    expect(sub('fb:buyer1')).toBeNull();
    expect(await ledger('cs_test_4242')).toBeNull();
  });

  it('in production a test-mode event is ignored even with a live key', async () => {
    const { env, sub, ledger } = makeEnv(PRODUCTION);
    const res = await deliver(env, paidSession({ sessionId: 'cs_test_4242', userId: 'fb:buyer1', planId: 'agency', livemode: false }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).ignored).toBe('livemode_mismatch');
    expect(sub('fb:buyer1')).toBeNull();
    expect(await ledger('cs_test_4242')).toBeNull();
  });

  it('in production a live event is credited', async () => {
    const { env, sub } = makeEnv(PRODUCTION);
    const res = await deliver(env, paidSession({ sessionId: 'cs_live_1', userId: 'fb:buyer1', planId: 'agency', livemode: true }));
    expect(res.status).toBe(200);
    expect(sub('fb:buyer1')?.plan).toBe('agency');
  });

  it('on staging a live event is ignored, and so is an event that does not say which mode it is', async () => {
    const { env, sub } = makeEnv();
    const live = await deliver(env, paidSession({ sessionId: 'cs_live_2', userId: 'fb:buyer1', planId: 'agency', livemode: true }));
    expect(((await live.json()) as any).ignored).toBe('livemode_mismatch');
    const unmarked = paidSession({ sessionId: 'cs_x', userId: 'fb:buyer1', planId: 'agency' }) as Record<string, unknown>;
    delete unmarked.livemode;
    expect(((await (await deliver(env, unmarked)).json()) as any).ignored).toBe('livemode_mismatch');
    expect(sub('fb:buyer1')).toBeNull();
  });
});

describe('F3: nobody pays while the payment could not be credited', () => {
  it.each([
    ['migration 0024 is missing', { DB: createSqliteD1({ skipMigrations: ['0024_stripe_payment_intent'] }) }],
    ['the Stripe ledger table is missing', { DB: createSqliteD1({ skipMigrations: ['0021_stripe_payments', '0024_stripe_payment_intent'] }) }],
  ])('no session is created when %s', async (_name, overrides) => {
    const { env } = makeEnv(overrides);
    const { cookie } = await signIn(env);
    const stripe = stripeApi();
    const res = await createStripeCheckoutSession(checkoutRequest({ cookie }), env, stripe);
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).code).toBe('STRIPE_LEDGER_UNAVAILABLE');
    expect(stripe.calls).toHaveLength(0);
  });

  it('no session is created when the database is not bound', async () => {
    const { env } = makeEnv();
    const { cookie } = await signIn(env);
    (env as any).DB = undefined;
    const stripe = stripeApi();
    const res = await createStripeCheckoutSession(checkoutRequest({ cookie }), env, stripe);
    expect(res.status).toBe(503);
    expect(stripe.calls).toHaveLength(0);
  });

  it('the webhook asks for redelivery, and claims nothing, when the subscription store is not bound', async () => {
    const { env, ledger } = makeEnv();
    const kv = env.LUMINARA_KV;
    (env as any).LUMINARA_KV = undefined;
    const event = paidSession({ sessionId: 'cs_no_kv', userId: 'fb:buyer1', planId: 'growth' });
    const res = await deliver(env, event);
    expect(res.status).toBe(503);
    expect(await ledger('cs_no_kv')).toBeNull();

    // Once the store is back, the redelivered event credits the buyer.
    (env as any).LUMINARA_KV = kv;
    expect((await deliver(env, event)).status).toBe(200);
    expect(await ledger('cs_no_kv')).not.toBeNull();
  });
});

describe('F4: a plan is granted only for a paid checkout session of the right amount', () => {
  it('credits subscription on checkout.session.completed and is idempotent on repeat', async () => {
    const { env, sub, ledger } = makeEnv();
    const event = paidSession({ sessionId: 'cs_test_session_abc123', userId: 'fb:buyer1', planId: 'growth' });
    const before = Date.now();
    const res1 = await deliver(env, event);
    const after = Date.now();
    expect(res1.status).toBe(200);
    expect(((await res1.json()) as any).received).toBe(true);

    const first = sub('fb:buyer1');
    expect(first).toMatchObject({ plan: 'growth', amountTotal: 14900, paymentMethod: 'stripe', sessionId: 'cs_test_session_abc123' });
    expect(first!.expiresAt).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(first!.expiresAt).toBeLessThanOrEqual(after + 30 * DAY_MS);

    expect(await ledger('cs_test_session_abc123')).toMatchObject({ amount_total: 14900, plan_id: 'growth', currency: 'usd' });

    // Duplicate delivery: must succeed idempotently without re-granting
    const res2 = await deliver(env, event);
    expect(res2.status).toBe(200);
    expect((await res2.json()) as any).toMatchObject({ received: true, duplicate: true });
    expect(sub('fb:buyer1')!.expiresAt).toBe(first!.expiresAt);
  });

  it.each([
    ['payment_status is unpaid', { payment_status: 'unpaid' }],
    ['payment_status is no_payment_required', { payment_status: 'no_payment_required' }],
    ['the amount is lower than the plan price', { amount_total: 100 }],
    ['the amount is higher than the plan price', { amount_total: 34900 }],
    ['the amount is missing', { amount_total: undefined }],
    ['the currency is not usd', { currency: 'eur' }],
    ['the mode is subscription', { mode: 'subscription' }],
    ['the mode is setup', { mode: 'setup' }],
    ['the buyer is named only by client_reference_id', { metadata: { planId: 'growth' }, client_reference_id: 'fb:buyer1' }],
    ['the metadata uses names the server never writes', { metadata: { plan: 'growth', accountId: 'fb:buyer1' } }],
    ['the plan is not one the server sells', { metadata: { planId: 'constructor', userId: 'fb:buyer1' } }],
  ])('grants nothing when %s', async (_name, session) => {
    const { env, sub, ledger } = makeEnv();
    const res = await deliver(env, paidSession({ sessionId: 'cs_bad', userId: 'fb:buyer1', planId: 'growth', session }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).ignored).toBeTruthy();
    expect(sub('fb:buyer1')).toBeNull();
    expect(await ledger('cs_bad')).toBeNull();
  });

  it('grants nothing on invoice.payment_succeeded, so one payment cannot be credited under a second id', async () => {
    const { env, sub, ledger } = makeEnv();
    const invoice = paidSession({ sessionId: 'in_test_1', userId: 'fb:buyer1', planId: 'growth', type: 'invoice.payment_succeeded', session: { amount_paid: 14900 } });
    const res = await deliver(env, invoice);
    expect(res.status).toBe(200);
    expect(sub('fb:buyer1')).toBeNull();
    expect(await ledger('in_test_1')).toBeNull();
  });

  it('rejects webhooks with invalid signatures', async () => {
    const { env, sub } = makeEnv();
    const payload = JSON.stringify(paidSession({ sessionId: 'cs_forged', userId: 'fb:buyer1', planId: 'agency' }));
    const t = Math.floor(Date.now() / 1000);
    const signedWithAnotherSecret = await generateValidSignatureHeader(payload, 'whsec_not_the_real_one');
    // A fresh timestamp each time, so only the HMAC (or the header shape) can refuse these.
    for (const header of [signedWithAnotherSecret, `t=${t},v1=${'0'.repeat(64)}`, `t=${t},v1=invalid`, `t=${t},v1`, `t=${t}`]) {
      const req = new Request('https://api.luminara.ai/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': header },
        body: payload,
      });
      const res = await handleStripeWebhook(req, env);
      expect(res.status, header).toBe(400);
      expect(((await res.json()) as any).error).toBe('Invalid Stripe signature');
    }
    expect(sub('fb:buyer1')).toBeNull();
  });

  it('a failed subscription write releases the claim, and the retry adds the days once', async () => {
    const { env, kv, sub, ledger } = makeEnv();
    // The buyer's login shares an account, so the grant is two writes: sub:{account} then sub:{login}.
    await (env.DB as any)
      .prepare(`INSERT INTO users (id, source, created_at, last_seen_at, account_id) VALUES ('fb:buyer1', 'firebase', 1, 1, 'acct_shared')`)
      .run();
    const event = paidSession({ sessionId: 'cs_half', userId: 'fb:buyer1', planId: 'growth' });

    kv.failNextPut((key) => key === 'sub:fb:buyer1');
    await expect(deliver(env, event)).rejects.toThrow('KV put failed');
    expect(await ledger('cs_half')).toBeNull();
    const half = sub('acct_shared');
    expect(half?.plan).toBe('growth');

    expect((await deliver(env, event)).status).toBe(200);
    expect(sub('acct_shared')!.expiresAt).toBe(half!.expiresAt);
    expect(sub('fb:buyer1')!.expiresAt).toBe(half!.expiresAt);
    expect(await ledger('cs_half')).not.toBeNull();
  });

  it('a retry after a half-finished write is not refunded or added again when the buyer has upgraded in between', async () => {
    const { env, kv, sub, ledger } = makeEnv();
    await (env.DB as any)
      .prepare(`INSERT INTO users (id, source, created_at, last_seen_at, account_id) VALUES ('fb:buyer1', 'firebase', 1, 1, 'acct_shared')`)
      .run();
    const starter = paidSession({ sessionId: 'cs_half', userId: 'fb:buyer1', planId: 'starter', paymentIntent: 'pi_half' });

    kv.failNextPut((key) => key === 'sub:fb:buyer1');
    await expect(deliver(env, starter)).rejects.toThrow('KV put failed');
    const starterUntil = sub('acct_shared')!.expiresAt;

    // Before Stripe redelivers, the buyer upgrades by card.
    await deliver(env, paidSession({ sessionId: 'cs_up', userId: 'fb:buyer1', planId: 'agency', paymentIntent: 'pi_up' }));
    const upgraded = sub('acct_shared')!;
    expect(upgraded).toMatchObject({ plan: 'agency', expiresAt: starterUntil + 30 * DAY_MS });

    // The Starter days are already in that expiry: the retry must not send the money back, and must not add them again.
    const stripe = stripeApi({ id: 're_never' });
    const retry = await deliver(env, starter, stripe.fetcher);
    expect(retry.status).toBe(200);
    expect(stripe.calls).toHaveLength(0);
    expect(sub('acct_shared')).toEqual(upgraded);
    expect(sub('fb:buyer1')).toEqual(upgraded);
    expect(await ledger('cs_half')).toMatchObject({ granted_days: 30, reversed_at: null });
  });

  it('a session can be paid for one hour, not for a day', async () => {
    const { env } = makeEnv();
    const { cookie } = await signIn(env);
    const stripe = stripeApi();
    const before = Math.floor(Date.now() / 1000);
    await createStripeCheckoutSession(checkoutRequest({ cookie }), env, stripe);
    const expiresAt = Number(stripe.calls[0].params.get('expires_at'));
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3600);
    expect(expiresAt).toBeLessThanOrEqual(before + 3600 + 60);
  });
});

describe('Stripe does not promise event order', () => {
  it.each([
    ['charge.refunded', { id: 'ch_1', payment_intent: 'pi_early', refunded: true }],
    ['charge.dispute.created', { id: 'dp_1', payment_intent: 'pi_early', status: 'needs_response' }],
  ])('a %s that arrives before its session was credited stops the late session from being credited', async (type, object) => {
    const { env, sub, ledger } = makeEnv();
    const early = await deliver(env, stripeEvent(type, object));
    expect(early.status).toBe(200);
    expect(((await early.json()) as any).ignored).toBe('not_found');

    // The session event Stripe was still retrying arrives now. The money has gone back: no plan.
    const late = await deliver(env, paidSession({ sessionId: 'cs_late', userId: 'fb:buyer1', planId: 'agency', paymentIntent: 'pi_early' }));
    expect(late.status).toBe(200);
    expect(((await late.json()) as any).duplicate).toBe(true);
    expect(sub('fb:buyer1')).toBeNull();
    expect(await ledger('cs_late')).toBeNull();

    // The same refund again is a repeat, and other payments are untouched.
    const again = await deliver(env, stripeEvent(type, object));
    expect(((await again.json()) as any).ignored).toBe('already_reversed');
    await deliver(env, paidSession({ sessionId: 'cs_ok', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_ok' }));
    expect(sub('fb:buyer1')?.plan).toBe('growth');
  });
});

describe('F5: a refund or a dispute takes back the days that charge granted', () => {
  it('the ledger row keeps the payment intent, the buyer, the days granted and when they end', async () => {
    const { env, sub, ledger } = makeEnv();
    await deliver(env, paidSession({ sessionId: 'cs_1', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_1' }));
    expect(await ledger('cs_1')).toMatchObject({
      payment_intent: 'pi_1',
      user_id: 'fb:buyer1',
      granted_days: 30,
      granted_until: sub('fb:buyer1')!.expiresAt,
      prev_plan: null,
      reversed_at: null,
      reversal_reason: null,
    });
  });

  it.each([
    ['charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', refunded: true, amount: 14900, amount_refunded: 14900 }, 'refund'],
    ['charge.dispute.created', { id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1', status: 'needs_response' }, 'dispute'],
    ['charge.dispute.funds_withdrawn', { id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1', status: 'needs_response' }, 'dispute'],
  ])('%s ends the plan that charge paid for, once', async (type, object, reason) => {
    const { env, sub, ledger } = makeEnv();
    await deliver(env, paidSession({ sessionId: 'cs_1', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_1' }));
    expect(sub('fb:buyer1')!.expiresAt).toBeGreaterThan(Date.now());

    const res = await deliver(env, stripeEvent(type, object));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).reversed).toBe(reason);
    const after = sub('fb:buyer1')!;
    expect(after.expiresAt).toBeLessThanOrEqual(Date.now());
    expect(after.reversedStripeSessions).toEqual(['cs_1']);
    const row = await ledger('cs_1');
    expect(row!.reversal_reason).toBe(reason);
    expect(row!.reversed_at).toBeGreaterThan(0);

    // The same event again changes nothing.
    const again = await deliver(env, stripeEvent(type, object));
    expect(((await again.json()) as any).ignored).toBe('already_reversed');
    expect(sub('fb:buyer1')).toEqual(after);
  });

  it('a refund and a dispute for one charge remove its days once, not twice', async () => {
    const { env, sub } = makeEnv();
    await deliver(env, paidSession({ sessionId: 'cs_1', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_1' }));
    await deliver(env, paidSession({ sessionId: 'cs_2', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_2' }));
    const paid = sub('fb:buyer1')!.expiresAt;

    await deliver(env, stripeEvent('charge.dispute.created', { id: 'dp_1', payment_intent: 'pi_1', status: 'needs_response' }));
    await deliver(env, stripeEvent('charge.dispute.funds_withdrawn', { id: 'dp_1', payment_intent: 'pi_1', status: 'needs_response' }));
    await deliver(env, stripeEvent('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', refunded: true }));

    // Two 30-day charges, one reversed: 30 days come off, and the plan is still running.
    expectAbout(sub('fb:buyer1')!.expiresAt, paid - 30 * DAY_MS);
    expect(sub('fb:buyer1')!.plan).toBe('growth');
  });

  it('a partial refund leaves the plan as it is', async () => {
    const { env, sub, ledger } = makeEnv();
    await deliver(env, paidSession({ sessionId: 'cs_1', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_1' }));
    const before = sub('fb:buyer1');
    const res = await deliver(env, stripeEvent('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount: 14900, amount_refunded: 1000 }));
    expect(((await res.json()) as any).ignored).toBe('partial_refund');
    expect(sub('fb:buyer1')).toEqual(before);
    expect((await ledger('cs_1'))!.reversed_at).toBeNull();
  });

  it('an inquiry is not a dispute: the plan stays until funds are withdrawn', async () => {
    const { env, sub, ledger } = makeEnv();
    await deliver(env, paidSession({ sessionId: 'cs_1', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_1' }));
    const before = sub('fb:buyer1');

    const inquiry = await deliver(env, stripeEvent('charge.dispute.created', { id: 'dp_1', payment_intent: 'pi_1', status: 'warning_needs_response' }));
    expect(((await inquiry.json()) as any).ignored).toBe('dispute_inquiry');
    expect(sub('fb:buyer1')).toEqual(before);
    expect((await ledger('cs_1'))!.reversed_at).toBeNull();

    // The inquiry becomes a chargeback.
    const withdrawn = await deliver(env, stripeEvent('charge.dispute.funds_withdrawn', { id: 'dp_1', payment_intent: 'pi_1', status: 'needs_response' }));
    expect(((await withdrawn.json()) as any).reversed).toBe('dispute');
    expect(sub('fb:buyer1')!.expiresAt).toBeLessThanOrEqual(Date.now());
  });

  it('a refund for a charge this Worker never credited is acknowledged and changes nothing', async () => {
    const { env, kv } = makeEnv();
    kv.store.set('sub:fb:buyer1', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 10 * DAY_MS }));
    const before = kv.store.get('sub:fb:buyer1');
    const res = await deliver(env, stripeEvent('charge.refunded', { id: 'ch_other', payment_intent: 'pi_other_product', refunded: true }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).ignored).toBe('not_found');
    expect(kv.store.get('sub:fb:buyer1')).toBe(before);
  });

  it('both copies of the subscription are rewritten when the login shares an account', async () => {
    const { env, sub } = makeEnv();
    await (env.DB as any)
      .prepare(`INSERT INTO users (id, source, created_at, last_seen_at, account_id) VALUES ('fb:buyer1', 'firebase', 1, 1, 'acct_shared')`)
      .run();
    await deliver(env, paidSession({ sessionId: 'cs_1', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_1' }));
    expect(sub('acct_shared')!.expiresAt).toBeGreaterThan(Date.now());
    expect(sub('fb:buyer1')!.expiresAt).toBeGreaterThan(Date.now());

    await deliver(env, stripeEvent('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', refunded: true }));
    expect(sub('acct_shared')!.expiresAt).toBeLessThanOrEqual(Date.now());
    expect(sub('fb:buyer1')!.expiresAt).toBeLessThanOrEqual(Date.now());
  });

  it('a failed write releases the reversal, and the retry removes the days once', async () => {
    const { env, kv, sub, ledger } = makeEnv();
    // Two writes per change: sub:{account} then sub:{login}. The second one fails, once.
    await (env.DB as any)
      .prepare(`INSERT INTO users (id, source, created_at, last_seen_at, account_id) VALUES ('fb:buyer1', 'firebase', 1, 1, 'acct_shared')`)
      .run();
    await deliver(env, paidSession({ sessionId: 'cs_1', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_1' }));
    await deliver(env, paidSession({ sessionId: 'cs_2', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_2' }));
    const paid = sub('acct_shared')!.expiresAt;
    const refund = stripeEvent('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', refunded: true });

    kv.failNextPut((key) => key === 'sub:fb:buyer1');
    await expect(deliver(env, refund)).rejects.toThrow('KV put failed');
    expect((await ledger('cs_1'))!.reversed_at).toBeNull();
    const half = sub('acct_shared')!.expiresAt;
    expectAbout(half, paid - 30 * DAY_MS);
    expect(sub('fb:buyer1')!.expiresAt).toBe(paid);

    // Another reversal lands in between and is written in full.
    await deliver(env, paidSession({ sessionId: 'cs_3', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_3' }));
    await deliver(env, stripeEvent('charge.refunded', { id: 'ch_3', payment_intent: 'pi_3', refunded: true }));
    const between = sub('acct_shared')!.expiresAt;
    expectAbout(between, half);

    // The retried refund of cs_1 finds itself on the record and takes nothing more.
    expect((await deliver(env, refund)).status).toBe(200);
    expect(sub('acct_shared')!.expiresAt).toBe(between);
    expect(sub('fb:buyer1')!.expiresAt).toBe(between);
    expect((await ledger('cs_1'))!.reversal_reason).toBe('refund');
  });

  it('only the days still ahead come off: a card month that has run out cannot shorten a plan paid another way', async () => {
    const { env, kv, sub } = makeEnv();
    await deliver(env, paidSession({ sessionId: 'cs_old', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_old' }));

    passDays(40); // the card month is used up and has lapsed
    const starsUntil = Date.now() + 30 * DAY_MS;
    kv.store.set('sub:fb:buyer1', otherRailRecord('growth', starsUntil));

    passDays(1);
    const res = await deliver(env, stripeEvent('charge.refunded', { id: 'ch_old', payment_intent: 'pi_old', refunded: true }));
    expect(((await res.json()) as any).reversed).toBe('refund');
    expect(sub('fb:buyer1')).toMatchObject({ plan: 'growth', expiresAt: starsUntil, chargeId: 'tg_charge_1' });
  });

  it('a card month refunded part way through leaves the month bought on another rail whole', async () => {
    const { env, kv, sub } = makeEnv();
    await deliver(env, paidSession({ sessionId: 'cs_1', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_1' }));
    const cardUntil = sub('fb:buyer1')!.expiresAt;

    passDays(5);
    kv.store.set('sub:fb:buyer1', otherRailRecord('growth', cardUntil + 30 * DAY_MS)); // a Stars renewal on top

    passDays(5);
    await deliver(env, stripeEvent('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', refunded: true }));
    // 20 of the card month's days were still ahead. They come off, and 30 days remain from now.
    expectAbout(sub('fb:buyer1')!.expiresAt, Date.now() + 30 * DAY_MS);
    expect(sub('fb:buyer1')!.plan).toBe('growth');
  });
});

describe('F5: a reversed upgrade does not leave the higher plan behind', () => {
  const dispute = (pi: string) => stripeEvent('charge.dispute.created', { id: `dp_${pi}`, payment_intent: pi, status: 'needs_response' });

  it('a disputed upgrade gives back the plan it replaced, with the days that were paid for', async () => {
    const { env, kv, sub, ledger } = makeEnv();
    const starterUntil = Date.now() + 20 * DAY_MS;
    kv.store.set('sub:fb:buyer1', otherRailRecord('starter', starterUntil));

    await deliver(env, paidSession({ sessionId: 'cs_up', userId: 'fb:buyer1', planId: 'agency', paymentIntent: 'pi_up' }));
    expect(sub('fb:buyer1')).toMatchObject({ plan: 'agency', expiresAt: starterUntil + 30 * DAY_MS });
    expect((await ledger('cs_up'))!.prev_plan).toBe('starter');

    await deliver(env, dispute('pi_up'));
    expect(sub('fb:buyer1')).toMatchObject({ plan: 'starter', expiresAt: starterUntil });
  });

  it.each([
    ['the second upgrade first', ['pi_2', 'pi_1']],
    ['the first upgrade first', ['pi_1', 'pi_2']],
  ])('two card upgrades, both disputed (%s): the cheap days do not stay Agency days', async (_name, order) => {
    const { env, kv, sub } = makeEnv();
    const starterUntil = Date.now() + 300 * DAY_MS;
    kv.store.set('sub:fb:buyer1', otherRailRecord('starter', starterUntil));
    await deliver(env, paidSession({ sessionId: 'cs_1', userId: 'fb:buyer1', planId: 'agency', paymentIntent: 'pi_1' }));
    await deliver(env, paidSession({ sessionId: 'cs_2', userId: 'fb:buyer1', planId: 'agency', paymentIntent: 'pi_2' }));
    expect(sub('fb:buyer1')).toMatchObject({ plan: 'agency', expiresAt: starterUntil + 60 * DAY_MS });

    await deliver(env, dispute(order[0]));
    // One Agency charge still stands, so the plan is still Agency.
    expect(sub('fb:buyer1')).toMatchObject({ plan: 'agency', expiresAt: starterUntil + 30 * DAY_MS });

    await deliver(env, dispute(order[1]));
    expect(sub('fb:buyer1')).toMatchObject({ plan: 'starter', expiresAt: starterUntil });
  });

  it.each([
    ['Agency first', ['pi_a', 'pi_g'], 'growth'],
    ['Growth first', ['pi_g', 'pi_a'], 'agency'],
  ])('a Growth then an Agency upgrade, both disputed (%s): the plan steps down to what is still paid for', async (_name, order, afterFirst) => {
    const { env, kv, sub } = makeEnv();
    const starterUntil = Date.now() + 100 * DAY_MS;
    kv.store.set('sub:fb:buyer1', otherRailRecord('starter', starterUntil));
    await deliver(env, paidSession({ sessionId: 'cs_g', userId: 'fb:buyer1', planId: 'growth', paymentIntent: 'pi_g' }));
    await deliver(env, paidSession({ sessionId: 'cs_a', userId: 'fb:buyer1', planId: 'agency', paymentIntent: 'pi_a' }));

    await deliver(env, dispute(order[0]));
    expect(sub('fb:buyer1')!.plan).toBe(afterFirst);
    await deliver(env, dispute(order[1]));
    expect(sub('fb:buyer1')).toMatchObject({ plan: 'starter', expiresAt: starterUntil });
  });

  it('a renewal that still stands keeps the plan it pays for', async () => {
    const { env, sub } = makeEnv();
    await deliver(env, paidSession({ sessionId: 'cs_1', userId: 'fb:buyer1', planId: 'agency', paymentIntent: 'pi_1' }));
    await deliver(env, paidSession({ sessionId: 'cs_2', userId: 'fb:buyer1', planId: 'agency', paymentIntent: 'pi_2' }));
    const paid = sub('fb:buyer1')!.expiresAt;
    await deliver(env, dispute('pi_1'));
    expect(sub('fb:buyer1')!.plan).toBe('agency');
    expectAbout(sub('fb:buyer1')!.expiresAt, paid - 30 * DAY_MS);
  });

  it('when another rail has set the plan since, the name is left alone and only the days come off', async () => {
    const { env, kv, sub } = makeEnv();
    const starterUntil = Date.now() + 100 * DAY_MS;
    kv.store.set('sub:fb:buyer1', otherRailRecord('starter', starterUntil));
    await deliver(env, paidSession({ sessionId: 'cs_up', userId: 'fb:buyer1', planId: 'agency', paymentIntent: 'pi_up' }));

    // The buyer then pays for Agency with Stars, which writes its own record.
    const starsUntil = starterUntil + 60 * DAY_MS;
    kv.store.set('sub:fb:buyer1', otherRailRecord('agency', starsUntil));

    await deliver(env, dispute('pi_up'));
    expect(sub('fb:buyer1')).toMatchObject({ plan: 'agency', expiresAt: starsUntil - 30 * DAY_MS });
  });
});

describe('F6: the payer always returns to the Luminara site', () => {
  it('builds both return URLs from WEBAPP_URL, whatever the body and the Origin header say', async () => {
    const { env } = makeEnv(PRODUCTION);
    const { cookie } = await signIn(env);
    const stripe = stripeApi();
    const res = await createStripeCheckoutSession(
      checkoutRequest({
        cookie,
        // An allowed origin, but not the one WEBAPP_URL names: it must not be used either.
        origin: 'https://www.luminarasuite.com',
        body: {
          planId: 'starter',
          successUrl: 'https://evil.example/thanks',
          cancelUrl: 'https://evil.example/cancel',
          customerEmail: 'someone-else@evil.example',
        },
      }),
      env,
      stripe,
    );
    expect(res.status).toBe(200);
    const { params } = stripe.calls[0];
    expect(params.get('success_url')).toBe('https://luminarasuite.com/?payment=success&plan=starter&session_id={CHECKOUT_SESSION_ID}');
    expect(params.get('cancel_url')).toBe('https://luminarasuite.com/pricing?payment=cancelled');
    expect(params.toString()).not.toContain('evil.example');
    expect(params.get('customer_email')).toBe('buyer@example.com');
  });

  it.each([undefined, '', 'not a url', 'javascript:alert(1)', 'http://luminarasuite.com/'])(
    'refuses to create a session in production when WEBAPP_URL is %s',
    async (WEBAPP_URL) => {
      const { env } = makeEnv({ ...PRODUCTION, WEBAPP_URL });
      const { cookie } = await signIn(env);
      const stripe = stripeApi();
      const res = await createStripeCheckoutSession(checkoutRequest({ cookie, origin: 'https://luminarasuite.com' }), env, stripe);
      expect(res.status).toBe(503);
      expect(stripe.calls).toHaveLength(0);
    },
  );
});

describe('F14: the checkout route is rate limited and the webhook body is capped', () => {
  it('create-checkout-session uses the auth limiter: the 21st call in a minute from one address is refused', async () => {
    const { env } = makeEnv();
    const { cookie } = await signIn(env);
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    const call = () => worker.fetch(checkoutRequest({ cookie, headers: { 'cf-connecting-ip': '203.0.113.77' } }), env, ctx);
    for (let i = 0; i < 20; i++) {
      const res = await call();
      expect(res.status).toBe(503);
    }
    const limited = await call();
    expect(limited.status).toBe(429);
  });

  it('a webhook body over the cap is refused before its signature is checked', async () => {
    const { env } = makeEnv();
    const big = paidSession({ sessionId: 'cs_big', userId: 'fb:buyer1', planId: 'growth', session: { padding: 'x'.repeat(70_000) } });
    // Correctly signed, so without a cap this event would be accepted and credited.
    const res = await deliver(env, big);
    expect(res.status).toBe(413);

    // Wrongly signed: still 413, not 400, so the HMAC was never computed over it.
    const unsigned = new Request('https://staging.luminarasuite.com/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` },
      body: JSON.stringify(big),
    });
    expect((await handleStripeWebhook(unsigned, env)).status).toBe(413);
  });

  it('a checkout body over the cap is refused', async () => {
    const { env } = makeEnv();
    const { cookie } = await signIn(env);
    const stripe = stripeApi();
    const res = await createStripeCheckoutSession(checkoutRequest({ cookie, body: { planId: 'growth', padding: 'x'.repeat(70_000) } }), env, stripe);
    expect(res.status).toBe(413);
    expect(stripe.calls).toHaveLength(0);
  });
});

describe('Plan rank (Track SW, SW0a-4): a lower plan never replaces a higher active one', () => {
  it('ranks starter below growth below agency, with "pro" as agency and anything unknown as free', () => {
    expect(planRank('starter')).toBeLessThan(planRank('growth'));
    expect(planRank('growth')).toBeLessThan(planRank('agency'));
    expect(planRank('pro')).toBe(planRank('agency'));
    expect(planRank('AGENCY')).toBe(planRank('agency'));
    for (const unknown of ['', 'free', 'constructor', undefined, null, 42]) expect(planRank(unknown)).toBe(0);
  });

  it.each([
    ['agency', 'starter'],
    ['agency', 'growth'],
    ['growth', 'starter'],
    ['pro', 'growth'],
  ])('with %s active, a %s checkout is refused before payment', async (active, planId) => {
    const { env, kv } = makeEnv();
    const { cookie, userId } = await signIn(env);
    kv.store.set(`sub:${userId}`, JSON.stringify({ plan: active, expiresAt: Date.now() + 15 * DAY_MS }));
    const stripe = stripeApi();
    const res = await createStripeCheckoutSession(checkoutRequest({ cookie, body: { planId } }), env, stripe);
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.code).toBe('LOWER_PLAN_REFUSED');
    expect(body.error).toMatch(/no payment was started/);
    expect(stripe.calls).toHaveLength(0);
  });

  it.each([
    ['growth', 'growth'],
    ['starter', 'agency'],
    ['agency', 'agency'],
  ])('with %s active, a %s checkout goes ahead', async (active, planId) => {
    const { env, kv } = makeEnv();
    const { cookie, userId } = await signIn(env);
    kv.store.set(`sub:${userId}`, JSON.stringify({ plan: active, expiresAt: Date.now() + 15 * DAY_MS }));
    const stripe = stripeApi();
    const res = await createStripeCheckoutSession(checkoutRequest({ cookie, body: { planId } }), env, stripe);
    expect(res.status).toBe(200);
    expect(stripe.calls).toHaveLength(1);
  });

  it('an expired higher plan does not block a lower one', async () => {
    const { env, kv } = makeEnv();
    const { cookie, userId } = await signIn(env);
    kv.store.set(`sub:${userId}`, JSON.stringify({ plan: 'agency', expiresAt: Date.now() - DAY_MS }));
    const stripe = stripeApi();
    const res = await createStripeCheckoutSession(checkoutRequest({ cookie, body: { planId: 'starter' } }), env, stripe);
    expect(res.status).toBe(200);
  });

  it('a lower plan paid while a higher one is active changes nothing and is sent back to the payer', async () => {
    const { env, kv, sub, ledger } = makeEnv();
    const agencyExpiry = Date.now() + 15 * DAY_MS;
    kv.store.set('sub:fb:buyer1', JSON.stringify({ plan: 'agency', startedAt: 1, expiresAt: agencyExpiry }));
    const before = kv.store.get('sub:fb:buyer1');
    const stripe = stripeApi({ id: 're_1', status: 'succeeded' });

    const res = await deliver(env, paidSession({ sessionId: 'cs_low', userId: 'fb:buyer1', planId: 'starter', paymentIntent: 'pi_low' }), stripe.fetcher);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).refunded).toBe('lower_plan_refused');

    // Plan and expiry are exactly as they were: the Starter price bought no Agency days.
    expect(kv.store.get('sub:fb:buyer1')).toBe(before);
    expect(sub('fb:buyer1')).toMatchObject({ plan: 'agency', expiresAt: agencyExpiry });

    expect(stripe.calls).toHaveLength(1);
    expect(stripe.calls[0].url).toBe('https://api.stripe.com/v1/refunds');
    expect(stripe.calls[0].params.get('payment_intent')).toBe('pi_low');
    expect(stripe.calls[0].headers['Idempotency-Key']).toBe('lower-plan-refund-cs_low');
    expect(await ledger('cs_low')).toMatchObject({ granted_days: 0, reversal_reason: 'lower_plan_refused' });

    // Stripe then reports that refund. It must not take days off the Agency plan.
    const echo = await deliver(env, stripeEvent('charge.refunded', { id: 'ch_low', payment_intent: 'pi_low', refunded: true }), stripe.fetcher);
    expect(((await echo.json()) as any).ignored).toBe('already_reversed');
    expect(kv.store.get('sub:fb:buyer1')).toBe(before);
  });

  it('if that refund cannot be sent, the event is left for redelivery and nothing is recorded as handled', async () => {
    const { env, kv, ledger } = makeEnv();
    kv.store.set('sub:fb:buyer1', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 15 * DAY_MS }));
    const before = kv.store.get('sub:fb:buyer1');
    const event = paidSession({ sessionId: 'cs_low', userId: 'fb:buyer1', planId: 'starter', paymentIntent: 'pi_low' });

    const down = stripeApi({ error: { code: 'api_error' } }, 500);
    await expect(deliver(env, event, down.fetcher)).rejects.toThrow(/refund/i);
    expect(await ledger('cs_low')).toBeNull();
    expect(kv.store.get('sub:fb:buyer1')).toBe(before);

    // Redelivery, with Stripe saying the charge is already refunded (the owner did it by hand): done.
    const done = stripeApi({ error: { code: 'charge_already_refunded' } }, 400);
    expect((await deliver(env, event, done.fetcher)).status).toBe(200);
    expect((await ledger('cs_low'))!.reversal_reason).toBe('lower_plan_refused');
  });

  it.each(['charge_disputed', 'refund_disputed_payment'])('a refused payment the bank has already charged back (%s) is settled, not retried', async (code) => {
    const { env, kv, ledger } = makeEnv();
    kv.store.set('sub:fb:buyer1', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 15 * DAY_MS }));
    const before = kv.store.get('sub:fb:buyer1');
    const stripe = stripeApi({ error: { code } }, 400);
    const res = await deliver(env, paidSession({ sessionId: 'cs_low', userId: 'fb:buyer1', planId: 'starter', paymentIntent: 'pi_low' }), stripe.fetcher);
    expect(res.status).toBe(200);
    expect((await ledger('cs_low'))!.reversal_reason).toBe('lower_plan_refused');

    // The chargeback event that follows takes nothing from the plan the buyer does hold.
    await deliver(env, stripeEvent('charge.dispute.created', { id: 'dp_low', payment_intent: 'pi_low', status: 'needs_response' }));
    expect(kv.store.get('sub:fb:buyer1')).toBe(before);
  });

  it('a session already credited is never refunded on redelivery, even after the buyer upgrades', async () => {
    const { env, sub } = makeEnv();
    const starter = paidSession({ sessionId: 'cs_s', userId: 'fb:buyer1', planId: 'starter', paymentIntent: 'pi_s' });
    await deliver(env, starter);
    await deliver(env, paidSession({ sessionId: 'cs_a', userId: 'fb:buyer1', planId: 'agency', paymentIntent: 'pi_a' }));
    const upgraded = sub('fb:buyer1');
    expect(upgraded!.plan).toBe('agency');

    const stripe = stripeApi({ id: 're_never' });
    const again = await deliver(env, starter, stripe.fetcher);
    expect(((await again.json()) as any).duplicate).toBe(true);
    expect(stripe.calls).toHaveLength(0);
    expect(sub('fb:buyer1')).toEqual(upgraded);
  });

  it('the same plan again extends the expiry and keeps the plan', async () => {
    const { env, kv, sub } = makeEnv();
    const growthUntil = Date.now() + 10 * DAY_MS;
    kv.store.set('sub:fb:buyer1', JSON.stringify({ plan: 'growth', expiresAt: growthUntil }));
    await deliver(env, paidSession({ sessionId: 'cs_renew', userId: 'fb:buyer1', planId: 'growth' }));
    expect(sub('fb:buyer1')).toMatchObject({ plan: 'growth', expiresAt: growthUntil + 30 * DAY_MS });
  });

  it('a higher plan adds its days to the current expiry and replaces the plan name', async () => {
    const { env, kv, sub, ledger } = makeEnv();
    const starterUntil = Date.now() + 10 * DAY_MS;
    kv.store.set('sub:fb:buyer1', JSON.stringify({ plan: 'starter', expiresAt: starterUntil }));
    await deliver(env, paidSession({ sessionId: 'cs_up', userId: 'fb:buyer1', planId: 'agency' }));
    expect(sub('fb:buyer1')).toMatchObject({ plan: 'agency', expiresAt: starterUntil + 30 * DAY_MS });
    expect((await ledger('cs_up'))!.prev_plan).toBe('starter');
  });
});
