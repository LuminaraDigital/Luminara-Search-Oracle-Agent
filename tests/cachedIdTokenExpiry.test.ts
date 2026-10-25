import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ getFirebaseIdToken: vi.fn<(forceRefresh?: boolean) => Promise<string | null>>() }));

vi.mock('../services/auth/firebaseAuthService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/auth/firebaseAuthService')>()),
  getFirebaseIdToken: (forceRefresh?: boolean) => sdk.getFirebaseIdToken(forceRefresh),
}));

import { clientHasHostedIdentity, getApiAuthHeaders, workerFetchWithAuthRetry } from '../services/apiClient';
import { writeCachedFirebaseIdToken } from '../services/auth/firebaseIdToken';
import { createTonInvoice } from '../services/ton/tonService';

/** An unsigned JWT-shaped token whose payload expires `secondsLeft` from now. */
function idToken(secondsLeft: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsLeft })).toString('base64url');
  return `e30.${payload}.sig`;
}

function captureFetch(): Array<Headers> {
  const seen: Array<Headers> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return seen;
}

describe('a cached Firebase ID token near expiry', () => {
  afterEach(() => {
    writeCachedFirebaseIdToken(null);
    sdk.getFirebaseIdToken.mockReset();
    vi.unstubAllGlobals();
  });

  it('is left out of sync Worker headers so the session cookie answers', async () => {
    vi.stubGlobal('window', { location: { protocol: 'https:', origin: 'https://luminarasuite.com', href: 'https://luminarasuite.com/', search: '' } });
    const seen = captureFetch();

    writeCachedFirebaseIdToken(idToken(-30));
    expect(getApiAuthHeaders().Authorization).toBeUndefined();
    // Still signed in: only the header drops the token, so sign-out still clears the cookie.
    expect(clientHasHostedIdentity()).toBe(true);
    await createTonInvoice('growth');
    expect(seen[0].get('authorization')).toBeNull();

    writeCachedFirebaseIdToken(idToken(30));
    expect(getApiAuthHeaders().Authorization).toBeUndefined();

    const live = idToken(3600);
    writeCachedFirebaseIdToken(live);
    expect(getApiAuthHeaders().Authorization).toBe(`Bearer ${live}`);
    await createTonInvoice('growth');
    expect(seen[1].get('authorization')).toBe(`Bearer ${live}`);
  });

  it('is refreshed through the SDK on the async path', async () => {
    const seen = captureFetch();
    const refreshed = idToken(3600);
    sdk.getFirebaseIdToken.mockResolvedValue(refreshed);
    writeCachedFirebaseIdToken(idToken(-30));

    const res = await workerFetchWithAuthRetry('https://luminarasuite.com/api/workspace');

    expect(res.status).toBe(200);
    expect(sdk.getFirebaseIdToken).toHaveBeenCalledWith(false);
    expect(seen[0].get('authorization')).toBe(`Bearer ${refreshed}`);
  });
});
