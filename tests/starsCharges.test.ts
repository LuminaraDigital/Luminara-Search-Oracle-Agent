import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import {
  PLANS,
  handleTelegramPaymentUpdate,
  handleTelegramUpdate,
  isTelegramPaymentUpdate,
  parseStarsPayload,
  refundStarsCharge,
  runStarsChargeSweep,
  subscriptionListsCharge,
} from '../worker/telegramBot';
import {
  STARS_LEASE_MS,
  STARS_MAX_REFUND_ATTEMPTS,
  STARS_RECEIVED_GRACE_MS,
  STARS_REFUND_GRACE_MS,
  leaseStarsCharge,
  recordStarsCharge,
} from '../worker/starsCharges';
import { linkTelegramAndFirebase, writeSubscriptionRecord } from '../worker/userStore';
import { createPrivacyJob } from '../worker/privacyService';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1, type SqliteD1 } from './helpers/sqliteD1';

/**
 * Track SW, SW0a-3: a paid Telegram Stars charge can never be lost.
 * Each test below is one line of that task's acceptance, or a rule its design depends on.
 */

const DAY = 86400_000;
const PAYER = 777;
const ADMIN = 999999;

class MockKV {
  store = new Map<string, string>();
  failPut: (key: string) => boolean = () => false;
  failGet: (key: string) => boolean = () => false;

  async get(key: string, type?: string) {
    if (this.failGet(key)) throw new Error(`KV get failed for ${key}`);
    const val = this.store.get(key);
    if (val === undefined) return null;
    return type === 'json' ? JSON.parse(val) : val;
  }

  async put(key: string, value: string) {
    if (this.failPut(key)) throw new Error(`KV put failed for ${key}`);
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
  }

  json(key: string): any {
    const val = this.store.get(key);
    return val === undefined ? null : JSON.parse(val);
  }
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

type TelegramCall = { method: string; body: any };

function installTelegram() {
  const calls: TelegramCall[] = [];
  const replies: Record<string, (body: any) => unknown> = {};
  (globalThis as any).fetch = vi.fn(async (url: unknown, init?: { body?: string }) => {
    const method = String(url).split('/').pop() || '';
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ method, body });
    return { json: async () => (replies[method] ? replies[method](body) : { ok: true, result: true }) };
  });
  return {
    calls,
    replies,
    of: (method: string) => calls.filter((c) => c.method === method),
    messagesTo: (chatId: number) => calls.filter((c) => c.method === 'sendMessage' && Number(c.body.chat_id) === chatId),
  };
}

function makeEnv() {
  const kv = new MockKV();
  const db = createSqliteD1();
  const env = {
    ASSETS: {} as any,
    BOT_TOKEN: '123456:MOCK_TOKEN',
    WEBAPP_URL: 'https://luminarasuite.com',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    TELEGRAM_ADMIN_ID: String(ADMIN),
    ADMIN_SECRET: 'admin-secret-for-tests',
    LUMINARA_KV: kv as any,
    DB: db as D1Database,
  } as unknown as Env;
  return { env, kv, db };
}

const paid = (chargeId: string, o: { payload?: string; from?: number; amount?: number } = {}) => ({
  message: {
    chat: { id: o.from ?? PAYER },
    from: { id: o.from ?? PAYER },
    successful_payment: {
      currency: 'XTR',
      total_amount: o.amount ?? PLANS.starter.stars,
      invoice_payload: o.payload ?? `starter:${PAYER}`,
      telegram_payment_charge_id: chargeId,
      provider_payment_charge_id: `prov_${chargeId}`,
    },
  },
});

const rowOf = (db: SqliteD1, chargeId: string): any =>
  db.sqlite.prepare('SELECT * FROM stars_charges WHERE charge_id = ?').get(chargeId) ?? null;
const claimed = (db: SqliteD1, chargeId: string): boolean =>
  Boolean(db.sqlite.prepare('SELECT 1 AS n FROM stars_credited_charges WHERE charge_id = ?').get(chargeId));

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const webhook = (update: unknown, env: Env) =>
  worker.fetch(
    new Request('https://luminarasuite.com/api/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-secret' },
      body: JSON.stringify(update),
    }),
    env,
    ctx,
  );

/** Moves the clock forward without touching the event loop the sqlite stand-in relies on. */
let realStart = 0;
let travelled = 0;
function travel(ms: number) {
  if (travelled === 0) realStart = Date.now();
  travelled += ms;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(realStart + travelled);
}

let telegram: ReturnType<typeof installTelegram>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  telegram = installTelegram();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  travelled = 0;
  vi.restoreAllMocks();
});

describe('a paid Stars charge is put on record first', () => {
  it('credits the plan, lists the charge on the subscription and closes the row', async () => {
    const { env, kv, db } = makeEnv();
    const outcome = await handleTelegramPaymentUpdate(paid('ch_ok'), env);
    expect(outcome.status).toBe(200);

    const row = rowOf(db, 'ch_ok');
    expect(row).toMatchObject({ payer_tg_id: PAYER, account_id: String(PAYER), purpose: 'plan', ref_id: 'starter', stars: 2500, status: 'credited', lease_until: null });
    expect(claimed(db, 'ch_ok')).toBe(true);

    const sub = kv.json(`sub:${PAYER}`);
    expect(sub.plan).toBe('starter');
    expect(sub.chargeId).toBe('ch_ok');
    expect(sub.appliedCharges).toEqual(['ch_ok']);
    expect(sub.expiresAt).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(kv.json('stars:charge:ch_ok')).toMatchObject({ plan: 'starter', chargeId: 'ch_ok', payerTgId: PAYER });

    expect(telegram.of('refundStarPayment')).toHaveLength(0);
    expect(telegram.messagesTo(PAYER)).toHaveLength(1);
    expect(telegram.messagesTo(PAYER)[0].body.text).toContain('Luminara Starter');
  });

  it('the webhook answers only after the charge is settled, and is not held back by the throttle', async () => {
    const { env, db } = makeEnv();
    for (let i = 0; i < 40; i += 1) {
      const res = await webhook(paid(`ch_burst_${i}`, { amount: PLANS.starter.stars }), env);
      expect(res.status).toBe(200);
      // No waitUntil ran (the test context drops it), yet the row is already decided.
      expect(rowOf(db, `ch_burst_${i}`).status).toBe('credited');
    }
  });

  it('the same update twice credits once', async () => {
    const { env, kv, db } = makeEnv();
    await handleTelegramPaymentUpdate(paid('ch_twice'), env);
    const first = kv.json(`sub:${PAYER}`);
    const second = await handleTelegramPaymentUpdate(paid('ch_twice'), env);

    expect(second).toEqual({ status: 200, note: 'already_credited' });
    expect(kv.json(`sub:${PAYER}`)).toEqual(first);
    expect(rowOf(db, 'ch_twice').status).toBe('credited');
    expect(telegram.messagesTo(PAYER)).toHaveLength(1);
    expect(telegram.of('refundStarPayment')).toHaveLength(0);
  });

  it('a second purchase of the same plan adds its days and both charges stay listed', async () => {
    const { env, kv } = makeEnv();
    await handleTelegramPaymentUpdate(paid('ch_a'), env);
    const afterFirst = kv.json(`sub:${PAYER}`).expiresAt;
    await handleTelegramPaymentUpdate(paid('ch_b'), env);
    const sub = kv.json(`sub:${PAYER}`);
    expect(sub.expiresAt).toBe(afterFirst + 30 * DAY);
    expect(sub.appliedCharges).toEqual(['ch_a', 'ch_b']);
  });
});

describe('when the charge row cannot be written', () => {
  it('with no database the webhook asks Telegram to send the update again and grants nothing', async () => {
    const { env, kv } = makeEnv();
    env.DB = undefined;
    const res = await webhook(paid('ch_nodb'), env);
    expect(res.status).toBe(503);
    expect(kv.json(`sub:${PAYER}`)).toBeNull();
    expect(kv.json('stars:charge:ch_nodb')).toBeNull();
    expect(telegram.calls).toHaveLength(0);
  });

  it('with the insert failing the webhook returns non-2xx and nothing is granted', async () => {
    const { env, kv, db } = makeEnv();
    env.DB = faultyDb(db, (sql) => (/INSERT INTO stars_charges/.test(sql) ? 'D1_ERROR: Network connection lost.' : false));
    const res = await webhook(paid('ch_insert_fails'), env);
    expect(res.status).toBe(503);
    expect(rowOf(db, 'ch_insert_fails')).toBeNull();
    expect(claimed(db, 'ch_insert_fails')).toBe(false);
    expect(kv.json(`sub:${PAYER}`)).toBeNull();
    expect(telegram.of('refundStarPayment')).toHaveLength(0);
  });

  it('the redelivery that follows is processed as normal', async () => {
    const { env, kv, db } = makeEnv();
    let down = true;
    env.DB = faultyDb(db, (sql) => (down && /INSERT INTO stars_charges/.test(sql) ? 'D1_ERROR: Network connection lost.' : false));
    expect((await webhook(paid('ch_retry'), env)).status).toBe(503);
    down = false;
    expect((await webhook(paid('ch_retry'), env)).status).toBe(200);
    expect(rowOf(db, 'ch_retry').status).toBe('credited');
    expect(kv.json(`sub:${PAYER}`).appliedCharges).toEqual(['ch_retry']);
  });

  it('a write that can never pass answers 200 and alerts, so Telegram does not redeliver it forever', async () => {
    const { env, kv, db } = makeEnv();
    env.DB = faultyDb(db, (sql) => (/INSERT INTO stars_charges/.test(sql) ? 'D1_ERROR: CHECK constraint failed: stars > 0' : false));
    const res = await webhook(paid('ch_constraint'), env);
    expect(res.status).toBe(200);
    expect(kv.json(`sub:${PAYER}`)).toBeNull();
    expect(telegram.messagesTo(ADMIN)).toHaveLength(1);
    expect(telegram.messagesTo(ADMIN)[0].body.text).toContain('rejected by the ledger');
  });

  it('a paid update with no charge id answers 200 and alerts', async () => {
    const { env, db } = makeEnv();
    const update = paid('');
    const res = await webhook(update, env);
    expect(res.status).toBe(200);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM stars_charges').get().n).toBe(0);
    expect(telegram.messagesTo(ADMIN)[0].body.text).toContain('could not be recorded');
  });
});

describe('a grant that fails', () => {
  it('produces one refund to the payer, one message to the payer and no subscription', async () => {
    const { env, kv, db } = makeEnv();
    kv.failPut = (key) => key.startsWith('sub:');
    // The invoice names user 777; user 555 paid it. The refund must go to 555.
    const outcome = await handleTelegramPaymentUpdate(paid('ch_grant_fails', { from: 555 }), env);

    expect(outcome.status).toBe(200);
    const refunds = telegram.of('refundStarPayment');
    expect(refunds).toHaveLength(1);
    expect(refunds[0].body).toEqual({ user_id: 555, telegram_payment_charge_id: 'ch_grant_fails' });
    expect(telegram.of('sendMessage')).toHaveLength(1);
    expect(telegram.messagesTo(555)[0].body.text).toContain('2,500 Stars have been refunded');
    expect(kv.json(`sub:${PAYER}`)).toBeNull();
    expect(kv.json('sub:555')).toBeNull();
    expect(kv.json('stars:charge:ch_grant_fails')).toBeNull();
    expect(rowOf(db, 'ch_grant_fails')).toMatchObject({ status: 'refunded', payer_tg_id: 555, lease_until: null });
    // The claim is gone, so the older claim table does not go on saying this charge was credited.
    expect(claimed(db, 'ch_grant_fails')).toBe(false);
  });

  it('with the first subscription write landing and the second throwing, the charge ends credited and is not refunded', async () => {
    const { env, kv, db } = makeEnv();
    db.sqlite
      .prepare(`INSERT INTO users (id, source, created_at, last_seen_at, account_id) VALUES ('777', 'telegram', 1, 1, 'acct_777')`)
      .run();
    kv.failPut = (key) => key === 'sub:777';

    const outcome = await handleTelegramPaymentUpdate(paid('ch_half'), env);
    expect(outcome).toEqual({ status: 200, note: 'credited' });
    expect(rowOf(db, 'ch_half')).toMatchObject({ status: 'credited', account_id: 'acct_777' });
    expect(telegram.of('refundStarPayment')).toHaveLength(0);
    expect(subscriptionListsCharge(kv.json('sub:acct_777'), 'ch_half')).toBe(true);
    // The buyer is told the plan is active, and the receipt is written after all.
    expect(telegram.messagesTo(PAYER)[0].body.text).toContain('is active until');
    expect(kv.json('stars:charge:ch_half')).toMatchObject({ accountId: 'acct_777', chargeId: 'ch_half' });
  });

  it('when what was granted cannot be read, nothing is decided and the row goes back to the sweep', async () => {
    const { env, kv, db } = makeEnv();
    kv.failPut = (key) => key.startsWith('sub:');
    let reads = 0;
    // The grant reads the receipt and the subscription; every read after those fails.
    kv.failGet = (key) => (key.startsWith('stars:charge:') || key.startsWith('sub:')) && (reads += 1) > 2;

    const outcome = await handleTelegramPaymentUpdate(paid('ch_blind'), env);
    expect(outcome).toEqual({ status: 200, note: 'undecided' });
    expect(rowOf(db, 'ch_blind')).toMatchObject({ status: 'received', lease_until: null });
    expect(telegram.of('refundStarPayment')).toHaveLength(0);
    expect(telegram.messagesTo(PAYER)[0].body.text).toContain('Within 24 hours');
  });

  it('a redelivery after a grant that stopped half way does not add the days twice', async () => {
    const { env, kv, db } = makeEnv();
    let down = true;
    env.DB = faultyDb(db, (sql) => (down && /SET status = 'credited'/.test(sql) ? 'D1_ERROR: Network connection lost.' : false));
    kv.failPut = (key) => key.startsWith('stars:charge:');
    await handleTelegramPaymentUpdate(paid('ch_resume'), env);
    const granted = kv.json(`sub:${PAYER}`).expiresAt;
    expect(rowOf(db, 'ch_resume').status).toBe('received');

    down = false;
    kv.failPut = () => false;
    travel(STARS_LEASE_MS + 1_000);
    const again = await handleTelegramPaymentUpdate(paid('ch_resume'), env);
    expect(again).toEqual({ status: 200, note: 'credited' });
    expect(kv.json(`sub:${PAYER}`).expiresAt).toBe(granted);
    expect(rowOf(db, 'ch_resume').status).toBe('credited');
    expect(kv.json('stars:charge:ch_resume')).toMatchObject({ chargeId: 'ch_resume' });
    expect(telegram.of('refundStarPayment')).toHaveLength(0);
  });

  it('a redelivery that finds the row refund_due grants nothing', async () => {
    const { env, kv, db } = makeEnv();
    kv.failPut = (key) => key.startsWith('sub:');
    telegram.replies.refundStarPayment = () => ({ ok: false, description: 'Bad Request: try later' });
    await handleTelegramPaymentUpdate(paid('ch_due'), env);
    expect(rowOf(db, 'ch_due')).toMatchObject({ status: 'refund_due', attempts: 1 });
    expect(telegram.messagesTo(PAYER)[0].body.text).toContain('will be refunded automatically within 24 hours');

    kv.failPut = () => false;
    const again = await handleTelegramPaymentUpdate(paid('ch_due'), env);
    expect(again).toEqual({ status: 200, note: 'already_refund_due' });
    expect(kv.json(`sub:${PAYER}`)).toBeNull();
    expect(claimed(db, 'ch_due')).toBe(false);
    expect(rowOf(db, 'ch_due').status).toBe('refund_due');
  });

  it('a payload nobody recognises is recorded as unknown and refunded, and the webhook returns 200', async () => {
    const { env, kv, db } = makeEnv();
    const res = await webhook(paid('ch_mystery', { payload: 'mystery-sku:1', amount: 42 }), env);
    expect(res.status).toBe(200);
    expect(rowOf(db, 'ch_mystery')).toMatchObject({ purpose: 'unknown', ref_id: 'mystery-sku:1', stars: 42, status: 'refunded', refund_reason: 'unknown_payload' });
    expect(telegram.of('refundStarPayment')[0].body).toEqual({ user_id: PAYER, telegram_payment_charge_id: 'ch_mystery' });
    expect(telegram.messagesTo(PAYER)[0].body.text).toContain('42 Stars have been refunded');
    expect(kv.json(`sub:${PAYER}`)).toBeNull();
  });

  it('an object prototype key is not a plan', () => {
    expect(parseStarsPayload('constructor:777')).toEqual({ purpose: 'unknown', ref: 'constructor:777' });
    expect(parseStarsPayload(undefined)).toEqual({ purpose: 'unknown', ref: '(empty)' });
    expect(parseStarsPayload('PRO:12')).toEqual({ purpose: 'plan', planId: 'agency', granteeId: 12 });
    expect(parseStarsPayload('starter')).toEqual({ purpose: 'plan', planId: 'starter', granteeId: null });
  });
});

describe('the sweep', () => {
  it('with the insert done and everything after it failing, the webhook returns 200 and the sweep finishes the charge', async () => {
    const { env, kv, db } = makeEnv();
    let down = false;
    env.DB = faultyDb(db, (sql) => {
      if (/INSERT INTO stars_charges/.test(sql)) {
        down = true; // the row lands, then the database stops answering
        return false;
      }
      return down && !/SELECT .* FROM stars_charges WHERE charge_id/.test(sql) ? 'D1_ERROR: Network connection lost.' : false;
    });
    kv.failPut = () => true;

    const res = await webhook(paid('ch_after'), env);
    expect(res.status).toBe(200);
    expect(rowOf(db, 'ch_after').status).toBe('received');
    expect(telegram.of('refundStarPayment')).toHaveLength(0);

    env.DB = db;
    kv.failPut = () => false;
    // Too young: the webhook that wrote it may still be working.
    await runStarsChargeSweep(env);
    expect(rowOf(db, 'ch_after').status).toBe('received');

    travel(STARS_RECEIVED_GRACE_MS + 60_000);
    const summary = await runStarsChargeSweep(env);
    expect(summary).toMatchObject({ examined: 1, refundDue: 1, refunded: 1, credited: 0, errors: 0 });
    expect(rowOf(db, 'ch_after')).toMatchObject({ status: 'refunded', refund_reason: 'grant_not_found' });
    expect(telegram.of('refundStarPayment')).toHaveLength(1);
    expect(telegram.of('refundStarPayment')[0].body.user_id).toBe(PAYER);
    expect(telegram.messagesTo(PAYER).at(-1)?.body.text).toContain('have been refunded');
    expect(kv.json(`sub:${PAYER}`)).toBeNull();
  });

  it('closes a charge that was granted when its row could not be marked credited', async () => {
    const { env, kv, db } = makeEnv();
    let down = true;
    env.DB = faultyDb(db, (sql) => (down && /SET status = 'credited'/.test(sql) ? 'D1_ERROR: Network connection lost.' : false));
    await handleTelegramPaymentUpdate(paid('ch_unmarked'), env);
    expect(rowOf(db, 'ch_unmarked').status).toBe('received');
    expect(kv.json(`sub:${PAYER}`).appliedCharges).toEqual(['ch_unmarked']);

    down = false;
    travel(STARS_RECEIVED_GRACE_MS + 60_000);
    const summary = await runStarsChargeSweep(env);
    expect(summary).toMatchObject({ credited: 1, refundDue: 0, refunded: 0 });
    expect(rowOf(db, 'ch_unmarked').status).toBe('credited');
    expect(telegram.of('refundStarPayment')).toHaveLength(0);
  });

  it('still finds a charge granted after a second purchase on another rail rewrote the subscription record', async () => {
    const { env, kv, db } = makeEnv();
    let down = true;
    env.DB = faultyDb(db, (sql) => (down && /SET status = 'credited'/.test(sql) ? 'D1_ERROR: Network connection lost.' : false));
    // The receipt is never written, so the subscription record is the only trace of the grant.
    kv.failPut = (key) => key.startsWith('stars:charge:');
    await handleTelegramPaymentUpdate(paid('ch_overwritten'), env);
    expect(rowOf(db, 'ch_overwritten').status).toBe('received');
    expect(kv.json('stars:charge:ch_overwritten')).toBeNull();

    // A TON purchase replaces the record. It knows nothing about Stars charges.
    await writeSubscriptionRecord(env, String(PAYER), { plan: 'growth', paymentMethod: 'ton', txHash: 'abc', startedAt: Date.now(), expiresAt: Date.now() + 60 * DAY });
    expect(kv.json(`sub:${PAYER}`)).toMatchObject({ plan: 'growth', paymentMethod: 'ton', appliedCharges: ['ch_overwritten'] });

    down = false;
    travel(STARS_RECEIVED_GRACE_MS + 60_000);
    const summary = await runStarsChargeSweep(env);
    expect(summary).toMatchObject({ credited: 1, refundDue: 0, refunded: 0 });
    expect(rowOf(db, 'ch_overwritten').status).toBe('credited');
    expect(telegram.of('refundStarPayment')).toHaveLength(0);
  });

  it('does not carry the list over from a subscription that has already ended', async () => {
    const { env, kv } = makeEnv();
    await kv.put(`sub:${PAYER}`, JSON.stringify({ plan: 'starter', expiresAt: Date.now() - DAY, appliedCharges: ['ch_old'] }));
    await writeSubscriptionRecord(env, String(PAYER), { plan: 'growth', paymentMethod: 'ton', expiresAt: Date.now() + 30 * DAY });
    expect(kv.json(`sub:${PAYER}`).appliedCharges).toBeUndefined();
  });

  it('a late redelivery and the sweep racing for one received row: exactly one of them decides it', async () => {
    const { env, kv, db } = makeEnv();
    await recordStarsCharge(env, { chargeId: 'ch_race', payerTgId: PAYER, accountId: String(PAYER), purpose: 'plan', refId: 'starter', stars: 2500 });
    travel(STARS_RECEIVED_GRACE_MS + 60_000);

    await Promise.all([handleTelegramPaymentUpdate(paid('ch_race'), env), runStarsChargeSweep(env)]);

    const status = rowOf(db, 'ch_race').status;
    const hasPlan = subscriptionListsCharge(kv.json(`sub:${PAYER}`), 'ch_race');
    const refunds = telegram.of('refundStarPayment').length;
    if (status === 'credited') {
      expect(hasPlan).toBe(true);
      expect(refunds).toBe(0);
    } else {
      expect(status).toBe('refunded');
      expect(hasPlan).toBe(false);
      expect(refunds).toBe(1);
    }
    expect(['credited', 'refunded']).toContain(status);
  });

  it('only one caller can take a lease, and a lease outlives the handler that holds it', async () => {
    const { env } = makeEnv();
    await recordStarsCharge(env, { chargeId: 'ch_lease', payerTgId: PAYER, accountId: null, purpose: 'plan', refId: 'starter', stars: 2500 });
    const now = Date.now();
    const leases = await Promise.all([
      leaseStarsCharge(env, 'ch_lease', 'received', now),
      leaseStarsCharge(env, 'ch_lease', 'received', now),
      leaseStarsCharge(env, 'ch_lease', 'received', now),
    ]);
    expect(leases.filter((l) => l !== null)).toHaveLength(1);
    expect(await leaseStarsCharge(env, 'ch_lease', 'received', now + STARS_LEASE_MS - 1)).toBeNull();
    expect(await leaseStarsCharge(env, 'ch_lease', 'received', now + STARS_LEASE_MS + 1)).not.toBeNull();
    // The sweep waits longer than a lease lasts, so it never takes a row from a handler still at work.
    expect(STARS_RECEIVED_GRACE_MS).toBeGreaterThan(STARS_LEASE_MS);
  });

  it('retries a refund Telegram refused, gives up after five attempts, and alerts', async () => {
    const { env, kv, db } = makeEnv();
    kv.failPut = (key) => key.startsWith('sub:');
    telegram.replies.refundStarPayment = () => ({ ok: false, description: 'Bad Request: try later' });
    await handleTelegramPaymentUpdate(paid('ch_stuck'), env);
    expect(rowOf(db, 'ch_stuck')).toMatchObject({ status: 'refund_due', attempts: 1 });

    // Too soon after the inline attempt: the sweep leaves it alone.
    await runStarsChargeSweep(env);
    expect(rowOf(db, 'ch_stuck').attempts).toBe(1);

    for (let attempt = 2; attempt <= STARS_MAX_REFUND_ATTEMPTS; attempt += 1) {
      travel(STARS_LEASE_MS + STARS_REFUND_GRACE_MS + 60_000);
      await runStarsChargeSweep(env);
      expect(rowOf(db, 'ch_stuck').attempts).toBe(attempt);
    }
    expect(rowOf(db, 'ch_stuck').status).toBe('refund_failed');
    expect(telegram.of('refundStarPayment')).toHaveLength(STARS_MAX_REFUND_ATTEMPTS);
    const alerts = telegram.messagesTo(ADMIN).filter((m) => m.body.text.includes('failed 5 times'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body.text).toContain('ch_stuck');

    // Nothing retries it again by itself.
    travel(DAY);
    await runStarsChargeSweep(env);
    expect(telegram.of('refundStarPayment')).toHaveLength(STARS_MAX_REFUND_ATTEMPTS);

    // An operator retries it once Telegram is answering again.
    telegram.replies.refundStarPayment = () => ({ ok: true, result: true });
    const res = await refundStarsCharge(env, 1, 'ch_stuck', 'admin_retry');
    expect(res).toMatchObject({ ok: true, status: 'refunded', payerTgId: PAYER });
    expect(rowOf(db, 'ch_stuck').status).toBe('refunded');
  });

  it("counts Telegram's \"already refunded\" as a refund that went through", async () => {
    const { env, kv, db } = makeEnv();
    kv.failPut = (key) => key.startsWith('sub:');
    telegram.replies.refundStarPayment = () => ({ ok: false, description: 'Bad Request: CHARGE_ALREADY_REFUNDED' });
    await handleTelegramPaymentUpdate(paid('ch_already'), env);
    expect(rowOf(db, 'ch_already')).toMatchObject({ status: 'refunded', attempts: 0 });
    expect(telegram.messagesTo(PAYER)[0].body.text).toContain('have been refunded');
  });

  it("reports a payment Telegram lists that the ledger has no record of, and changes nothing", async () => {
    const { env, db } = makeEnv();
    await handleTelegramPaymentUpdate(paid('ch_known'), env);
    db.sqlite.prepare(`INSERT INTO stars_credited_charges (charge_id, account_id, credited_at) VALUES ('ch_before_ledger', '1', 1)`).run();
    travel(STARS_RECEIVED_GRACE_MS + 60_000);
    const hourAgo = Math.floor((Date.now() - 60 * 60_000) / 1000);
    const payer = { type: 'user', transaction_type: 'invoice_payment', user: { id: PAYER } };
    telegram.replies.getStarTransactions = () => ({
      ok: true,
      result: {
        transactions: [
          { id: 'ch_known', amount: 2500, date: hourAgo, source: payer },
          { id: 'ch_before_ledger', amount: 2500, date: hourAgo, source: payer },
          { id: 'ch_never_seen', amount: 2500, date: hourAgo, source: payer },
          // Its update may still be on the way.
          { id: 'ch_just_now', amount: 2500, date: Math.floor(Date.now() / 1000), source: payer },
          // A refund going out, not a payment coming in.
          { id: 'ch_refund_out', amount: 2500, date: hourAgo, receiver: payer },
          { id: 'ch_gift', amount: 5, date: hourAgo, source: { type: 'user', transaction_type: 'gift_purchase', user: { id: 1 } } },
          { id: 'ch_too_old', amount: 2500, date: hourAgo - 10 * 86400, source: payer },
        ],
      },
    });

    const before = db.sqlite.prepare('SELECT COUNT(*) AS n FROM stars_charges').get().n;
    const summary = await runStarsChargeSweep(env);
    expect(summary?.unmatched).toEqual(['ch_never_seen']);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM stars_charges').get().n).toBe(before);
    const alert = telegram.messagesTo(ADMIN).find((m) => m.body.text.includes('no record of'));
    expect(alert?.body.text).toContain('ch_never_seen');
    expect(telegram.of('refundStarPayment')).toHaveLength(0);
  });

  it('runs on the daily cron', async () => {
    const { ALL_SCHEDULED_JOBS, DAILY_CRON, jobsForCron } = await import('../worker/scheduledJobs');
    expect(jobsForCron(DAILY_CRON)).toContain('stars_charge_sweep');
    expect(ALL_SCHEDULED_JOBS).toContain('stars_charge_sweep');
    const source = readFileSync(resolve(__dirname, '..', 'worker', 'index.ts'), 'utf8');
    expect(source).toMatch(/jobs\.includes\('stars_charge_sweep'\)\) ctx\.waitUntil\(runStarsChargeSweep\(env\)/);
  });
});

describe('refunds a person asks for go through the ledger', () => {
  it('a manual /refund leaves the charge refunded in the ledger, and goes to the payer whatever id was typed', async () => {
    const { env, kv, db } = makeEnv();
    await handleTelegramPaymentUpdate(paid('ch_manual'), env);
    expect(rowOf(db, 'ch_manual').status).toBe('credited');

    await handleTelegramUpdate({ message: { chat: { id: ADMIN }, from: { id: ADMIN }, text: '/refund 4242 ch_manual' } }, env);

    expect(telegram.of('refundStarPayment')).toHaveLength(1);
    expect(telegram.of('refundStarPayment')[0].body).toEqual({ user_id: PAYER, telegram_payment_charge_id: 'ch_manual' });
    expect(rowOf(db, 'ch_manual')).toMatchObject({ status: 'refunded', refund_reason: 'admin_bot_refund' });
    expect(kv.json(`sub:${PAYER}`)).toBeNull();
    expect(kv.json('stars:charge:ch_manual').refunded).toBe(true);
    expect(telegram.messagesTo(ADMIN).at(-1)?.body.text).toContain(`user \`${PAYER}\``);
  });

  it('a /refund from someone who is not an admin does nothing', async () => {
    const { env, db } = makeEnv();
    await handleTelegramPaymentUpdate(paid('ch_guarded'), env);
    await handleTelegramUpdate({ message: { chat: { id: 5 }, from: { id: 5 }, text: '/refund 777 ch_guarded' } }, env);
    expect(telegram.of('refundStarPayment')).toHaveLength(0);
    expect(rowOf(db, 'ch_guarded').status).toBe('credited');
  });

  it('POST /telegram/refund goes through the ledger too, and still needs the admin secret', async () => {
    const { env, db } = makeEnv();
    await handleTelegramPaymentUpdate(paid('ch_http'), env);
    const call = (secret?: string) =>
      worker.fetch(
        new Request('https://luminarasuite.com/api/telegram/refund', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(secret ? { 'x-admin-secret': secret } : {}) },
          body: JSON.stringify({ userId: 4242, chargeId: 'ch_http' }),
        }),
        env,
        ctx,
      );

    expect((await call()).status).toBe(401);
    expect((await call('test-secret')).status).toBe(401);
    expect(rowOf(db, 'ch_http').status).toBe('credited');

    const res = await call('admin-secret-for-tests');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'refunded', payerTgId: PAYER });
    expect(rowOf(db, 'ch_http')).toMatchObject({ status: 'refunded', refund_reason: 'admin_http_refund' });
  });

  it('a refund Telegram refuses stays refund due and is reported as not done', async () => {
    const { env, db } = makeEnv();
    await handleTelegramPaymentUpdate(paid('ch_refused'), env);
    telegram.replies.refundStarPayment = () => ({ ok: false, description: 'Bad Request: try later' });
    const res = await refundStarsCharge(env, PAYER, 'ch_refused');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('will be retried');
    expect(rowOf(db, 'ch_refused')).toMatchObject({ status: 'refund_due', attempts: 1 });
  });

  it('a charge older than the ledger is refunded directly and recorded as refunded', async () => {
    const { env, kv, db } = makeEnv();
    await kv.put('stars:charge:ch_legacy', JSON.stringify({ userId: 31, loginId: '31', accountId: '31', plan: 'starter', stars: 2500, chargeId: 'ch_legacy' }));
    await kv.put('sub:31', JSON.stringify({ plan: 'starter', chargeId: 'ch_legacy', expiresAt: Date.now() + 5 * DAY }));

    const res = await refundStarsCharge(env, 31, 'ch_legacy', 'admin_bot_refund');
    expect(res.ok).toBe(true);
    expect(telegram.of('refundStarPayment')[0].body).toEqual({ user_id: 31, telegram_payment_charge_id: 'ch_legacy' });
    expect(rowOf(db, 'ch_legacy')).toMatchObject({ status: 'refunded', payer_tg_id: 31, stars: 2500, ref_id: 'starter' });
    expect(kv.json('sub:31')).toBeNull();
  });

  it('a refund takes back only the days that charge gave', async () => {
    const { env, kv, db } = makeEnv();
    await handleTelegramPaymentUpdate(paid('ch_first'), env);
    const afterFirst = kv.json(`sub:${PAYER}`).expiresAt;
    await handleTelegramPaymentUpdate(paid('ch_second'), env);

    expect((await refundStarsCharge(env, PAYER, 'ch_second')).ok).toBe(true);
    const sub = kv.json(`sub:${PAYER}`);
    expect(sub.expiresAt).toBe(afterFirst);
    expect(sub.appliedCharges).toEqual(['ch_first']);
    expect(sub.chargeId).toBe('ch_first');

    expect((await refundStarsCharge(env, PAYER, 'ch_first')).ok).toBe(true);
    expect(kv.json(`sub:${PAYER}`)).toBeNull();
    expect(rowOf(db, 'ch_first').status).toBe('refunded');
    expect(rowOf(db, 'ch_second').status).toBe('refunded');
  });

  it("Telegram's own refund notice closes the row and the plan, and is not sent to the chat model", async () => {
    const { env, kv, db } = makeEnv();
    await handleTelegramPaymentUpdate(paid('ch_notice'), env);
    telegram.calls.length = 0;

    const update = {
      message: {
        chat: { id: PAYER },
        from: { id: PAYER },
        refunded_payment: { currency: 'XTR', total_amount: 2500, invoice_payload: `starter:${PAYER}`, telegram_payment_charge_id: 'ch_notice' },
      },
    };
    expect(isTelegramPaymentUpdate(update)).toBe(true);
    expect((await webhook(update, env)).status).toBe(200);

    expect(rowOf(db, 'ch_notice')).toMatchObject({ status: 'refunded', refund_reason: 'refunded_at_telegram' });
    expect(kv.json(`sub:${PAYER}`)).toBeNull();
    expect(telegram.calls).toHaveLength(0);
  });
});

describe('pre-checkout', () => {
  const query = { id: 'q1', currency: 'XTR', total_amount: PLANS.starter.stars, invoice_payload: `starter:${PAYER}` };

  it('says yes when both ledgers can take a write', async () => {
    const { env } = makeEnv();
    const res = await webhook({ pre_checkout_query: query }, env);
    expect(res.status).toBe(200);
    expect(telegram.of('answerPreCheckoutQuery')[0].body).toEqual({ pre_checkout_query_id: 'q1', ok: true });
  });

  it('says no while the charge ledger is missing, so nobody is charged', async () => {
    const { env } = makeEnv();
    env.DB = createSqliteD1({ skipMigrations: ['0023'] });
    await handleTelegramPaymentUpdate({ pre_checkout_query: query }, env);
    expect(telegram.of('answerPreCheckoutQuery')[0].body.ok).toBe(false);
  });

  it('is answered inside 10 seconds even when the database never answers', async () => {
    const { env } = makeEnv();
    const never = new Promise<never>(() => {});
    const hung: any = { bind: () => hung, first: () => never, all: () => never, run: () => never };
    env.DB = { prepare: () => hung } as unknown as D1Database;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const started = Date.now();
    const pending = handleTelegramPaymentUpdate({ pre_checkout_query: query }, env);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(telegram.of('answerPreCheckoutQuery')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_500);
    await pending;

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(telegram.of('answerPreCheckoutQuery')[0].body.ok).toBe(false);
  });
});

describe('the account behind a charge', () => {
  it('a charge row follows the account that survives a link', async () => {
    const { env, kv, db } = makeEnv();
    await recordStarsCharge(env, { chargeId: 'ch_linked', payerTgId: PAYER, accountId: String(PAYER), purpose: 'plan', refId: 'starter', stars: 2500, status: 'refunded' });
    // The web account holds the paid plan, so it is the one that survives.
    await kv.put('sub:fb:uid-1', JSON.stringify({ plan: 'starter', expiresAt: Date.now() + DAY }));
    const linked = await linkTelegramAndFirebase(env, String(PAYER), 'uid-1');
    expect(linked.accountId).toBe('fb:uid-1');
    expect(rowOf(db, 'ch_linked').account_id).toBe('fb:uid-1');
  });

  it('is exported with the account, and on deletion the row stays without the account id', async () => {
    const { env, db } = makeEnv();
    await handleTelegramPaymentUpdate(paid('ch_private'), env);
    const user = { id: String(PAYER), accountId: String(PAYER), source: 'telegram' } as HostedIdentity;

    const exported = await createPrivacyJob(env, user, 'export');
    const { jobId } = (await exported.json()) as { jobId: string };
    const body = JSON.parse((await (env.LUMINARA_KV as any).get(`privacy:export:${jobId}`)) as string);
    expect(body.processors).toContain('stars_charges');
    expect(body.starsCharges).toEqual([expect.objectContaining({ charge_id: 'ch_private', stars: 2500, status: 'credited' })]);
    // Someone else may have paid for this account's plan; their Telegram id is not this account's data.
    expect(Object.keys(body.starsCharges[0])).not.toContain('payer_tg_id');

    const deleted = await createPrivacyJob(env, user, 'delete');
    expect(deleted.status).toBe(200);
    expect(rowOf(db, 'ch_private')).toMatchObject({ account_id: null, payer_tg_id: PAYER, status: 'credited' });
  });
});

describe('the setup script', () => {
  it('keeps pending updates unless told otherwise, because one of them can be a paid update', () => {
    const source = readFileSync(resolve(__dirname, '..', 'scripts', 'telegram-setup.mjs'), 'utf8');
    expect(source).not.toMatch(/drop_pending_updates:\s*true/);
    expect(source).toContain("drop_pending_updates: process.env.DROP_PENDING_UPDATES === 'true'");
  });
});
