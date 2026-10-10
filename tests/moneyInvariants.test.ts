import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { OP_JETTON_TRANSFER_NOTIFICATION } from '../worker/jettonSettlement';
import {
  createTonInvoice,
  crc16Xmodem,
  isTonAddressConfirmed,
  isTonCheckoutOpen,
  JETTON_CHECKOUT_LIVE,
  JETTON_UNAVAILABLE_ERROR,
  LORA_CHECKOUT_LIVE,
  TON_IN_TELEGRAM_ERROR,
  TON_UNAVAILABLE_ERROR,
} from '../worker/tonPayment';
import { STRIPE_CHECKOUT_LIVE } from '../worker/stripePayment';
import { railsOffered, resolvePaymentOptions } from '../components/paywall/paymentOptions';
import { createSqliteD1 } from './helpers/sqliteD1';

/**
 * Money invariants. Each value here decides whether the app takes a payment it can credit.
 *
 * On 2026-10-10 the Jetton switch was found on, inside a commit about something else, while the
 * verifier looked for an opcode no real transfer carries. Changing one of these now means changing
 * this file in the same pull request, so the change is visible in review.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
  const env: any = {
    LUMINARA_KV: kv,
    DB: createSqliteD1(),
    TON_RECEIVING_ADDRESS: syntheticTonAddress(0x11, 0x5a),
    TON_ADDRESS_CONFIRMED: 'true',
    ENVIRONMENT: 'production',
    CHAIN_NETWORK: 'mainnet',
    CHAIN_TON_API_BASE: 'https://toncenter.com/api/v3',
    CHAIN_TON_API_FALLBACK_BASE: 'https://tonapi.io',
    ...overrides,
  };
  return { env, kv };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

const BOT_TOKEN = '123456:MONEY_INVARIANTS_TEST';

/** Init data signed the way Telegram signs it, so the request passes the sign-in guard as a real Mini App user. */
function signInitData(userId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Buyer' }),
  };
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

describe('money invariants', () => {
  it('Jetton checkout is off', () => {
    expect(JETTON_CHECKOUT_LIVE).toBe(false);
  });

  it('LORA checkout has its own switch and it is off', () => {
    expect(LORA_CHECKOUT_LIVE).toBe(false);
  });

  it('the Jetton verifier looks for the TEP-74 transfer_notification opcode', () => {
    expect(OP_JETTON_TRANSFER_NOTIFICATION).toBe(0x7362d09c);
  });

  it('the in-repo LORA contract sends the same opcode the verifier looks for', () => {
    const tact = readFileSync(join(ROOT, 'contracts/jetton/contracts/messages.tact'), 'utf8');
    expect(tact).toMatch(/message\(0x7362d09c\)\s+JettonNotification/);
  });

  it.each(['USDT', 'LORA'] as const)('no %s invoice is issued and no order is stored', async (asset) => {
    const { env, kv } = makeEnv();
    const inv = await createTonInvoice(env, 'user_1', 'starter', { asset });
    expect(inv.ok).toBe(false);
    expect((inv as { error: string }).error).toBe(JETTON_UNAVAILABLE_ERROR);
    expect(kv.store.size).toBe(0);
  });

  it('public health does not report a Jetton checkout, even with TON configured', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(new Request('https://luminarasuite.com/api/health'), env, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; ton?: boolean; jettonCheckout?: boolean };
    expect(body.ok).toBe(true);
    expect(body.jettonCheckout).toBe(false);
  });
});

describe('the TON merchant address must be confirmed by the owner before it takes money', () => {
  it('only the string "true" counts as confirmed', () => {
    for (const v of [undefined, '', 'false', 'TRUE', 'yes', '1', ' maybe ']) {
      expect(isTonAddressConfirmed({ TON_ADDRESS_CONFIRMED: v as string })).toBe(false);
    }
    expect(isTonAddressConfirmed({ TON_ADDRESS_CONFIRMED: 'true' })).toBe(true);
    expect(isTonAddressConfirmed({ TON_ADDRESS_CONFIRMED: ' true ' })).toBe(true);
  });

  it.each([undefined, 'false'])('with TON_ADDRESS_CONFIRMED=%s no TON invoice is issued and no order is stored', async (value) => {
    const { env, kv } = makeEnv({ TON_ADDRESS_CONFIRMED: value });
    expect(isTonCheckoutOpen(env)).toBe(false);
    const inv = await createTonInvoice(env, 'user_1', 'starter');
    expect(inv.ok).toBe(false);
    expect((inv as { error: string }).error).toBe(TON_UNAVAILABLE_ERROR);
    expect(kv.store.size).toBe(0);
  });

  it('public health reports ton false until the address is confirmed, and true after', async () => {
    const closed = await worker.fetch(new Request('https://luminarasuite.com/api/health'), makeEnv({ TON_ADDRESS_CONFIRMED: 'false' }).env, ctx);
    expect(((await closed.json()) as { ton?: boolean }).ton).toBe(false);
    const open = await worker.fetch(new Request('https://luminarasuite.com/api/health'), makeEnv().env, ctx);
    expect(((await open.json()) as { ton?: boolean }).ton).toBe(true);
  });

  it('the shipped config keeps TON closed in every environment until the owner confirms', () => {
    const cfg = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
    const values = [...cfg.matchAll(/"TON_ADDRESS_CONFIRMED":\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(values.length).toBe(3);
    // Changing one of these to "true" is the owner's confirmation and belongs in its own pull request.
    expect(values).toEqual(['false', 'false', 'false']);
  });
});

describe('Stars is the only way to pay inside Telegram', () => {
  it('a signed-in Mini App user cannot get a TON invoice: the request is refused and no order is stored', async () => {
    const { env, kv } = makeEnv({ BOT_TOKEN });
    const res = await worker.fetch(
      new Request('https://luminarasuite.com/api/ton/invoice', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(4242) },
        body: JSON.stringify({ planId: 'starter' }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body.error).toBe(TON_IN_TELEGRAM_ERROR);
    expect(body.code).toBe('TON_NOT_IN_TELEGRAM');
    expect([...kv.store.keys()].filter((k) => k.startsWith('ton:order:'))).toEqual([]);
  });

  it('init data that does not verify gets no invoice either', async () => {
    const { env, kv } = makeEnv({ BOT_TOKEN });
    const res = await worker.fetch(
      new Request('https://luminarasuite.com/api/ton/invoice', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': 'user=%7B%22id%22%3A1%7D&hash=00' },
        body: JSON.stringify({ planId: 'starter' }),
      }),
      env,
      ctx,
    );
    expect(res.ok).toBe(false);
    expect([...kv.store.keys()].filter((k) => k.startsWith('ton:order:'))).toEqual([]);
  });

  it('the paywall offers exactly Stars on a Telegram surface, whatever health reports', () => {
    const everythingOn = { ok: true, ton: true, jettonCheckout: true, stripeCheckout: true };
    expect(railsOffered(resolvePaymentOptions({ inTelegram: true, health: everythingOn }))).toEqual(['stars']);
  });

  it('the bot does not point buyers at other ways to pay', () => {
    const bot = readFileSync(join(ROOT, 'worker/telegramBot.ts'), 'utf8');
    expect(bot).not.toMatch(/every payment option/i);
  });
});

describe('the card rail stays off until its own review', () => {
  it('Stripe checkout is off', () => {
    // An audit on 2026-10-10 found it unsafe to switch on: a buyer who is not signed in is charged
    // and credited to a made-up guest id, and a test key in production grants real plans.
    expect(STRIPE_CHECKOUT_LIVE).toBe(false);
  });
});
