import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import { identify } from '../worker/workerUtils';
import { mintOpaqueSession } from '../worker/opaqueSession';
import { INIT_DATA_EXPIRED_REASON } from '../worker/telegramAuth';

// A Mini App left open for over an hour still holds the 14-day session from /telegram/auth.
// Genuine but stale initData must not lock that user out; forged initData still must.

const botToken = '123456:STALE_INIT_DATA_TEST';
const ORIGIN = 'https://luminarasuite.com';
const TWO_HOURS = 2 * 3600;

function signInitData(userId: number, ageSeconds = 0, token = botToken): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000) - ageSeconds),
    user: JSON.stringify({ id: userId, first_name: 'Ada' }),
  };
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}

function makeEnv(): Env {
  const store = new Map<string, string>();
  const kv = {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
  } as unknown as KVNamespace;
  return {
    ASSETS: { fetch: async () => new Response('ok') },
    LUMINARA_KV: kv,
    WEBAPP_URL: `${ORIGIN}/`,
    ALLOWED_ORIGINS: ORIGIN,
    BOT_TOKEN: botToken,
  } as unknown as Env;
}

async function sessionCookie(env: Env, tgId: number): Promise<string> {
  const sid = await mintOpaqueSession(env, { uid: `tg:${tgId}`, name: 'Ada' });
  if (!sid) throw new Error('no session minted');
  return `__session=${encodeURIComponent(sid)}`;
}

afterEach(() => vi.unstubAllGlobals());

describe('identify() with stale Mini App initData', () => {
  it('signs the user in from the session they already hold', async () => {
    const env = makeEnv();
    const who = await identify(new Request(`${ORIGIN}/api/auth/session`, {
      headers: { 'x-telegram-init-data': signInitData(77001, TWO_HOURS), cookie: await sessionCookie(env, 77001) },
    }), env);
    expect(who.error).toBeUndefined();
    expect(who.user).toMatchObject({ id: '77001', source: 'telegram' });
  });

  it('still answers "reopen the app" when there is no session', async () => {
    const env = makeEnv();
    const who = await identify(new Request(`${ORIGIN}/api/auth/session`, {
      headers: { 'x-telegram-init-data': signInitData(77002, TWO_HOURS) },
    }), env);
    expect(who.user).toBeNull();
    expect(who.error).toBe(INIT_DATA_EXPIRED_REASON);
  });

  it('refuses forged initData even with a valid session', async () => {
    const env = makeEnv();
    const who = await identify(new Request(`${ORIGIN}/api/auth/session`, {
      headers: {
        'x-telegram-init-data': signInitData(77003, 0, '999:WRONG_BOT'),
        cookie: await sessionCookie(env, 77003),
      },
    }), env);
    expect(who.user).toBeNull();
    expect(who.error).toMatch(/signature mismatch/);
  });

  it('keeps the cross-site check on a cookie-signed write', async () => {
    const env = makeEnv();
    const who = await identify(new Request(`${ORIGIN}/api/projects`, {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'x-telegram-init-data': signInitData(77004, TWO_HOURS),
        cookie: await sessionCookie(env, 77004),
      },
    }), env);
    expect(who.user).toBeNull();
    expect(who.error).toBeTruthy();
  });
});

describe('POST /api/telegram/invoice with stale initData', () => {
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

  function stubTelegram() {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${url} ${String(init?.body || '')}`);
      if (url.includes('/createInvoiceLink')) {
        return new Response(JSON.stringify({ ok: true, result: 'https://t.me/$invoice123' }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }));
    return calls;
  }

  function invoiceRequest(initData: string, cookie?: string) {
    return new Request(`${ORIGIN}/api/telegram/invoice`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        'cf-connecting-ip': '203.0.113.9',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ initData, plan: 'starter' }),
    });
  }

  it('creates the invoice for the session user after the app has been open over an hour', async () => {
    const env = makeEnv();
    const calls = stubTelegram();
    const res = await worker.fetch(invoiceRequest(signInitData(77010, TWO_HOURS), await sessionCookie(env, 77010)), env, ctx);
    const body = (await res.json()) as { ok?: boolean; url?: string; error?: string };
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, url: 'https://t.me/$invoice123' });
    expect(calls.some((c) => c.includes('/createInvoiceLink') && c.includes('starter:77010'))).toBe(true);
  });

  it('still refuses stale initData with no session', async () => {
    const env = makeEnv();
    stubTelegram();
    const res = await worker.fetch(invoiceRequest(signInitData(77011, TWO_HOURS)), env, ctx);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe(INIT_DATA_EXPIRED_REASON);
  });

  it('does not mint a new session from stale initData', async () => {
    const env = makeEnv();
    stubTelegram();
    const res = await worker.fetch(new Request(`${ORIGIN}/api/telegram/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '203.0.113.10', cookie: await sessionCookie(env, 77012) },
      body: JSON.stringify({ initData: signInitData(77012, TWO_HOURS) }),
    }), env, ctx);
    expect(res.status).toBe(401);
  });
});
