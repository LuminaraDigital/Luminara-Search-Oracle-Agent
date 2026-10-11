/**
 * Stripe checkout, subscription crediting, and webhook listener for Luminara Suite.
 * Cloudflare Workers native implementation using Web Crypto API.
 * Invariants: worker/README.md, "Stripe card rail invariants".
 */
import type { Env } from './env';
import { billingId, identify, json } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import {
  claimStripeReversal,
  claimStripeSession,
  isStripeLedgerReady,
  liveStripePlans,
  releaseStripeReversal,
  releaseStripeSession,
} from './paymentLedger';
import { resolveAccountId, writeSubscriptionRecord } from './userStore';
import { normalizePlanId } from '../services/plans/planEntitlements';

/**
 * Flip to true only after staging Checkout + webhook credit is proven (commercial CC2).
 * Secrets alone must not light the Card rail in the client.
 */
export const STRIPE_CHECKOUT_LIVE = false;

/** True when both Stripe secrets are present (Worker can create sessions / verify webhooks). */
export function isStripeSecretsConfigured(env: Env): boolean {
  return Boolean(String(env.STRIPE_SECRET_KEY || '').trim() && String(env.STRIPE_WEBHOOK_SECRET || '').trim());
}

function isProductionEnv(env: Pick<Env, 'ENVIRONMENT'>): boolean {
  return String(env.ENVIRONMENT || '').trim().toLowerCase() === 'production';
}

function stripeKeyMode(key: unknown): 'live' | 'test' | 'unknown' {
  const value = String(key || '').trim();
  if (/^(sk|rk)_live_/.test(value)) return 'live';
  if (/^(sk|rk)_test_/.test(value)) return 'test';
  return 'unknown';
}

export type StripeConfig = { ok: true; livemode: boolean } | { ok: false; reason: string };

/**
 * The Stripe mode this environment must run in: live in production, test everywhere else.
 * A test key in production would let card 4242... buy a real plan, and a live key on staging
 * would charge a real card for a staging plan. Either way the rail stays closed.
 */
export function diagnoseStripeConfig(env: Env): StripeConfig {
  if (!isStripeSecretsConfigured(env)) return { ok: false, reason: 'STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is not set' };
  const mode = stripeKeyMode(env.STRIPE_SECRET_KEY);
  const production = isProductionEnv(env);
  if (production && mode !== 'live') return { ok: false, reason: 'ENVIRONMENT=production requires a live Stripe secret key' };
  if (!production && mode !== 'test') return { ok: false, reason: 'outside production a test Stripe secret key is required' };
  return { ok: true, livemode: production };
}

/** Public health / Paywall: Card rail only when live flag + secrets in the right mode for the environment. */
export function isStripeCheckoutLive(env: Env): boolean {
  return STRIPE_CHECKOUT_LIVE && diagnoseStripeConfig(env).ok;
}

export const STRIPE_PLAN_CONFIG: Record<
  string,
  { name: string; amountCents: number; description: string; days: number }
> = {
  starter: {
    name: 'Luminara Suite - Starter Plan',
    amountCents: 4900,
    description: '30-day web audit access for up to 2 domains.',
    days: 30,
  },
  growth: {
    name: 'Luminara Suite - Growth Plan',
    amountCents: 14900,
    description: '30-day access: IDE connectors, branded share links, 3 seats, weekly re-audits.',
    days: 30,
  },
  agency: {
    name: 'Luminara Suite - Agency Plan',
    amountCents: 34900,
    description: '30-day access: Research API access, 10 seats, daily re-audits, white-label exports.',
    days: 30,
  },
};

const STRIPE_CURRENCY = 'usd';
const DAY_MS = 86400_000;
/**
 * A checkout session can be paid for one hour (Stripe allows 30 minutes to 24 hours). A short
 * life keeps a session opened under an old price, or before the buyer changed plan, from being
 * paid a day later.
 */
const CHECKOUT_SESSION_TTL_SEC = 3600;

export const STRIPE_UNAVAILABLE_ERROR =
  'Card checkout is not available right now. Nothing was charged. Please try again later.';
export const CARD_IN_TELEGRAM_ERROR = 'Inside Telegram, plans are paid with Telegram Stars.';

type StripeDeps = { fetcher?: typeof fetch };

/**
 * Plan rank for the rule of Track SW task SW0a-4: a lower plan never replaces a higher active one.
 * Names go through normalizePlanId, so "pro" ranks as agency and an unknown name ranks as free.
 * SW0a-4 has not landed for the other rails. When it moves this rule into writeSubscriptionRecord,
 * use its rank table here, and let reverseStripeCharge through: restoring the plan a disputed
 * upgrade replaced is a deliberate write of a lower plan.
 */
const PLAN_RANK: Record<string, number> = { free: 0, starter: 1, growth: 2, agency: 3 };

export function planRank(plan: unknown): number {
  return PLAN_RANK[normalizePlanId(typeof plan === 'string' ? plan : '')] ?? 0;
}

type ActiveSubscription = { plan: string; expiresAt: number; record: Record<string, unknown> };

/**
 * Fields this rail keeps on the sub:* record, beside the ones every rail writes:
 * - stripeSessions: card sessions whose days are in the current run of the plan. A retried
 *   event finds its session here and neither adds its days again nor refuses it.
 * - stripeBasePlan: the plan held before the current run of card purchases began.
 * - reversedStripeSessions: card sessions whose days were already taken back from this record.
 * Another rail writes a fresh record without them, which ends the run.
 */
function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * The active subscription, read from the same two keys as getActiveSubscription. Unlike that
 * reader a KV fault throws here: a money decision must not mistake "could not read" for "no plan".
 */
async function readActiveSubscription(
  kv: KVNamespace,
  accountId: string,
  userId: string,
  now: number,
): Promise<ActiveSubscription | null> {
  for (const key of new Set([`sub:${accountId}`, `sub:${userId}`])) {
    const record = (await kv.get(key, 'json')) as Record<string, unknown> | null;
    const expiresAt = Number(record?.expiresAt);
    if (record && Number.isFinite(expiresAt) && expiresAt > now) {
      return { plan: String(record.plan || ''), expiresAt, record };
    }
  }
  return null;
}

/** Origin the payer returns to. Built from WEBAPP_URL only: never from the request. */
function checkoutReturnOrigin(env: Env): string | null {
  try {
    const url = new URL(String(env.WEBAPP_URL || '').trim());
    if (url.protocol === 'https:') return url.origin;
    return url.protocol === 'http:' && !isProductionEnv(env) ? url.origin : null;
  } catch {
    return null;
  }
}

/** Timing-safe equality check between two hex strings */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify Stripe webhook signature (v1 scheme).
 * Follows stripe.com/docs/webhooks/signatures using Web Crypto API.
 */
export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSec = 300,
): Promise<{ ok: boolean; reason?: string }> {
  if (!signatureHeader || !secret) {
    return { ok: false, reason: 'missing_signature_or_secret' };
  }

  const items = signatureHeader.split(',');
  let timestamp = NaN;
  const signatures: string[] = [];

  for (const item of items) {
    const [key, val] = item.trim().split('=');
    if (key === 't') {
      // Digits only. parseInt read "NaN" as NaN, and NaN compares false against the tolerance,
      // which skipped the replay window.
      timestamp = /^\d+$/.test(val || '') ? Number(val) : NaN;
    } else if (key === 'v1' && val) {
      signatures.push(val);
    }
  }

  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    return { ok: false, reason: 'malformed_signature_header' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (toleranceSec > 0 && Math.abs(nowSec - timestamp) > toleranceSec) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const signedPayload = `${timestamp}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
  const expectedSig = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const matches = signatures.some((sig) => timingSafeEqualHex(sig, expectedSig));
  return matches ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

/**
 * Creates a Stripe Checkout Session for self-serve card billing.
 * POST /api/stripe/create-checkout-session
 */
export async function handleCreateStripeCheckoutSession(request: Request, env: Env): Promise<Response> {
  if (!STRIPE_CHECKOUT_LIVE) {
    return json(
      {
        ok: false,
        error: 'Card checkout is not live yet. Pay with Telegram Stars in the Telegram app.',
        code: 'STRIPE_NOT_LIVE',
      },
      503,
    );
  }
  return createStripeCheckoutSession(request, env);
}

/**
 * Everything behind the STRIPE_CHECKOUT_LIVE switch. Exported so tests can prove each refusal
 * while the switch is off. Only handleCreateStripeCheckoutSession is routed.
 */
export async function createStripeCheckoutSession(
  request: Request,
  env: Env,
  deps: StripeDeps = {},
): Promise<Response> {
  const unavailable = (reason: string, code: string) => {
    console.error(`[Stripe] Checkout refused: ${reason}.`);
    return json({ ok: false, error: STRIPE_UNAVAILABLE_ERROR, code }, 503);
  };

  const cfg = diagnoseStripeConfig(env);
  if (!cfg.ok) return unavailable(cfg.reason, 'STRIPE_NOT_CONFIGURED');
  const returnOrigin = checkoutReturnOrigin(env);
  if (!returnOrigin) return unavailable('WEBAPP_URL is not a valid https URL', 'STRIPE_NOT_CONFIGURED');

  // Telegram requires digital goods inside a bot or Mini App to be sold for Stars (Track SW, SW0a-6).
  if (request.headers.get('x-telegram-init-data')) {
    return json({ ok: false, error: CARD_IN_TELEGRAM_ERROR, code: 'CARD_NOT_IN_TELEGRAM' }, 400);
  }

  // The buyer must be signed in. A session for an id the server made up could never be credited.
  const who = await identify(request, env);
  if (who.error || !who.user) {
    return json({ ok: false, error: who.error || 'Sign in to pay by card.', code: 'AUTH_REQUIRED' }, 401);
  }
  // A Telegram identity is only ever minted from Mini App init data, so it is still a Telegram surface.
  if (who.user.source === 'telegram') {
    return json({ ok: false, error: CARD_IN_TELEGRAM_ERROR, code: 'CARD_NOT_IN_TELEGRAM' }, 400);
  }

  const read = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const body = (read.value || {}) as { planId?: unknown };

  const planId = String(body.planId || '').trim().toLowerCase();
  const plan = Object.hasOwn(STRIPE_PLAN_CONFIG, planId) ? STRIPE_PLAN_CONFIG[planId] : undefined;
  if (!plan) {
    return json(
      { ok: false, error: `Invalid planId "${planId.slice(0, 40)}". Available: starter, growth, agency` },
      400,
    );
  }

  // Nobody pays while crediting is impossible: the webhook needs the ledger and the subscription store.
  if (!env.LUMINARA_KV) return unavailable('LUMINARA_KV is not bound', 'STRIPE_LEDGER_UNAVAILABLE');
  if (!(await isStripeLedgerReady(env))) return unavailable('the Stripe ledger is not ready', 'STRIPE_LEDGER_UNAVAILABLE');

  const userId = who.user.id;
  const accountId = billingId(who.user);

  // A lower plan is refused before payment (SW0a-4). The same plan extends; a higher plan upgrades.
  const active = await readActiveSubscription(env.LUMINARA_KV, accountId, userId, Date.now());
  if (active && planRank(active.plan) > planRank(planId)) {
    const until = new Date(active.expiresAt).toISOString().slice(0, 10);
    return json(
      {
        ok: false,
        error: `Your ${normalizePlanId(active.plan)} plan is active until ${until}. A lower plan cannot replace it, so no payment was started.`,
        code: 'LOWER_PLAN_REFUSED',
      },
      409,
    );
  }

  const params = new URLSearchParams();
  params.set('payment_method_types[0]', 'card');
  params.set('mode', 'payment');
  params.set('line_items[0][price_data][currency]', STRIPE_CURRENCY);
  params.set('line_items[0][price_data][unit_amount]', String(plan.amountCents));
  params.set('line_items[0][price_data][product_data][name]', plan.name);
  params.set('line_items[0][price_data][product_data][description]', plan.description);
  params.set('line_items[0][quantity]', '1');
  params.set('metadata[userId]', userId);
  params.set('metadata[accountId]', accountId);
  params.set('metadata[planId]', planId);
  params.set('success_url', `${returnOrigin}/?payment=success&plan=${planId}&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${returnOrigin}/pricing?payment=cancelled`);
  params.set('expires_at', String(Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SEC));
  if (who.user.email) params.set('customer_email', who.user.email);

  try {
    const stripeRes = await (deps.fetcher || fetch)('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const sessionData = await stripeRes.json() as any;
    if (!stripeRes.ok) {
      console.error('[Stripe] Failed to create checkout session:', sessionData);
      return json(
        { ok: false, error: sessionData?.error?.message || 'Failed to initialize Stripe checkout' },
        500,
      );
    }

    return json({
      ok: true,
      checkoutUrl: sessionData.url,
      sessionId: sessionData.id,
      planId,
    });
  } catch (err: any) {
    console.error('[Stripe] Network error calling Stripe API:', err);
    return json({ ok: false, error: 'Could not contact Stripe gateway' }, 502);
  }
}

/**
 * Handle incoming Stripe webhook events.
 * POST /api/stripe/webhook
 *
 * Not gated by STRIPE_CHECKOUT_LIVE: a session paid just before the switch is turned off must
 * still be credited, and a refund must still be honoured.
 */
export async function handleStripeWebhook(request: Request, env: Env, deps: StripeDeps = {}): Promise<Response> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured on the worker.');
    return json({ error: 'Webhook secret unconfigured' }, 503);
  }

  const sigHeader = request.headers.get('stripe-signature');
  const read = await readBody(request, MAX_SMALL_BODY_BYTES, false);
  if (!read.ok) return json({ error: read.error }, read.status);
  const rawBody = read.text;

  const verify = await verifyStripeSignature(rawBody, sigHeader, secret);
  if (!verify.ok) {
    console.warn(`[Stripe Webhook] Verification failed: ${verify.reason}`);
    return json({ error: 'Invalid Stripe signature' }, 400);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  // Wrong key for this environment: answer 503 so Stripe redelivers once the key is fixed.
  const cfg = diagnoseStripeConfig(env);
  if (!cfg.ok) {
    console.error(`[Stripe Webhook] Event ${String(event?.id || '')} not processed: ${cfg.reason}.`);
    return json({ error: 'Stripe is not configured for this environment' }, 503);
  }
  // A test-mode event in production (or a live one elsewhere) never touches a plan.
  if (event?.livemode !== cfg.livemode) {
    console.error(
      `[Stripe Webhook] Event ${String(event?.id || '')} ignored: livemode=${String(event?.livemode)} but this environment expects ${cfg.livemode}.`,
    );
    return json({ received: true, ignored: 'livemode_mismatch' });
  }

  const type = String(event.type || '');
  const object = event.data?.object || {};

  if (type === 'checkout.session.completed') return creditCheckoutSession(env, object, deps);

  if (type === 'charge.refunded') {
    // Stripe sends this for a partial refund too. Only a full refund takes the plan days back;
    // a partial refund is the owner's own decision and leaves the plan as it is.
    if (object.refunded !== true) {
      console.warn(`[Stripe Webhook] Partial refund on charge ${String(object.id || '')}: plan left unchanged.`);
      return json({ received: true, ignored: 'partial_refund' });
    }
    return reverseStripeCharge(env, object.payment_intent, 'refund');
  }

  if (type === 'charge.dispute.created' || type === 'charge.dispute.funds_withdrawn') {
    // An inquiry (status warning_*) withdraws no funds and is not a dispute yet. If it becomes
    // one, funds_withdrawn follows and is handled here; the ledger makes the pair remove days once.
    if (type === 'charge.dispute.created' && String(object.status || '').startsWith('warning_')) {
      console.warn(`[Stripe Webhook] Inquiry ${String(object.id || '')} on ${String(object.payment_intent || '')}: plan left unchanged.`);
      return json({ received: true, ignored: 'dispute_inquiry' });
    }
    return reverseStripeCharge(env, object.payment_intent, 'dispute');
  }

  return json({ received: true });
}

/** Credits one paid Checkout session. Every field that decides the grant is checked against server config. */
async function creditCheckoutSession(env: Env, session: any, deps: StripeDeps): Promise<Response> {
  const sessionId = String(session.id || '');
  const metadata = session.metadata || {};
  const planId = String(metadata.planId || '');
  const userId = String(metadata.userId || '');
  const plan = Object.hasOwn(STRIPE_PLAN_CONFIG, planId) ? STRIPE_PLAN_CONFIG[planId] : undefined;
  if (!sessionId || !plan || !userId) {
    // Not a session this Worker created (another product on the same Stripe account).
    console.warn(`[Stripe Webhook] Session ${sessionId} carries no Luminara plan metadata, skipping.`);
    return json({ received: true, ignored: 'not_a_luminara_checkout' });
  }

  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : '';
  const currency = String(session.currency || '').toLowerCase();
  const mismatch =
    session.mode !== 'payment' ? 'mode'
    : session.payment_status !== 'paid' ? 'payment_status'
    : session.amount_total !== plan.amountCents ? 'amount_total'
    : currency !== STRIPE_CURRENCY ? 'currency'
    : !paymentIntent ? 'payment_intent'
    : null;
  if (mismatch) {
    console.error(
      `[Stripe Webhook] Session ${sessionId} NOT credited: ${mismatch} does not match the ${planId} plan ` +
        `(mode=${String(session.mode)} payment_status=${String(session.payment_status)} amount_total=${String(session.amount_total)} currency=${currency}).`,
    );
    return json({ received: true, ignored: `${mismatch}_mismatch` });
  }

  if (!env.LUMINARA_KV) {
    console.error(`[Stripe Webhook] Session ${sessionId} not credited: LUMINARA_KV is not bound.`);
    return json({ error: 'Subscription store unavailable' }, 503);
  }

  const now = Date.now();
  const customerId = session.customer ? String(session.customer) : null;
  const accountId = await resolveAccountId(env, userId);
  const existing = await readActiveSubscription(env.LUMINARA_KV, accountId, userId, now);

  // A run of card purchases: the active record was last written by this rail.
  const inCardRun = existing?.record.paymentMethod === 'stripe';
  const applied = inCardRun ? idList(existing?.record.stripeSessions) : [];
  // A retry after a half-finished write finds this session already on the record. Its days are
  // in the plan, so it is neither added again nor refused, whatever the buyer bought since.
  const alreadyApplied = applied.includes(sessionId);

  // The buyer was refused at session creation if they already held a higher plan. A session
  // opened before the higher plan was bought can still arrive paid: it is sent back, not granted.
  const refused = !alreadyApplied && Boolean(existing && planRank(existing.plan) > planRank(planId));

  const basePlan = (existing && (inCardRun ? String(existing.record.stripeBasePlan || '') : existing.plan)) || null;
  const expiresAt = existing && alreadyApplied ? existing.expiresAt : (existing ? existing.expiresAt : now) + plan.days * DAY_MS;

  const claim = await claimStripeSession(env, {
    sessionId,
    paymentIntent,
    customerId,
    accountId,
    userId,
    planId,
    amountTotal: plan.amountCents,
    currency,
    grantedDays: refused ? 0 : plan.days,
    grantedUntil: refused ? null : expiresAt,
    prevPlan: basePlan,
    reversal: refused ? 'lower_plan_refused' : null,
    now,
  });

  if (!claim.ok) {
    if (claim.reason === 'duplicate') {
      // Credited earlier, or its payment was refunded or disputed before this event arrived.
      console.warn(`[Stripe Webhook] Session ${sessionId} is already on the ledger, skipping.`);
      return json({ received: true, duplicate: true });
    }
    console.error(`[Stripe Webhook] Could not record session ${sessionId} (${claim.reason})`);
    return json({ error: 'Failed to record session in ledger' }, 500);
  }

  try {
    if (refused) {
      await refundStripePayment(env, paymentIntent, sessionId, deps);
      console.warn(
        `[Stripe Webhook] Session ${sessionId} refunded: ${planId} is lower than the active ${String(existing?.plan)} plan of account ${accountId}.`,
      );
      return json({ received: true, refunded: 'lower_plan_refused' });
    }

    await writeSubscriptionRecord(env, userId, existing && alreadyApplied ? existing.record : {
      plan: planId,
      amountTotal: plan.amountCents,
      currency,
      sessionId,
      customerId,
      paymentMethod: 'stripe',
      startedAt: now,
      expiresAt,
      stripeSessions: [...applied, sessionId].slice(-50),
      stripeBasePlan: basePlan,
      reversedStripeSessions: inCardRun ? idList(existing?.record.reversedStripeSessions) : [],
    });
  } catch (err) {
    await releaseStripeSession(env, sessionId);
    throw err;
  }

  console.log(`[Stripe Webhook] Successfully credited plan ${planId} to user ${userId} (session ${sessionId})`);
  return json({ received: true });
}

/** Sends a payment back in full. Safe to repeat: Stripe replays the first answer for the same key. */
async function refundStripePayment(env: Env, paymentIntent: string, sessionId: string, deps: StripeDeps): Promise<void> {
  const params = new URLSearchParams();
  params.set('payment_intent', paymentIntent);
  params.set('metadata[reason]', 'lower_plan_refused');
  params.set('metadata[sessionId]', sessionId);
  const res = await (deps.fetcher || fetch)('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `lower-plan-refund-${sessionId}`,
    },
    body: params.toString(),
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
  // The money is already on its way back: refunded by hand, or charged back by the bank.
  if (['charge_already_refunded', 'charge_disputed', 'refund_disputed_payment'].includes(body?.error?.code || '')) return;
  throw new Error(`Stripe refund for session ${sessionId} failed with HTTP ${res.status} (${body?.error?.code || 'no code'})`);
}

/**
 * The plan a reversal leaves behind. A reversed charge must not leave a plan that no standing
 * card charge pays for: the plan falls to the highest of the account's other standing card
 * charges and the plan it held before the run of card purchases began.
 * If another rail wrote the record after the card charge, that purchase set the plan under its
 * own rules and the name is left alone.
 */
async function planAfterReversal(
  env: Env,
  existing: ActiveSubscription,
  reversed: { sessionId: string; userId: string; accountId: string; basePlan: string | null },
  now: number,
): Promise<string> {
  if (existing.record.paymentMethod !== 'stripe') return existing.plan;
  const standing = await liveStripePlans(env, {
    userId: reversed.userId,
    accountId: reversed.accountId,
    exceptSessionId: reversed.sessionId,
    now,
  });
  let justified = reversed.basePlan || '';
  for (const plan of standing) {
    if (planRank(plan) > planRank(justified)) justified = plan;
  }
  return justified && planRank(existing.plan) > planRank(justified) ? justified : existing.plan;
}

/**
 * Takes back the days one charge granted, once, when it is fully refunded or disputed.
 * Only the part of those days that is still ahead comes off, so a charge whose days were used
 * up long ago cannot shorten a plan paid for some other way.
 */
async function reverseStripeCharge(env: Env, paymentIntentRaw: unknown, reason: 'refund' | 'dispute'): Promise<Response> {
  const paymentIntent = typeof paymentIntentRaw === 'string' ? paymentIntentRaw : '';
  if (!paymentIntent) return json({ received: true, ignored: 'no_payment_intent' });
  if (!env.LUMINARA_KV) {
    console.error(`[Stripe Webhook] ${reason} for ${paymentIntent} not applied: LUMINARA_KV is not bound.`);
    return json({ error: 'Subscription store unavailable' }, 503);
  }

  const now = Date.now();
  const claim = await claimStripeReversal(env, { paymentIntent, reason, now });
  if (!claim.ok) {
    if (claim.reason === 'unavailable') return json({ error: 'Failed to record reversal in ledger' }, 500);
    // not_found: nothing was credited for this payment (it is now marked, so nothing will be).
    // already_reversed: a repeat, or the other of a refund and dispute pair.
    return json({ received: true, ignored: claim.reason });
  }

  const { sessionId, grantedDays, grantedUntil, prevPlan } = claim.session;
  const userId = claim.session.userId || claim.session.accountId || '';
  try {
    const accountId = userId ? await resolveAccountId(env, userId) : '';
    const existing = userId ? await readActiveSubscription(env.LUMINARA_KV, accountId, userId, now) : null;
    if (existing && grantedDays > 0) {
      const reversed = idList(existing.record.reversedStripeSessions);
      let next = existing.record;
      // A retry after a half-finished write finds this reversal already on the record: the same
      // record is written again so both keys carry it, without taking the days a second time.
      if (!reversed.includes(sessionId)) {
        const unusedMs = Math.min(grantedDays * DAY_MS, Math.max(0, (grantedUntil ?? Number.MAX_SAFE_INTEGER) - now));
        next = {
          ...existing.record,
          plan: await planAfterReversal(env, existing, { sessionId, userId, accountId, basePlan: prevPlan }, now),
          expiresAt: Math.max(now, existing.expiresAt - unusedMs),
          reversedStripeSessions: [...reversed, sessionId].slice(-50),
          reversedAt: now,
        };
      }
      await writeSubscriptionRecord(env, userId, next);
    }
  } catch (err) {
    await releaseStripeReversal(env, sessionId);
    throw err;
  }

  console.warn(`[Stripe Webhook] ${reason} on ${paymentIntent}: took back the unused days granted by session ${sessionId}.`);
  return json({ received: true, reversed: reason });
}
