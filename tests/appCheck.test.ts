import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { parseJsonc } from '../scripts/lib/jsonc.mjs';
import {
  APP_CHECK_JWKS_TTL_MS,
  APP_CHECK_JWKS_URL,
  assertAppCheckClaims,
  enforceAppCheckRequest,
  extractAppCheckToken,
  isAppCheckExempt,
  isAppCheckRequired,
  loadAppCheckJwks,
  resetAppCheckJwksCache,
  resolveAppCheckMode,
  resolveFirebaseProjectNumber,
  type AppCheckLogFields,
} from '../worker/appCheck';
import { shouldAttachAppCheck } from '../services/apiClient';
import type { Env } from '../worker/env';
import worker from '../worker/index';

describe('appCheck', () => {
  it('isAppCheckRequired reads the env flag', () => {
    expect(isAppCheckRequired({} as Env)).toBe(false);
    expect(isAppCheckRequired({ REQUIRE_APP_CHECK: 'true' } as Env)).toBe(true);
    expect(isAppCheckRequired({ REQUIRE_APP_CHECK: 'TRUE' } as Env)).toBe(true);
    expect(isAppCheckRequired({ REQUIRE_APP_CHECK: 'false' } as Env)).toBe(false);
  });

  it('resolveFirebaseProjectNumber accepts digits only', () => {
    expect(resolveFirebaseProjectNumber({} as Env)).toBeNull();
    expect(resolveFirebaseProjectNumber({ FIREBASE_PROJECT_NUMBER: '274315225068' } as Env)).toBe(
      '274315225068',
    );
    expect(resolveFirebaseProjectNumber({ FIREBASE_PROJECT_NUMBER: 'luminara-suite' } as Env)).toBeNull();
  });

  it('assertAppCheckClaims accepts project-number audience', () => {
    const now = Math.floor(Date.now() / 1000);
    const ok = assertAppCheckClaims(
      {
        iss: 'https://firebaseappcheck.googleapis.com/274315225068',
        aud: ['projects/274315225068'],
        sub: '1:274315225068:web:092053650dfce884f482c9',
        exp: now + 3600,
        iat: now - 10,
      },
      '274315225068',
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.appId).toContain('274315225068');
  });

  it('assertAppCheckClaims rejects a project-id audience', () => {
    const now = Math.floor(Date.now() / 1000);
    const ok = assertAppCheckClaims(
      {
        iss: 'https://firebaseappcheck.googleapis.com/274315225068',
        aud: ['projects/luminara-suite'],
        sub: '1:274315225068:web:abc',
        exp: now + 3600,
        iat: now - 10,
      },
      '274315225068',
    );
    expect(ok.ok).toBe(false);
  });

  it('assertAppCheckClaims rejects expired and wrong audience', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(
      assertAppCheckClaims(
        {
          iss: 'https://firebaseappcheck.googleapis.com/274315225068',
          aud: ['projects/274315225068'],
          sub: '1:274315225068:web:abc',
          exp: now - 10,
          iat: now - 100,
        },
        '274315225068',
      ).ok,
    ).toBe(false);

    expect(
      assertAppCheckClaims(
        {
          iss: 'https://firebaseappcheck.googleapis.com/274315225068',
          aud: ['projects/other'],
          sub: '1:274315225068:web:abc',
          exp: now + 3600,
          iat: now - 10,
        },
        '274315225068',
      ).ok,
    ).toBe(false);
  });

  it('extractAppCheckToken prefers header over body', () => {
    const req = new Request('https://luminarasuite.com/api/auth/sign-in', {
      headers: { 'X-Firebase-AppCheck': 'header-token' },
    });
    expect(extractAppCheckToken(req, 'body-token')).toBe('header-token');
    expect(extractAppCheckToken(new Request('https://example.com'), 'body-token')).toBe('body-token');
    expect(extractAppCheckToken(new Request('https://example.com'))).toBeUndefined();
  });
});

const PROJECT = '274315225068';
const ISSUER = `https://firebaseappcheck.googleapis.com/${PROJECT}`;

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  publicJwk = { ...jwk, kid: 'test-app-check', alg: 'RS256', use: 'sig' };
});

afterEach(() => {
  resetAppCheckJwksCache();
  vi.restoreAllMocks();
});

function jwksFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function signToken(aud: string, exp: number): Promise<string> {
  return new SignJWT({ sub: `1:${PROJECT}:web:abc` })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-app-check', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(aud)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 10)
    .setExpirationTime(exp)
    .sign(privateKey);
}

function env(mode: 'off' | 'log' | 'enforce'): Env {
  return { APPCHECK_ENFORCE: mode, FIREBASE_PROJECT_NUMBER: PROJECT } as Env;
}

function request(token?: string, path = '/api/projects'): Request {
  const headers = new Headers();
  if (token) headers.set('X-Firebase-AppCheck', token);
  return new Request(`https://luminarasuite.com${path}`, { headers });
}

describe('APPCHECK_ENFORCE', () => {
  it('defaults to off', () => {
    expect(resolveAppCheckMode({})).toBe('off');
    expect(resolveAppCheckMode({ APPCHECK_ENFORCE: 'maybe' })).toBe('off');
    expect(resolveAppCheckMode({ APPCHECK_ENFORCE: 'LOG' })).toBe('log');
  });

  it('exempts health, robots.txt, llms.txt, and webhooks', () => {
    for (const path of ['/api/health', '/health', '/robots.txt', '/llms.txt', '/api/stripe/webhook', '/api/webhooks/auth', '/api/telegram/webhook']) {
      expect(isAppCheckExempt(new URL(path, 'https://luminarasuite.com'))).toBe(true);
    }
    expect(isAppCheckExempt(new URL('/api/projects', 'https://luminarasuite.com'))).toBe(false);
  });

  it.each(['off', 'log', 'enforce'] as const)('missing token in %s', async (mode) => {
    const logs: AppCheckLogFields[] = [];
    const fetchImpl = jwksFetch();
    const res = await enforceAppCheckRequest(request(), env(mode), { fetchImpl, log: (fields) => logs.push(fields) });
    expect(fetchImpl).not.toHaveBeenCalled();
    if (mode === 'off') {
      expect(res).toBeNull();
      expect(logs).toEqual([]);
      return;
    }
    expect(logs).toEqual([expect.objectContaining({ event: 'appcheck', mode, reason: 'missing', path: '/api/projects' })]);
    if (mode === 'log') {
      expect(res).toBeNull();
      return;
    }
    expect(res?.status).toBe(401);
    expect(await res?.json()).toMatchObject({ code: 'APP_CHECK_REQUIRED' });
  });

  it.each(['off', 'log', 'enforce'] as const)('valid token in %s', async (mode) => {
    const token = await signToken(`projects/${PROJECT}`, Math.floor(Date.now() / 1000) + 3600);
    const logs: AppCheckLogFields[] = [];
    const fetchImpl = jwksFetch();
    const res = await enforceAppCheckRequest(request(token), env(mode), {
      fetchImpl,
      log: (fields) => logs.push(fields),
    });
    expect(res).toBeNull();
    expect(logs).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(mode === 'off' ? 0 : 1);
  });

  it.each(['off', 'log', 'enforce'] as const)('expired token in %s', async (mode) => {
    const token = await signToken(`projects/${PROJECT}`, Math.floor(Date.now() / 1000) - 60);
    const logs: AppCheckLogFields[] = [];
    const fetchImpl = jwksFetch();
    const res = await enforceAppCheckRequest(request(token), env(mode), {
      fetchImpl,
      log: (fields) => logs.push(fields),
    });
    if (mode === 'off') {
      expect(res).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
      return;
    }
    expect(logs[0]).toMatchObject({ reason: 'expired', mode });
    expect(JSON.stringify(logs)).not.toContain(token);
    if (mode === 'log') {
      expect(res).toBeNull();
      return;
    }
    expect(res?.status).toBe(401);
    expect(await res?.json()).toMatchObject({ code: 'APP_CHECK_INVALID' });
  });

  it.each(['off', 'log', 'enforce'] as const)('wrong audience in %s', async (mode) => {
    const token = await signToken('projects/999999999999', Math.floor(Date.now() / 1000) + 3600);
    const logs: AppCheckLogFields[] = [];
    const fetchImpl = jwksFetch();
    const res = await enforceAppCheckRequest(request(token), env(mode), {
      fetchImpl,
      log: (fields) => logs.push(fields),
    });
    if (mode === 'off') {
      expect(res).toBeNull();
      return;
    }
    expect(logs[0]).toMatchObject({ reason: 'wrong_aud', mode });
    expect(JSON.stringify(logs)).not.toContain(token);
    if (mode === 'log') {
      expect(res).toBeNull();
      return;
    }
    expect(res?.status).toBe(401);
    expect(await res?.json()).toMatchObject({ code: 'APP_CHECK_INVALID' });
  });

  it('caches the JWKS until the TTL', async () => {
    const fetchImpl = jwksFetch();
    const now = 1_700_000_000_000;
    await loadAppCheckJwks(fetchImpl, now);
    await loadAppCheckJwks(fetchImpl, now + 1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(APP_CHECK_JWKS_URL);
    await loadAppCheckJwks(fetchImpl, now + APP_CHECK_JWKS_TTL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps production APPCHECK_ENFORCE off and staging on log', () => {
    const cfg = parseJsonc(readFileSync(resolve(__dirname, '..', 'wrangler.jsonc'), 'utf8')) as {
      vars: { APPCHECK_ENFORCE: string };
      env: { staging: { vars: { APPCHECK_ENFORCE: string } }; production: { vars: { APPCHECK_ENFORCE: string } } };
    };
    expect(cfg.vars.APPCHECK_ENFORCE).toBe('off');
    expect(cfg.env.production.vars.APPCHECK_ENFORCE).toBe('off');
    expect(cfg.env.staging.vars.APPCHECK_ENFORCE).toBe('log');
  });
});

describe('APPCHECK_ENFORCE on the worker', () => {
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

  function workerEnv(mode: string): Env {
    return {
      ASSETS: { fetch: async () => new Response('ok') },
      WEBAPP_URL: 'https://luminarasuite.com/',
      ALLOWED_ORIGINS: 'https://luminarasuite.com',
      FIREBASE_PROJECT_NUMBER: PROJECT,
      APPCHECK_ENFORCE: mode,
    } as Env;
  }

  it('serves health, robots.txt, and llms.txt while enforce is on', async () => {
    const enforced = workerEnv('enforce');
    expect((await worker.fetch(new Request('https://luminarasuite.com/api/health'), enforced, ctx)).status).toBe(200);
    expect((await worker.fetch(new Request('https://luminarasuite.com/robots.txt'), enforced, ctx)).status).toBe(200);
    expect((await worker.fetch(new Request('https://luminarasuite.com/llms.txt'), enforced, ctx)).status).toBe(200);
  });

  it('returns 401 for a missing token only in enforce mode', async () => {
    const blocked = await worker.fetch(new Request('https://luminarasuite.com/api/no-such-route'), workerEnv('enforce'), ctx);
    expect(blocked.status).toBe(401);
    expect(await blocked.json()).toMatchObject({ code: 'APP_CHECK_REQUIRED' });
    const open = await worker.fetch(new Request('https://luminarasuite.com/api/no-such-route'), workerEnv('off'), ctx);
    expect(open.status).toBe(404);
  });

  it('does not block the stripe webhook in enforce mode', async () => {
    const res = await worker.fetch(
      new Request('https://luminarasuite.com/api/stripe/webhook', { method: 'POST', body: '{}' }),
      workerEnv('enforce'),
      ctx,
    );
    const body = (await res.json()) as { code?: string };
    expect(body.code).not.toBe('APP_CHECK_REQUIRED');
    expect(body.code).not.toBe('APP_CHECK_INVALID');
  });
});

describe('client App Check header', () => {
  it('attaches only on same-origin API calls, not health', () => {
    const origin = 'https://luminarasuite.com';
    expect(shouldAttachAppCheck(`${origin}/api/projects`, origin, origin)).toBe(true);
    expect(shouldAttachAppCheck(`${origin}/api/health`, origin, origin)).toBe(false);
    expect(shouldAttachAppCheck('https://example.com/api/projects', origin, origin)).toBe(false);
    expect(shouldAttachAppCheck(`${origin}/robots.txt`, origin, origin)).toBe(false);
  });
});
