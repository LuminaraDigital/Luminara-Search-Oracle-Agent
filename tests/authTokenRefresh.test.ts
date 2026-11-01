import { describe, expect, it, vi } from 'vitest';
import { handleTokenRefresh } from '../worker/authCredentialGateway';
import type { Env } from '../worker/env';

const env = { FIREBASE_WEB_API_KEY: 'key', WEBAPP_URL: 'https://luminarasuite.com/' } as unknown as Env;

function refreshRequest(body: unknown): Request {
  return new Request('https://luminarasuite.com/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('handleTokenRefresh', () => {
  it('renews the token and sends the referrer a restricted key needs', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id_token: 'new-id', refresh_token: 'new-refresh', expires_in: '3600' })),
    );

    const res = await handleTokenRefresh(refreshRequest({ refreshToken: 'old' }), env, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, idToken: 'new-id', refreshToken: 'new-refresh' });
    const init = fetchImpl.mock.calls[0]?.[1 as never] as unknown as RequestInit;
    expect((init.headers as Record<string, string>).Referer).toBe('https://luminarasuite.com/');
  });

  it('returns 401 when Firebase refuses the refresh token', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'INVALID_REFRESH_TOKEN' } }), { status: 400 }),
    );

    const res = await handleTokenRefresh(refreshRequest({ refreshToken: 'revoked' }), env, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(401);
  });

  it('keeps the session when the API key is the problem', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }),
    );

    const res = await handleTokenRefresh(refreshRequest({ refreshToken: 'old' }), env, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(503);
  });

  it('keeps the session on a provider outage', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));

    const res = await handleTokenRefresh(refreshRequest({ refreshToken: 'old' }), env, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(503);
  });

  it('rejects a missing token before calling Firebase', async () => {
    const fetchImpl = vi.fn();

    const res = await handleTokenRefresh(refreshRequest({}), env, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
