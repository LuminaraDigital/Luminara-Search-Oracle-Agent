import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTonInvoice,
  verifyTonPayment,
  TON_PRICING,
  TON_UNAVAILABLE_ERROR,
  crc16Xmodem,
  extractTonComment,
} from '../worker/tonPayment';
import { normalizeTonTxHash, tonTxHashAliases } from '../worker/chainNetwork';
import { claimTonTransaction } from '../worker/paymentLedger';
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
    CHAIN_NETWORK: 'mainnet',
    CHAIN_TON_API_BASE: 'https://toncenter.com/api/v3',
    CHAIN_TON_API_FALLBACK_BASE: 'https://tonapi.io',
    CHAIN_XDC_RPC_URL: 'https://erpc.xinfin.network',
    ...overrides,
  };
  // The owner has confirmed whichever address this test uses, unless the test says otherwise.
  if (!('TON_CONFIRMED_ADDRESS' in overrides)) env.TON_CONFIRMED_ADDRESS = env.TON_RECEIVING_ADDRESS;
  return { env, kv };
}

function toncenterResponse(memo: string, amountNano: string, hash = 'abc123', seqno = 96144803) {
  return new Response(
    JSON.stringify({
      transactions: [
        {
          hash,
          now: Math.floor(Date.now() / 1000),
          mc_block_seqno: seqno,
          in_msg: {
            value: amountNano,
            message_content: { decoded: { '@type': 'text_comment', text: memo } },
          },
        },
      ],
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
      if (url.includes('toncenter.com/api/v3')) return new Response('Internal Server Error', { status: 500 });
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

  it('queries Toncenter v3 base from env and persists proof_anchors seqno', async () => {
    const { env } = makeEnv();
    const inv = await createTonInvoice(env, 'user_v3', 'starter');
    if (!inv.ok) throw new Error('invoice failed');

    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain('https://toncenter.com/api/v3/transactions');
      expect(url).toContain('start_utime=');
      return toncenterResponse(inv.order.memo, TON_PRICING.starter.nanoTon, 'v3_hash', 424242);
    });

    const verifyRes = await verifyTonPayment(env, inv.order.orderId, { fetcher });
    expect(verifyRes.ok).toBe(true);
    const row = env.DB.sqlite.prepare('SELECT seqno, network, tx_hash FROM proof_anchors WHERE tx_hash = ?').get('v3_hash');
    expect(row.seqno).toBe(424242);
    expect(row.network).toBe('mainnet');
  });

  it('fail-closed when CHAIN_NETWORK mismatches merchant address', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env } = makeEnv({ CHAIN_NETWORK: 'testnet', TON_RECEIVING_ADDRESS: MERCHANT });
    const inv = await createTonInvoice(env, 'user_mismatch', 'starter');
    expect(inv.ok).toBe(false);
  });

  it('uses testnet Toncenter host for staging', async () => {
    const { env } = makeEnv({
      ENVIRONMENT: 'staging',
      CHAIN_NETWORK: 'testnet',
      TON_RECEIVING_ADDRESS: TESTNET_MERCHANT,
      CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
      CHAIN_TON_API_FALLBACK_BASE: 'https://testnet.tonapi.io',
      CHAIN_XDC_RPC_URL: 'https://rpc.apothem.network',
    });
    const inv = await createTonInvoice(env, 'user_tn', 'starter');
    if (!inv.ok) throw new Error('invoice failed');
    const fetcher = vi.fn(async (url: string) => {
      expect(url.startsWith('https://testnet.toncenter.com/api/v3/transactions')).toBe(true);
      expect(url).not.toContain('https://toncenter.com/api/v2');
      return toncenterResponse(inv.order.memo, TON_PRICING.starter.nanoTon, 'tn_hash', 99);
    });
    expect((await verifyTonPayment(env, inv.order.orderId, { fetcher })).ok).toBe(true);
    const row = env.DB.sqlite.prepare('SELECT network, explorer_url FROM proof_anchors WHERE tx_hash = ?').get('tn_hash');
    expect(row.network).toBe('testnet');
    expect(row.explorer_url).toContain('testnet.tonviewer.com');
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

describe('TON transaction hash encoding (Toncenter base64 vs TonAPI hex)', () => {
  const HASH_BYTES = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 251) & 0xff));
  const HASH_BASE64 = HASH_BYTES.toString('base64');
  const HASH_HEX = HASH_BYTES.toString('hex');

  /** Toncenter is down, TonAPI reports the transfer with its hex hash. */
  function tonapiOnlyFetcher(memo: string, amountNano: string, hash: string, txExtra: Record<string, unknown> = {}) {
    return vi.fn(async (url: string) => {
      if (!url.includes('tonapi.io')) return new Response('Internal Server Error', { status: 500 });
      return new Response(
        JSON.stringify({
          transactions: [
            {
              hash,
              utime: Math.floor(Date.now() / 1000),
              success: true,
              aborted: false,
              in_msg: { value: amountNano, bounced: false, decoded_body: { text: memo } },
              ...txExtra,
            },
          ],
        }),
        { status: 200 },
      );
    });
  }

  it('normalises both encodings of one hash to lowercase hex and leaves other strings alone', () => {
    expect(HASH_BASE64).toMatch(/[+/=]/);
    expect(normalizeTonTxHash(HASH_BASE64)).toBe(HASH_HEX);
    expect(normalizeTonTxHash(HASH_BYTES.toString('base64url'))).toBe(HASH_HEX);
    expect(normalizeTonTxHash(HASH_HEX.toUpperCase())).toBe(HASH_HEX);
    expect(normalizeTonTxHash(`0x${HASH_HEX}`)).toBe(HASH_HEX);
    expect(normalizeTonTxHash(' v3_hash ')).toBe('v3_hash');
    expect(tonTxHashAliases(HASH_BASE64)).toEqual(expect.arrayContaining([HASH_HEX, HASH_BASE64]));
    expect(tonTxHashAliases(HASH_BASE64)[0]).toBe(HASH_HEX);
    expect(tonTxHashAliases('v3_hash')).toEqual(['v3_hash']);

    const unpadded = HASH_BASE64.replace(/=$/, '');
    expect(unpadded).toHaveLength(43);
    expect(normalizeTonTxHash(unpadded)).toBe(HASH_HEX);

    // Valid base64 of the wrong length (31 and 33 bytes) is not a tx hash: passed through untouched.
    for (const size of [31, 33]) {
      const other = Buffer.alloc(size, 0xab).toString('base64');
      expect(normalizeTonTxHash(other)).toBe(other);
      expect(tonTxHashAliases(other)).toEqual([other]);
    }
  });

  it('returns the already-credited success when the same order is retried under the other encoding', async () => {
    const { env, kv } = makeEnv();
    const inv = await createTonInvoice(env, 'user_retry_enc', 'starter');
    if (!inv.ok) throw new Error('invoice failed');

    const toncenter = vi.fn(async () => toncenterResponse(inv.order.memo, TON_PRICING.starter.nanoTon, HASH_BASE64));
    const first = await verifyTonPayment(env, inv.order.orderId, { fetcher: toncenter });
    expect(first.ok).toBe(true);

    // Force the retry past the confirmed-order short cut and the KV guard, onto the ledger claim.
    const stored = await kv.get(`ton:order:${inv.order.orderId}`, 'json');
    await kv.put(`ton:order:${inv.order.orderId}`, JSON.stringify({ ...stored, status: 'pending' }));
    await kv.delete(`ton:tx:${HASH_HEX}`);

    const retry = await verifyTonPayment(env, inv.order.orderId, {
      fetcher: tonapiOnlyFetcher(inv.order.memo, TON_PRICING.starter.nanoTon, HASH_HEX),
    });

    expect(retry.ok).toBe(true);
    if (first.ok && retry.ok) expect(retry.expiresAt).toBe(first.expiresAt);
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ton_credited_tx').get().n).toBe(1);
  });

  it('credits once when the same tx is seen as base64 via Toncenter and as hex via TonAPI', async () => {
    const { env, kv } = makeEnv();
    const invA = await createTonInvoice(env, 'user_b64', 'starter');
    const invB = await createTonInvoice(env, 'user_hex', 'starter');
    if (!invA.ok || !invB.ok) throw new Error('invoice failed');
    // The comment must equal the order's memo, so each order is shown a transfer carrying its own.
    // What the two answers share is the transaction: one hash, spelled two ways.
    const toncenter = vi.fn(async () => toncenterResponse(invA.order.memo, TON_PRICING.starter.nanoTon, HASH_BASE64));
    expect((await verifyTonPayment(env, invA.order.orderId, { fetcher: toncenter })).ok).toBe(true);

    // The D1 ledger alone must refuse the second spelling, so drop the KV guard.
    await kv.delete(`ton:tx:${HASH_HEX}`);
    const replay = await verifyTonPayment(env, invB.order.orderId, {
      fetcher: tonapiOnlyFetcher(invB.order.memo, TON_PRICING.starter.nanoTon, HASH_HEX),
    });

    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error).toMatch(/already been credited to another order/i);
    expect(kv.store.has('sub:user_hex')).toBe(false);
    expect(env.DB.sqlite.prepare('SELECT tx_hash FROM ton_credited_tx').all().map((r: any) => r.tx_hash)).toEqual([HASH_HEX]);
    const anchor = env.DB.sqlite.prepare("SELECT tx_hash, explorer_url FROM proof_anchors WHERE kind = 'ton_payment'").all();
    expect(anchor).toHaveLength(1);
    expect(anchor[0].tx_hash).toBe(HASH_HEX);
    expect(anchor[0].explorer_url).toBe(`https://tonviewer.com/transaction/${HASH_HEX}`);
  });

  it('treats a legacy base64 ledger row and its hex form as the same transaction', async () => {
    const { env, kv } = makeEnv();
    env.DB.sqlite
      .prepare('INSERT INTO ton_credited_tx (tx_hash, order_id, account_id, credited_at) VALUES (?, ?, ?, ?)')
      .run(HASH_BASE64, 'ton_legacy_order', 'user_legacy', Date.now());
    const inv = await createTonInvoice(env, 'user_after_legacy', 'starter');
    if (!inv.ok) throw new Error('invoice failed');

    const res = await verifyTonPayment(env, inv.order.orderId, {
      fetcher: tonapiOnlyFetcher(inv.order.memo, TON_PRICING.starter.nanoTon, HASH_HEX),
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already been credited to another order/i);
    expect(kv.store.has('sub:user_after_legacy')).toBe(false);
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ton_credited_tx').get().n).toBe(1);
    expect(await claimTonTransaction(env, { txHash: HASH_HEX, orderId: 'ton_legacy_order' })).toEqual({
      ok: false,
      reason: 'order_already_credited',
    });
  });

  it('honours a legacy KV guard stored under the base64 form', async () => {
    const { env, kv } = makeEnv();
    await kv.put(`ton:tx:${HASH_BASE64}`, 'ton_order_prior');
    const inv = await createTonInvoice(env, 'user_kv_legacy', 'starter');
    if (!inv.ok) throw new Error('invoice failed');

    const res = await verifyTonPayment(env, inv.order.orderId, {
      fetcher: tonapiOnlyFetcher(inv.order.memo, TON_PRICING.starter.nanoTon, HASH_HEX),
    });
    expect(res.ok).toBe(false);
    expect(kv.store.has('sub:user_kv_legacy')).toBe(false);
  });

  // Non-bounceable transfer to an uninitialised wallet: aborted, compute skipped, funds kept.
  const TONCENTER_UNINIT = { description: { aborted: true, compute_ph: { skipped: true, reason: 'no_state' } } };
  const TONAPI_UNINIT = { success: false, aborted: true, compute_phase: { skipped: true, skip_reason: 'cskip_no_state' } };
  const TONCENTER_BOUNCE = { type: 'ok', msg_size: { cells: '1', bits: '0' }, msg_fees: '0', fwd_fees: '0' };

  it.each([
    ['Toncenter uninit wallet, no bounce phase', 'toncenter', TONCENTER_UNINIT, {}, true],
    ['Toncenter failed compute and action phases, no bounce phase', 'toncenter', { description: { aborted: true, compute_ph: { skipped: false, success: false }, action: { success: false }, bounce: null } }, {}, true],
    ['Toncenter uninit wallet with a bounce phase', 'toncenter', { description: { ...TONCENTER_UNINIT.description, bounce: TONCENTER_BOUNCE } }, { bounce: true }, false],
    ['Toncenter bounced in_msg', 'toncenter', {}, { bounced: true }, false],
    ['Toncenter aborted, bounceable in_msg, bounce phase omitted', 'toncenter', TONCENTER_UNINIT, { bounce: true }, false],
    ['Toncenter aborted, in_msg.bounce false', 'toncenter', TONCENTER_UNINIT, { bounce: false }, true],
    ['TonAPI aborted, bounceable in_msg, bounce phase omitted', 'tonapi', TONAPI_UNINIT, { bounce: true }, false],
    ['TonAPI aborted, in_msg.bounce false', 'tonapi', TONAPI_UNINIT, { bounce: false }, true],
    ['TonAPI uninit wallet, no bounce phase', 'tonapi', TONAPI_UNINIT, {}, true],
    ['TonAPI uninit wallet with a bounce phase', 'tonapi', { ...TONAPI_UNINIT, bounce_phase: 'TrPhaseBounceOk' }, { bounce: true }, false],
    ['TonAPI bounced in_msg', 'tonapi', {}, { bounced: true }, false],
  ])('%s: credited=%s', async (_label, provider, txExtra, inMsgExtra, credited) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { env, kv } = makeEnv();
    const inv = await createTonInvoice(env, 'user_bounced', 'starter');
    if (!inv.ok) throw new Error('invoice failed');
    const now = Math.floor(Date.now() / 1000);

    const fetcher = vi.fn(async (url: string) => {
      const isTonapi = url.includes('tonapi.io');
      if (isTonapi !== (provider === 'tonapi')) return new Response('Internal Server Error', { status: 500 });
      const tx = isTonapi
        ? {
            hash: HASH_HEX,
            utime: now,
            success: true,
            aborted: false,
            in_msg: { value: TON_PRICING.starter.nanoTon, bounced: false, decoded_body: { text: inv.order.memo }, ...inMsgExtra },
            ...txExtra,
          }
        : {
            hash: HASH_BASE64,
            now,
            mc_block_seqno: 1,
            description: { aborted: false, compute_ph: { skipped: false, success: true }, action: { success: true } },
            in_msg: {
              value: TON_PRICING.starter.nanoTon,
              bounced: false,
              message_content: { decoded: { '@type': 'text_comment', text: inv.order.memo } },
              ...inMsgExtra,
            },
            ...txExtra,
          };
      return new Response(JSON.stringify({ transactions: [tx] }), { status: 200 });
    });

    const res = await verifyTonPayment(env, inv.order.orderId, { fetcher });
    expect(res.ok).toBe(credited);
    expect(kv.store.has('sub:user_bounced')).toBe(credited);
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ton_credited_tx').get().n).toBe(credited ? 1 : 0);
  });

  it('still credits a healthy transfer that carries the full Toncenter status fields', async () => {
    const { env } = makeEnv();
    const inv = await createTonInvoice(env, 'user_healthy', 'starter');
    if (!inv.ok) throw new Error('invoice failed');
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          transactions: [
            {
              hash: HASH_BASE64,
              now: Math.floor(Date.now() / 1000),
              mc_block_seqno: 7,
              description: { aborted: false, compute_ph: { skipped: false, success: true }, action: { success: true } },
              in_msg: {
                value: TON_PRICING.starter.nanoTon,
                bounced: false,
                message_content: { decoded: { '@type': 'text_comment', text: inv.order.memo } },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    expect((await verifyTonPayment(env, inv.order.orderId, { fetcher })).ok).toBe(true);
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
    const { env } = makeEnv({
      TON_RECEIVING_ADDRESS: TESTNET_MERCHANT,
      ENVIRONMENT: 'staging',
      CHAIN_NETWORK: 'testnet',
      CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
      CHAIN_TON_API_FALLBACK_BASE: 'https://testnet.tonapi.io',
      CHAIN_XDC_RPC_URL: 'https://rpc.apothem.network',
    });
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

    // An index that shows each order a transfer with its own memo and the same transaction hash:
    // one transaction, so only one order may be credited.
    const shared = (memo: string) => vi.fn(async () => toncenterResponse(memo, TON_PRICING.starter.nanoTon, 'tx_shared'));

    const results = await Promise.all([
      verifyTonPayment(env, invA.order.orderId, { fetcher: shared(invA.order.memo) }),
      verifyTonPayment(env, invB.order.orderId, { fetcher: shared(invB.order.memo) }),
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
    // The same transaction hash shown to each order with that order's own memo.
    const replayed = (memo: string) => vi.fn(async () => toncenterResponse(memo, TON_PRICING.starter.nanoTon, 'tx_replayed'));

    expect((await verifyTonPayment(env, invA.order.orderId, { fetcher: replayed(invA.order.memo) })).ok).toBe(true);
    await kv.delete('ton:tx:tx_replayed');

    const replay = await verifyTonPayment(env, invB.order.orderId, { fetcher: replayed(invB.order.memo) });
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

  it('logs a [Proof] alert line and still credits when the proof anchor insert fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, kv } = makeEnv();
    const inv = await createTonInvoice(env, 'user_anchor_fail', 'starter');
    if (!inv.ok) throw new Error('invoice failed');
    const fetcher = vi.fn(async () => toncenterResponse(inv.order.memo, TON_PRICING.starter.nanoTon, 'tx_anchor_fail'));
    env.DB.sqlite.exec('DROP TABLE proof_anchors');

    const res = await verifyTonPayment(env, inv.order.orderId, { fetcher });

    expect(res.ok).toBe(true);
    expect((await kv.get('sub:user_anchor_fail', 'json')).plan).toBe('starter');
    expect(env.DB.sqlite.prepare('SELECT order_id FROM ton_credited_tx WHERE tx_hash = ?').get('tx_anchor_fail').order_id).toBe(
      inv.order.orderId,
    );
    const proofLines = errors.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('[Proof] anchor_write_failed'));
    expect(proofLines).toHaveLength(1);
    expect(proofLines[0]).toContain('tx_hash=tx_anchor_fail');
    expect(proofLines[0]).toContain(`order_id=${inv.order.orderId}`);
    expect(proofLines[0]).toContain('network=mainnet');
    expect(proofLines[0]).toMatch(/no such table/i);
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
