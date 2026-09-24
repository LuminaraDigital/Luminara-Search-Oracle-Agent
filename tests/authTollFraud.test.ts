import { describe, expect, it, vi } from 'vitest';
import {
  enforceBurstLimit,
  enforceDualKeySlidingLimit,
  enforceKvSlidingWindow,
  passwordResetIpLimiter,
  rateLimiter,
  checkOutboundDailyBudget,
  incrementOutboundDaily,
} from '../worker/securityHardening';
import {
  gatePublicAuthMessaging,
  handlePasswordResetRequest,
  handleSendVerification,
  normalizeResetEmail,
  PASSWORD_RESET_SUCCESS_BODY,
  sendPasswordResetOob,
} from '../worker/authTollFraud';
import { handleRequestOtp, handleVerifyOtp, normalizeE164Phone, isOtpSmsEnabled } from '../worker/authOtpSms';
import {
  handleSignIn,
  handleSignUp,
  SIGN_IN_FAILURE_MESSAGE,
  SIGN_UP_FAILURE_MESSAGE,
} from '../worker/authCredentialGateway';
import { clientIp } from '../worker/security';
import { friendlyFirebaseError } from '../services/auth/firebaseAuthService';
import type { Env } from '../worker/env';
import { otpIpLimiter } from '../worker/securityHardening';

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: awaitablePut(store),
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function awaitablePut(store: Map<string, string>) {
  return async (key: string, value: string) => {
    store.set(key, value);
  };
}

function resetReq(email: string): Request {
  return new Request('https://luminarasuite.com/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

describe('normalizeResetEmail', () => {
  it('accepts and lowercases valid emails', () => {
    expect(normalizeResetEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('rejects malformed input', () => {
    expect(normalizeResetEmail('')).toBeNull();
    expect(normalizeResetEmail('not-an-email')).toBeNull();
    expect(normalizeResetEmail(null)).toBeNull();
  });
});

describe('friendlyFirebaseError anti-enumeration', () => {
  it('does not confirm email-already-in-use', () => {
    const msg = friendlyFirebaseError({ code: 'auth/email-already-in-use' });
    expect(msg.toLowerCase()).not.toContain('already has an account');
    expect(msg.toLowerCase()).not.toContain('already in use');
  });

  it('collapses user-not-found with wrong-password', () => {
    expect(friendlyFirebaseError({ code: 'auth/user-not-found' })).toBe(
      friendlyFirebaseError({ code: 'auth/wrong-password' }),
    );
  });
});

describe('sliding window rateLimiter', () => {
  it('blocks after maxRequests within the window', async () => {
    const store = new Map<string, string>();
    const env = { LUMINARA_KV: mockKv(store), REQUIRE_TG_AUTH: 'true' } as Env;
    const limit = rateLimiter({ maxRequests: 3, windowSeconds: 900, keyPrefix: 'rl:test' });

    expect((await limit(env, 'ip:10.0.0.1')).ok).toBe(true);
    expect((await limit(env, 'ip:10.0.0.1')).ok).toBe(true);
    expect((await limit(env, 'ip:10.0.0.1')).ok).toBe(true);
    const blocked = await limit(env, 'ip:10.0.0.1');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.response.status).toBe(429);
      expect(blocked.response.headers.get('Retry-After')).toBeTruthy();
    }
  });

  it('dual-key rejects when either uid or ip bucket is exhausted', async () => {
    const store = new Map<string, string>();
    const env = { LUMINARA_KV: mockKv(store), REQUIRE_TG_AUTH: 'true' } as Env;

    for (let i = 0; i < 2; i++) {
      const ok = await enforceDualKeySlidingLimit(env, {
        action: 'api_key_create',
        uid: 'acct-same',
        ip: `203.0.113.${i}`,
        maxRequests: 2,
        windowSeconds: 3600,
      });
      expect(ok.ok).toBe(true);
    }
    const blocked = await enforceDualKeySlidingLimit(env, {
      action: 'api_key_create',
      uid: 'acct-same',
      ip: '203.0.113.99',
      maxRequests: 2,
      windowSeconds: 3600,
    });
    expect(blocked.ok).toBe(false);
  });
});

describe('burst + outbound killswitch', () => {
  it('fails closed after 5 requests in one second from one IP', () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    for (let i = 0; i < 5; i++) {
      expect(enforceBurstLimit(ip, 5).ok).toBe(true);
    }
    const blocked = enforceBurstLimit(ip, 5);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.response.status).toBe(429);
      expect(blocked.response.headers.get('Retry-After')).toBeTruthy();
    }
  });

  it('halts when daily outbound counter reaches the limit', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      OUTBOUND_EMAIL_DAILY_LIMIT: '2',
    } as Env;
    expect((await checkOutboundDailyBudget(env)).ok).toBe(true);
    await incrementOutboundDaily(env, 1);
    await incrementOutboundDaily(env, 1);
    const blocked = await checkOutboundDailyBudget(env);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.response.status).toBe(503);
  });
});

describe('password reset anti-enumeration', () => {
  it('returns identical success body for existing and missing emails', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      FIREBASE_WEB_API_KEY: 'test-key',
      WEBAPP_URL: 'https://luminarasuite.com/',
      OUTBOUND_EMAIL_DAILY_LIMIT: '50',
    } as Env;

    const fetchExisting = vi.fn(async () => new Response(JSON.stringify({ email: 'a@b.com' }), { status: 200 }));
    const fetchMissing = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'EMAIL_NOT_FOUND' } }), { status: 400 }),
    );

    const ipA = '203.0.113.10';
    const ipB = '203.0.113.11';

    const existing = await handlePasswordResetRequest(resetReq('exists@example.com'), env, ipA, {
      fetchImpl: fetchExisting as unknown as typeof fetch,
      minLatencyMs: 0,
    });
    const missing = await handlePasswordResetRequest(resetReq('missing@example.com'), env, ipB, {
      fetchImpl: fetchMissing as unknown as typeof fetch,
      minLatencyMs: 0,
    });

    expect(existing.status).toBe(200);
    expect(missing.status).toBe(200);
    const bodyA = await existing.json();
    const bodyB = await missing.json();
    expect(bodyA).toEqual(PASSWORD_RESET_SUCCESS_BODY);
    expect(bodyB).toEqual(PASSWORD_RESET_SUCCESS_BODY);
    expect(JSON.stringify(bodyA)).not.toMatch(/not.?found|EMAIL_NOT_FOUND|user-not-found/i);
    expect(JSON.stringify(bodyB)).not.toMatch(/not.?found|EMAIL_NOT_FOUND|user-not-found/i);
  });

  it('blocks the 4th password-reset from one IP before calling the provider', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      FIREBASE_WEB_API_KEY: 'test-key',
      REQUIRE_TG_AUTH: 'true',
      OUTBOUND_EMAIL_DAILY_LIMIT: '50',
    } as Env;
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const ip = '203.0.113.40';

    for (let i = 0; i < 3; i++) {
      const res = await handlePasswordResetRequest(resetReq(`user${i}@example.com`), env, ip, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        minLatencyMs: 0,
      });
      expect(res.status).toBe(200);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const blocked = await handlePasswordResetRequest(resetReq('fourth@example.com'), env, ip, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minLatencyMs: 0,
    });
    expect(blocked.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });

  it('sendPasswordResetOob maps EMAIL_NOT_FOUND to soft miss', async () => {
    const env = { FIREBASE_WEB_API_KEY: 'k' } as Env;
    const result = await sendPasswordResetOob(env, 'nobody@example.com', {
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { message: 'EMAIL_NOT_FOUND' } }), {
          status: 400,
        })) as unknown as typeof fetch,
    });
    expect(result).toEqual({ dispatched: false, reason: 'not_found' });
  });
});

describe('passwordResetIpLimiter preset', () => {
  it('allows three then rejects', async () => {
    const store = new Map<string, string>();
    const env = { LUMINARA_KV: mockKv(store), REQUIRE_TG_AUTH: 'true' } as Env;
    const key = 'ip:203.0.113.77';
    expect((await passwordResetIpLimiter(env, key)).ok).toBe(true);
    expect((await passwordResetIpLimiter(env, key)).ok).toBe(true);
    expect((await passwordResetIpLimiter(env, key)).ok).toBe(true);
    expect((await passwordResetIpLimiter(env, key)).ok).toBe(false);
  });
});

describe('enforceKvSlidingWindow fail-closed', () => {
  it('returns 503 when KV missing and failClosedWithoutKv', async () => {
    const env = { REQUIRE_TG_AUTH: 'false' } as Env;
    const r = await enforceKvSlidingWindow(env, {
      key: 'rl:x:ip:1',
      maxRequests: 1,
      windowSeconds: 60,
      failClosedWithoutKv: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(503);
  });
});

describe('clientIp trust boundary', () => {
  it('uses cf-connecting-ip and ignores spoofable forwarding headers', () => {
    const req = new Request('https://luminarasuite.com/api/auth/reset-password', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '198.51.100.7',
        'x-real-ip': '10.0.0.1',
        'x-forwarded-for': '10.0.0.2',
      },
    });
    expect(clientIp(req)).toBe('198.51.100.7');
  });

  it('collapses to one shared bucket when the edge header is absent', () => {
    // An attacker rotating x-real-ip must not mint a fresh rate-limit bucket.
    const forged = ['10.0.0.1', '10.0.0.2', '10.0.0.3'].map((v) =>
      clientIp(
        new Request('https://luminarasuite.com/api/auth/reset-password', {
          method: 'POST',
          headers: { 'x-real-ip': v },
        }),
      ),
    );
    expect(new Set(forged)).toEqual(new Set(['unknown']));
  });
});

describe('outbound budget killswitch fails closed', () => {
  it('refuses to dispatch in production when the counter store is missing', async () => {
    const env = { ENVIRONMENT: 'production' } as Env;
    const r = await checkOutboundDailyBudget(env);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(503);
      const body = (await r.response.json()) as { code?: string };
      expect(body.code).toBe('OUTBOUND_BUDGET_UNAVAILABLE');
    }
  });

  it('stays permissive outside production so local dev still works', async () => {
    const env = { ENVIRONMENT: 'development' } as Env;
    expect((await checkOutboundDailyBudget(env)).ok).toBe(true);
  });
});

describe('atomic edge backstop on the reset path', () => {
  function limiterAllowing(n: number) {
    let seen = 0;
    return {
      limit: async () => {
        seen += 1;
        return { success: seen <= n };
      },
    };
  }

  it('rejects via the edge binding before the KV window is consumed', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      REQUIRE_TG_AUTH: 'true',
      FIREBASE_WEB_API_KEY: 'k',
      AUTH_MESSAGING_LIMITER: limiterAllowing(0),
    } as unknown as Env;
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));

    const res = await handlePasswordResetRequest(resetReq('a@example.com'), env, '203.0.113.150', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minLatencyMs: 0,
    });

    expect(res.status).toBe(429);
    expect(fetchImpl).not.toHaveBeenCalled();
    // The KV policy window must be untouched: the edge rejected first.
    expect([...store.keys()].some((k) => k.startsWith('rl:pwd_reset:'))).toBe(false);
  });

  it('passes through to the KV window when the edge binding allows', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      REQUIRE_TG_AUTH: 'true',
      AUTH_MESSAGING_LIMITER: limiterAllowing(5),
    } as unknown as Env;

    const gate = await gatePublicAuthMessaging(env, '203.0.113.151');
    expect(gate.ok).toBe(true);
    expect([...store.keys()].some((k) => k.startsWith('rl:pwd_reset:'))).toBe(true);
  });

  it('is a no-op allow when the binding is not deployed', async () => {
    const store = new Map<string, string>();
    const env = { LUMINARA_KV: mockKv(store), REQUIRE_TG_AUTH: 'true' } as Env;
    expect((await gatePublicAuthMessaging(env, '203.0.113.152')).ok).toBe(true);
  });
});

describe('OTP / verification public gates', () => {
  it('request-otp never calls a provider and returns OTP_NOT_ENABLED after gate', async () => {
    const store = new Map<string, string>();
    const env = { LUMINARA_KV: mockKv(store), REQUIRE_TG_AUTH: 'true' } as Env;
    const res = await handleRequestOtp(
      new Request('https://luminarasuite.com/api/auth/request-otp', { method: 'POST' }),
      env,
      '203.0.113.200',
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('OTP_NOT_ENABLED');
    expect([...store.keys()].some((k) => k.startsWith('rl:otp:'))).toBe(true);
  });

  it('otpIpLimiter blocks the 6th request within an hour', async () => {
    const store = new Map<string, string>();
    const env = { LUMINARA_KV: mockKv(store), REQUIRE_TG_AUTH: 'true' } as Env;
    const key = 'ip:203.0.113.201';
    for (let i = 0; i < 5; i++) {
      expect((await otpIpLimiter(env, key)).ok).toBe(true);
    }
    const blocked = await otpIpLimiter(env, key);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.response.status).toBe(429);
  });

  it('send-verification returns neutral success whether Toolkit accepts or rejects', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      FIREBASE_WEB_API_KEY: 'test-key',
      OUTBOUND_EMAIL_DAILY_LIMIT: '50',
      REQUIRE_TG_AUTH: 'true',
    } as Env;

    const okFetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const errFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'INVALID_ID_TOKEN' } }), { status: 400 }),
    );

    const a = await handleSendVerification(
      new Request('https://luminarasuite.com/api/auth/send-verification', { method: 'POST' }),
      env,
      '203.0.113.210',
      'uid-a',
      'token-a',
      { fetchImpl: okFetch as unknown as typeof fetch, minLatencyMs: 0 },
    );
    const b = await handleSendVerification(
      new Request('https://luminarasuite.com/api/auth/send-verification', { method: 'POST' }),
      env,
      '203.0.113.211',
      'uid-b',
      'token-b',
      { fetchImpl: errFetch as unknown as typeof fetch, minLatencyMs: 0 },
    );

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const bodyA = await a.json();
    const bodyB = await b.json();
    expect(bodyA).toEqual(bodyB);
    expect(JSON.stringify(bodyA)).not.toMatch(/INVALID_ID_TOKEN|user-not-found/i);
  });

  it('send-verification dual-key blocks the same uid across rotating IPs', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      FIREBASE_WEB_API_KEY: 'k',
      OUTBOUND_EMAIL_DAILY_LIMIT: '50',
      REQUIRE_TG_AUTH: 'true',
    } as Env;
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));

    for (let i = 0; i < 5; i++) {
      const res = await handleSendVerification(
        new Request('https://luminarasuite.com/api/auth/send-verification', { method: 'POST' }),
        env,
        `198.51.100.${i}`,
        'uid-shared',
        'tok',
        { fetchImpl: fetchImpl as unknown as typeof fetch, minLatencyMs: 0 },
      );
      expect(res.status).toBe(200);
    }
    const blocked = await handleSendVerification(
      new Request('https://luminarasuite.com/api/auth/send-verification', { method: 'POST' }),
      env,
      '198.51.100.99',
      'uid-shared',
      'tok',
      { fetchImpl: fetchImpl as unknown as typeof fetch, minLatencyMs: 0 },
    );
    expect(blocked.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});

describe('password reset latency floor', () => {
  it('pads both exists and missing paths to a comparable minimum latency', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      FIREBASE_WEB_API_KEY: 'test-key',
      OUTBOUND_EMAIL_DAILY_LIMIT: '50',
    } as Env;

    const fastOk = vi.fn(async () => new Response('{}', { status: 200 }));
    const fastMiss = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'EMAIL_NOT_FOUND' } }), { status: 400 }),
    );

    const floorMs = 50;
    const t0 = Date.now();
    await handlePasswordResetRequest(resetReq('exists@example.com'), env, '203.0.113.60', {
      fetchImpl: fastOk as unknown as typeof fetch,
      minLatencyMs: floorMs,
    });
    const elapsedOk = Date.now() - t0;

    const t1 = Date.now();
    await handlePasswordResetRequest(resetReq('missing@example.com'), env, '203.0.113.61', {
      fetchImpl: fastMiss as unknown as typeof fetch,
      minLatencyMs: floorMs,
    });
    const elapsedMiss = Date.now() - t1;

    expect(elapsedOk).toBeGreaterThanOrEqual(floorMs - 5);
    expect(elapsedMiss).toBeGreaterThanOrEqual(floorMs - 5);
    // Side-channel budget: paths should not diverge by more than ~floorMs under mock network.
    expect(Math.abs(elapsedOk - elapsedMiss)).toBeLessThan(floorMs + 40);
  });
});

describe('Worker-mediated sign-up / sign-in', () => {
  function credReq(email: string, password: string): Request {
    return new Request('https://luminarasuite.com/api/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  }

  it('sign-in collapses EMAIL_NOT_FOUND and INVALID_PASSWORD to the same body', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      FIREBASE_WEB_API_KEY: 'k',
      REQUIRE_TG_AUTH: 'true',
    } as Env;

    const notFound = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'EMAIL_NOT_FOUND' } }), { status: 400 }),
    );
    const badPass = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'INVALID_PASSWORD' } }), { status: 400 }),
    );

    const a = await handleSignIn(credReq('a@example.com', 'password1'), env, '203.0.113.70', {
      fetchImpl: notFound as unknown as typeof fetch,
      minLatencyMs: 0,
    });
    const b = await handleSignIn(credReq('b@example.com', 'password1'), env, '203.0.113.71', {
      fetchImpl: badPass as unknown as typeof fetch,
      minLatencyMs: 0,
    });

    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    const bodyA = await a.json();
    const bodyB = await b.json();
    expect(bodyA).toEqual(bodyB);
    expect(bodyA).toEqual({ ok: false, error: SIGN_IN_FAILURE_MESSAGE, code: 'SIGN_IN_FAILED' });
  });

  it('sign-up maps EMAIL_EXISTS to anti-enumeration failure (not a confirming error)', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      FIREBASE_WEB_API_KEY: 'k',
      REQUIRE_TG_AUTH: 'true',
    } as Env;
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'EMAIL_EXISTS' } }), { status: 400 }),
    );
    const res = await handleSignUp(credReq('taken@example.com', 'password1'), env, '203.0.113.72', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minLatencyMs: 0,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body.error).toBe(SIGN_UP_FAILURE_MESSAGE);
    expect(body.code).toBe('SIGN_UP_FAILED');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('already');
    expect(JSON.stringify(body)).not.toMatch(/EMAIL_EXISTS/i);
  });

  it('sign-in succeeds and returns tokens when Toolkit accepts', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      FIREBASE_WEB_API_KEY: 'k',
      REQUIRE_TG_AUTH: 'true',
    } as Env;
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            idToken: 'id',
            refreshToken: 'rt',
            localId: 'uid1',
            email: 'ok@example.com',
            expiresIn: '3600',
          }),
          { status: 200 },
        ),
    );
    const res = await handleSignIn(credReq('ok@example.com', 'password1'), env, '203.0.113.73', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minLatencyMs: 0,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; idToken?: string; localId?: string };
    expect(body.ok).toBe(true);
    expect(body.idToken).toBe('id');
    expect(body.localId).toBe('uid1');
  });

  it('blocks the 6th sign-up from one IP within an hour before Toolkit', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      FIREBASE_WEB_API_KEY: 'k',
      REQUIRE_TG_AUTH: 'true',
    } as Env;
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            idToken: 'id',
            refreshToken: 'rt',
            localId: 'u',
            email: 'n@example.com',
            expiresIn: '3600',
          }),
          { status: 200 },
        ),
    );
    // Distinct IPs for burst isolation; shared KV key is forced via same logical IP bucket
    // by calling signUpIpLimiter through the handler with one IP spaced by the burst window.
    // Prefer direct limiter assertion for the policy window, plus one handler check.
    const { signUpIpLimiter } = await import('../worker/securityHardening');
    const key = 'ip:203.0.113.74';
    for (let i = 0; i < 5; i++) {
      expect((await signUpIpLimiter(env, key)).ok).toBe(true);
    }
    expect((await signUpIpLimiter(env, key)).ok).toBe(false);

    // Handler also rejects when the sliding bucket is already exhausted.
    const blocked = await handleSignUp(credReq('last@example.com', 'password1'), env, '203.0.113.74', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minLatencyMs: 0,
    });
    expect(blocked.status).toBe(429);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('SMS OTP when enabled', () => {
  it('normalizeE164Phone accepts E.164 and rejects junk', () => {
    expect(normalizeE164Phone('+15551234567')).toBe('+15551234567');
    expect(normalizeE164Phone('555')).toBeNull();
  });

  it('isOtpSmsEnabled requires flag and Twilio trio', () => {
    expect(isOtpSmsEnabled({} as Env)).toBe(false);
    expect(
      isOtpSmsEnabled({
        OTP_SMS_ENABLED: 'true',
        TWILIO_ACCOUNT_SID: 'ACxxx',
        TWILIO_AUTH_TOKEN: 'tok',
        TWILIO_FROM_NUMBER: '+15550001111',
      } as Env),
    ).toBe(true);
  });

  it('sends SMS when enabled and verify accepts the code', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: mockKv(store),
      REQUIRE_TG_AUTH: 'true',
      OTP_SMS_ENABLED: 'true',
      TWILIO_ACCOUNT_SID: 'ACxxx',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_FROM_NUMBER: '+15550001111',
      OUTBOUND_EMAIL_DAILY_LIMIT: '50',
    } as Env;

    let capturedBody = '';
    const twilioFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body || '');
      return new Response('{"sid":"SM1"}', { status: 201 });
    });

    const req = new Request('https://luminarasuite.com/api/auth/request-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+15551234567' }),
    });
    const sent = await handleRequestOtp(req, env, '203.0.113.80', {
      fetchImpl: twilioFetch as unknown as typeof fetch,
      minLatencyMs: 0,
    });
    expect(sent.status).toBe(200);
    expect(twilioFetch).toHaveBeenCalled();
    const params = new URLSearchParams(capturedBody);
    const smsText = params.get('Body') || '';
    const codeMatch = smsText.match(/verification code is (\d{6})/);
    expect(codeMatch).toBeTruthy();
    const code = codeMatch![1]!;

    const verify = await handleVerifyOtp(
      new Request('https://luminarasuite.com/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '+15551234567', code }),
      }),
      env,
      '203.0.113.80',
      { minLatencyMs: 0 },
    );
    expect(verify.status).toBe(200);
    const body = (await verify.json()) as { ok?: boolean; verified?: boolean };
    expect(body.ok).toBe(true);
    expect(body.verified).toBe(true);
  });
});
