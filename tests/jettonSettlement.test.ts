import { describe, expect, it } from 'vitest';
import { Address, beginCell, Cell } from '@ton/core';
import {
  OP_JETTON_TRANSFER_NOTIFICATION,
  JETTON_DECIMALS,
  addressFromStackItem,
  decodeJettonNotification,
  findMatchingJettonPayment,
  inboundBodyCell,
  jettonPriceUnits,
  matchJettonNotification,
  resolveMerchantJettonWallet,
  JETTON_NOT_FOUND,
  JETTON_VERIFY_UNAVAILABLE,
} from '../worker/jettonSettlement';
import { JETTON_PRICING, LORA_DECIMALS, USDT_DECIMALS } from '../worker/tonPayment';

/** Synthetic workchain-0 addresses; hash bytes are fill patterns, not real wallets. */
const addr = (fill: number) => new Address(0, Buffer.alloc(32, fill));
const MERCHANT = addr(0x5a);
const MASTER = addr(0x11);
const MERCHANT_JW = addr(0x22);
const ATTACKER_JW = addr(0x66);
const PAYER = addr(0x33);
const MEMO = 'LUM:ton_1_abc:growth';

function notificationBody(opts: { amount: bigint; comment?: string; inline?: boolean; op?: number; sender?: Address | null }): Cell {
  const b = beginCell()
    .storeUint(opts.op ?? OP_JETTON_TRANSFER_NOTIFICATION, 32)
    .storeUint(7, 64)
    .storeCoins(opts.amount)
    .storeAddress(opts.sender === undefined ? PAYER : opts.sender);
  if (opts.comment === undefined) return b.endCell();
  const payload = beginCell().storeUint(0, 32).storeStringTail(opts.comment);
  if (opts.inline) return b.storeBit(0).storeBuilder(payload).endCell();
  return b.storeBit(1).storeRef(payload.endCell()).endCell();
}

function toncenterTx(body: Cell, opts: { source?: Address; hash?: string; utime?: number; bounced?: boolean } = {}) {
  return {
    hash: opts.hash ?? Buffer.alloc(32, 0xab).toString('base64'),
    now: opts.utime ?? 2_000_000_000,
    mc_block_seqno: 42,
    in_msg: {
      source: (opts.source ?? MERCHANT_JW).toRawString().toUpperCase(),
      bounced: opts.bounced ?? false,
      message_content: { body: body.toBoc().toString('base64') },
    },
  };
}

const criteria = { memo: MEMO, minUnits: 79_000_000n, merchantJettonWallet: MERCHANT_JW, minTimeSec: 1_000, network: 'mainnet' as const };

describe('decodeJettonNotification', () => {
  it('decodes ref and inline forward-payload comments', () => {
    for (const inline of [false, true]) {
      const d = decodeJettonNotification(notificationBody({ amount: 79_000_000n, comment: MEMO, inline }));
      expect(d).not.toBeNull();
      expect(d!.amount).toBe(79_000_000n);
      expect(d!.queryId).toBe(7n);
      expect(d!.comment).toBe(MEMO);
      expect(d!.sender!.equals(PAYER)).toBe(true);
    }
  });

  it('returns empty comment when no forward payload and null sender for addr_none', () => {
    const d = decodeJettonNotification(notificationBody({ amount: 1n, sender: null }));
    expect(d!.comment).toBe('');
    expect(d!.sender).toBeNull();
  });

  it('rejects other opcodes and truncated cells', () => {
    expect(decodeJettonNotification(notificationBody({ amount: 1n, comment: MEMO, op: 0x0f8a7ea5 }))).toBeNull();
    expect(decodeJettonNotification(beginCell().storeUint(OP_JETTON_TRANSFER_NOTIFICATION, 32).endCell())).toBeNull();
    expect(decodeJettonNotification(beginCell().endCell())).toBeNull();
  });

  it('ignores non-text forward payloads', () => {
    const body = beginCell()
      .storeUint(OP_JETTON_TRANSFER_NOTIFICATION, 32).storeUint(0, 64).storeCoins(5n).storeAddress(PAYER)
      .storeBit(1).storeRef(beginCell().storeUint(0xdeadbeef, 32).endCell()).endCell();
    expect(decodeJettonNotification(body)!.comment).toBe('');
  });
});

describe('inboundBodyCell', () => {
  it('reads Toncenter base64 and TonAPI hex bodies, rejects garbage', () => {
    const body = notificationBody({ amount: 1n, comment: MEMO });
    expect(inboundBodyCell({ message_content: { body: body.toBoc().toString('base64') } })!.equals(body)).toBe(true);
    expect(inboundBodyCell({ raw_body: body.toBoc().toString('hex') })!.equals(body)).toBe(true);
    expect(inboundBodyCell({ raw_body: 'zz' })).toBeNull();
    expect(inboundBodyCell({ message_content: { body: 'not-a-boc' } })).toBeNull();
    expect(inboundBodyCell({})).toBeNull();
  });
});

describe('matchJettonNotification', () => {
  const good = () => notificationBody({ amount: 79_000_000n, comment: MEMO });

  it('credits a notification from the canonical merchant jetton wallet', () => {
    const m = matchJettonNotification([toncenterTx(good())], criteria);
    expect(m).toMatchObject({ ok: true, seqno: 42, network: 'mainnet', jettonAmount: 79_000_000n });
    expect(m!.txHash).toBe('ab'.repeat(32));
    expect(m!.sender).toBe(PAYER.toString({ bounceable: false, testOnly: false }));
  });

  it('accepts TonAPI-shaped transactions (source object, hex raw_body)', () => {
    const tx = { hash: 'cd'.repeat(32), utime: 2_000_000_000, in_msg: { source: { address: MERCHANT_JW.toRawString() }, raw_body: good().toBoc().toString('hex') } };
    expect(matchJettonNotification([tx], criteria)?.txHash).toBe('cd'.repeat(32));
  });

  it('SECURITY: ignores a forged notification from any other contract', () => {
    expect(matchJettonNotification([toncenterTx(good(), { source: ATTACKER_JW })], criteria)).toBeNull();
  });

  it('SECURITY: ignores a plain TON comment carrying the memo', () => {
    const plain = beginCell().storeUint(0, 32).storeStringTail(MEMO).endCell();
    expect(matchJettonNotification([toncenterTx(plain, { source: PAYER })], criteria)).toBeNull();
    expect(matchJettonNotification([toncenterTx(plain)], criteria)).toBeNull();
  });

  it('rejects underpayment, wrong memo, bounced, stale, and hashless transactions', () => {
    expect(matchJettonNotification([toncenterTx(notificationBody({ amount: 78_999_999n, comment: MEMO }))], criteria)).toBeNull();
    expect(matchJettonNotification([toncenterTx(notificationBody({ amount: 79_000_000n, comment: 'LUM:other' }))], criteria)).toBeNull();
    expect(matchJettonNotification([toncenterTx(good(), { bounced: true })], criteria)).toBeNull();
    expect(matchJettonNotification([toncenterTx(good(), { utime: 999 })], criteria)).toBeNull();
    expect(matchJettonNotification([toncenterTx(good(), { hash: '' })], criteria)).toBeNull();
  });

  it('SECURITY: exact memo only, so a two-memo comment cannot shadow a victim payment', () => {
    const multi = notificationBody({ amount: 79_000_000n, comment: `LUM:ton_9_zzz:growth ${MEMO}` });
    const victim = toncenterTx(good(), { hash: Buffer.alloc(32, 0xcc).toString('base64') });
    const m = matchJettonNotification([toncenterTx(multi), victim], criteria);
    expect(m?.txHash).toBe('cc'.repeat(32));
    expect(matchJettonNotification([toncenterTx(notificationBody({ amount: 79_000_000n, comment: `  ${MEMO}\n` }))], criteria)?.ok).toBe(true);
  });

  it('refuses empty memo or non-positive price (fail closed)', () => {
    expect(matchJettonNotification([toncenterTx(good())], { ...criteria, memo: '' })).toBeNull();
    expect(matchJettonNotification([toncenterTx(good())], { ...criteria, minUnits: 0n })).toBeNull();
  });

  it('skips non-matching transactions and finds a later match', () => {
    const m = matchJettonNotification([{}, { in_msg: null }, toncenterTx(good(), { source: ATTACKER_JW }), toncenterTx(good())], criteria);
    expect(m?.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Network layer
// ---------------------------------------------------------------------------

function mockKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(k: string) { return store.get(k) ?? null; },
    async put(k: string, v: string) { store.set(k, v); },
  };
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    CHAIN_NETWORK: 'mainnet',
    CHAIN_TON_API_BASE: 'https://toncenter.com/api/v3',
    CHAIN_TON_API_FALLBACK_BASE: 'https://tonapi.io',
    TON_API_KEY: 'k',
    LUMINARA_KV: mockKv(),
    ...overrides,
  } as any;
}


const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const addrBoc = (a: Address) => beginCell().storeAddress(a).endCell().toBoc();

/** Routes provider calls. `toncenterWallet` / `tonapiWallet` = null simulates that provider failing. */
function router(opts: {
  toncenterWallet?: Address | null;
  tonapiWallet?: Address | null;
  txs?: unknown[];
  toncenterTxStatus?: number;
  tonapiTxs?: unknown[];
  calls?: Array<{ url: string; init?: RequestInit }>;
} = {}) {
  const tcWallet = opts.toncenterWallet === undefined ? MERCHANT_JW : opts.toncenterWallet;
  const taWallet = opts.tonapiWallet === undefined ? MERCHANT_JW : opts.tonapiWallet;
  return async (url: string, init?: RequestInit) => {
    opts.calls?.push({ url, init });
    if (url.endsWith('/runGetMethod')) {
      return tcWallet ? json({ exit_code: 0, stack: [{ type: 'slice', value: addrBoc(tcWallet).toString('base64') }] }) : json({}, 500);
    }
    if (url.includes('/methods/get_wallet_address')) {
      return taWallet ? json({ success: true, exit_code: 0, stack: [{ type: 'cell', cell: addrBoc(taWallet).toString('hex') }] }) : json({}, 500);
    }
    if (url.includes('toncenter.com') && url.includes('/transactions')) return json({ transactions: opts.txs ?? [] }, opts.toncenterTxStatus ?? 200);
    if (url.includes('tonapi.io') && url.includes('/transactions')) return json({ transactions: opts.tonapiTxs ?? [] });
    return json({}, 404);
  };
}

describe('addressFromStackItem', () => {
  it('reads Toncenter base64 and TonAPI hex stack cells; rejects garbage', () => {
    expect(addressFromStackItem({ type: 'slice', value: addrBoc(MERCHANT_JW).toString('base64') })!.equals(MERCHANT_JW)).toBe(true);
    expect(addressFromStackItem({ type: 'cell', cell: addrBoc(MERCHANT_JW).toString('hex') })!.equals(MERCHANT_JW)).toBe(true);
    expect(addressFromStackItem({ type: 'slice', slice: addrBoc(MERCHANT_JW).toString('hex') })!.equals(MERCHANT_JW)).toBe(true);
    expect(addressFromStackItem({ type: 'num', value: '0x1' })).toBeNull();
    expect(addressFromStackItem(null)).toBeNull();
  });
});

describe('resolveMerchantJettonWallet (on-chain get_wallet_address)', () => {
  const input = { master: MASTER, owner: MERCHANT, network: 'mainnet' as const, toncenter: 'https://toncenter.com/api/v3', tonapi: 'https://tonapi.io' };

  it('derives from the master contract, sends owner slice + API key, caches', async () => {
    const env = makeEnv();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const r1 = await resolveMerchantJettonWallet(env, input, router({ calls }));
    expect(r1.ok && r1.wallet.equals(MERCHANT_JW)).toBe(true);
    const tc = calls.find(c => c.url.endsWith('/runGetMethod'))!;
    const body = JSON.parse(String(tc.init!.body));
    expect(body.address).toBe(MASTER.toRawString());
    expect(body.method).toBe('get_wallet_address');
    expect(Cell.fromBase64(body.stack[0].value).beginParse().loadAddress().equals(MERCHANT)).toBe(true);
    expect((tc.init!.headers as Record<string, string>)['X-API-Key']).toBe('k');
    expect(calls.some(c => c.url.includes('/jetton/wallets'))).toBe(false);

    const before = calls.length;
    expect((await resolveMerchantJettonWallet(env, input, router({ calls }))).ok).toBe(true);
    expect(calls.length).toBe(before);
  });

  it('uses either provider alone when the other fails', async () => {
    expect((await resolveMerchantJettonWallet(makeEnv(), input, router({ toncenterWallet: null }))).ok).toBe(true);
    expect((await resolveMerchantJettonWallet(makeEnv(), input, router({ tonapiWallet: null }))).ok).toBe(true);
  });

  it('SECURITY: fails closed when providers disagree', async () => {
    const r = await resolveMerchantJettonWallet(makeEnv(), input, router({ tonapiWallet: ATTACKER_JW }));
    expect(r.ok).toBe(false);
  });

  it('fails closed when every provider fails, and does not cache', async () => {
    const env = makeEnv();
    expect((await resolveMerchantJettonWallet(env, input, router({ toncenterWallet: null, tonapiWallet: null }))).ok).toBe(false);
    expect(env.LUMINARA_KV.store.size).toBe(0);
    expect((await resolveMerchantJettonWallet(env, input, async () => { throw new Error('down'); })).ok).toBe(false);
  });

  it('rejects non-zero exit codes', async () => {
    const f = async (url: string) =>
      url.endsWith('/runGetMethod') ? json({ exit_code: 11, stack: [] }) : json({ success: false, exit_code: 11, stack: [] });
    expect((await resolveMerchantJettonWallet(makeEnv(), input, f)).ok).toBe(false);
  });
});

describe('findMatchingJettonPayment', () => {
  const order = {
    orderId: 'ton_1_abc',
    memo: MEMO,
    amountUnits: '79000000',
    recipientAddress: MERCHANT.toString({ bounceable: true }),
    jettonMaster: MASTER.toString(),
    createdAt: 2_000_000_000_000,
  };
  const good = () => toncenterTx(notificationBody({ amount: 79_000_000n, comment: MEMO }));

  it('end to end: derives wallet then matches notification; pages oldest-first', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const r = await findMatchingJettonPayment(order, makeEnv(), { expectedMaster: MASTER.toRawString(), fetcher: router({ txs: [good()], calls }) });
    expect(r).toMatchObject({ ok: true, jettonAmount: 79_000_000n });
    expect(calls.find(c => c.url.includes('toncenter.com') && c.url.includes('/transactions'))!.url).toContain('sort=asc');
  });

  it('SECURITY: a fake jetton wallet the indexer might list cannot get credit', async () => {
    const forged = toncenterTx(notificationBody({ amount: 10n ** 12n, comment: MEMO }), { source: ATTACKER_JW });
    const r = await findMatchingJettonPayment(order, makeEnv(), { expectedMaster: MASTER.toRawString(), fetcher: router({ txs: [forged] }) });
    expect(r).toEqual({ ok: false, error: JETTON_NOT_FOUND });
  });

  it('falls back to TonAPI when Toncenter transactions fail', async () => {
    const tx = { hash: 'ef'.repeat(32), utime: 2_000_000_000, in_msg: { source: { address: MERCHANT_JW.toRawString() }, raw_body: notificationBody({ amount: 79_000_000n, comment: MEMO }).toBoc().toString('hex') } };
    const r = await findMatchingJettonPayment(order, makeEnv(), { expectedMaster: MASTER.toRawString(), fetcher: router({ toncenterTxStatus: 502, tonapiTxs: [tx] }) });
    expect(r).toMatchObject({ ok: true, txHash: 'ef'.repeat(32) });
  });

  it('reports network trouble vs not-found distinctly', async () => {
    const down = await findMatchingJettonPayment(order, makeEnv(), { expectedMaster: MASTER.toRawString(), fetcher: router({ toncenterTxStatus: 502 }) });
    expect((down as { error: string }).error).toMatch(/Could not reach/);
    const none = await findMatchingJettonPayment(order, makeEnv(), { expectedMaster: MASTER.toRawString(), fetcher: router() });
    expect(none).toEqual({ ok: false, error: JETTON_NOT_FOUND });
  });

  it('returns not-found when the jetton wallet cannot be derived', async () => {
    const r = await findMatchingJettonPayment(order, makeEnv(), { expectedMaster: MASTER.toRawString(), fetcher: router({ toncenterWallet: null, tonapiWallet: null, txs: [good()] }) });
    expect(r).toEqual({ ok: false, error: JETTON_NOT_FOUND });
  });

  it('SECURITY: refuses when the order master differs from the configured master', async () => {
    const r = await findMatchingJettonPayment(order, makeEnv(), { expectedMaster: addr(0x99).toRawString(), fetcher: router() });
    expect(r).toEqual({ ok: false, error: JETTON_VERIFY_UNAVAILABLE });
  });

  it('refuses bad amount, missing master, or invalid chain config', async () => {
    const f = router();
    const m = MASTER.toRawString();
    expect((await findMatchingJettonPayment({ ...order, amountUnits: '0' }, makeEnv(), { expectedMaster: m, fetcher: f })).ok).toBe(false);
    expect((await findMatchingJettonPayment({ ...order, amountUnits: '1.5' }, makeEnv(), { expectedMaster: m, fetcher: f })).ok).toBe(false);
    expect((await findMatchingJettonPayment({ ...order, jettonMaster: '' }, makeEnv(), { expectedMaster: m, fetcher: f })).ok).toBe(false);
    expect((await findMatchingJettonPayment(order, makeEnv({ CHAIN_NETWORK: '' }), { expectedMaster: m, fetcher: f })).ok).toBe(false);
  });
});

describe('jettonPriceUnits', () => {
  it('prices per asset decimals (LORA is not priced in USDT units)', () => {
    expect(jettonPriceUnits('USDT', '79')).toBe(79_000_000n);
    expect(jettonPriceUnits('LORA', '79')).toBe(79_000_000_000n);
    expect(jettonPriceUnits('USDT', 0)).toBeNull();
    expect(jettonPriceUnits('USDT', '1.0000001')).toBeNull();
    expect(jettonPriceUnits('toString' as never, '1')).toBeNull();
  });

  it('decimals stay in sync with worker/tonPayment.ts', () => {
    expect(JETTON_DECIMALS.USDT).toBe(USDT_DECIMALS);
    expect(JETTON_DECIMALS.LORA).toBe(LORA_DECIMALS);
  });

  it('REGRESSION GUARD: reusing USDT unit strings for LORA would underprice 1000x', () => {
    const usdtUnits = BigInt(JETTON_PRICING.growth.units);
    expect(jettonPriceUnits('LORA', JETTON_PRICING.growth.amount)).toBe(usdtUnits * 1000n);
  });
});
