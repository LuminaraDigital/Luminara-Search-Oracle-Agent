import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  verifyStripeSignature,
  STRIPE_PLAN_CONFIG,
  handleStripeWebhook,
  handleCreateStripeCheckoutSession,
} from '../worker/stripePayment';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';

describe('Stripe Payments & Webhook Verification', () => {
  const secret = 'whsec_test_secret_12345';

  async function generateValidSignatureHeader(payload: string, webhookSecret: string, timestamp?: number): Promise<string> {
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
  });

  describe('handleStripeWebhook idempotency and ledger crediting', () => {
    let d1: any;
    let env: Env;
    let mockKv: Map<string, string>;

    beforeEach(async () => {
      d1 = createSqliteD1();
      mockKv = new Map<string, string>();
      // Initialize required table matching migration 0021
      await d1.exec(`
        CREATE TABLE IF NOT EXISTS stripe_credited_sessions (
          session_id TEXT PRIMARY KEY,
          customer_id TEXT,
          account_id TEXT,
          plan_id TEXT NOT NULL,
          amount_total INTEGER NOT NULL,
          currency TEXT NOT NULL,
          credited_at INTEGER NOT NULL
        );
      `);

      env = {
        DB: d1,
        LUMINARA_KV: {
          get: async (k: string, type?: string) => {
            const v = mockKv.get(k);
            if (!v) return null;
            return type === 'json' ? JSON.parse(v) : v;
          },
          put: async (k: string, v: string) => { mockKv.set(k, v); },
          delete: async (k: string) => { mockKv.delete(k); },
        } as any,
        STRIPE_WEBHOOK_SECRET: secret,
        STRIPE_SECRET_KEY: 'sk_test_mock_stripe_key',
      } as unknown as Env;
    });

    it('rejects webhooks with invalid signatures', async () => {
      const req = new Request('https://api.luminara.ai/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': 't=123,v1=invalid',
        },
        body: JSON.stringify({ type: 'checkout.session.completed' }),
      });

      const res = await handleStripeWebhook(req, env);
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe('Invalid Stripe signature');
    });

    it('credits subscription on checkout.session.completed and is idempotent on repeat', async () => {
      const payload = JSON.stringify({
        id: 'evt_test_success_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_session_abc123',
            amount_total: 14900,
            customer_email: 'buyer@agency.com',
            currency: 'usd',
            metadata: {
              plan: 'growth',
              accountId: 'acc_growth_test_1',
            },
          },
        },
      });

      const sigHeader = await generateValidSignatureHeader(payload, secret);
      const req = new Request('https://api.luminara.ai/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': sigHeader,
        },
        body: payload,
      });

      // First run: credits successfully
      const res1 = await handleStripeWebhook(req, env);
      expect(res1.status).toBe(200);
      const body1 = await res1.json() as any;
      expect(body1.received).toBe(true);

      // Verify subscription record was created in KV
      const rawSub = mockKv.get('sub:acc_growth_test_1');
      expect(rawSub).toBeDefined();
      const sub = JSON.parse(rawSub!);
      expect(sub.plan).toBe('growth');
      expect(sub.amountTotal).toBe(14900);

      // Verify stripe_credited_sessions record was written in D1
      const sessionRow = await d1.prepare('SELECT * FROM stripe_credited_sessions WHERE session_id = ?')
        .bind('cs_test_session_abc123')
        .first();
      expect(sessionRow).toBeDefined();
      expect(sessionRow.amount_total).toBe(14900);
      expect(sessionRow.plan_id).toBe('growth');

      // Duplicate delivery with another request: must succeed idempotently without re-granting
      const req2 = new Request('https://api.luminara.ai/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': sigHeader,
        },
        body: payload,
      });
      const res2 = await handleStripeWebhook(req2, env);
      expect(res2.status).toBe(200);
      const body2 = await res2.json() as any;
      expect(body2.received).toBe(true);
      expect(body2.duplicate).toBe(true);
    });

    it('enforces rank-guard so Starter does not overwrite an active Agency plan', async () => {
      // Seed active agency plan expiring in 15 days
      const now = Date.now();
      const agencyExpiry = now + 15 * 86400_000;
      mockKv.set('sub:acc_agency_user', JSON.stringify({
        plan: 'agency',
        startedAt: now - 15 * 86400_000,
        expiresAt: agencyExpiry,
      }));

      const payload = JSON.stringify({
        id: 'evt_starter_purchase',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_starter_clobber',
            amount_total: 4900,
            currency: 'usd',
            metadata: {
              plan: 'starter',
              accountId: 'acc_agency_user',
            },
          },
        },
      });

      const sigHeader = await generateValidSignatureHeader(payload, secret);
      const req = new Request('https://api.luminara.ai/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': sigHeader,
        },
        body: payload,
      });

      const res = await handleStripeWebhook(req, env);
      expect(res.status).toBe(200);

      // Verify rank guard: plan is preserved as agency and duration is extended
      const rawSub = mockKv.get('sub:acc_agency_user');
      expect(rawSub).toBeDefined();
      const sub = JSON.parse(rawSub!);
      expect(sub.plan).toBe('agency');
      expect(sub.expiresAt).toBeGreaterThan(agencyExpiry);
    });

    it('handles charge.refunded event gracefully', async () => {
      const payload = JSON.stringify({
        id: 'evt_refund_1',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test_123',
            customer: 'cus_test_123',
          },
        },
      });
      const sigHeader = await generateValidSignatureHeader(payload, secret);
      const req = new Request('https://api.luminara.ai/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': sigHeader },
        body: payload,
      });

      const res = await handleStripeWebhook(req, env);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.received).toBe(true);
      expect(body.refund_logged).toBe(true);
    });
  });
});
