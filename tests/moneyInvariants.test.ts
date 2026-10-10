import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
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
import { PLANS } from '../worker/telegramBot';
import { Q402_SETTLEMENT_LIVE } from '../worker/q402';
import { parseJsonc } from '../scripts/lib/jsonc.mjs';
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

const MERCHANT = syntheticTonAddress(0x11, 0x5a);
const OTHER_ADDRESS = syntheticTonAddress(0x11, 0x3c);

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
    TON_RECEIVING_ADDRESS: MERCHANT,
    TON_CONFIRMED_ADDRESS: MERCHANT,
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
  it('confirmed means the confirmed address equals the receiving address, exactly', () => {
    const is = (confirmed: unknown, receiving: unknown = MERCHANT) =>
      isTonAddressConfirmed({ TON_CONFIRMED_ADDRESS: confirmed as string, TON_RECEIVING_ADDRESS: receiving as string });
    for (const v of [undefined, '', 'true', 'false', 'yes', OTHER_ADDRESS, MERCHANT.toLowerCase(), MERCHANT.slice(0, -1)]) {
      expect(is(v)).toBe(false);
    }
    // The same wallet written in its other form (non-bounceable, tag 0x51) is a different string,
    // and so not confirmed: the owner confirms the exact characters the invoice will carry.
    const sameWalletOtherForm = syntheticTonAddress(0x51, 0x5a);
    expect(sameWalletOtherForm).not.toBe(MERCHANT);
    expect(is(sameWalletOtherForm)).toBe(false);
    expect(is(MERCHANT)).toBe(true);
    expect(is(` ${MERCHANT} `)).toBe(true);
    // No receiving address at all is never "confirmed", even if both are empty.
    expect(is('', '')).toBe(false);
    expect(is(undefined, undefined)).toBe(false);
  });

  it('changing the receiving address without confirming the new one closes checkout again', async () => {
    const { env, kv } = makeEnv({ TON_RECEIVING_ADDRESS: OTHER_ADDRESS });
    expect(isTonCheckoutOpen(env)).toBe(false);
    const inv = await createTonInvoice(env, 'user_1', 'starter');
    expect(inv.ok).toBe(false);
    expect(kv.store.size).toBe(0);
  });

  it.each([undefined, '', 'true'])('with TON_CONFIRMED_ADDRESS=%s no TON invoice is issued and no order is stored', async (value) => {
    const { env, kv } = makeEnv({ TON_CONFIRMED_ADDRESS: value });
    expect(isTonCheckoutOpen(env)).toBe(false);
    const inv = await createTonInvoice(env, 'user_1', 'starter');
    expect(inv.ok).toBe(false);
    expect((inv as { error: string }).error).toBe(TON_UNAVAILABLE_ERROR);
    expect(kv.store.size).toBe(0);
  });

  it('a confirmed address does issue an invoice, to that address', async () => {
    const { env } = makeEnv();
    const inv = await createTonInvoice(env, 'user_1', 'starter');
    expect(inv.ok).toBe(true);
    expect((inv as { order: { recipientAddress: string } }).order.recipientAddress).toBe(MERCHANT);
  });

  it('public health reports ton false until the address is confirmed, and true after', async () => {
    const closed = await worker.fetch(new Request('https://luminarasuite.com/api/health'), makeEnv({ TON_CONFIRMED_ADDRESS: '' }).env, ctx);
    expect(((await closed.json()) as { ton?: boolean }).ton).toBe(false);
    const open = await worker.fetch(new Request('https://luminarasuite.com/api/health'), makeEnv().env, ctx);
    expect(((await open.json()) as { ton?: boolean }).ton).toBe(true);
  });

  it('the shipped config keeps TON closed in all three environments until the owner confirms', () => {
    const cfg = parseJsonc(readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')) as {
      vars: Record<string, string>;
      env: Record<string, { vars: Record<string, string> }>;
    };
    const blocks = { top: cfg.vars, staging: cfg.env.staging.vars, production: cfg.env.production.vars };
    for (const [name, vars] of Object.entries(blocks)) {
      expect(vars, name).toHaveProperty('TON_CONFIRMED_ADDRESS');
      // Filling one of these in is the owner's confirmation. It belongs in its own pull request,
      // with this test changed beside it and the address read back to the owner character by character.
      expect(vars.TON_CONFIRMED_ADDRESS, name).toBe('');
      expect(isTonAddressConfirmed(vars), name).toBe(false);
    }
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

  it('a Telegram session without the header is still refused: the identity came from Telegram', async () => {
    const { env, kv } = makeEnv({ BOT_TOKEN, WEBAPP_URL: 'https://luminarasuite.com/' });
    // Sign in the way the Mini App does, to be given a session cookie.
    const auth = await worker.fetch(
      new Request('https://luminarasuite.com/api/telegram/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://luminarasuite.com' },
        body: JSON.stringify({ initData: signInitData(4243) }),
      }),
      env,
      ctx,
    );
    expect(auth.status).toBe(200);
    const cookie = (auth.headers.get('set-cookie') || '').split(';')[0];
    expect(cookie).toMatch(/=/);
    const res = await worker.fetch(
      new Request('https://luminarasuite.com/api/ton/invoice', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://luminarasuite.com', cookie },
        body: JSON.stringify({ planId: 'starter' }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('TON_NOT_IN_TELEGRAM');
    expect([...kv.store.keys()].filter((k) => k.startsWith('ton:order:'))).toEqual([]);
  });

  it('the paywall offers exactly Stars on a Telegram surface, whatever health reports', () => {
    const everythingOn = { ok: true, ton: true, jettonCheckout: true, stripeCheckout: true };
    expect(railsOffered(resolvePaymentOptions({ inTelegram: true, health: everythingOn }))).toEqual(['stars']);
  });

  it('the bot does not point buyers at other ways to pay', () => {
    const bot = readFileSync(join(ROOT, 'worker/telegramBot.ts'), 'utf8');
    expect(bot).not.toMatch(/every payment option/i);
    expect(bot).not.toMatch(/TON blockchain/i);
    expect(bot).not.toMatch(/pay (with|in|by|via) (TON|USDT|card|crypto)/i);
    expect(bot).not.toMatch(/USDT|\$LORA/);
  });
});

describe('the card rail stays off until its own review', () => {
  it('Stripe checkout is off', () => {
    // An audit on 2026-10-10 found it unsafe to switch on: a buyer who is not signed in is charged
    // and credited to a made-up guest id, and a test key in production grants real plans.
    expect(STRIPE_CHECKOUT_LIVE).toBe(false);
  });
});

describe('public health carries the Stars catalogue and nothing private', () => {
  it('lists the three 30-day plans with their Stars price, so the Mini App account panel can draw them', async () => {
    const res = await worker.fetch(new Request('https://luminarasuite.com/api/health'), makeEnv().env, ctx);
    const body = (await res.json()) as { plans?: Record<string, { title: string; description: string; stars: number; days: number }> } & Record<string, unknown>;
    expect(Object.keys(body.plans || {}).sort()).toEqual(['agency', 'growth', 'starter']);
    for (const id of ['starter', 'growth', 'agency'] as const) {
      expect(body.plans![id]).toEqual({ title: PLANS[id].title, description: PLANS[id].description, stars: PLANS[id].stars, days: PLANS[id].days });
      expect(body.plans![id].stars).toBeGreaterThan(0);
    }
    expect(Object.keys(body).sort()).toEqual(['jettonCheckout', 'ok', 'plans', 'stripeCheckout', 'ton']);
  });
});

describe('Q402 is off, and while it is off none of its routes answer', () => {
  it('settlement is off', () => {
    expect(Q402_SETTLEMENT_LIVE).toBe(false);
  });

  it.each([
    ['GET', '/api/q402/supported'],
    ['POST', '/api/q402/verify'],
    ['POST', '/api/q402/settle'],
    ['POST', '/api/q402/audit'],
    ['GET', '/api/q402/anything-else'],
  ])('%s %s is a 404 and publishes no address or price', async (method, route) => {
    const res = await worker.fetch(
      new Request(`https://luminarasuite.com${route}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined }),
      makeEnv().env,
      ctx,
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain(MERCHANT);
    expect(text).not.toMatch(/USDT|LORA|burn/i);
  });
});

describe('payment copy makes no burn, tax-on-transfer or yield claim', () => {
  // The LORA contract takes no tax, fee or automatic burn on a transfer (LORA rule J6), so no screen may say it does.
  it.each([
    'components/paywall/PaywallModal.tsx',
    'components/paywall/paymentOptions.ts',
    'components/telegram/TelegramAccountPanel.tsx',
    'worker/termsPolicy.ts',
  ])('%s', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    expect(src).not.toMatch(/\bburn|deflation|\byield\b|\bstaking\b|\bAPY\b/i);
  });

  it('no file a buyer or an API client reads from says burn or deflation (the search in the task\'s acceptance)', () => {
    // components/paywall, worker/q402, worker/tonPayment.ts and worker/termsPolicy.ts, whole files:
    // a field or a comment left behind is how the wording came back last time.
    // Walked all the way down, like the search itself.
    const walk = (dir: string): string[] =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
      );
    const sources = (list: string[]) => list.filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
    const files = sources([...walk('components/paywall'), ...walk('worker/q402'), 'worker/tonPayment.ts', 'worker/termsPolicy.ts']);
    expect(files.length).toBeGreaterThan(8);
    const linesMatching = (list: string[], pattern: RegExp) =>
      list.flatMap((rel) =>
        readFileSync(join(ROOT, rel), 'utf8')
          .split('\n')
          .map((line, i) => (pattern.test(line) ? `${rel}:${i + 1}` : ''))
          .filter(Boolean),
      );
    expect(linesMatching(files, /burn|deflation/i)).toEqual([]);

    // services/ton builds the contract's real burn message (a holder burning their own tokens),
    // so the word itself belongs there. The claim that a payment burns a share does not.
    const tonClient = sources(walk('services/ton'));
    expect(tonClient.length).toBeGreaterThan(0);
    expect(linesMatching(tonClient, /deflation|supply watcher|qubic/i)).toEqual([]);
  });

  it('the Terms do not name USDT or $LORA as a way to pay while both are off', () => {
    const terms = readFileSync(join(ROOT, 'worker/termsPolicy.ts'), 'utf8');
    expect(JETTON_CHECKOUT_LIVE).toBe(false);
    expect(terms).not.toMatch(/USDT|\$LORA|Jetton/);
  });
});
