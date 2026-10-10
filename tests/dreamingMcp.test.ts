import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:APS_TEST_TOKEN';

function signInitData(fields: Record<string, string>, token = botToken): string {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(store: Map<string, string>): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(store),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    BOT_TOKEN: botToken,
  } as unknown as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function tgHeaders(userId: number, ip: string) {
  const initData = signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Tester' }),
  });
  return {
    'content-type': 'application/json',
    'x-telegram-init-data': initData,
    'x-forwarded-for': ip,
  };
}

describe('Luminara Dreaming MCP Tool Surface', () => {
  it('exposes dreaming tools in tools/list catalogue', async () => {
    const store = new Map<string, string>();
    store.set('sub:301', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 }));
    const env = makeEnv(store);

    const listRes = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: tgHeaders(301, '10.30.0.1'),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      env,
      ctx,
    );

    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      result?: { tools?: Array<{ name: string; description: string }> };
    };
    const names = (body.result?.tools || []).map((t) => t.name);

    expect(names).toContain('dream_status');
    expect(names).toContain('dream_consolidate');
    expect(names).toContain('get_business_memory');
    expect(names).toContain('review_dream_proposal');
  });

  it('runs dream_status, dream_consolidate, and get_business_memory via tools/call', async () => {
    const store = new Map<string, string>();
    store.set('sub:302', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 }));
    const env = makeEnv(store);

    // 1. Initial dream_status
    const statusRes = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: tgHeaders(302, '10.30.0.2'),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'dream_status',
            arguments: { domain: 'hermes-seo.com' },
          },
        }),
      }),
      env,
      ctx,
    );

    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as {
      result?: {
        content?: Array<{ type: string; text: string }>;
        structuredContent?: { domain: string; activeMemoriesCount: number };
      };
    };
    expect(statusBody.result?.structuredContent?.domain).toBe('hermes-seo.com');
    expect(statusBody.result?.content?.[0]?.text).toContain('Luminara Dreaming Status');

    // 2. Trigger dream_consolidate with force: true
    const dreamRes = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: tgHeaders(302, '10.30.0.3'),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'dream_consolidate',
            arguments: { domain: 'hermes-seo.com', force: true },
          },
        }),
      }),
      env,
      ctx,
    );

    expect(dreamRes.status).toBe(200);
    const dreamBody = (await dreamRes.json()) as {
      result?: { content?: Array<{ type: string; text: string }> };
    };
    expect(dreamBody.result?.content?.[0]?.text).toContain('Dreaming consolidated');

    // 3. Query get_business_memory
    const memRes = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: tgHeaders(302, '10.30.0.4'),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'get_business_memory',
            arguments: { domain: 'hermes-seo.com' },
          },
        }),
      }),
      env,
      ctx,
    );

    expect(memRes.status).toBe(200);
    const memBody = (await memRes.json()) as {
      result?: { structuredContent?: { domain: string } };
    };
    expect(memBody.result?.structuredContent?.domain).toBe('hermes-seo.com');
  });
});
