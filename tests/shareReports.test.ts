import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sanitizeSharePayload, hashSharePassword, handleShareRoute } from '../worker/shareService';
import { sha256Hex } from '../worker/workerUtils';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:SHARE_TEST';

function signInitData(fields: Record<string, string>): string {
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
    BOT_TOKEN: botToken,
  } as Env;
}

describe('W1 shareable reports', () => {
  it('sanitizeSharePayload strips secret-looking keys', () => {
    const cleaned = sanitizeSharePayload({
      markdownText: 'hello',
      apiKey: 'secret',
      nested: { password: 'x', title: 'ok' },
      sources: [{ uri: 'https://a.com', authorization: 'Bearer x' }],
    }) as Record<string, unknown>;
    expect(cleaned.markdownText).toBe('hello');
    expect(cleaned.apiKey).toBeUndefined();
    expect((cleaned.nested as Record<string, unknown>).password).toBeUndefined();
    expect((cleaned.nested as Record<string, unknown>).title).toBe('ok');
    expect(((cleaned.sources as unknown[])[0] as Record<string, unknown>).authorization).toBeUndefined();
  });

  it('create → public GET → revoke → 404', async () => {
    const store = new Map<string, string>([
      ['sub:77', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 })],
    ]);
    const env = makeEnv(store);
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 77, first_name: 'Growth' }),
    });

    const createRes = await handleShareRoute(
      new Request('https://luminarasuite.com/api/share/reports', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
        },
        body: JSON.stringify({
          markdownText: '# Report\n\nSafe body',
          domain: 'example.com',
          apiKey: 'should-be-stripped',
        }),
      }),
      env,
      '/share/reports',
    );
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { ok: boolean; token: string; id: string; url: string };
    expect(created.ok).toBe(true);
    expect(created.token).toMatch(/^[a-f0-9]{64}$/);
    expect(created.url).toContain(`/share/${created.token}`);

    const getRes = await handleShareRoute(
      new Request(`https://luminarasuite.com/api/share/reports/${created.token}`),
      env,
      `/share/reports/${created.token}`,
    );
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { ok: boolean; report: { markdownText: string; apiKey?: string } };
    expect(got.report.markdownText).toContain('Safe body');
    expect(got.report.apiKey).toBeUndefined();

    const del = await handleShareRoute(
      new Request(`https://luminarasuite.com/api/share/reports/${created.id}`, {
        method: 'DELETE',
        headers: { 'x-telegram-init-data': initData },
      }),
      env,
      `/share/reports/${created.id}`,
    );
    expect(del.status).toBe(200);

    const gone = await handleShareRoute(
      new Request(`https://luminarasuite.com/api/share/reports/${created.token}`),
      env,
      `/share/reports/${created.token}`,
    );
    expect(gone.status).toBe(404);
  });

  it('password gate and free plan entitlement', async () => {
    const store = new Map<string, string>([
      ['sub:88', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86400_000 })],
    ]);
    const env = makeEnv(store);
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 88, first_name: 'Agency' }),
    });

    const createRes = await handleShareRoute(
      new Request('https://luminarasuite.com/api/share/reports', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
        },
        body: JSON.stringify({
          markdownText: '# Secret report',
          password: 'correct-horse',
        }),
      }),
      env,
      '/share/reports',
    );
    const created = (await createRes.json()) as { token: string };
    const locked = await handleShareRoute(
      new Request(`https://luminarasuite.com/api/share/reports/${created.token}`),
      env,
      `/share/reports/${created.token}`,
    );
    expect(locked.status).toBe(401);

    const unlocked = await handleShareRoute(
      new Request(`https://luminarasuite.com/api/share/reports/${created.token}`, {
        headers: { 'x-share-password': 'correct-horse' },
      }),
      env,
      `/share/reports/${created.token}`,
    );
    expect(unlocked.status).toBe(200);

    const freeEnv = makeEnv(new Map());
    const freeInit = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 11, first_name: 'Free' }),
    });
    const denied = await handleShareRoute(
      new Request('https://luminarasuite.com/api/share/reports', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': freeInit,
        },
        body: JSON.stringify({ markdownText: '# Nope' }),
      }),
      freeEnv,
      '/share/reports',
    );
    expect(denied.status).toBe(403);

    const pwHash = await hashSharePassword('correct-horse');
    expect(pwHash).toBe(await sha256Hex('luminara-share-pw:correct-horse'));
  });
});
