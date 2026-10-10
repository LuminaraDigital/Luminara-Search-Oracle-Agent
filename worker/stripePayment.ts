/**
 * Stripe checkout, subscription crediting, and webhook listener for Luminara Suite.
 * Cloudflare Workers native implementation using Web Crypto API.
 */
import type { Env } from './env';
import { identify, json } from './workerUtils';
import { claimStripeSession, isStripeLedgerReady, releaseStripeSession } from './paymentLedger';
import { resolveAccountId, writeSubscriptionRecord } from './userStore';

/**
 * Flip to true only after staging Checkout + webhook credit is proven (commercial CC2).
 * Secrets alone must not light the Card rail in the client.
 */
export const STRIPE_CHECKOUT_LIVE = false;

/** True when both Stripe secrets are present (Worker can create sessions / verify webhooks). */
export function isStripeSecretsConfigured(env: Env): boolean {
  return Boolean(String(env.STRIPE_SECRET_KEY || '').trim() && String(env.STRIPE_WEBHOOK_SECRET || '').trim());
}

/** Public health / Paywall: Card rail only when live flag + secrets. */
export function isStripeCheckoutLive(env: Env): boolean {
  return STRIPE_CHECKOUT_LIVE && isStripeSecretsConfigured(env);
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

/** Convert hex string to Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
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
  let timestamp = -1;
  const signatures: string[] = [];

  for (const item of items) {
    const [key, val] = item.trim().split('=');
    if (key === 't') {
      timestamp = parseInt(val, 10);
    } else if (key === 'v1') {
      signatures.push(val);
    }
  }

  if (timestamp === -1 || signatures.length === 0) {
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
  if (!isStripeCheckoutLive(env)) {
    return json(
      {
        ok: false,
        error: 'Card checkout is not live yet. Pay with Telegram Stars or TON, or email support@luminarasuite.com.',
        code: 'STRIPE_NOT_LIVE',
      },
      503,
    );
  }
  if (!env.STRIPE_SECRET_KEY) {
    return json(
      {
        ok: false,
        error: 'Stripe card checkout is not configured on the server. Please contact support.',
        code: 'STRIPE_NOT_CONFIGURED',
      },
      503,
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON request body' }, 400);
  }

  const planId = String(body.planId || '').trim().toLowerCase();
  const plan = STRIPE_PLAN_CONFIG[planId];
  if (!plan) {
    return json(
      { ok: false, error: `Invalid planId "${planId}". Available: starter, growth, agency` },
      400,
    );
  }

  // Identify the caller (Telegram, Firebase, or fallback to body user/account)
  let userId = '';
  let accountId = '';
  try {
    const who = await identify(request, env);
    if (who.user) {
      userId = String(who.user.id || '');
      accountId = String(who.user.accountId || userId);
    }
  } catch {
    /* caller might be a guest filling checkout */
  }

  if (!userId) {
    if (body.userId && typeof body.userId === 'string' && body.userId.startsWith('guest_')) {
      userId = body.userId.trim();
    } else {
      userId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
  }
  if (!accountId && env.LUMINARA_KV) {
    accountId = await resolveAccountId(env, userId);
  } else if (!accountId) {
    accountId = userId;
  }

  const origin = request.headers.get('origin') || env.WEBAPP_URL || 'https://luminarasuite.com';
  const successUrl = body.successUrl || `${origin}/?payment=success&plan=${planId}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = body.cancelUrl || `${origin}/pricing?payment=cancelled`;

  const params = new URLSearchParams();
  params.set('payment_method_types[0]', 'card');
  params.set('mode', 'payment');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(plan.amountCents));
  params.set('line_items[0][price_data][product_data][name]', plan.name);
  params.set('line_items[0][price_data][product_data][description]', plan.description);
  params.set('line_items[0][quantity]', '1');
  params.set('metadata[userId]', userId);
  params.set('metadata[accountId]', accountId);
  params.set('metadata[planId]', planId);
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);

  if (body.customerEmail && typeof body.customerEmail === 'string') {
    params.set('customer_email', body.customerEmail.trim());
  }

  try {
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
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
 */
export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured on the worker.');
    return json({ error: 'Webhook secret unconfigured' }, 503);
  }

  const sigHeader = request.headers.get('stripe-signature');
  const rawBody = await request.text();

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

  const type = String(event.type || '');
  if (type === 'charge.refunded') {
    const charge = event.data?.object || {};
    const customerId = charge.customer ? String(charge.customer) : null;
    console.warn(`[Stripe Webhook] charge.refunded event received for customer ${customerId}`);
    return json({ received: true, refund_logged: true });
  }

  if (type === 'checkout.session.completed' || type === 'invoice.payment_succeeded') {
    const session = event.data?.object || {};
    const sessionId = String(session.id || '');
    const customerId = session.customer ? String(session.customer) : null;
    const metadata = session.metadata || {};
    const planId = String(metadata.planId || metadata.plan || '').toLowerCase();
    const userId = String(metadata.userId || metadata.accountId || session.client_reference_id || '');
    const accountId = String(metadata.accountId || userId || '');
    const amountTotal = Number(session.amount_total || session.amount_paid || 0);
    const currency = String(session.currency || 'usd').toLowerCase();

    const plan = STRIPE_PLAN_CONFIG[planId];
    if (plan && userId) {
      const now = Date.now();
      const claim = await claimStripeSession(env, {
        sessionId,
        customerId,
        accountId,
        planId,
        amountTotal,
        currency,
        now,
      });

      if (!claim.ok) {
        if (claim.reason === 'duplicate') {
          console.warn(`[Stripe Webhook] Duplicate delivery for session ${sessionId}, skipping.`);
          return json({ received: true, duplicate: true });
        }
        console.error(`[Stripe Webhook] Could not record session ${sessionId} (${claim.reason})`);
        return json({ error: 'Failed to record session in ledger' }, 500);
      }

      const existing = env.LUMINARA_KV
        ? ((await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as { plan?: string; expiresAt?: number } | null)
        : null;

      const PLAN_RANK: Record<string, number> = {
        starter: 1,
        growth: 2,
        agency: 3,
      };

      const existingActive = Boolean(existing?.expiresAt && existing.expiresAt > now);
      const existingRank = existingActive ? (PLAN_RANK[String(existing?.plan || '').toLowerCase()] || 0) : 0;
      const newRank = PLAN_RANK[planId] || 0;

      // Rank-guard: If user already has an active higher-tier plan (e.g. Agency), do not overwrite with Starter
      const effectivePlan = existingActive && existingRank > newRank ? String(existing?.plan) : planId;
      const base = existingActive && existing?.expiresAt ? existing.expiresAt : now;

      const record = {
        plan: effectivePlan,
        amountTotal,
        currency,
        sessionId,
        customerId,
        paymentMethod: 'stripe',
        startedAt: now,
        expiresAt: base + plan.days * 86400_000,
      };

      if (env.LUMINARA_KV) {
        try {
          await writeSubscriptionRecord(env, userId, record);
        } catch (err) {
          await releaseStripeSession(env, sessionId);
          throw err;
        }
      }

      console.log(`[Stripe Webhook] Successfully credited plan ${planId} to user ${userId} (session ${sessionId})`);
    }
  }

  return json({ received: true });
}
