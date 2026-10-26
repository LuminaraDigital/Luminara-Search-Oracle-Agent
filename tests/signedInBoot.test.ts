import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { mintOpaqueSession } from '../worker/opaqueSession';
import { decoratePublicHtml, resetHashedPublicUrls } from '../worker/staticPublicCache';
import { resetAccountBoot, startAccountBoot, takeAccountBoot } from '../services/auth/accountBoot';
import { writeCachedFirebaseIdToken } from '../services/auth/firebaseIdToken';

function kv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  } as unknown as KVNamespace;
}

function makeEnv(store = new Map<string, string>()): Env {
  return {
    ASSETS: { fetch: async () => new Response('<!doctype html><html><body>app</body></html>', { headers: { 'content-type': 'text/html' } }) },
    LUMINARA_KV: kv(store),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    FIREBASE_PROJECT_ID: 'demo',
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

describe('signed-in boot', () => {
  afterEach(() => {
    resetAccountBoot();
    resetHashedPublicUrls();
    writeCachedFirebaseIdToken(null);
    vi.unstubAllGlobals();
  });

  it('returns workspace and quota together for a session cookie', async () => {
    const store = new Map<string, string>();
    const env = makeEnv(store);
    const sid = await mintOpaqueSession(env, { uid: 'user42', email: 'a@example.com', name: 'Ada' });
    store.set('sub:fb:user42', JSON.stringify({ plan: 'starter', expiresAt: Date.now() + 86_400_000 }));
    const res = await worker.fetch(new Request('https://luminarasuite.com/api/boot', {
      headers: { cookie: `__session=${sid}`, 'cf-connecting-ip': '203.0.113.10' },
    }), env, ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; accountId: string; workspace: { updatedAt: number }; quota: { isUnlimited: boolean; plan: string } };
    expect(body.ok).toBe(true);
    expect(body.accountId).toBe('fb:user42');
    expect(body.workspace.updatedAt).toBe(0);
    expect(body.quota.isUnlimited).toBe(true);
    expect(body.quota.plan).toBe('starter');
  });

  it('refuses boot without a session', async () => {
    const res = await worker.fetch(new Request('https://luminarasuite.com/api/boot', {
      headers: { 'cf-connecting-ip': '203.0.113.11' },
    }), makeEnv(), ctx);
    expect(res.status).toBe(401);
  });

  it('rewrites boot files onto hashed names and tells HTML to revalidate', async () => {
    const files: Record<string, string> = {
      '/boot-splash.js': 'splash',
      '/promote-css.js': 'css',
      '/fonts/outfit-latin.woff2': 'font-a',
      '/fonts/instrument-serif-latin.woff2': 'font-b',
      '/fonts/instrument-serif-italic-latin.woff2': 'font-c',
    };
    let fetches = 0;
    const assets = {
      fetch: async (req: Request) => {
        fetches += 1;
        const path = new URL(req.url).pathname;
        const body = files[path];
        return new Response(body ?? '', { status: body ? 200 : 404, headers: { 'content-type': 'text/plain' } });
      },
    };
    const html = '<script src="/boot-splash.js"></script><link href="/fonts/outfit-latin.woff2">';
    const first = await decoratePublicHtml(new Response(html, { headers: { 'content-type': 'text/html' } }), assets);
    const body = await first.text();
    expect(body).toMatch(/\/boot-splash\.[a-f0-9]{10}\.js/);
    expect(body).toMatch(/\/fonts\/outfit-latin\.[a-f0-9]{10}\.woff2/);
    expect(first.headers.get('cache-control')).toBe('no-cache');
    const again = await decoratePublicHtml(new Response(html, { headers: { 'content-type': 'text/html' } }), assets);
    expect(await again.text()).toBe(body);
    expect(fetches).toBe(5);
  });

  it('shares one boot request for the same token', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://staging.luminarasuite.com' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      accountId: 'fb:1',
      workspace: { updatedAt: 4, payload: {} },
      quota: { limit: 3, used: 1, remaining: 2, resetSec: 10, isUnlimited: false, plan: 'free' },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const [a, b] = await Promise.all([startAccountBoot('tok-1'), startAccountBoot('tok-1')]);
    expect(a?.accountId).toBe('fb:1');
    expect(b?.workspace.updatedAt).toBe(4);
    expect(vi.mocked(fetch).mock.calls.length).toBe(1);
  });

  it('hands a pending boot only to the token it was started for', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://luminarasuite.com' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      accountId: 'fb:a',
      workspace: { updatedAt: 1, payload: {} },
      quota: { limit: 3, used: 0, remaining: 3, resetSec: 10, isUnlimited: false, plan: 'free' },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    writeCachedFirebaseIdToken('tok-a');
    const started = startAccountBoot('tok-a');

    writeCachedFirebaseIdToken('tok-b');
    expect(await takeAccountBoot()).toBeNull();

    writeCachedFirebaseIdToken('tok-a');
    expect((await takeAccountBoot())?.accountId).toBe('fb:a');
    await started;
  });
});
