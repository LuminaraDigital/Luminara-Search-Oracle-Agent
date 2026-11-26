import { describe, expect, it, vi } from 'vitest';
import worker, { isSidecarPathAllowed, umamiUpstreamPath } from '../worker/index';
import type { Env } from '../worker/env';
import { mintOpaqueSession, SESSION_COOKIE_NAME } from '../worker/authMiddleware';
import { MAX_SIDECAR_BODY_BYTES } from '../worker/sidecarRelay';

describe('sidecar relay allowlist', () => {
  it('allows the two LanguageTool routes with the right method', () => {
    expect(isSidecarPathAllowed('languagetool', 'POST', '/v2/check')).toBe(true);
    expect(isSidecarPathAllowed('languagetool', 'GET', '/v2/languages')).toBe(true);
    expect(isSidecarPathAllowed('languagetool', 'post', '/v2/check')).toBe(true);
  });

  it('enforces the method per LanguageTool route', () => {
    expect(isSidecarPathAllowed('languagetool', 'GET', '/v2/check')).toBe(false);
    expect(isSidecarPathAllowed('languagetool', 'POST', '/v2/languages')).toBe(false);
    expect(isSidecarPathAllowed('languagetool', 'DELETE', '/v2/check')).toBe(false);
  });

  it('blocks LanguageTool look-alikes and other endpoints', () => {
    expect(isSidecarPathAllowed('languagetool', 'POST', '/v2/checkX')).toBe(false);
    expect(isSidecarPathAllowed('languagetool', 'POST', '/v2/check/extra')).toBe(false);
    expect(isSidecarPathAllowed('languagetool', 'POST', '/v2/words/add')).toBe(false);
    expect(isSidecarPathAllowed('languagetool', 'GET', '/v2/languages/')).toBe(false);
  });

  it('allows read-only Umami website routes', () => {
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites')).toBe(true);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/abc-123/stats')).toBe(true);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/metrics')).toBe(true);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/abc/pageviews')).toBe(true);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/abc/sessions')).toBe(true);
  });

  it('blocks Umami writes and everything outside the website read surface', () => {
    expect(isSidecarPathAllowed('umami', 'POST', '/api/websites')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'DELETE', '/api/websites/abc')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/abc')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/abc/events')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/abc/stats/extra')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websitesX')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/users')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/auth/login')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/../users')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/a b/stats')).toBe(false);
  });

  it('rejects unknown sidecar ids', () => {
    expect(isSidecarPathAllowed('crawler', 'GET', '/health')).toBe(false);
    expect(isSidecarPathAllowed('', 'GET', '/api/websites')).toBe(false);
  });
});

describe('umamiUpstreamPath', () => {
  it('rewrites /api to /v1 for Umami Cloud', () => {
    expect(umamiUpstreamPath('https://api.umami.is', '/api/websites')).toBe('https://api.umami.is/v1/websites');
    expect(umamiUpstreamPath('https://api.umami.is/', '/api/websites/abc/stats')).toBe('https://api.umami.is/v1/websites/abc/stats');
  });

  it('passes self-hosted paths through unchanged', () => {
    expect(umamiUpstreamPath('https://stats.example.com', '/api/websites')).toBe('https://stats.example.com/api/websites');
    expect(umamiUpstreamPath('http://localhost:3002/', '/api/websites/abc/metrics')).toBe('http://localhost:3002/api/websites/abc/metrics');
  });

  it('preserves a query string when one is included', () => {
    expect(umamiUpstreamPath('https://api.umami.is', '/api/websites/abc/stats?startAt=1&endAt=2'))
      .toBe('https://api.umami.is/v1/websites/abc/stats?startAt=1&endAt=2');
    expect(umamiUpstreamPath('https://stats.example.com', '/api/websites/abc/stats?startAt=1&endAt=2'))
      .toBe('https://stats.example.com/api/websites/abc/stats?startAt=1&endAt=2');
  });

  it('does not rewrite a self-hosted instance whose path merely contains api', () => {
    expect(umamiUpstreamPath('https://example.com/api.umami.is', '/api/websites')).toBe('https://example.com/api.umami.is/api/websites');
  });
});

describe('sidecar relay auth and body bounds (H-01)', () => {
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
  let ipCounter = 1;
  const req = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || {});
    headers.set('cf-connecting-ip', `10.12.0.${ipCounter++}`);
    return new Request(`https://luminarasuite.com${path}`, { ...init, headers });
  };

  function makeEnv(overrides: Partial<Env> = {}): Env {
    const kvStore = new Map<string, string>();
    return {
      ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
      LUMINARA_KV: {
        get: async (k: string, type?: string) => {
          const v = kvStore.get(k);
          if (v === undefined) return null;
          return type === 'json' ? JSON.parse(v) : v;
        },
        put: async (k: string, v: string) => { kvStore.set(k, v); },
        delete: async (k: string) => { kvStore.delete(k); },
      } as unknown as KVNamespace,
      WEBAPP_URL: 'https://luminarasuite.com/',
      ALLOWED_ORIGINS: 'https://luminarasuite.com',
      REQUIRE_TG_AUTH: 'false',
      LANGUAGETOOL_URL: 'https://lt.internal',
      UMAMI_URL: 'https://umami.internal',
      UMAMI_API_KEY: 'umami-server-key',
      ADMIN_SECRET: 'admin-secret-for-test',
      ...overrides,
    } as Env;
  }

  it('requires verified user session for languagetool even when REQUIRE_TG_AUTH is false and caps body size', async () => {
    const env = makeEnv({ REQUIRE_TG_AUTH: 'false' });
    const unauth = await worker.fetch(
      req('/api/sidecars/languagetool/v2/check', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'text=hello&language=en-US',
      }),
      env,
      ctx,
    );
    expect(unauth.status).toBe(401);

    const sid = (await mintOpaqueSession(env, { uid: 'lt_user_1' })) as string;
    const oversized = await worker.fetch(
      req('/api/sidecars/languagetool/v2/check', {
        method: 'POST',
        headers: {
          origin: 'https://luminarasuite.com',
          cookie: `${SESSION_COOKIE_NAME}=${sid}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'a'.repeat(MAX_SIDECAR_BODY_BYTES + 1),
      }),
      env,
      ctx,
    );
    expect(oversized.status).toBe(413);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ matches: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    try {
      const ok = await worker.fetch(
        req('/api/sidecars/languagetool/v2/check', {
          method: 'POST',
          headers: {
            origin: 'https://luminarasuite.com',
            cookie: `${SESSION_COOKIE_NAME}=${sid}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'text=hello&language=en-US',
        }),
        env,
        ctx,
      );
      expect(ok.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('locks umami behind isAdminAuthorized: 503 unset, 401 unauth, 403 non-admin user, 200 admin secret without cookie', async () => {
    const envNoAdmin = makeEnv({ ADMIN_SECRET: undefined });
    const res503 = await worker.fetch(req('/api/sidecars/umami/api/websites'), envNoAdmin, ctx);
    expect(res503.status).toBe(503);

    const env = makeEnv({ REQUIRE_TG_AUTH: 'false' });
    const unauth = await worker.fetch(req('/api/sidecars/umami/api/websites'), env, ctx);
    expect(unauth.status).toBe(401);

    const wrongAdmin = await worker.fetch(
      req('/api/sidecars/umami/api/websites', { headers: { 'x-admin-secret': 'wrong' } }),
      env,
      ctx,
    );
    expect(wrongAdmin.status).toBe(401);

    const sid = (await mintOpaqueSession(env, { uid: 'regular_user_1' })) as string;
    const nonAdminUser = await worker.fetch(
      req('/api/sidecars/umami/api/websites', { headers: { cookie: `${SESSION_COOKIE_NAME}=${sid}` } }),
      env,
      ctx,
    );
    expect(nonAdminUser.status).toBe(403);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    try {
      const adminOk = await worker.fetch(
        req('/api/sidecars/umami/api/websites', { headers: { 'x-admin-secret': 'admin-secret-for-test' } }),
        env,
        ctx,
      );
      expect(adminOk.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
