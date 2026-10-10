import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/index';
import { PLANS, createInvoiceLink, handleTelegramPaymentUpdate, handleTelegramUpdate } from '../worker/telegramBot';
import { PlanDowngradeRefusedError, planRank, wouldDowngrade } from '../worker/planRank';
import { writeSubscriptionRecord } from '../worker/userStore';
import { createTonInvoice, verifyTonPayment, TON_PRICING, crc16Xmodem } from '../worker/tonPayment';
import { activateLicenseKey } from '../worker/licenseService';
import { createSqliteD1, type SqliteD1 } from './helpers/sqliteD1';

/**
 * Track SW, SW0a-4: a purchase cannot downgrade a plan, on any rail.
 * A subscriber who tries to buy a lower plan keeps their plan and expiry, pays nothing where the
 * rail can refuse, and reads why.
 */

const DAY = 86400_000;
const USER = 777;

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

class MockKV {
  store = new Map<string, string>();
  failGet: (key: string) => boolean = () => false;
  async get(key: string, type?: string) {
    if (this.failGet(key)) throw new Error(`KV get failed for ${key}`);
    const val = this.store.get(key);
    if (val === undefined) return null;
    return type === 'json' ? JSON.parse(val) : val;
  }
  async put(key: string, value: string) {
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

function makeEnv() {
  const kv = new MockKV();
  const db = createSqliteD1();
  const env = {
    ASSETS: {} as any,
    BOT_TOKEN: '123456:MOCK_TOKEN',
    WEBAPP_URL: 'https://luminarasuite.com',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    TELEGRAM_ADMIN_ID: '999999',
    LUMINARA_KV: kv as any,
    DB: db as D1Database,
    TON_RECEIVING_ADDRESS: MERCHANT,
    TON_CONFIRMED_ADDRESS: MERCHANT,
    ENVIRONMENT: 'production',
    CHAIN_NETWORK: 'mainnet',
    CHAIN_TON_API_BASE: 'https://toncenter.com/api/v3',
    CHAIN_TON_API_FALLBACK_BASE: 'https://tonapi.io',
  } as unknown as Env;
  return { env, kv, db: db as SqliteD1 };
}

type TelegramCall = { method: string; body: any };
function installTelegram() {
  const calls: TelegramCall[] = [];
  (globalThis as any).fetch = vi.fn(async (url: unknown, init?: { body?: string }) => {
    const method = String(url).split('/').pop() || '';
    calls.push({ method, body: init?.body ? JSON.parse(init.body) : {} });
    return { json: async () => ({ ok: true, result: method === 'createInvoiceLink' ? 'https://t.me/$invoice' : true }) };
  });
  return { calls, of: (method: string) => calls.filter((c) => c.method === method) };
}

/** Gives the user a running plan, as a purchase would have left it. */
async function subscribe(kv: MockKV, plan: string, daysLeft = 20, extra: Record<string, unknown> = {}) {
  const record = { plan, paymentMethod: 'stars', startedAt: Date.now() - DAY, expiresAt: Date.now() + daysLeft * DAY, ...extra };
  await kv.put(`sub:${USER}`, JSON.stringify(record));
  return record;
}

const preCheckout = (planId: string, o: { from?: number; payloadUser?: number } = {}) => ({
  pre_checkout_query: {
    id: 'q1',
    from: { id: o.from ?? USER },
    currency: 'XTR',
    total_amount: PLANS[planId].stars,
    invoice_payload: `${planId}:${o.payloadUser ?? USER}`,
  },
});

const paid = (chargeId: string, planId: string) => ({
  message: {
    chat: { id: USER },
    from: { id: USER },
    successful_payment: {
      currency: 'XTR',
      total_amount: PLANS[planId].stars,
      invoice_payload: `${planId}:${USER}`,
      telegram_payment_charge_id: chargeId,
    },
  },
});

/** A chain index that shows one inbound transfer with this comment. */
const showing = (comment: string, amountNano: string, hash: string) =>
  vi.fn(async () =>
    new Response(
      JSON.stringify({
        transactions: [{ hash, now: Math.floor(Date.now() / 1000), mc_block_seqno: 1, in_msg: { value: amountNano, message_content: { decoded: { '@type': 'text_comment', text: comment } } } }],
      }),
      { status: 200 },
    ),
  );

let telegram: ReturnType<typeof installTelegram>;

beforeEach(() => {
  telegram = installTelegram();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('which plan outranks which', () => {
  it('passes are lowest and equal; then Starter, Growth, Agency', () => {
    expect(planRank('single_audit')).toBe(planRank('multi_agent_crawl'));
    expect(planRank('single_audit')).toBeLessThan(planRank('starter'));
    expect(planRank('starter')).toBeLessThan(planRank('growth'));
    expect(planRank('growth')).toBeLessThan(planRank('agency'));
    expect(planRank('pro')).toBe(planRank('agency'));
    expect(planRank(' Growth ')).toBe(planRank('growth'));
  });

  it('no plan, the free tier and an unknown id rank below every plan', () => {
    for (const none of [undefined, null, '', 'free', 'constructor', 'enterprise']) expect(planRank(none)).toBe(0);
  });

  it('every plan that is sold has a rank', () => {
    for (const id of Object.keys(PLANS)) expect(planRank(id), id).toBeGreaterThan(0);
    for (const id of Object.keys(TON_PRICING)) expect(planRank(id), id).toBeGreaterThan(0);
  });

  it('only a plan that is still running can be downgraded', () => {
    const now = 1_000_000;
    expect(wouldDowngrade({ plan: 'agency', expiresAt: now + 1 }, 'starter', now)).toBe(true);
    expect(wouldDowngrade({ plan: 'agency', expiresAt: now }, 'starter', now)).toBe(false);
    expect(wouldDowngrade({ plan: 'starter', expiresAt: now + 1 }, 'starter', now)).toBe(false);
    expect(wouldDowngrade({ plan: 'starter', expiresAt: now + 1 }, 'agency', now)).toBe(false);
    expect(wouldDowngrade(null, 'starter', now)).toBe(false);
  });
});

describe('the rule lives where every rail writes', () => {
  it('a lower plan is not written over a higher one that is still running', async () => {
    const { env, kv } = makeEnv();
    const before = await subscribe(kv, 'growth');
    await expect(writeSubscriptionRecord(env, String(USER), { plan: 'single_audit', expiresAt: Date.now() + 21 * DAY })).rejects.toBeInstanceOf(PlanDowngradeRefusedError);
    expect(kv.json(`sub:${USER}`)).toEqual(before);
  });

  it('the same plan, a higher plan, and any plan over one that has ended are written', async () => {
    const { env, kv } = makeEnv();
    await subscribe(kv, 'growth');
    await writeSubscriptionRecord(env, String(USER), { plan: 'growth', expiresAt: Date.now() + 50 * DAY });
    expect(kv.json(`sub:${USER}`).plan).toBe('growth');
    await writeSubscriptionRecord(env, String(USER), { plan: 'agency', expiresAt: Date.now() + 80 * DAY });
    expect(kv.json(`sub:${USER}`).plan).toBe('agency');

    await subscribe(kv, 'agency', -1);
    await writeSubscriptionRecord(env, String(USER), { plan: 'starter', expiresAt: Date.now() + 30 * DAY });
    expect(kv.json(`sub:${USER}`).plan).toBe('starter');
  });

  it('a caller that takes a plan away on purpose has to say so', async () => {
    const { env, kv } = makeEnv();
    await subscribe(kv, 'agency');
    await writeSubscriptionRecord(env, String(USER), { plan: 'starter', expiresAt: Date.now() + 5 * DAY }, { allowLowerPlan: true });
    expect(kv.json(`sub:${USER}`).plan).toBe('starter');
  });

  it('these are the only places that write a subscription; a new one must be added here on purpose', () => {
    const dir = resolve(__dirname, '..', 'worker');
    const callers = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /\bwriteSubscriptionRecord\(/.test(readFileSync(resolve(dir, f), 'utf8')))
      .sort();
    // userStore.ts defines it. Each of the others is a rail, and each refuses a lower plan before payment where it can.
    expect(callers).toEqual(['licenseService.ts', 'stripePayment.ts', 'telegramBot.ts', 'tonPayment.ts', 'userStore.ts']);
  });
});

describe('Telegram Stars', () => {
  it('a subscriber who tries to buy a one-day pass is refused before any invoice or charge, and reads why', async () => {
    const { env, kv } = makeEnv();
    const before = await subscribe(kv, 'agency');

    const link = await createInvoiceLink(env, USER, 'single_audit');
    expect(link.ok).toBe(false);
    if (!link.ok) {
      expect(link.error).toContain('You already have Luminara Pro / Agency until');
      expect(link.error).toContain('Single Autonomous Audit Run is a lower plan');
      expect(link.error).toContain('nothing was charged');
    }
    expect(telegram.of('createInvoiceLink')).toHaveLength(0);

    await handleTelegramPaymentUpdate(preCheckout('single_audit'), env);
    const answer = telegram.of('answerPreCheckoutQuery')[0].body;
    expect(answer.ok).toBe(false);
    expect(answer.error_message).toContain('You already have Luminara Pro / Agency');
    expect(answer.error_message.length).toBeLessThanOrEqual(255);

    expect(kv.json(`sub:${USER}`)).toEqual(before);
  });

  it("the bot's /buy command says why instead of sending an invoice", async () => {
    const { env, kv } = makeEnv();
    await subscribe(kv, 'agency');
    await handleTelegramUpdate({ message: { chat: { id: USER }, from: { id: USER }, text: '/buy_starter' } }, env);
    expect(telegram.of('sendInvoice')).toHaveLength(0);
    expect(telegram.of('sendMessage')[0].body.text).toContain('Luminara Starter is a lower plan');
  });

  it('if the payment arrives anyway, the Stars go back and the plan is untouched', async () => {
    const { env, kv, db } = makeEnv();
    const before = await subscribe(kv, 'growth');
    const outcome = await handleTelegramPaymentUpdate(paid('ch_slipped', 'starter'), env);
    expect(outcome).toEqual({ status: 200, note: 'refunded' });
    expect(kv.json(`sub:${USER}`)).toEqual(before);
    expect(telegram.of('refundStarPayment')[0].body).toEqual({ user_id: USER, telegram_payment_charge_id: 'ch_slipped' });
    expect(db.sqlite.prepare("SELECT status, refund_reason FROM stars_charges WHERE charge_id = 'ch_slipped'").get()).toEqual({ status: 'refunded', refund_reason: 'plan_downgrade_refused' });
  });

  it('the same plan again extends it; a higher plan replaces it and keeps the days already there', async () => {
    const { env, kv } = makeEnv();
    const before = await subscribe(kv, 'starter');

    await handleTelegramPaymentUpdate(preCheckout('starter'), env);
    expect(telegram.of('answerPreCheckoutQuery')[0].body.ok).toBe(true);
    await handleTelegramPaymentUpdate(paid('ch_again', 'starter'), env);
    expect(kv.json(`sub:${USER}`)).toMatchObject({ plan: 'starter', expiresAt: before.expiresAt + 30 * DAY });

    await handleTelegramPaymentUpdate(preCheckout('agency'), env);
    expect(telegram.of('answerPreCheckoutQuery')[1].body.ok).toBe(true);
    await handleTelegramPaymentUpdate(paid('ch_up', 'agency'), env);
    expect(kv.json(`sub:${USER}`)).toMatchObject({ plan: 'agency', expiresAt: before.expiresAt + 60 * DAY });
  });

  it('pre-checkout refuses a payer who is not the user the invoice was made for', async () => {
    const { env } = makeEnv();
    await handleTelegramPaymentUpdate(preCheckout('starter', { from: 555, payloadUser: USER }), env);
    const answer = telegram.of('answerPreCheckoutQuery')[0].body;
    expect(answer.ok).toBe(false);
    expect(answer.error_message).toContain('another Telegram account');
  });

  it('pre-checkout says no when the plan the buyer already has cannot be read', async () => {
    const { env, kv } = makeEnv();
    kv.failGet = (key) => key.startsWith('sub:');
    await handleTelegramPaymentUpdate(preCheckout('starter'), env);
    const answer = telegram.of('answerPreCheckoutQuery')[0].body;
    expect(answer.ok).toBe(false);
    expect(answer.error_message).toContain('temporarily unavailable');
  });
});

describe('TON', () => {
  it('no invoice is issued for a plan lower than the one still running', async () => {
    const { env, kv, db } = makeEnv();
    const before = await subscribe(kv, 'agency');
    const inv = await createTonInvoice(env, String(USER), 'starter');
    expect(inv.ok).toBe(false);
    if (!inv.ok) {
      expect(inv.error).toContain('You already have Luminara Pro / Agency until');
      expect(inv.error).toContain('no invoice was issued');
    }
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM ton_pending_orders').get().n).toBe(0);
    expect([...kv.store.keys()].filter((k) => k.startsWith('ton:order:'))).toEqual([]);
    expect(kv.json(`sub:${USER}`)).toEqual(before);
  });

  it('a payment for an order made before the buyer took a higher plan is held for the owner, not applied and not reported as confirmed', async () => {
    const { env, kv, db } = makeEnv();
    const inv = await createTonInvoice(env, String(USER), 'starter');
    if (!inv.ok) throw new Error(inv.error);
    const before = await subscribe(kv, 'agency');
    const index = showing(inv.order.memo, TON_PRICING.starter.nanoTon, 'tx_held_for_owner');

    const res = await verifyTonPayment(env, inv.order.orderId, { expectedUserId: String(USER), fetcher: index });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('so your payment was not applied');
      expect(res.error).toContain('support@luminarasuite.com');
      expect(res.error).toContain(inv.order.orderId);
    }
    expect(kv.json(`sub:${USER}`)).toEqual(before);
    // The transfer is spent: the claim stays, and the order is on the owner's list.
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM ton_credited_tx').get().n).toBe(1);
    expect(kv.json(`sub_pending:${USER}:${inv.order.orderId}`)).toMatchObject({
      orderId: inv.order.orderId,
      planId: 'starter',
      txHash: 'tx_held_for_owner',
      reason: 'plan_downgrade_refused',
      currentPlan: 'agency',
    });

    // Checking again says the same thing; it does not turn into "confirmed".
    const again = await verifyTonPayment(env, inv.order.orderId, { expectedUserId: String(USER), fetcher: index });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain('so your payment was not applied');
    expect(kv.json(`sub:${USER}`)).toEqual(before);
  });
});

describe('licence keys', () => {
  it('a trial key offered by an Agency subscriber is refused and is still redeemable afterwards', async () => {
    const { env, kv, db } = makeEnv();
    const before = await subscribe(kv, 'agency', 2);

    const refused = await activateLicenseKey(env, String(USER), 'LUM-GROWTH-3DAY');
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('You already have the Pro / Agency plan until');
    expect(refused.error).toContain('the key was not used and is still valid');
    expect(kv.json(`sub:${USER}`)).toEqual(before);
    // Nothing was claimed: not the key, and not this account's one trial.
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM license_trial_claims').get().n).toBe(0);
    expect(kv.store.has(`license:trial:claimed:${USER}`)).toBe(false);

    // Once Agency has run out, the same key works for the same account.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * DAY);
    const later = await activateLicenseKey(env, String(USER), 'LUM-GROWTH-3DAY');
    expect(later.ok).toBe(true);
    expect(kv.json(`sub:${USER}`).plan).toBe('growth');
  });

  it('a key for the same plan or a higher one is redeemed as before', async () => {
    const { env, kv } = makeEnv();
    const before = await subscribe(kv, 'starter', 10);
    const res = await activateLicenseKey(env, String(USER), 'LUM-AGENCY-7DAY');
    expect(res.ok).toBe(true);
    expect(kv.json(`sub:${USER}`)).toMatchObject({ plan: 'agency', expiresAt: before.expiresAt + 7 * DAY });
  });

  it('a key redeemed by an account with no plan works as before', async () => {
    const { env, kv } = makeEnv();
    expect((await activateLicenseKey(env, String(USER), 'LUM-PROMO-3DAY')).ok).toBe(true);
    expect(kv.json(`sub:${USER}`).plan).toBe('starter');
  });
});
