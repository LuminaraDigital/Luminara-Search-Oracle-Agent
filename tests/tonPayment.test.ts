import { describe, expect, it, vi } from 'vitest';
import { createTonInvoice, verifyTonPayment, TON_PRICING, extractTonComment } from '../worker/tonPayment';
import { buildCommentBoc } from '../services/ton/tonService';

function createMockKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (!val) return null;
      if (type === 'json') return JSON.parse(val);
      return val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

describe('TON Payment Settlement Engine', () => {
  it('creates a unique invoice with proper memo and pricing', async () => {
    const kv = createMockKv();
    const env: any = { LUMINARA_KV: kv, TON_RECEIVING_ADDRESS: 'EQ_MERCHANT_WALLET' };

    const inv = await createTonInvoice(env, 'user_123', 'starter');
    expect(inv.ok).toBe(true);
    if (inv.ok) {
      expect(inv.order.planId).toBe('starter');
      expect(inv.order.tonAmount).toBe(TON_PRICING.starter.ton);
      expect(inv.order.amountNano).toBe(TON_PRICING.starter.nanoTon);
      expect(inv.order.recipientAddress).toBe('EQ_MERCHANT_WALLET');
      expect(inv.order.memo).toMatch(/^LUM:ton_\d+_[a-z0-9]+:starter$/);
      expect(inv.order.status).toBe('pending');
      const stored = await kv.get(`ton:order:${inv.order.orderId}`, 'json');
      expect(stored).not.toBeNull();
    }
  });

  it('rejects invoice when merchant address is missing', async () => {
    const inv = await createTonInvoice({ LUMINARA_KV: createMockKv() } as any, 'user_123', 'starter');
    expect(inv.ok).toBe(false);
  });

  it('rejects an invalid plan during invoice creation', async () => {
    const env: any = { LUMINARA_KV: createMockKv(), TON_RECEIVING_ADDRESS: 'EQ_X' };
    const inv = await createTonInvoice(env, 'user_123', 'non_existent_plan');
    expect(inv.ok).toBe(false);
  });

  it('verifies payment only when Toncenter reports a matching transfer', async () => {
    const kv = createMockKv();
    const env: any = { LUMINARA_KV: kv, TON_RECEIVING_ADDRESS: 'EQ_MERCHANT_WALLET', TON_API_KEY: 'test' };

    const inv = await createTonInvoice(env, 'user_456', 'growth');
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              transaction_id: { hash: 'abc123' },
              in_msg: {
                value: TON_PRICING.growth.nanoTon,
                message: inv.order.memo,
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const verifyRes = await verifyTonPayment(env, inv.order.orderId, {
      expectedUserId: 'user_456',
      fetcher,
    });

    expect(verifyRes.ok).toBe(true);
    if (verifyRes.ok) {
      expect(verifyRes.plan).toBe('growth');
      const sub = await kv.get('sub:user_456', 'json');
      expect(sub.plan).toBe('growth');
      expect(sub.paymentMethod).toBe('ton');
    }
  });

  it('rejects verify when only a client BOC is offered (no on-chain match)', async () => {
    const kv = createMockKv();
    const env: any = { LUMINARA_KV: kv, TON_RECEIVING_ADDRESS: 'EQ_MERCHANT_WALLET' };
    const inv = await createTonInvoice(env, 'user_456', 'starter');
    if (!inv.ok) return;

    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }),
    );

    const verifyRes = await verifyTonPayment(env, inv.order.orderId, { fetcher });
    expect(verifyRes.ok).toBe(false);
  });

  it('extractTonComment reads known message shapes', () => {
    expect(extractTonComment({ message: 'LUM:x' })).toBe('LUM:x');
    expect(extractTonComment({ msg_data: { text: 'LUM:y' } })).toBe('LUM:y');
  });

  it('buildCommentBoc generates base64 payload', () => {
    const boc = buildCommentBoc('LUM:ton_123:starter');
    expect(typeof boc).toBe('string');
    expect(boc.length).toBeGreaterThan(10);
  });
});
