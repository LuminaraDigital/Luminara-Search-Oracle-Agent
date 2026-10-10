import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Address } from '@ton/core';
import {
  createTonInvoice,
  sweepTonPendingOrders,
  verifyTonPayment,
  TON_PRICING,
  TON_ORDER_WALLET_REPLACED_ERROR,
  TON_TOO_MANY_OPEN_ORDERS_ERROR,
  TON_UNAVAILABLE_ERROR,
  crc16Xmodem,
} from '../worker/tonPayment';
import { TON_MAX_OPEN_ORDERS_PER_ACCOUNT, TON_PENDING_ORDER_SUPPORT_MS, TON_PENDING_ORDER_TTL_MS } from '../worker/tonPendingOrders';
import { linkTelegramAndFirebase } from '../worker/userStore';
import { createPrivacyJob } from '../worker/privacyService';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1, type SqliteD1 } from './helpers/sqliteD1';

/**
 * Track SW, SW0a-5: native TON matching.
 * The comment must equal the order's memo. An order is remembered in D1 for 48 hours and a sweep
 * re-checks unpaid ones, so a transfer the chain index shows late is credited late instead of never.
 */

const state = vi.hoisted(() => ({
  inTelegram: false,
  health: { ok: true, ton: true, jettonCheckout: false, stripeCheckout: false, plans: {} } as Record<string, unknown>,
}));

vi.mock('@tonconnect/ui-react', () => ({
  TonConnectButton: () => null,
  useTonWallet: () => null,
  useTonConnectUI: () => [{}, () => {}],
}));
vi.mock('../services/telegram/tma', async (importActual) => ({
  ...(await importActual<typeof import('../services/telegram/tma')>()),
  isInTelegram: () => state.inTelegram,
}));
vi.mock('../services/apiClient', async (importActual) => ({
  ...(await importActual<typeof import('../services/apiClient')>()),
  getServerHealthSync: () => state.health,
  apiBase: () => 'https://luminarasuite.com',
}));

import {
  TON_PENDING_NOTICE,
  TON_PENDING_ORDER_WINDOW_MS,
  TON_STILL_PENDING_NOTICE,
  checkPendingTonPayment,
  executeTonPayment,
  forgetPendingTonOrder,
  readPendingTonOrder,
  rememberPendingTonOrder,
} from '../services/ton/tonService';
import { PaywallModal } from '../components/paywall/PaywallModal';

const DAY = 86400_000;

function syntheticTonAddress(tag: number, fill: number): string {
  const bytes = new Uint8Array(36);
  bytes[0] = tag;
  bytes.fill(fill, 2, 34);
  const crc = crc16Xmodem(bytes.subarray(0, 34));
  bytes[34] = crc >> 8;
  bytes[35] = crc & 0xff;
  return Buffer.from(bytes).toString('base64url');
}
const MERCHANT = syntheticTonAddress(0x11, 0x5a);

function makeEnv(overrides: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  const kv = {
    store,
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (val === undefined) return null;
      return type === 'json' ? JSON.parse(val) : val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
  const db = createSqliteD1();
  const env: any = {
    LUMINARA_KV: kv,
    DB: db,
    TON_RECEIVING_ADDRESS: MERCHANT,
    TON_CONFIRMED_ADDRESS: MERCHANT,
    ENVIRONMENT: 'production',
    CHAIN_NETWORK: 'mainnet',
    CHAIN_TON_API_BASE: 'https://toncenter.com/api/v3',
    CHAIN_TON_API_FALLBACK_BASE: 'https://tonapi.io',
    ...overrides,
  };
  return { env, kv, db: db as SqliteD1 };
}

/** A chain index that shows one inbound transfer with this comment, amount and hash. */
const showing = (comment: string, amountNano: string, hash: string) =>
  vi.fn(async () =>
    new Response(
      JSON.stringify({
        transactions: [
          {
            hash,
            now: Math.floor(Date.now() / 1000),
            mc_block_seqno: 1,
            in_msg: { value: amountNano, message_content: { decoded: { '@type': 'text_comment', text: comment } } },
          },
        ],
      }),
      { status: 200 },
    ),
  );
/** A chain index that shows nothing yet. */
const empty = () => vi.fn(async () => new Response(JSON.stringify({ transactions: [] }), { status: 200 }));

const rowOf = (db: SqliteD1, orderId: string): any =>
  db.sqlite.prepare('SELECT * FROM ton_pending_orders WHERE order_id = ?').get(orderId) ?? null;

function travel(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + ms);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function invoice(env: any, user = 'user_a', plan = 'starter') {
  const inv = await createTonInvoice(env, user, plan);
  if (!inv.ok) throw new Error(`invoice failed: ${inv.error}`);
  return inv.order;
}

describe('the comment must equal the order memo', () => {
  it.each([
    ['another order memo with this one appended', (memo: string) => `LUM:ton_1_other:agency ${memo}`],
    ['this memo with text after it', (memo: string) => `${memo} thanks`],
    ['this memo with text glued on', (memo: string) => `x${memo}`],
    ['this memo twice', (memo: string) => `${memo}${memo}`],
    ['a longer plan name', (memo: string) => `${memo}x`],
  ])('a transfer whose comment only contains it (%s) is not credited', async (_label, comment) => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env);
    const res = await verifyTonPayment(env, order.orderId, { fetcher: showing(comment(order.memo), TON_PRICING.starter.nanoTon, 'tx_contains') });
    expect(res.ok).toBe(false);
    expect(kv.store.has('sub:user_a')).toBe(false);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM ton_credited_tx').get().n).toBe(0);
  });

  it('the exact memo is credited, and space around it is not held against the payer', async () => {
    const { env, kv } = makeEnv();
    const order = await invoice(env);
    const res = await verifyTonPayment(env, order.orderId, { fetcher: showing(`  ${order.memo}\n`, TON_PRICING.starter.nanoTon, 'tx_exact') });
    expect(res.ok).toBe(true);
    expect(kv.store.has('sub:user_a')).toBe(true);
  });
});

type IndexedTx = { hash: string; now: number; lt: number; comment: string; value: string };

/** A chain index that filters and pages the way the two real ones are asked to. */
function chainIndex(
  txs: IndexedTx[],
  opts: { toncenterDown?: boolean; tonapiDown?: boolean; allDown?: boolean; tonapiFailsAfterFirstPage?: boolean } = {},
) {
  const calls: string[] = [];
  const shape = (t: IndexedTx) => ({
    hash: t.hash,
    now: t.now,
    utime: t.now,
    lt: String(t.lt),
    mc_block_seqno: 1,
    in_msg: { value: t.value, message_content: { decoded: { '@type': 'text_comment', text: t.comment } } },
  });
  const fetcher = vi.fn(async (url: string) => {
    calls.push(url);
    if (opts.allDown) return new Response('down', { status: 503 });
    const u = new URL(url);
    const limit = Number(u.searchParams.get('limit') || 30);
    if (u.searchParams.has('account')) {
      // Toncenter v3.
      if (opts.toncenterDown) return new Response('down', { status: 503 });
      const since = Number(u.searchParams.get('start_utime') || 0);
      const offset = Number(u.searchParams.get('offset') || 0);
      const asc = u.searchParams.get('sort') === 'asc';
      const list = txs.filter((t) => t.now >= since).sort((a, b) => (asc ? a.lt - b.lt : b.lt - a.lt));
      return new Response(JSON.stringify({ transactions: list.slice(offset, offset + limit).map(shape) }), { status: 200 });
    }
    // TonAPI: newest first, paged back by logical time.
    if (opts.tonapiDown) return new Response('down', { status: 503 });
    if (opts.tonapiFailsAfterFirstPage && u.searchParams.has('before_lt')) return new Response('down', { status: 503 });
    const before = u.searchParams.get('before_lt');
    const list = txs.filter((t) => (before ? t.lt < Number(before) : true)).sort((a, b) => b.lt - a.lt);
    return new Response(JSON.stringify({ transactions: list.slice(0, limit).map(shape) }), { status: 200 });
  });
  return { fetcher, calls, txs };
}

/** Lets a test make chosen statements fail, the way a database that stops answering would. */
function faultyDb(db: SqliteD1, failure: (sql: string) => string | false): D1Database {
  const guard = (sql: string) => {
    const message = failure(sql);
    if (message) throw new Error(message);
  };
  const wrap = (stmt: any, sql: string): any => ({
    bind: (...args: unknown[]) => wrap(stmt.bind(...args), sql),
    execute: () => stmt.execute(),
    first: async (...args: unknown[]) => {
      guard(sql);
      return stmt.first(...args);
    },
    all: async () => {
      guard(sql);
      return stmt.all();
    },
    run: async () => {
      guard(sql);
      return stmt.run();
    },
  });
  return { prepare: (sql: string) => wrap(db.prepare(sql), sql), batch: (s: any[]) => db.batch(s) } as unknown as D1Database;
}

const nowSec = () => Math.floor(Date.now() / 1000);
const creditedCount = (db: SqliteD1) => db.sqlite.prepare('SELECT COUNT(*) AS n FROM ton_credited_tx').get().n as number;

describe('an order is remembered for 48 hours', () => {
  it('an invoice writes the order to D1 with what the verifier needs', async () => {
    const { env, db } = makeEnv();
    const order = await invoice(env);
    expect(rowOf(db, order.orderId)).toMatchObject({
      memo: order.memo,
      account_id: 'user_a',
      login_id: 'user_a',
      plan_id: 'starter',
      asset: 'TON',
      amount_nano: TON_PRICING.starter.nanoTon,
      recipient: MERCHANT,
      network: 'mainnet',
      status: 'pending',
    });
    expect(rowOf(db, order.orderId).expires_at - rowOf(db, order.orderId).created_at).toBe(TON_PENDING_ORDER_TTL_MS);
  });

  it('no invoice is issued when the order could not be remembered', async () => {
    const { env, kv } = makeEnv();
    env.DB = createSqliteD1({ skipMigrations: ['0025'] });
    const inv = await createTonInvoice(env, 'user_a', 'starter');
    expect(inv).toEqual({ ok: false, error: TON_UNAVAILABLE_ERROR });
    expect([...kv.store.keys()].filter((k) => k.startsWith('ton:order:'))).toEqual([]);
  });

  it('an order that was remembered and then could not be stored is not issued, and its row is removed', async () => {
    const { env, kv, db } = makeEnv();
    const put = kv.put.bind(kv);
    kv.put = async (key: string, value: string) => {
      if (key.startsWith('ton:order:')) throw new Error('simulated KV outage');
      return put(key, value);
    };
    expect(await createTonInvoice(env, 'user_a', 'starter')).toEqual({ ok: false, error: TON_UNAVAILABLE_ERROR });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM ton_pending_orders').get().n).toBe(0);
  });

  it('one account cannot hold more than the allowed number of open orders, and paying one frees a place', async () => {
    const { env } = makeEnv();
    const orders = [];
    for (let i = 0; i < TON_MAX_OPEN_ORDERS_PER_ACCOUNT; i += 1) orders.push(await invoice(env, 'user_many'));
    expect(await createTonInvoice(env, 'user_many', 'starter')).toEqual({ ok: false, error: TON_TOO_MANY_OPEN_ORDERS_ERROR });
    // The message names only controls that exist.
    expect(TON_TOO_MANY_OPEN_ORDERS_ERROR).toContain('Check my payment');
    expect(TON_TOO_MANY_OPEN_ORDERS_ERROR).not.toMatch(/pay one of them/i);
    // Somebody else is not affected.
    expect((await createTonInvoice(env, 'user_other', 'starter')).ok).toBe(true);

    const paid = await verifyTonPayment(env, orders[0].orderId, { fetcher: showing(orders[0].memo, TON_PRICING.starter.nanoTon, 'tx_frees_a_place') });
    expect(paid.ok).toBe(true);
    expect((await createTonInvoice(env, 'user_many', 'starter')).ok).toBe(true);
  });

  it('the cap holds when many invoices are asked for at the same moment', async () => {
    const { env, kv, db } = makeEnv();
    const results = await Promise.all(Array.from({ length: TON_MAX_OPEN_ORDERS_PER_ACCOUNT + 5 }, () => createTonInvoice(env, 'user_burst', 'starter')));
    expect(results.filter((r) => r.ok)).toHaveLength(TON_MAX_OPEN_ORDERS_PER_ACCOUNT);
    expect(results.filter((r) => !r.ok && r.error === TON_TOO_MANY_OPEN_ORDERS_ERROR)).toHaveLength(5);
    expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ton_pending_orders WHERE account_id = 'user_burst'`).get().n).toBe(TON_MAX_OPEN_ORDERS_PER_ACCOUNT);
    // A refused invoice leaves no order behind in KV either.
    expect([...kv.store.keys()].filter((k) => k.startsWith('ton:order:'))).toHaveLength(TON_MAX_OPEN_ORDERS_PER_ACCOUNT);
  });

  it("the buyer's own retry still works after the 2-hour KV copy has gone", async () => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env);
    kv.store.delete(`ton:order:${order.orderId}`);

    const wrongUser = await verifyTonPayment(env, order.orderId, { expectedUserId: 'someone_else', fetcher: empty() });
    expect(wrongUser).toEqual({ ok: false, error: 'Order does not belong to this account' });

    const res = await verifyTonPayment(env, order.orderId, {
      expectedUserId: 'user_a',
      fetcher: showing(order.memo, TON_PRICING.starter.nanoTon, 'tx_late_retry'),
    });
    expect(res.ok).toBe(true);
    expect(kv.store.has('sub:user_a')).toBe(true);
    expect(rowOf(db, order.orderId).status).toBe('credited');
  });

  it('a database that cannot be read is not reported as an order that has expired', async () => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env);
    kv.store.delete(`ton:order:${order.orderId}`);
    env.DB = faultyDb(db, (sql) => (/FROM ton_pending_orders WHERE order_id/.test(sql) ? 'D1_ERROR: Network connection lost.' : false));
    const res = await verifyTonPayment(env, order.orderId, { fetcher: showing(order.memo, TON_PRICING.starter.nanoTon, 'tx_blind') });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/temporarily unavailable/i);
      expect(res.error).not.toMatch(/not found or expired/i);
    }
  });

  it('an order remembered for another network is not verified', async () => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env);
    kv.store.delete(`ton:order:${order.orderId}`);
    db.sqlite.prepare(`UPDATE ton_pending_orders SET network = 'testnet' WHERE order_id = ?`).run(order.orderId);
    const res = await verifyTonPayment(env, order.orderId, { fetcher: showing(order.memo, TON_PRICING.starter.nanoTon, 'tx_wrong_net') });
    expect(res).toEqual({ ok: false, error: 'Order not found or expired' });
    expect(kv.store.has('sub:user_a')).toBe(false);
  });

  it('an order is payable only to the wallet configured now: after the address is replaced, a transfer to the old one grants nothing', async () => {
    const { env, kv } = makeEnv();
    const order = await invoice(env);
    const replacement = syntheticTonAddress(0x11, 0x3c);
    env.TON_RECEIVING_ADDRESS = replacement;
    env.TON_CONFIRMED_ADDRESS = replacement;
    const res = await verifyTonPayment(env, order.orderId, { fetcher: showing(order.memo, TON_PRICING.starter.nanoTon, 'tx_old_wallet') });
    // The buyer is told what happened and where to turn, not to pay some other way.
    expect(res).toEqual({ ok: false, error: TON_ORDER_WALLET_REPLACED_ERROR });
    expect(TON_ORDER_WALLET_REPLACED_ERROR).toContain('support@luminarasuite.com');
    expect(kv.store.has('sub:user_a')).toBe(false);
  });

  it('after 48 hours the order is closed; its row is kept 30 days for support, then removed', async () => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env);
    kv.store.delete(`ton:order:${order.orderId}`);
    travel(TON_PENDING_ORDER_TTL_MS + 60_000);

    const res = await verifyTonPayment(env, order.orderId, { fetcher: showing(order.memo, TON_PRICING.starter.nanoTon, 'tx_too_late') });
    expect(res).toEqual({ ok: false, error: 'Order not found or expired' });

    expect(await sweepTonPendingOrders(env, { fetcher: empty() })).toMatchObject({ expired: 1, deleted: 0, matched: 0 });
    expect(rowOf(db, order.orderId)).toMatchObject({ status: 'expired', account_id: 'user_a' });
    // Expired is final: a transfer that shows up now is not credited.
    expect((await verifyTonPayment(env, order.orderId, { fetcher: showing(order.memo, TON_PRICING.starter.nanoTon, 'tx_after_close') })).ok).toBe(false);

    travel(TON_PENDING_ORDER_SUPPORT_MS);
    expect(await sweepTonPendingOrders(env, { fetcher: empty() })).toMatchObject({ deleted: 1 });
    expect(rowOf(db, order.orderId)).toBeNull();
  });
});

describe('the sweep credits late instead of never', () => {
  it('an order paid at minute 1 and shown by the index at minute 5 is credited by the next sweep, with no user action', async () => {
    const { env, kv, db } = makeEnv();
    const index = chainIndex([]);
    const order = await invoice(env);
    const paidAt = nowSec() + 60;

    // Too young: the buyer's own polling is still running.
    expect(await sweepTonPendingOrders(env, { fetcher: index.fetcher })).toMatchObject({ open: 0, matched: 0 });

    travel(3 * 60_000);
    // The transfer was made at minute 1; the index has not caught up yet.
    expect(await sweepTonPendingOrders(env, { fetcher: index.fetcher })).toMatchObject({ open: 1, matched: 0, credited: 0 });
    expect(kv.store.has('sub:user_a')).toBe(false);

    // Hours later the KV copy is gone and the index shows it, dated minute 1.
    travel(3 * 60 * 60_000);
    kv.store.delete(`ton:order:${order.orderId}`);
    index.txs.push({ hash: 'tx_indexed_late', now: paidAt, lt: 1, comment: order.memo, value: TON_PRICING.starter.nanoTon });
    expect(await sweepTonPendingOrders(env, { fetcher: index.fetcher })).toMatchObject({ open: 1, matched: 1, credited: 1, errors: 0 });
    expect(JSON.parse(kv.store.get('sub:user_a') as string)).toMatchObject({ plan: 'starter', paymentMethod: 'ton' });
    expect(rowOf(db, order.orderId).status).toBe('credited');
  });

  it('a paid order behind six hundred older unpaid ones is credited in the same run, with one read of the wallet and one order looked at', async () => {
    const { env, kv } = makeEnv();
    for (let account = 0; account < 60; account += 1) {
      for (let i = 0; i < 10; i += 1) await invoice(env, `abandoned_${account}`);
    }
    travel(60_000);
    const paid = await invoice(env, 'user_paid');
    const index = chainIndex([{ hash: 'tx_behind_the_queue', now: nowSec() + 30, lt: 7, comment: paid.memo, value: TON_PRICING.starter.nanoTon }]);
    travel(3 * 60_000);

    const summary = await sweepTonPendingOrders(env, { fetcher: index.fetcher });
    expect(summary).toMatchObject({ open: 601, matched: 1, credited: 1, errors: 0, truncated: false });
    expect(kv.store.has('sub:user_paid')).toBe(true);
    // One read of each index for the wallet, however many orders are open.
    expect(index.calls).toHaveLength(2);
  });

  it('says so when a wallet has more history than one run reads, or when a page of it fails', async () => {
    const { env } = makeEnv();
    await invoice(env);
    const t0 = nowSec();
    const many = Array.from({ length: 1_100 }, (_, i) => ({ hash: `dust_${i}`, now: t0 + i, lt: i + 1, comment: `hello ${i}`, value: '1' }));
    travel(60 * 60_000);
    expect((await sweepTonPendingOrders(env, { fetcher: chainIndex(many).fetcher })).truncated).toBe(true);

    const some = many.slice(0, 250);
    expect((await sweepTonPendingOrders(env, { fetcher: chainIndex(some).fetcher })).truncated).toBe(false);
    // Toncenter is down and TonAPI answers its first page only: a partial read, not a complete one.
    const partial = chainIndex(some, { toncenterDown: true, tonapiFailsAfterFirstPage: true });
    expect((await sweepTonPendingOrders(env, { fetcher: partial.fetcher })).truncated).toBe(true);
  });

  it.each([
    ['Toncenter alone, with TonAPI down', { tonapiDown: true }],
    ['TonAPI alone, with Toncenter down', { toncenterDown: true }],
    ['both answering', {}],
  ])('a transfer is found on a wallet that has received hundreds of others since the invoice (%s)', async (_name, opts) => {
    const { env, kv } = makeEnv();
    const order = await invoice(env);
    const t0 = nowSec();
    const dust = (i: number): IndexedTx => ({ hash: `dust_${i}`, now: t0 + i, lt: i, comment: `hello ${i}`, value: '1' });
    const index = chainIndex(
      [
        ...Array.from({ length: 150 }, (_, i) => dust(i + 1)),
        { hash: 'tx_deep_in_history', now: t0 + 200, lt: 200, comment: order.memo, value: TON_PRICING.starter.nanoTon },
        ...Array.from({ length: 150 }, (_, i) => dust(i + 201)),
      ],
      opts,
    );
    travel(60 * 60_000);

    const res = await verifyTonPayment(env, order.orderId, { expectedUserId: 'user_a', fetcher: index.fetcher });
    expect(res.ok).toBe(true);
    expect(kv.store.has('sub:user_a')).toBe(true);
    // It took more than one page to reach it.
    expect(index.calls.length).toBeGreaterThan(1);
  });

  it('an order is never credited twice, even when the sweep is made to look at a credited order again', async () => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env);
    const index = chainIndex([{ hash: 'tx_once', now: nowSec() + 30, lt: 3, comment: order.memo, value: TON_PRICING.starter.nanoTon }]);
    travel(3 * 60_000);

    expect((await sweepTonPendingOrders(env, { fetcher: index.fetcher })).credited).toBe(1);
    const expiry = JSON.parse(kv.store.get('sub:user_a') as string).expiresAt;
    expect(await sweepTonPendingOrders(env, { fetcher: index.fetcher })).toMatchObject({ open: 0, matched: 0, credited: 0 });

    // Put everything back as if nothing had been recorded except the ledger claim: the row is
    // pending again and both KV copies are gone. Only ton_credited_tx stands between this and a
    // second credit.
    db.sqlite.prepare(`UPDATE ton_pending_orders SET status = 'pending' WHERE order_id = ?`).run(order.orderId);
    for (const key of [...kv.store.keys()]) if (key.startsWith('ton:order:') || key.startsWith('ton:tx:')) kv.store.delete(key);
    await sweepTonPendingOrders(env, { fetcher: index.fetcher });
    await verifyTonPayment(env, order.orderId, { expectedUserId: 'user_a', fetcher: index.fetcher });

    expect(JSON.parse(kv.store.get('sub:user_a') as string).expiresAt).toBe(expiry);
    expect(creditedCount(db)).toBe(1);
  });

  it('the sweep and the buyer checking at the same moment credit the order once', async () => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env);
    const index = chainIndex([{ hash: 'tx_raced', now: nowSec() + 30, lt: 3, comment: order.memo, value: TON_PRICING.starter.nanoTon }]);
    travel(3 * 60_000);
    const before = Date.now();

    await Promise.all([
      sweepTonPendingOrders(env, { fetcher: index.fetcher }),
      verifyTonPayment(env, order.orderId, { expectedUserId: 'user_a', fetcher: index.fetcher }),
    ]);

    expect(creditedCount(db)).toBe(1);
    const sub = JSON.parse(kv.store.get('sub:user_a') as string);
    expect(sub.expiresAt).toBeLessThanOrEqual(before + 30 * DAY + 5_000);
  });

  it('an order whose claim is held by another verifier is not marked credited by this one', async () => {
    const { env, db } = makeEnv();
    const order = await invoice(env);
    // Another verifier holds the claim for this order and has not written the plan yet (it may still fail and release it).
    db.sqlite.prepare(`INSERT INTO ton_credited_tx (tx_hash, order_id, account_id, credited_at) VALUES ('tx_held', ?, 'user_a', ?)`).run(order.orderId, Date.now());
    const res = await verifyTonPayment(env, order.orderId, { fetcher: showing(order.memo, TON_PRICING.starter.nanoTon, 'tx_held') });
    expect(res.ok).toBe(true);
    expect(rowOf(db, order.orderId).status).toBe('pending');
  });

  it('a credited order whose row was never marked is brought in step by a later sweep: not counted again, and not closed as unpaid', async () => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env);
    const index = chainIndex([{ hash: 'tx_unmarked', now: nowSec() + 30, lt: 3, comment: order.memo, value: TON_PRICING.starter.nanoTon }]);
    travel(3 * 60_000);
    // The plan is written; marking the row fails.
    env.DB = faultyDb(db, (sql) => (/UPDATE ton_pending_orders SET status = 'credited' WHERE order_id/.test(sql) ? 'D1_ERROR: Network connection lost.' : false));
    expect((await sweepTonPendingOrders(env, { fetcher: index.fetcher })).credited).toBe(1);
    expect(rowOf(db, order.orderId).status).toBe('pending');
    const expiry = JSON.parse(kv.store.get('sub:user_a') as string).expiresAt;
    env.DB = db;

    // Straight away the claim is too young to be taken as settled: its verifier could still be at work.
    expect(await sweepTonPendingOrders(env, { fetcher: index.fetcher })).toMatchObject({ reconciled: 0 });

    travel(6 * 60_000);
    expect(await sweepTonPendingOrders(env, { fetcher: index.fetcher })).toMatchObject({ reconciled: 1, open: 0, matched: 0, credited: 0 });
    expect(rowOf(db, order.orderId).status).toBe('credited');

    travel(TON_PENDING_ORDER_TTL_MS);
    expect(await sweepTonPendingOrders(env, { fetcher: index.fetcher })).toMatchObject({ expired: 0 });
    expect(rowOf(db, order.orderId).status).toBe('credited');
    expect(JSON.parse(kv.store.get('sub:user_a') as string).expiresAt).toBe(expiry);
    expect(creditedCount(db)).toBe(1);
  });

  it('when neither index answers, nothing is decided and nothing is lost', async () => {
    const { env, db } = makeEnv();
    const order = await invoice(env);
    travel(3 * 60_000);
    const summary = await sweepTonPendingOrders(env, { fetcher: chainIndex([], { allDown: true }).fetcher });
    expect(summary).toMatchObject({ open: 1, matched: 0, credited: 0, errors: 1 });
    expect(rowOf(db, order.orderId).status).toBe('pending');
  });

  it('runs on the daily cron', async () => {
    const { ALL_SCHEDULED_JOBS, DAILY_CRON, jobsForCron } = await import('../worker/scheduledJobs');
    expect(jobsForCron(DAILY_CRON)).toContain('ton_pending_sweep');
    expect(ALL_SCHEDULED_JOBS).toContain('ton_pending_sweep');
    const source = readFileSync(resolve(__dirname, '..', 'worker', 'index.ts'), 'utf8');
    expect(source).toMatch(/jobs\.includes\('ton_pending_sweep'\)/);
    expect(source).toContain('sweepTonPendingOrders(env)');
  });
});

describe('the account behind a pending order', () => {
  it('is exported with the account and deleted with it', async () => {
    const { env, db } = makeEnv();
    const order = await invoice(env, 'fb:privacy');
    const user = { id: 'fb:privacy', accountId: 'fb:privacy', source: 'firebase' } as HostedIdentity;
    db.sqlite.prepare(`INSERT OR IGNORE INTO users (id, source, account_id, created_at, last_seen_at) VALUES ('fb:privacy', 'firebase', 'fb:privacy', 1, 1)`).run();

    const exported = await createPrivacyJob(env, user, 'export');
    const { jobId } = (await exported.json()) as { jobId: string };
    const body = JSON.parse((await env.LUMINARA_KV.get(`privacy:export:${jobId}`)) as string);
    expect(body.processors).toContain('ton_pending_orders');
    expect(body.tonPendingOrders).toEqual([expect.objectContaining({ order_id: order.orderId, plan_id: 'starter', status: 'pending' })]);

    expect((await createPrivacyJob(env, user, 'delete')).status).toBe(200);
    expect(rowOf(db, order.orderId)).toBeNull();
  });

  it('follows the account that survives a link', async () => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env, '777');
    await kv.put('sub:fb:uid-1', JSON.stringify({ plan: 'starter', expiresAt: Date.now() + DAY }));
    const linked = await linkTelegramAndFirebase(env, '777', 'uid-1');
    expect(linked.accountId).toBe('fb:uid-1');
    expect(rowOf(db, order.orderId).account_id).toBe('fb:uid-1');
  });
});

describe('what the buyer is told when the index is slow', () => {
  const memory = () => {
    const store = new Map<string, string>();
    return {
      store,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  };

  it('the notice says what is true and names a control that exists', () => {
    expect(TON_PENDING_NOTICE).toContain('If you paid, it will be credited: do not pay again.');
    expect(TON_PENDING_NOTICE).toContain('Check my payment');
    expect(TON_PENDING_NOTICE).toContain('48 hours');
    expect(TON_PENDING_ORDER_WINDOW_MS).toBe(TON_PENDING_ORDER_TTL_MS);
    const service = readFileSync(resolve(__dirname, '..', 'services', 'ton', 'tonService.ts'), 'utf8');
    expect(service).not.toContain('Retry Verify from Pricing');
  });

  it('the order is remembered across a closed tab for 48 hours, then forgotten', () => {
    vi.stubGlobal('localStorage', memory());
    expect(readPendingTonOrder()).toBeNull();
    rememberPendingTonOrder('ton_1_abc', 1_000);
    expect(readPendingTonOrder(1_000 + TON_PENDING_ORDER_WINDOW_MS)).toBe('ton_1_abc');
    expect(readPendingTonOrder(1_001 + TON_PENDING_ORDER_WINDOW_MS)).toBeNull();
    rememberPendingTonOrder('ton_2_def');
    forgetPendingTonOrder();
    expect(readPendingTonOrder()).toBeNull();
  });

  it('"Check my payment" asks the Worker again and reports each outcome truthfully', async () => {
    const storage = memory();
    vi.stubGlobal('localStorage', storage);
    const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

    rememberPendingTonOrder('ton_3_ghi');
    answer(400, { error: 'Matching on-chain transfer not found yet. Wait a few seconds and retry.' });
    expect(await checkPendingTonPayment('ton_3_ghi')).toEqual({ ok: false, error: TON_STILL_PENDING_NOTICE });
    expect(readPendingTonOrder()).toBe('ton_3_ghi');

    answer(400, { error: 'Order not found or expired' });
    const closed = await checkPendingTonPayment('ton_3_ghi');
    expect(closed).toMatchObject({ ok: false, closed: true });
    expect(closed.error).toContain('ton_3_ghi');
    expect(readPendingTonOrder()).toBeNull();

    // Signed out, or the service being unavailable, is said as it is, and the order is not forgotten.
    rememberPendingTonOrder('ton_3b_mno');
    answer(401, { error: 'Sign in required' });
    expect(await checkPendingTonPayment('ton_3b_mno')).toEqual({ ok: false, error: 'Sign in required' });
    answer(400, { error: 'Payment verification is temporarily unavailable. Please try again in a few minutes.' });
    expect((await checkPendingTonPayment('ton_3b_mno')).error).toMatch(/temporarily unavailable/);
    expect(readPendingTonOrder()).toBe('ton_3b_mno');

    rememberPendingTonOrder('ton_4_jkl');
    answer(200, { ok: true, plan: 'starter', expiresAt: 123 });
    expect(await checkPendingTonPayment('ton_4_jkl')).toMatchObject({ ok: true, plan: 'starter' });
    expect(readPendingTonOrder()).toBeNull();
  });

  it('the paywall shows the control on the web while an order is waiting, and never inside Telegram', () => {
    const storage = memory();
    vi.stubGlobal('localStorage', storage);
    const paywall = () => renderToStaticMarkup(createElement(PaywallModal, { isOpen: true, onClose: () => {} }));

    state.inTelegram = false;
    expect(paywall()).not.toContain('Check my payment');

    rememberPendingTonOrder('ton_5_mno');
    const html = paywall();
    expect(html).toContain('Check my payment');
    expect(html).toContain('ton_5_mno');

    state.inTelegram = true;
    expect(paywall()).not.toContain('Check my payment');
    state.inTelegram = false;
  });
});

describe('the client payment flow', () => {
  const MAINNET_ADDR = new Address(0, Buffer.alloc(32, 0x5a)).toString({ bounceable: true, testOnly: false });
  const clientOrder = {
    orderId: 'ton_9_xyz',
    planId: 'starter',
    amountNano: '15000000000',
    tonAmount: 15,
    memo: 'LUM:ton_9_xyz:starter',
    recipientAddress: MAINNET_ADDR,
    status: 'pending',
    createdAt: 0,
  };
  const storage = () => {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  };
  /** The Worker as the client sees it: an invoice, then whatever `verify` does. */
  const api = (verify: () => Promise<Response>) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) =>
        String(url).endsWith('/api/ton/invoice') ? new Response(JSON.stringify({ ok: true, order: clientOrder }), { status: 200 }) : verify(),
      ),
    );

  it('the order is remembered before the wallet is asked, and forgotten if the wallet refuses', async () => {
    vi.stubGlobal('localStorage', storage());
    api(async () => new Response('{}', { status: 400 }));
    let rememberedWhileAsking: string | null = null;
    const wallet = {
      wallet: { account: { chain: '-239' } },
      sendTransaction: vi.fn(async () => {
        rememberedWhileAsking = readPendingTonOrder();
        throw new Error('User rejected the request');
      }),
    };
    const res = await executeTonPayment(wallet, 'starter');
    expect(rememberedWhileAsking).toBe('ton_9_xyz');
    expect(res).toEqual({ ok: false, error: 'User rejected the request' });
    expect(readPendingTonOrder()).toBeNull();
  });

  it('refusing a second attempt puts back the first order, which may be paid and waiting', async () => {
    vi.stubGlobal('localStorage', storage());
    api(async () => new Response('{}', { status: 400 }));
    rememberPendingTonOrder('ton_first_paid', Date.now() - 60_000);
    const wallet = {
      wallet: { account: { chain: '-239' } },
      sendTransaction: vi.fn(async () => {
        throw new Error('User rejected the request');
      }),
    };
    expect((await executeTonPayment(wallet, 'starter')).ok).toBe(false);
    expect(readPendingTonOrder()).toBe('ton_first_paid');
  });

  it('a check that fails while polling is not shown as a failed payment', async () => {
    vi.stubGlobal('localStorage', storage());
    api(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const wallet = { wallet: { account: { chain: '-239' } }, sendTransaction: vi.fn(async () => ({})) };
    const pending = executeTonPayment(wallet, 'starter');
    await vi.advanceTimersByTimeAsync(25_000);
    const res = await pending;
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: false, pendingOrderId: 'ton_9_xyz', error: TON_PENDING_NOTICE });
    expect(readPendingTonOrder()).toBe('ton_9_xyz');
  });

  it('a transfer seen while polling ends the wait and clears the reminder', async () => {
    vi.stubGlobal('localStorage', storage());
    api(async () => new Response(JSON.stringify({ ok: true, plan: 'starter', expiresAt: 5 }), { status: 200 }));
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const wallet = { wallet: { account: { chain: '-239' } }, sendTransaction: vi.fn(async () => ({})) };
    const pending = executeTonPayment(wallet, 'starter');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toMatchObject({ ok: true, plan: 'starter' });
    expect(readPendingTonOrder()).toBeNull();
  });
});
