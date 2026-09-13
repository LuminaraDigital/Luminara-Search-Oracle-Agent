import { describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import {
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  buildLogoutCookie,
  parseCookies,
  verifyWebhookSignature,
} from '../worker/authMiddleware';
import { createSqliteD1 } from './helpers/sqliteD1';

function mockKv(store = new Map<string, string>()): KVNamespace {
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

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    FIREBASE_PROJECT_ID: 'demo-luminara',
    AUTH_WEBHOOK_SECRET: 'super-secret-webhook-key',
    ...overrides,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

let ipCounter = 100;
const req = (path: string, init: RequestInit = {}, ip = `10.8.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`) => {
  const headers = new Headers(init.headers || {});
  headers.set('cf-connecting-ip', ip);
  return new Request(`https://luminarasuite.com${path}`, { ...init, headers });
};

describe('Centralized Edge Auth Middleware & Route Guarding', () => {
  it('allows unauthenticated access to explicitly whitelisted public endpoints', async () => {
    const env = makeEnv();
    const health = await worker.fetch(req('/api/health'), env, ctx);
    expect(health.status).toBe(200);

    const desktop = await worker.fetch(req('/api/desktop/latest'), env, ctx);
    expect(desktop.status).toBe(200);
  });

  it('blocks unauthenticated requests to protected endpoints with 401 JSON response', async () => {
    const env = makeEnv();
    const protectedRequests = [
      { path: '/api/workspace', method: 'GET' },
      { path: '/api/enterprise/audit-logs', method: 'GET' },
      { path: '/api/ton/invoice', method: 'POST', body: JSON.stringify({ planId: 'starter' }) },
      { path: '/api/license/activate', method: 'POST', body: JSON.stringify({ key: 'test-key' }) },
      { path: '/api/sentinel/register', method: 'POST', body: JSON.stringify({ domain: 'test.com' }) },
    ];

    for (const reqSpec of protectedRequests) {
      const res = await worker.fetch(req(reqSpec.path, { method: reqSpec.method, body: reqSpec.body }), env, ctx);
      expect(res.status, `Expected 401 for ${reqSpec.path}`).toBe(401);
      const data = await res.json() as { ok: boolean; error: string; code?: string };
      expect(data.ok).toBe(false);
      expect(data.code).toBe('AUTH_REQUIRED');
      expect(res.headers.get('content-type')).toContain('application/json');
    }
  });

  it('allows BYOK provider relays with user-supplied x-provider-key', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    try {
      const res = await worker.fetch(
        req('/api/providers/groq/models', { headers: { 'x-provider-key': 'gsk_user_owned_key' } }),
        makeEnv(),
        ctx,
      );
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('HttpOnly Session Cookie Management', () => {
  it('formats session cookies with HttpOnly, Secure, and SameSite=Lax flags', () => {
    const cookie = buildSessionCookie('mock_jwt_token', 3600);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=mock_jwt_token`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=3600');
  });

  it('formats logout cookies with Max-Age=0 and expired date to purge the cookie', () => {
    const logoutCookie = buildLogoutCookie();
    expect(logoutCookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(logoutCookie).toContain('Max-Age=0');
    expect(logoutCookie).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('parses cookies accurately from Cookie header', () => {
    const request = new Request('https://luminarasuite.com', {
      headers: { cookie: '__session=token123; other_cookie=val456' },
    });
    const parsed = parseCookies(request);
    expect(parsed.__session).toBe('token123');
    expect(parsed.other_cookie).toBe('val456');
  });

  it('clears session cookie on POST /api/auth/logout', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('/api/auth/logout', { method: 'POST' }), env, ctx);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('Max-Age=0');
  });
});

describe('Signed Webhook Verification (/api/webhooks/auth)', () => {
  it('rejects webhooks with missing or invalid cryptographic signatures', async () => {
    const env = makeEnv({ AUTH_WEBHOOK_SECRET: 'test-secret-123' });
    const payload = JSON.stringify({ type: 'user.created', data: { uid: 'user_99', email: 'test@example.com' } });

    // Missing signature
    const resMissing = await worker.fetch(
      req('/api/webhooks/auth', { method: 'POST', body: payload }),
      env,
      ctx
    );
    expect(resMissing.status).toBe(401);

    // Invalid signature
    const resInvalid = await worker.fetch(
      req('/api/webhooks/auth', {
        method: 'POST',
        body: payload,
        headers: { 'x-auth-signature': '0000000000000000000000000000000000000000000000000000000000000000' },
      }),
      env,
      ctx
    );
    expect(resInvalid.status).toBe(401);
  });

  it('accepts webhooks with valid HMAC-SHA256 signature and synchronizes user state', async () => {
    const secret = 'test-secret-123';
    const env = makeEnv({ AUTH_WEBHOOK_SECRET: secret });
    const payload = JSON.stringify({ type: 'user.created', data: { uid: 'sync_user_1', email: 'sync@example.com', displayName: 'Sync User' } });

    // Compute expected HMAC-SHA256
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    const validSignature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const res = await worker.fetch(
      req('/api/webhooks/auth', {
        method: 'POST',
        body: payload,
        headers: { 'x-auth-signature': validSignature },
      }),
      env,
      ctx
    );

    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; processed: string };
    expect(data.ok).toBe(true);
    expect(data.processed).toBe('user.created');
  });
});
