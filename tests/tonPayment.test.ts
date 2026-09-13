import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTonInvoice,
  verifyTonPayment,
  TON_PRICING,
  TON_UNAVAILABLE_ERROR,
  crc16Xmodem,
  extractTonComment,
} from '../worker/tonPayment';
import { PLANS } from '../worker/telegramBot';
import { buildCommentBoc } from '../services/ton/tonService';
import { createSqliteD1 } from './helpers/sqliteD1';

/** Synthetic user-friendly address with a valid CRC; the hash bytes are a fill pattern, not a real wallet. */
function syntheticTonAddress(tag: number, fill: number): string {
  const bytes = new Uint8Array(36);
  bytes[0] = tag;
  bytes[1] = 0x00;
  bytes.fill(fill, 2, 34);
  const crc = crc16Xmodem(bytes.subarray(0, 34));
  bytes[34] = crc >> 8;
  bytes[35] = crc & 0xff;
  return Buffer.from(bytes).toString('base64url');
}

const MERCHANT = syntheticTonAddress(0x11, 0x5a);
const TESTNET_MERCHANT = syntheticTonAddress(0x91, 0x5a);

function createMockKv() {
  const store = new Map<string, string>();
  return {
    store,
    failPutsMatching: null as RegExp | null,
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (val === undefined) return null;
      if (type === 'json') return JSON.parse(val);
      return val;
    },
    async put(key: string, value: string) {
      if (this.failPutsMatching?.test(key)) throw new Error('simulated KV outage');
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  const kv = createMockKv();
  const env: any = {
    LUMINARA_KV: kv,
    DB: createSqliteD1(),
    TON_RECEIVING_ADDRESS: MERCHANT,
    ENVIRONMENT: 'production',
    ...overrides,
  };
  return { env, kv };
}

function toncenterResponse(memo: string, amountNano: string, hash = 'abc123') {
  return new Response(
    JSON.stringify({
      ok: true,
      result: [{ transaction_id: { hash }, utime: Math.floor(Date.now() / 1000), in_msg: { value: amountNano, message: memo } }],
    }),
    { status: 200 },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TON Payment Settlement Engine', () => {
  it('creates a unique invoice with proper memo and pricing', async () => {
    const { env, kv } = makeEnv();

    const inv = await createTonInvoice(env, 'user_123', 'starter');
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    expect(inv.order.planId).toBe('starter');
    expect(inv.order.tonAmount).toBe(TON_PRICING.starter.ton);
    expect(inv.order.amountNano).toBe(TON_PRICING.starter.nanoTon);
    expect(inv.order.recipientAddress).toBe(MERCHANT);
    expect(inv.order.memo).toMatch(/^LUM:ton_\d+_[a-z0-9]+:starter$/);
    expect(inv.order.status).toBe('pending');
    expect(await kv.get(`ton:order:${inv.order.orderId}`, 'json')).not.toBeNull();
  });

  it('rejects an invalid plan during invoice creation', async () => {
    const { env } = makeEnv();
    const inv = await createTonInvoice(env, 'user_123', 'non_existent_plan');
    expect(inv.ok).toBe(false);
  });

  it('verifies payment only when Toncenter reports a matching transfer', async () => {
    const { env, kv } = makeEnv({ TON_API_KEY: 'test' });

    const inv = await createTonInvoice(env, 'user_456', 'growth');
    if (!inv.ok) throw new Error('invoice failed');

    const fetcher = vi.fn(async () => toncenterResponse(inv.order.memo, TON_PRICING.growth.nanoTon));
    const verifyRes = await verifyTonPayment(env, inv.order.orderId, { expectedUserId: 'user_456', fetcher });

    expect(verifyRes.ok).toBe(true);
    if (!verifyRes.ok) return;
    expect(verifyRes.plan).toBe('growth');
    const sub = await kv.get('sub:user_456', 'json');
    expect(sub.plan).toBe('growth');
    expect(sub.paymentMethod).toBe('ton');
  });

  it('rejects verify when only a client BOC is offered (no on-chain match)', async () => {
    const { env } = makeEnv();
    const inv = await createTonInvoice(env, 'user_456', 'starter');
    if (!inv.ok) throw new Error('invoice failed');

    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }));
    const verifyRes = await verifyTonPayment(env, inv.order.orderId, { fetcher });
    expect(verifyRes.ok).toBe(false);
  });

  it('extractTonComment reads known message shapes and decodes base64 text', () => {
    expect(extractTonComment({ message: 'LUM:x' })).toBe('LUM:x');
    expect(extractTonComment({ msg_data: { text: 'LUM:y' } })).toBe('LUM:y');
    const base64Comment = btoa('LUM:ton_encoded:growth');
    expect(extractTonComment({ msg_data: { text: base64Comment } })).toBe('LUM:ton_encoded:growth');
  });

  it('buildCommentBoc generates official @ton/core base64 payload', () => {
    const boc = buildCommentBoc('LUM:ton_123:starter');
    expect(typeof boc).toBe('string');
    expect(boc.length).toBeGreaterThan(10);
  });

  it('falls back to TonAPI when Toncenter returns 500 error', async () => {
    const { env } = makeEnv();
    const inv = await createTonInvoice(env, 'user_fallback', 'starter');
    if (!inv.ok) throw new Error('invoice failed');

    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('toncenter.com')) return new Response('Internal Server Error', { status: 500 });
      if (url.includes('tonapi.io')) {
        return new Response(
          JSON.stringify({
            transactions: [
              {
                hash: 'tonapi_tx_hash_999',
                utime: Math.floor(Date.now() / 1000),
                in_msg: { value: TON_PRICING.starter.nanoTon, decoded_body: { text: inv.order.memo } },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    const verifyRes = await verifyTonPayment(env, inv.order.orderId, { expectedUserId: 'user_fallback', fetcher });
    expect(verifyRes.ok).toBe(true);
  });

  it('prevents double-spending replay attack with a txHash claimed in legacy KV', async () => {
    const { env, kv } = makeEnv();
    await kv.put('ton:tx:hash_already_spent', 'ton_order_prior');

    const inv = await createTonInvoice(env, 'user_attacker', 'starter');
    if (!inv.ok) throw new Error('invoice failed');

    const fetcher = vi.fn(async () => toncenterResponse(inv.order.memo, TON_PRICING.starter.nanoTon, 'hash_already_spent'));
    const verifyRes = await verifyTonPayment(env, inv.order.orderId, { fetcher });
    expect(verifyRes.ok).toBe(false);
    if (!verifyRes.ok) expect(verifyRes.error).toMatch(/already been credited/i);
  });
});

describe('TON merchant address fail-closed', () => {
  it.each([
    ['missing', undefined],
    ['malformed', 'EQ_MERCHANT_WALLET'],
    ['bad checksum', `${MERCHANT.slice(0, 47)}${MERCHANT.endsWith('A') ? 'B' : 'A'}`],
    ['testnet in production', TESTNET_MERCHANT],
  ])('refuses an invoice when the address is %s, without leaking config names', async (_label, address) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, kv } = makeEnv({ TON_RECEIVING_ADDRESS: address });

    const inv = await createTonInvoice(env, 'user_cfg', 'starter');
    expect(inv.ok).toBe(false);
    if (inv.ok) return;
    expect(inv.error).toBe(TON_UNAVAILABLE_ERROR);
    expect(inv.error).not.toMatch(/TON_RECEIVING_ADDRESS|Worker|KV|D1/);
    expect([...kv.store.keys()].some((k) => k.startsWith('ton:order:'))).toBe(false);

    const logged = errors.mock.calls.flat().join(' ');
    expect(logged).toMatch(/TON_RECEIVING_ADDRESS/);
    if (typeof address === 'string' && address.length > 8) expect(logged).not.toContain(address);
  });

  it('allows a testnet address outside production', async () => {
    const { env } = makeEnv({ TON_RECEIVING_ADDRESS: TESTNET_MERCHANT, ENVIRONMENT: 'staging' });
    const inv = await createTonInvoice(env, 'user_staging', 'starter');
    expect(inv.ok).toBe(true);
  });

  it('verify refuses an order whose stored recipient does not validate', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, kv } = makeEnv();
    const orderId = 'ton_1_badrcpt';
    await kv.put(
      `ton:order:${orderId}`,
      JSON.stringify({
        orderId,
        userId: 'user_bad_recipient',
        planId: 'starter',
        amountNano: TON_PRICING.starter.nanoTon,
        tonAmount: TON_PRICING.starter.ton,
        memo: `LUM:${orderId}:starter`,
        recipientAddress: 'not-a-ton-address',
        status: 'pending',
        createdAt: Date.now(),
      }),
    );
    const fetcher = vi.fn(async () => toncenterResponse(`LUM:${orderId}:starter`, TON_PRICING.starter.nanoTon));

    const res = await verifyTonPayment(env, orderId, { fetcher });
    expect(res.ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(kv.store.has('sub:user_bad_recipient')).toBe(false);
  });
});

describe('Atomic TON crediting (D1 ledger)', () => {
  it('credits once when the same order is verified concurrently', async () => {
    const { env, kv } = makeEnv();
    const inv = await createTonInvoice(env, 'user_double_verify', 'starter');
    if (!inv.ok) throw new Error('invoice failed');
    const fetcher = vi.fn(async () => toncenterResponse(inv.order.memo, TON_PRICING.starter.nanoTon, 'tx_concurrent'));

    const before = Date.now();
    const results = await Promise.all([
      verifyTonPayment(env, inv.order.orderId, { fetcher }),
      verifyTonPayment(env, inv.order.orderId, { fetcher }),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    const sub = await kv.get('sub:user_double_verify', 'json');
    expect(sub.expiresAt).toBeLessThan(before + (PLANS.starter.days + 1) * 86400_000);
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ton_credited_tx').get().n).toBe(1);
  });

  it('refuses to credit one transaction to two orders', async () => {
    const { env, kv } = makeEnv();
    const invA = await createTonInvoice(env, 'user_a', 'starter');
    const invB = await createTonInvoice(env, 'user_b', 'starter');
    if (!invA.ok || !invB.ok) throw new Error('invoice failed');

    // One transfer whose comment matches both memos; only one order may be credited.
    const fetcher = vi.fn(async () =>
      toncenterResponse(`${invA.order.memo} ${invB.order.memo}`, TON_PRICING.starter.nanoTon, 'tx_shared'),
    );

    const results = await Promise.all([
      verifyTonPayment(env, invA.order.orderId, { fetcher }),
      verifyTonPayment(env, invB.order.orderId, { fetcher }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok && failed.error).toMatch(/already been credited to another order/i);
    expect(['user_a', 'user_b'].filter((id) => kv.store.has(`sub:${id}`))).toHaveLength(1);
  });

  it('refuses a replayed tx even after the KV guard expired', async () => {
    const { env, kv } = makeEnv();
    const invA = await createTonInvoice(env, 'user_first', 'starter');
    const invB = await createTonInvoice(env, 'user_replay', 'starter');
    if (!invA.ok || !invB.ok) throw new Error('invoice failed');
    const fetcher = vi.fn(async () =>
      toncenterResponse(`${invA.order.memo} ${invB.order.memo}`, TON_PRICING.starter.nanoTon, 'tx_replayed'),
    );

    expect((await verifyTonPayment(env, invA.order.orderId, { fetcher })).ok).toBe(true);
    await kv.delete('ton:tx:tx_replayed');

    const replay = await verifyTonPayment(env, invB.order.orderId, { fetcher });
    expect(replay.ok).toBe(false);
    expect(kv.store.has('sub:user_replay')).toBe(false);
  });

  it('fails closed when the D1 binding is missing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, kv } = makeEnv();
    const inv = await createTonInvoice(env, 'user_no_db', 'starter');
    if (!inv.ok) throw new Error('invoice failed');
    const fetcher = vi.fn(async () => toncenterResponse(inv.order.memo, TON_PRICING.starter.nanoTon, 'tx_no_db'));

    const noDbEnv = { ...env, DB: undefined };
    const invoice = await createTonInvoice(noDbEnv, 'user_no_db', 'starter');
    expect(invoice.ok).toBe(false);

    const res = await verifyTonPayment(noDbEnv, inv.order.orderId, { fetcher });
    expect(res.ok).toBe(false);
    expect(kv.store.has('sub:user_no_db')).toBe(false);
    expect(errors.mock.calls.flat().join(' ')).toMatch(/0004_payment_atomicity/);
  });

  it('fails closed when migration 0004 has not been applied', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, kv } = makeEnv();
    const inv = await createTonInvoice(env, 'user_no_table', 'starter');
    if (!inv.ok) throw new Error('invoice failed');
    const fetcher = vi.fn(async () => toncenterResponse(inv.order.memo, TON_PRICING.starter.nanoTon, 'tx_no_table'));

    const legacyEnv = { ...env, DB: createSqliteD1({ skipMigrations: ['0004'] }) };
    expect((await createTonInvoice(legacyEnv, 'user_no_table', 'starter')).ok).toBe(false);

    const res = await verifyTonPayment(legacyEnv, inv.order.orderId, { fetcher });
    expect(res.ok).toBe(false);
    expect(kv.store.has('sub:user_no_table')).toBe(false);
    expect(errors.mock.calls.flat().join(' ')).toMatch(/0004_payment_atomicity/);
  });

  it('releases the tx claim when the subscription write fails so verify can be retried', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, kv } = makeEnv();
    const inv = await createTonInvoice(env, 'user_flaky', 'starter');
    if (!inv.ok) throw new Error('invoice failed');
    const fetcher = vi.fn(async () => toncenterResponse(inv.order.memo, TON_PRICING.starter.nanoTon, 'tx_flaky'));

    kv.failPutsMatching = /^sub:/;
    expect((await verifyTonPayment(env, inv.order.orderId, { fetcher })).ok).toBe(false);

    kv.failPutsMatching = null;
    expect((await verifyTonPayment(env, inv.order.orderId, { fetcher })).ok).toBe(true);
    expect(kv.store.has('sub:user_flaky')).toBe(true);
  });
});
