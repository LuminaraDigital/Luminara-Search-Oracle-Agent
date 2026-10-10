import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTonInvoice, sweepTonPendingOrders, verifyTonPayment, TON_PRICING, TON_UNAVAILABLE_ERROR, crc16Xmodem } from '../worker/tonPayment';
import { TON_PENDING_ORDER_TTL_MS } from '../worker/tonPendingOrders';
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

  it('an order remembered for another network is not verified', async () => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env);
    kv.store.delete(`ton:order:${order.orderId}`);
    db.sqlite.prepare(`UPDATE ton_pending_orders SET network = 'testnet' WHERE order_id = ?`).run(order.orderId);
    const res = await verifyTonPayment(env, order.orderId, { fetcher: showing(order.memo, TON_PRICING.starter.nanoTon, 'tx_wrong_net') });
    expect(res).toEqual({ ok: false, error: 'Order not found or expired' });
    expect(kv.store.has('sub:user_a')).toBe(false);
  });

  it('after 48 hours the order is no longer creditable and its row is removed', async () => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env);
    kv.store.delete(`ton:order:${order.orderId}`);
    travel(TON_PENDING_ORDER_TTL_MS + 60_000);

    const res = await verifyTonPayment(env, order.orderId, { fetcher: showing(order.memo, TON_PRICING.starter.nanoTon, 'tx_too_late') });
    expect(res).toEqual({ ok: false, error: 'Order not found or expired' });

    const summary = await sweepTonPendingOrders(env, { fetcher: empty() });
    expect(summary).toMatchObject({ deleted: 1, examined: 0 });
    expect(rowOf(db, order.orderId)).toBeNull();
  });
});

describe('the sweep credits late instead of never', () => {
  it('an order paid at minute 1 and shown by the index at minute 5 is credited by the next sweep, with no user action', async () => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env);

    // Too young: the buyer's own polling is still running.
    expect(await sweepTonPendingOrders(env, { fetcher: empty() })).toMatchObject({ examined: 0 });

    travel(3 * 60_000);
    // The index has not caught up yet.
    expect(await sweepTonPendingOrders(env, { fetcher: empty() })).toMatchObject({ examined: 1, credited: 0, stillPending: 1 });
    expect(kv.store.has('sub:user_a')).toBe(false);

    // Hours later the KV copy is gone and the index shows the transfer.
    travel(3 * 60 * 60_000);
    kv.store.delete(`ton:order:${order.orderId}`);
    const summary = await sweepTonPendingOrders(env, { fetcher: showing(order.memo, TON_PRICING.starter.nanoTon, 'tx_indexed_late') });
    expect(summary).toMatchObject({ examined: 1, credited: 1, stillPending: 0, errors: 0 });
    expect(JSON.parse(kv.store.get('sub:user_a') as string)).toMatchObject({ plan: 'starter', paymentMethod: 'ton' });
    expect(rowOf(db, order.orderId).status).toBe('credited');
  });

  it('an order is never credited twice, by the sweep or by a retry after it', async () => {
    const { env, kv, db } = makeEnv();
    const order = await invoice(env);
    travel(3 * 60_000);
    const index = showing(order.memo, TON_PRICING.starter.nanoTon, 'tx_once');

    expect((await sweepTonPendingOrders(env, { fetcher: index })).credited).toBe(1);
    const expiry = JSON.parse(kv.store.get('sub:user_a') as string).expiresAt;

    // The row is credited, so the next sweep does not look at it again.
    expect(await sweepTonPendingOrders(env, { fetcher: index })).toMatchObject({ examined: 0, credited: 0 });
    // The buyer pressing "Check my payment" afterwards is told it is paid, and gains nothing more.
    expect((await verifyTonPayment(env, order.orderId, { expectedUserId: 'user_a', fetcher: index })).ok).toBe(true);

    expect(JSON.parse(kv.store.get('sub:user_a') as string).expiresAt).toBe(expiry);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM ton_credited_tx').get().n).toBe(1);
  });

  it('one run looks at a bounded number of orders, oldest first', async () => {
    const { env } = makeEnv();
    for (let i = 0; i < 6; i += 1) await invoice(env, `user_${i}`);
    travel(3 * 60_000);
    const index = empty();
    expect(await sweepTonPendingOrders(env, { fetcher: index, limit: 4 })).toMatchObject({ examined: 4, stillPending: 4 });
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
