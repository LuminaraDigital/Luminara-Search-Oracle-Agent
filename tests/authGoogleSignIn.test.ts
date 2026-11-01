import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGoogleSignIn } from '../worker/authCredentialGateway';
import type { Env } from '../worker/env';

const env = {
  FIREBASE_WEB_API_KEY: 'key',
  WEBAPP_URL: 'https://www.luminarasuite.com/',
  LUMINARA_KV: { get: async () => null, put: async () => undefined },
} as unknown as Env;
let ipCounter = 0;
let ip = '';

function googleRequest(body: unknown): Request {
  return new Request('https://www.luminarasuite.com/api/auth/google', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function asFetch(impl: ReturnType<typeof vi.fn>): typeof fetch {
  return impl as unknown as typeof fetch;
}

describe('handleGoogleSignIn', () => {
  beforeEach(() => {
    ipCounter += 1;
    ip = `203.0.113.${ipCounter}`;
  });

  it('exchanges the Google token for a Firebase session', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ idToken: 'fb', refreshToken: 'r', localId: 'u1', email: 'a@b.co' })),
    );

    const res = await handleGoogleSignIn(googleRequest({ googleIdToken: 'g.t' }), env, ip, {
      fetchImpl: asFetch(fetchImpl),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, idToken: 'fb', refreshToken: 'r', localId: 'u1' });
    const init = fetchImpl.mock.calls[0]?.[1 as never] as unknown as RequestInit;
    const sent = JSON.parse(String(init.body)) as { postBody: string };
    expect(new URLSearchParams(sent.postBody).get('id_token')).toBe('g.t');
    expect(new URLSearchParams(sent.postBody).get('providerId')).toBe('google.com');
  });

  it('returns 401 when Firebase rejects the token', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'INVALID_IDP_RESPONSE' } }), { status: 400 }),
    );

    const res = await handleGoogleSignIn(googleRequest({ googleIdToken: 'forged' }), env, ip, {
      fetchImpl: asFetch(fetchImpl),
    });

    expect(res.status).toBe(401);
  });

  it('returns 503 when the provider is misconfigured, not a token error', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'OPERATION_NOT_ALLOWED' } }), { status: 400 }),
    );

    const res = await handleGoogleSignIn(googleRequest({ googleIdToken: 'g.t' }), env, ip, {
      fetchImpl: asFetch(fetchImpl),
    });

    expect(res.status).toBe(503);
  });

  it('explains when the email already has a password account', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ needConfirmation: true })));

    const res = await handleGoogleSignIn(googleRequest({ googleIdToken: 'g.t' }), env, ip, {
      fetchImpl: asFetch(fetchImpl),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'GOOGLE_ACCOUNT_EXISTS' });
  });

  it('refuses an empty body without calling Firebase', async () => {
    const fetchImpl = vi.fn();

    const res = await handleGoogleSignIn(googleRequest({}), env, ip, { fetchImpl: asFetch(fetchImpl) });

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
