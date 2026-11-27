import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import {
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  buildLogoutCookie,
  verifyWebhookSignature,
  mintOpaqueSession,
  loadOpaqueSession,
} from '../worker/authMiddleware';
import { getSessionCookieToken } from '../worker/workerUtils';
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
      { path: '/api/oracle/chat', method: 'POST', body: '{}' },
      { path: '/api/audit/run', method: 'POST', body: '{}' },
      { path: '/api/enquiries', method: 'GET' },
      { path: '/api/outcomes', method: 'GET' },
      { path: '/api/recovery/send-step', method: 'POST', body: '{}' },
      { path: '/api/cms-mcp/catalog', method: 'GET' },
      { path: '/api/sidecars/languagetool/v2/check', method: 'POST', body: 'text=hi&language=en-US' },
      { path: '/api/privacy/export', method: 'GET' },
      { path: '/api/dreaming/status', method: 'GET' },
      { path: '/api/memory/search', method: 'POST', body: '{}' },
      { path: '/api/deploy/readback', method: 'POST', body: '{}' },
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

  it('reads the first __session cookie and returns null for a malformed one', () => {
    const cookie = (value: string) => new Request('https://luminarasuite.com', { headers: { cookie: value } });
    expect(getSessionCookieToken(cookie('other=val456; __session=token%2B123; __session=second'))).toBe('token+123');
    expect(getSessionCookieToken(cookie('__session=%E0%A4%A'))).toBeNull();
  });

  it('clears session cookie on POST /api/auth/logout', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('/api/auth/logout', { method: 'POST', headers: { origin: 'https://luminarasuite.com' } }), env, ctx);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('Max-Age=0');
  });

  it('logout survives a malformed cookie and revokes the first __session', async () => {
    const env = makeEnv();
    const first = (await mintOpaqueSession(env, { uid: 'logout_a' })) as string;
    const second = (await mintOpaqueSession(env, { uid: 'logout_b' })) as string;
    const res = await worker.fetch(
      req('/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://luminarasuite.com', cookie: `bad=%E0%A4%A; __session=${first}; __session=${second}` },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await loadOpaqueSession(env, first)).toBeNull();
    expect((await loadOpaqueSession(env, second))?.uid).toBe('logout_b');
  });
});

describe('Login CSRF on session-setting routes', () => {
  const botToken = '123456:CSRF_TEST';
  const signedInitData = (userId: number) => {
    const fields: Record<string, string> = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: userId, first_name: 'Ada' }),
    };
    const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const p = new URLSearchParams(fields);
    p.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
    return p.toString();
  };
  const telegramAuth = (headers: Record<string, string>) =>
    req('/api/telegram/auth', { method: 'POST', headers, body: JSON.stringify({ initData: signedInitData(66001) }) });

  it('refuses signed initData from a foreign Origin and sets no cookie', async () => {
    const env = makeEnv({ BOT_TOKEN: botToken });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await worker.fetch(telegramAuth({ origin: 'https://evil.example' }), env, ctx);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code?: string }).code).toBe('CSRF_REJECTED');
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        JSON.stringify({ event: 'csrf_rejected', path: '/api/telegram/auth', reason: 'origin_rejected' }),
      );

      const crossSite = await worker.fetch(
        telegramAuth({ origin: 'https://luminarasuite.com', 'sec-fetch-site': 'cross-site' }),
        env,
        ctx,
      );
      expect(crossSite.status).toBe(403);
      expect(crossSite.headers.get('set-cookie')).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it('sets the cookie for an allowlisted Origin, and for a missing one with a log line', async () => {
    const env = makeEnv({ BOT_TOKEN: botToken });
    const allowed = await worker.fetch(telegramAuth({ origin: 'https://luminarasuite.com' }), env, ctx);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('set-cookie')).toMatch(/^__session=sid_/);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const missing = await worker.fetch(telegramAuth({}), env, ctx);
      expect(missing.status).toBe(200);
      expect(missing.headers.get('set-cookie')).toMatch(/^__session=sid_/);
      expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: 'csrf_origin_missing', path: '/api/telegram/auth' }));
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses a foreign Origin on the session exchange and on logout', async () => {
    const env = makeEnv({ BOT_TOKEN: botToken });
    const exchange = await worker.fetch(
      req('/api/auth/session', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
        body: JSON.stringify({ initData: signedInitData(66002) }),
      }),
      env,
      ctx,
    );
    expect(exchange.status).toBe(403);
    expect(exchange.headers.get('set-cookie')).toBeNull();

    const logout = await worker.fetch(
      req('/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example' } }),
      env,
      ctx,
    );
    expect(logout.status).toBe(403);
    expect(logout.headers.get('set-cookie')).toBeNull();
  });
});

describe('Signed Webhook Verification (/api/webhooks/auth)', () => {
  async function signAuthHex(secret: string, timestamp: string, payload: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const buf = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payload}`));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function signSvix(secret: string, svixId: string, svixTs: string, payload: string): string {
    const keyBytes = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret, 'utf8');
    const b64 = createHmac('sha256', keyBytes).update(`${svixId}.${svixTs}.${payload}`).digest('base64');
    return `v1,${b64}`;
  }

  it('rejects webhooks with missing, unsigned-timestamp, expired, or invalid cryptographic signatures', async () => {
    const secret = 'test-secret-123';
    const env = makeEnv({ AUTH_WEBHOOK_SECRET: secret });
    const payload = JSON.stringify({ type: 'user.created', data: { uid: 'user_99', email: 'test@example.com' } });
    const nowTs = String(Math.floor(Date.now() / 1000));

    // Missing signature
    const resMissing = await worker.fetch(
      req('/api/webhooks/auth', { method: 'POST', body: payload }),
      env,
      ctx
    );
    expect(resMissing.status).toBe(401);

    // Signature without timestamp (legacy replayable format rejected)
    const legacySig = createHmac('sha256', secret).update(payload).digest('hex');
    const resNoTs = await worker.fetch(
      req('/api/webhooks/auth', { method: 'POST', body: payload, headers: { 'x-auth-signature': legacySig } }),
      env,
      ctx,
    );
    expect(resNoTs.status).toBe(401);

    // Expired timestamp (> 300s old)
    const oldTs = String(Math.floor(Date.now() / 1000) - 301);
    const oldSig = await signAuthHex(secret, oldTs, payload);
    const resExpired = await worker.fetch(
      req('/api/webhooks/auth', {
        method: 'POST',
        body: payload,
        headers: { 'x-auth-signature': oldSig, 'x-auth-timestamp': oldTs },
      }),
      env,
      ctx,
    );
    expect(resExpired.status).toBe(401);

    // Invalid signature with valid timestamp
    const resInvalid = await worker.fetch(
      req('/api/webhooks/auth', {
        method: 'POST',
        body: payload,
        headers: {
          'x-auth-timestamp': nowTs,
          'x-auth-signature': '0000000000000000000000000000000000000000000000000000000000000000',
        },
      }),
      env,
      ctx
    );
    expect(resInvalid.status).toBe(401);
  });

  it('accepts timestamped hex HMAC webhooks, deduplicates replays, and synchronizes user state', async () => {
    const secret = 'test-secret-123';
    const env = makeEnv({ AUTH_WEBHOOK_SECRET: secret });
    const payload = JSON.stringify({ type: 'user.created', data: { uid: 'sync_user_1', email: 'sync@example.com', displayName: 'Sync User' } });
    const ts = String(Math.floor(Date.now() / 1000));
    const validSignature = await signAuthHex(secret, ts, payload);

    const res = await worker.fetch(
      req('/api/webhooks/auth', {
        method: 'POST',
        body: payload,
        headers: { 'x-auth-timestamp': ts, 'x-auth-signature': validSignature },
      }),
      env,
      ctx
    );

    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; processed: string };
    expect(data.ok).toBe(true);
    expect(data.processed).toBe('user.created');

    // Replaying the same request (even with uppercase hex or rotated unsigned x-auth-nonce) must fail closed with 401
    const replay = await worker.fetch(
      req('/api/webhooks/auth', {
        method: 'POST',
        body: payload,
        headers: {
          'x-auth-timestamp': ts,
          'x-auth-signature': validSignature.toUpperCase(),
          'x-auth-nonce': 'rotated-unsigned-nonce-1',
        },
      }),
      env,
      ctx,
    );
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as { code?: string }).code).toBe('replayed');

    // Missing signed_request_nonces table must fail closed with 503
    const dbMissingTable = createSqliteD1();
    (dbMissingTable as unknown as { sqlite: { exec: (sql: string) => void } }).sqlite.exec(
      'DROP TABLE signed_request_nonces',
    );
    const missingTableRes = await worker.fetch(
      req('/api/webhooks/auth', {
        method: 'POST',
        body: payload,
        headers: { 'x-auth-timestamp': ts, 'x-auth-signature': validSignature },
      }),
      makeEnv({ AUTH_WEBHOOK_SECRET: secret, DB: dbMissingTable }),
      ctx,
    );
    expect(missingTableRes.status).toBe(503);
    expect(((await missingTableRes.json()) as { code?: string }).code).toBe('REQUEST_SIGNING_TABLE_MISSING');
  });

  it('accepts Svix v1,<base64> webhooks (whsec_ and raw secrets) and blocks replays and expiry', async () => {
    const whsec = `whsec_${Buffer.from('svix-signing-key-32-bytes-123456').toString('base64')}`;
    const env = makeEnv({ AUTH_WEBHOOK_SECRET: whsec });
    const payload = JSON.stringify({ type: 'user.updated', data: { uid: 'svix_user_1', email: 'svix@example.com' } });
    const ts = String(Math.floor(Date.now() / 1000));
    const svixId = 'msg_svix_test_001';
    const sig = signSvix(whsec, svixId, ts, payload);

    const ok = await worker.fetch(
      req('/api/webhooks/auth', {
        method: 'POST',
        body: payload,
        headers: {
          'svix-id': svixId,
          'svix-timestamp': ts,
          'svix-signature': `v1,invalidBase64== ${sig}`,
        },
      }),
      env,
      ctx,
    );
    expect(ok.status).toBe(200);

    // Same svix-id replayed -> 401
    const replay = await worker.fetch(
      req('/api/webhooks/auth', {
        method: 'POST',
        body: payload,
        headers: { 'svix-id': svixId, 'svix-timestamp': ts, 'svix-signature': sig },
      }),
      env,
      ctx,
    );
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as { code?: string }).code).toBe('replayed');

    // Expired Svix timestamp -> 401
    const staleTs = String(Math.floor(Date.now() / 1000) - 400);
    const staleSig = signSvix(whsec, 'msg_svix_stale', staleTs, payload);
    const expired = await worker.fetch(
      req('/api/webhooks/auth', {
        method: 'POST',
        body: payload,
        headers: { 'svix-id': 'msg_svix_stale', 'svix-timestamp': staleTs, 'svix-signature': staleSig },
      }),
      env,
      ctx,
    );
    expect(expired.status).toBe(401);
  });

  it('answers a signed JSON null payload as an unknown event, not a crash', async () => {
    const secret = 'test-secret-123';
    const env = makeEnv({ AUTH_WEBHOOK_SECRET: secret });
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = await signAuthHex(secret, ts, 'null');

    const res = await worker.fetch(
      req('/api/webhooks/auth', {
        method: 'POST',
        body: 'null',
        headers: { 'x-auth-timestamp': ts, 'x-auth-signature': signature },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 'unknown' });
  });

  it('user.deleted revokes the sessions the user already holds', async () => {
    const secret = 'test-secret-123';
    const env = makeEnv({ AUTH_WEBHOOK_SECRET: secret });
    const sid = (await mintOpaqueSession(env, { uid: 'gone_user_1', email: 'gone@example.com' })) as string;
    const otherSid = (await mintOpaqueSession(env, { uid: 'kept_user_1' })) as string;
    expect(await loadOpaqueSession(env, sid)).not.toBeNull();
    const before = await worker.fetch(
      req('/api/workspace', { headers: { cookie: `${SESSION_COOKIE_NAME}=${sid}` } }),
      env,
      ctx,
    );
    expect(before.status).toBe(200);

    const payload = JSON.stringify({ type: 'user.deleted', data: { id: 'fb:gone_user_1' } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await signAuthHex(secret, ts, payload);
    const res = await worker.fetch(
      req('/api/webhooks/auth', {
        method: 'POST',
        body: payload,
        headers: { 'x-auth-timestamp': ts, 'x-auth-signature': sig },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);

    expect(await loadOpaqueSession(env, sid)).toBeNull();
    expect(await loadOpaqueSession(env, otherSid)).not.toBeNull();
    // A session minted after the deletion, from an ID token that has not expired yet, is refused too.
    const lateSid = (await mintOpaqueSession(env, { uid: 'gone_user_1' })) as string;
    expect(await loadOpaqueSession(env, lateSid)).toBeNull();
    const who = await worker.fetch(
      req('/api/workspace', { headers: { cookie: `${SESSION_COOKIE_NAME}=${sid}` } }),
      env,
      ctx,
    );
    expect(who.status).toBe(401);
  });

  it('appends form-action none and base-uri none to /api/reports/:id/html CSP (M-25)', async () => {
    const env = makeEnv();
    const sid = (await mintOpaqueSession(env, { uid: 'rpt_csp_user', email: 'u@example.com' })) as string;
    const createProj = await worker.fetch(
      req('/api/projects', {
        method: 'POST',
        headers: {
          origin: 'https://luminarasuite.com',
          cookie: `${SESSION_COOKIE_NAME}=${sid}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'CSP Site', domain: 'example.com' }),
      }),
      env,
      ctx,
    );
    expect(createProj.status).toBe(200);
    const projId = ((await createProj.json()) as { project: { id: string } }).project.id;

    const saveRpt = await worker.fetch(
      req('/api/reports', {
        method: 'POST',
        headers: {
          origin: 'https://luminarasuite.com',
          cookie: `${SESSION_COOKIE_NAME}=${sid}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          projectId: projId,
          title: 'CSP Test',
          summary: 'Summary',
          html: '<!DOCTYPE html><html><head><title>R</title></head><body><h1>OK</h1></body></html>',
        }),
      }),
      env,
      ctx,
    );
    expect(saveRpt.status).toBe(200);
    const rptId = ((await saveRpt.json()) as { report: { id: string } }).report.id;

    const htmlRes = await worker.fetch(
      req(`/api/reports/${encodeURIComponent(rptId)}/html`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${sid}` },
      }),
      env,
      ctx,
    );
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get('cache-control')).toBe('private, no-store');
    const csp = htmlRes.headers.get('content-security-policy') || '';
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
  });
});
