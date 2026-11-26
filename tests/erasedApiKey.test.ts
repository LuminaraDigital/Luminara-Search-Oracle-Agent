/** An API key minted before an account erase must stop authenticating afterwards (401, not the erased account). */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import { identifyApiKey } from '../worker/apiKeyService';
import { eraseAccountRows } from '../worker/privacyService';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:ERASE_KEY_TEST';

function signInitData(userId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Pat' }),
  };
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}

function makeEnv() {
  const store = new Map<string, string>([['sub:88001', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 })]]);
  const kv = {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => void store.set(key, value),
    delete: async (key: string) => void store.delete(key),
    list: async () => ({ keys: [] as { name: string }[], list_complete: true, cacheStatus: null }),
  };
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: kv as unknown as KVNamespace,
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    BOT_TOKEN: botToken,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function req(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('cf-connecting-ip', '10.8.8.1');
  return new Request(`https://luminarasuite.com${path}`, { ...init, headers });
}

const mcpCall = (key: string) =>
  req('/api/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

describe('API keys after account erase', () => {
  it('authenticates before the erase and returns 401 after it', async () => {
    const env = makeEnv();
    const created = await worker.fetch(
      req('/api/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(88001) },
        body: JSON.stringify({ name: 'Old key' }),
      }),
      env,
      ctx,
    );
    expect(created.status).toBe(200);
    const { key } = (await created.json()) as { key: string };

    expect(await identifyApiKey(env, key)).not.toBeNull();
    const before = await worker.fetch(mcpCall(key), env, ctx);
    expect(before.status).not.toBe(401);

    await eraseAccountRows(env, '88001');

    expect(await identifyApiKey(env, key)).toBeNull();
    const after = await worker.fetch(mcpCall(key), env, ctx);
    expect(after.status).toBe(401);
  });
});
