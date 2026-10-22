import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyProvider } from '../worker/providerRelay';
import { handleAuditScoutRun } from '../worker/auditScoutRun';
import { readFreeUsed } from '../worker/quotaMiddleware';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';
import type { Env } from '../worker/env';

const BOT_TOKEN = '123456:MOCK_TOKEN';

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function signInitData(fields: Record<string, string>, token = BOT_TOKEN): string {
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function initDataFor(id: number): string {
  return signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Ada' }),
  });
}

function envFor(limit = '25') {
  const kv = memoryKv();
  const env = {
    LUMINARA_KV: kv,
    DAILY_QUOTA: memoryDailyQuotaNamespace(),
    BOT_TOKEN,
    REQUIRE_TG_AUTH: 'true',
    FREE_DAILY_LIMIT: limit,
    GROQ_API_KEY: 'gsk_test',
    WEBAPP_URL: 'https://luminarasuite.com',
  } as Env;
  return { env, kv };
}

function quotaUsed(env: Env): Promise<number | null> {
  return readFreeUsed(env, '11', Number(env.FREE_DAILY_LIMIT || 25));
}

async function mint(env: Env, id = 11, domain = 'https://movida.com.au') {
  const res = await handleAuditScoutRun(new Request('https://luminarasuite.com/api/audit/scout-run', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-init-data': initDataFor(id) },
    body: JSON.stringify({ domain }),
  }), env);
  const body = await res.json() as { ok: boolean; token?: string; domain?: string; error?: string };
  return { status: res.status, body, headers: res.headers };
}

function providerCall(token: string, domain: string, userId = 11, url = 'https://movida.com.au') {
  return new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-init-data': initDataFor(userId),
      'x-audit-run': token,
      'x-audit-domain': domain,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'Ping' }],
      url,
    }),
  });
}

describe('one Instant Audit run', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('spends one check for the run and not for each hosted call', async () => {
    const { env, kv } = envFor();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Groq hosted answer' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const opened = await mint(env);
    expect(opened.status).toBe(200);
    expect(opened.body.domain).toBe('movida.com.au');
    expect(await quotaUsed(env)).toBe(1);
    expect(opened.headers.get('x-quota-limit')).toBe('25');
    expect(opened.headers.get('x-quota-remaining')).toBe('24');

    for (let i = 0; i < 3; i++) {
      const res = await proxyProvider(
        providerCall(opened.body.token!, 'movida.com.au'),
        env,
        'groq',
        '/chat/completions',
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ choices: [{ message: { content: 'Groq hosted answer' } }] });
    }
    expect(await quotaUsed(env)).toBe(1);
    const refund = await handleAuditScoutRun(new Request('https://luminarasuite.com/api/audit/scout-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initDataFor(11) },
      body: JSON.stringify({ refund: true, token: opened.body.token }),
    }), env);
    expect(await refund.json()).toEqual({ ok: true, refunded: false });
    expect(await quotaUsed(env)).toBe(1);
  });

  it('refunds that check when the run produced no measured result', async () => {
    const { env, kv } = envFor();
    globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 }));
    const opened = await mint(env);
    const failed = await proxyProvider(
      providerCall(opened.body.token!, 'movida.com.au'),
      env,
      'groq',
      '/chat/completions',
    );
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await quotaUsed(env)).toBe(1);

    const refund = await handleAuditScoutRun(new Request('https://luminarasuite.com/api/audit/scout-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initDataFor(11) },
      body: JSON.stringify({ refund: true, token: opened.body.token }),
    }), env);
    expect(await refund.json()).toEqual({ ok: true, refunded: true });
    expect(await quotaUsed(env)).toBe(0);
  });

  it('meters the call that goes past the per-run cap', async () => {
    const { env, kv } = envFor();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const opened = await mint(env);
    for (let i = 0; i < 30; i++) {
      const res = await proxyProvider(providerCall(opened.body.token!, 'movida.com.au'), env, 'groq', '/chat/completions');
      expect(res.status).toBe(200);
    }
    expect(await quotaUsed(env)).toBe(1);
    const extra = await proxyProvider(providerCall(opened.body.token!, 'movida.com.au'), env, 'groq', '/chat/completions');
    expect(extra.status).toBe(200);
    expect(await quotaUsed(env)).toBe(2);
  });

  it('rejects an expired token, another account, and another site', async () => {
    const { env, kv } = envFor();
    globalThis.fetch = vi.fn(async () => new Response('should not run', { status: 200 }));
    const opened = await mint(env);
    const key = `audit-run:${opened.body.token}`;
    const stored = JSON.parse(kv.store.get(key)!) as { exp: number };
    stored.exp = Date.now() - 1000;
    kv.store.set(key, JSON.stringify(stored));

    const expired = await proxyProvider(providerCall(opened.body.token!, 'movida.com.au'), env, 'groq', '/chat/completions');
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ code: 'AUDIT_RUN_REJECTED' });

    stored.exp = Date.now() + 60_000;
    kv.store.set(key, JSON.stringify(stored));
    const other = await proxyProvider(providerCall(opened.body.token!, 'movida.com.au', 22), env, 'groq', '/chat/completions');
    expect(other.status).toBe(401);

    const otherSite = await proxyProvider(providerCall(opened.body.token!, 'example.com'), env, 'groq', '/chat/completions');
    expect(otherSite.status).toBe(403);
    expect(await otherSite.json()).toMatchObject({ code: 'AUDIT_RUN_REJECTED' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(await quotaUsed(env)).toBe(1);
  });

  it('treats www and a subdomain as the minted site', async () => {
    const { env } = envFor();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { markdown: 'page' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const www = await mint(env, 11, 'https://www.movida.com.au');
    const bare = await proxyProvider(
      providerCall(www.body.token!, 'www.movida.com.au', 11, 'https://movida.com.au/pages/about'),
      env,
      'groq',
      '/chat/completions',
    );
    expect(bare.status).toBe(200);

    const sub = await mint(env, 11, 'https://www.x.com');
    const booking = await proxyProvider(
      providerCall(sub.body.token!, 'www.x.com', 11, 'https://booking.x.com/book'),
      env,
      'groq',
      '/chat/completions',
    );
    expect(booking.status).toBe(200);
  });

  it('refunds an unmeasured run after a homepage 200, and the daily cap still holds', async () => {
    const { env, kv } = envFor('1');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const refundUnmeasured = (token: string) => handleAuditScoutRun(new Request('https://luminarasuite.com/api/audit/scout-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initDataFor(11) },
      body: JSON.stringify({ refund: true, token, healthScore: null, citationRate: null }),
    }), env);

    const opened = await mint(env);
    const page = await proxyProvider(
      providerCall(opened.body.token!, 'movida.com.au', 11, 'https://movida.com.au'),
      env,
      'groq',
      '/chat/completions',
    );
    expect(page.status).toBe(200);
    expect(await quotaUsed(env)).toBe(1);
    expect(await (await refundUnmeasured(opened.body.token!)).json()).toEqual({ ok: true, refunded: true });
    expect(await quotaUsed(env)).toBe(0);

    const again = await mint(env);
    const secondPage = await proxyProvider(
      providerCall(again.body.token!, 'movida.com.au', 11, 'https://movida.com.au'),
      env,
      'groq',
      '/chat/completions',
    );
    expect(secondPage.status).toBe(200);
    expect(await (await refundUnmeasured(again.body.token!)).json()).toEqual({ ok: true, refunded: false });
    expect(await quotaUsed(env)).toBe(1);
  });

  it('still meters a hosted call that is not part of a run', async () => {
    const { env, kv } = envFor();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'chat' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const chat = () => new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initDataFor(11) },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'Hi' }] }),
    });
    expect((await proxyProvider(chat(), env, 'groq', '/chat/completions')).status).toBe(200);
    expect((await proxyProvider(chat(), env, 'groq', '/chat/completions')).status).toBe(200);
    expect(await quotaUsed(env)).toBe(2);
  });

  it('covers later calls without rewriting the run', async () => {
    const { env, kv } = envFor();
    let runPuts = 0;
    const realPut = kv.put.bind(kv);
    kv.put = async (key: string, value: string) => {
      if (key.startsWith('audit-run:')) runPuts += 1;
      return realPut(key, value);
    };
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const opened = await mint(env);
    const afterMint = runPuts;
    for (let i = 0; i < 3; i++) {
      const res = await proxyProvider(
        providerCall(opened.body.token!, 'movida.com.au'),
        env,
        'groq',
        '/chat/completions',
      );
      expect(res.status).toBe(200);
    }
    expect(runPuts - afterMint).toBe(1);
    expect(await quotaUsed(env)).toBe(1);
  });

  it('refuses a free audit when the meter is unavailable, and does not invent a token', async () => {
    const { env } = envFor();
    env.DAILY_QUOTA = undefined;
    globalThis.fetch = vi.fn(async () => new Response('should not run', { status: 200 }));
    const opened = await mint(env);
    expect(opened.status).toBe(503);
    expect(opened.body.token).toBeUndefined();
    expect(opened.body).toMatchObject({ ok: false, code: 'HOSTED_CAPACITY' });

    const chat = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initDataFor(11) },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'Hi' }] }),
    });
    const res = await proxyProvider(chat, env, 'groq', '/chat/completions');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'HOSTED_CAPACITY' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not hand out a token when the audit run cannot be stored', async () => {
    const { env, kv } = envFor();
    const realPut = kv.put.bind(kv);
    kv.put = async (key: string, value: string) => {
      if (key.startsWith('audit-run:')) throw new Error('kv put');
      return realPut(key, value);
    };
    const opened = await mint(env);
    expect(opened.status).toBe(200);
    expect(opened.body.ok).toBe(true);
    expect(opened.body.token).toBeUndefined();
    expect(await quotaUsed(env)).toBe(0);
  });
});
