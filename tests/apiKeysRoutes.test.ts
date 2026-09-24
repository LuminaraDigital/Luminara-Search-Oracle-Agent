import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import { createSqliteD1 } from './helpers/sqliteD1';

/**
 * Route-level coverage for /api-keys as implemented in worker/index.ts:
 *   GET    /api-keys        -> { ok: true, keys: ApiKeyMeta[], tools }
 *   POST   /api-keys        -> { ok: true, key: 'lm_live_...' (full material, once), meta }
 *   DELETE /api-keys/:id    -> { ok: true } | 404 NOT_FOUND
 * Auth: Telegram initData (x-telegram-init-data) signed with BOT_TOKEN, same
 * strategy as tests/shareReports.test.ts. Plan gate: Growth+ via sub:<id> in KV.
 */

const botToken = '123456:APIKEYS_TEST';

function signInitData(userId: number, firstName: string): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: firstName }),
  };
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

function mockKv(store = new Map<string, string>()) {
  return {
    store,
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
    list: async () => ({ keys: [] as { name: string }[], list_complete: true, cacheStatus: null }),
  };
}

function makeEnv() {
  // Telegram identity has no accountId, so billingId = user.id = telegram numeric id.
  const store = new Map<string, string>([
    ['sub:77001', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 })],
    ['sub:77002', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 })],
  ]);
  const DB = createSqliteD1();
  const env: Env = {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(store) as unknown as KVNamespace,
    DB,
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    BOT_TOKEN: botToken,
  } as Env;
  return { env, DB, store };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function req(path: string, init: RequestInit = {}, ip = '10.9.9.1') {
  const headers = new Headers(init.headers || {});
  headers.set('cf-connecting-ip', ip);
  return new Request(`https://luminarasuite.com${path}`, { ...init, headers });
}

type CreatedBody = { ok: boolean; key: string; meta: { id: string; name: string; prefix: string } };
type ListBody = { ok: boolean; keys: Array<{ id: string; name: string; prefix: string; createdAt: number; lastUsedAt: number | null }> };

describe('/api-keys route (handler level)', () => {
  it('rejects unauthenticated requests with 401 AUTH_REQUIRED', async () => {
    const { env } = makeEnv();
    for (const [method, path] of [
      ['GET', '/api/api-keys'],
      ['POST', '/api/api-keys'],
      ['DELETE', '/api/api-keys/apk_nope'],
    ] as const) {
      const res = await worker.fetch(req(path, { method }), env, ctx);
      expect(res.status, `${method} ${path}`).toBe(401);
      const data = (await res.json()) as { ok: boolean; code?: string };
      expect(data.ok).toBe(false);
      expect(data.code).toBe('AUTH_REQUIRED');
    }
  });

  it('POST creates a key and returns full material with the lm_live_ prefix exactly once', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      req('/api/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(77001, 'Alpha') },
        body: JSON.stringify({ name: 'Cursor MCP' }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as CreatedBody;
    expect(data.ok).toBe(true);
    expect(data.key).toMatch(/^lm_live_/);
    expect(data.key.length).toBeGreaterThan('lm_live_'.length + 8);
    expect(data.meta.name).toBe('Cursor MCP');
    expect(data.meta.prefix).toBe(data.key.slice(0, 12));
  });

  it('GET lists keys as metadata only, never full key material', async () => {
    const { env } = makeEnv();
    const createRes = await worker.fetch(
      req('/api/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(77001, 'Alpha') },
        body: JSON.stringify({ name: 'Cursor MCP' }),
      }),
      env,
      ctx,
    );
    const created = (await createRes.json()) as CreatedBody;

    const listRes = await worker.fetch(
      req('/api/api-keys', { headers: { 'x-telegram-init-data': signInitData(77001, 'Alpha') } }),
      env,
      ctx,
    );
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as ListBody;
    expect(body.ok).toBe(true);
    expect(body.keys).toHaveLength(1);
    const row = body.keys[0];
    expect(row.id).toBe(created.meta.id);
    expect(row.name).toBe('Cursor MCP');
    expect(row.prefix).toBe(created.meta.prefix);
    // Middle secret chars of the full key must not appear anywhere in the list payload.
    const secretMiddle = created.key.slice(12, -4);
    expect(JSON.stringify(body.keys)).not.toContain(secretMiddle);
    // The raw full key field is absent from list rows.
    expect('key' in row).toBe(false);
  });

  it('DELETE /api-keys/:id revokes; GET no longer lists the key', async () => {
    const { env } = makeEnv();
    const createRes = await worker.fetch(
      req('/api/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(77001, 'Alpha') },
        body: JSON.stringify({ name: 'Temp key' }),
      }),
      env,
      ctx,
    );
    const created = (await createRes.json()) as CreatedBody;

    const delRes = await worker.fetch(
      req(`/api/api-keys/${created.meta.id}`, {
        method: 'DELETE',
        headers: { 'x-telegram-init-data': signInitData(77001, 'Alpha') },
      }),
      env,
      ctx,
    );
    expect(delRes.status).toBe(200);
    expect(((await delRes.json()) as { ok: boolean }).ok).toBe(true);

    const listRes = await worker.fetch(
      req('/api/api-keys', { headers: { 'x-telegram-init-data': signInitData(77001, 'Alpha') } }),
      env,
      ctx,
    );
    const body = (await listRes.json()) as ListBody;
    expect(body.keys.find((k) => k.id === created.meta.id)).toBeUndefined();

    // Second revoke hits the NOT_FOUND branch.
    const delAgain = await worker.fetch(
      req(`/api/api-keys/${created.meta.id}`, {
        method: 'DELETE',
        headers: { 'x-telegram-init-data': signInitData(77001, 'Alpha') },
      }),
      env,
      ctx,
    );
    expect(delAgain.status).toBe(404);
    expect(((await delAgain.json()) as { code?: string }).code).toBe('NOT_FOUND');
  });

  it('isolation: account A keys are invisible to account B and B cannot revoke them', async () => {
    const { env } = makeEnv();
    const createRes = await worker.fetch(
      req('/api/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(77001, 'Alpha') },
        body: JSON.stringify({ name: 'A key', }),
      }),
      env,
      ctx,
    );
    const created = (await createRes.json()) as CreatedBody;

    const listB = await worker.fetch(
      req('/api/api-keys', { headers: { 'x-telegram-init-data': signInitData(77002, 'Beta') } }),
      env,
      ctx,
    );
    const bodyB = (await listB.json()) as ListBody;
    expect(bodyB.keys.find((k) => k.id === created.meta.id)).toBeUndefined();

    const delByB = await worker.fetch(
      req(`/api/api-keys/${created.meta.id}`, {
        method: 'DELETE',
        headers: { 'x-telegram-init-data': signInitData(77002, 'Beta') },
      }),
      env,
      ctx,
    );
    expect(delByB.status).toBe(404);

    // Still live for A.
    const listA = await worker.fetch(
      req('/api/api-keys', { headers: { 'x-telegram-init-data': signInitData(77001, 'Alpha') } }),
      env,
      ctx,
    );
    const bodyA = (await listA.json()) as ListBody;
    expect(bodyA.keys).toHaveLength(1);
  });

  it('rejects callers without Growth+ mcpAccess with 403 MCP_ACCESS_REQUIRED', async () => {
    const { env, store } = makeEnv();
    store.set('sub:77001', JSON.stringify({ plan: 'free', expiresAt: Date.now() + 86400_000 }));
    const res = await worker.fetch(
      req('/api/api-keys', { headers: { 'x-telegram-init-data': signInitData(77001, 'Alpha') } }),
      env,
      ctx,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe('MCP_ACCESS_REQUIRED');
  });

  it('identifyApiKey resolves a created key to its account, then stops after revoke', async () => {
    const { env } = makeEnv();
    const { identifyApiKey } = await import('../worker/apiKeyService');
    const createRes = await worker.fetch(
      req('/api/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(77001, 'Alpha') },
        body: JSON.stringify({ name: 'MCP bearer' }),
      }),
      env,
      ctx,
    );
    const created = (await createRes.json()) as CreatedBody;

    const who = await identifyApiKey(env, created.key);
    expect(who?.accountId).toBe('77001');

    await worker.fetch(
      req(`/api/api-keys/${created.meta.id}`, {
        method: 'DELETE',
        headers: { 'x-telegram-init-data': signInitData(77001, 'Alpha') },
      }),
      env,
      ctx,
    );
    expect(await identifyApiKey(env, created.key)).toBeNull();
  });
});
