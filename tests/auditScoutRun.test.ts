import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyProvider } from '../worker/providerRelay';
import { handleAuditScoutRun } from '../worker/auditScoutRun';
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

function envFor() {
  const kv = memoryKv();
  const env = {
    LUMINARA_KV: kv,
    BOT_TOKEN,
    REQUIRE_TG_AUTH: 'true',
    FREE_DAILY_LIMIT: '25',
    GROQ_API_KEY: 'gsk_test',
    WEBAPP_URL: 'https://luminarasuite.com',
  } as Env;
  return { env, kv };
}

function quotaUsed(kv: ReturnType<typeof memoryKv>): string | undefined {
  const day = new Date().toISOString().slice(0, 10);
  return kv.store.get(`quota:11:${day}`);
}

async function mint(env: Env, id = 11, domain = 'https://movida.com.au') {
  const res = await handleAuditScoutRun(new Request('https://luminarasuite.com/api/audit/scout-run', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-init-data': initDataFor(id) },
    body: JSON.stringify({ domain }),
  }), env);
  const body = await res.json() as { ok: boolean; token?: string; domain?: string; error?: string };
  return { status: res.status, body };
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
    expect(quotaUsed(kv)).toBe('1');

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
    expect(quotaUsed(kv)).toBe('1');
    const refund = await handleAuditScoutRun(new Request('https://luminarasuite.com/api/audit/scout-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initDataFor(11) },
      body: JSON.stringify({ refund: true, token: opened.body.token }),
    }), env);
    expect(await refund.json()).toEqual({ ok: true, refunded: false });
    expect(quotaUsed(kv)).toBe('1');
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
    expect(quotaUsed(kv)).toBe('1');

    const refund = await handleAuditScoutRun(new Request('https://luminarasuite.com/api/audit/scout-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initDataFor(11) },
      body: JSON.stringify({ refund: true, token: opened.body.token }),
    }), env);
    expect(await refund.json()).toEqual({ ok: true, refunded: true });
    expect(quotaUsed(kv)).toBe('0');
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
    expect(quotaUsed(kv)).toBe('1');
    const extra = await proxyProvider(providerCall(opened.body.token!, 'movida.com.au'), env, 'groq', '/chat/completions');
    expect(extra.status).toBe(200);
    expect(quotaUsed(kv)).toBe('2');
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
    expect(otherSite.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(quotaUsed(kv)).toBe('1');
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
    expect(quotaUsed(kv)).toBe('2');
  });
});
