import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { firebaseAuthTiming, resetFirebaseAuthCache, verifyFirebaseIdToken } from '../worker/firebaseAuth';

async function signedToken(expOffsetSec: number): Promise<{ token: string; jwk: Record<string, unknown> }> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ email: 'a@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject('user-1')
    .setIssuer('https://securetoken.google.com/demo')
    .setAudience('demo')
    .setIssuedAt(now)
    .setExpirationTime(now + expOffsetSec)
    .sign(privateKey);
  return { token, jwk };
}

describe('Firebase token cache', () => {
  afterEach(() => {
    resetFirebaseAuthCache();
    vi.unstubAllGlobals();
  });

  it('verifies a token once and reuses Google keys for Cache-Control max-age', async () => {
    const { token, jwk } = await signedToken(3600);
    let fetches = 0;
    vi.stubGlobal('fetch', async () => {
      fetches += 1;
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { 'cache-control': 'public, max-age=3600' },
      });
    });
    const first = await verifyFirebaseIdToken(token, 'demo');
    const second = await verifyFirebaseIdToken(token, 'demo');
    expect(first.ok && first.user.uid).toBe('user-1');
    expect(second.ok && second.user.uid).toBe('user-1');
    expect(fetches).toBe(1);
    expect(firebaseAuthTiming(second)?.cache).toBe('hit');
  });

  it('fetches Google keys again when Cache-Control max-age is zero', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const now = Math.floor(Date.now() / 1000);
    const sign = (sub: string) => new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject(sub)
      .setIssuer('https://securetoken.google.com/demo')
      .setAudience('demo')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);
    const [firstToken, secondToken] = await Promise.all([sign('user-1'), sign('user-2')]);
    let fetches = 0;
    vi.stubGlobal('fetch', async () => {
      fetches += 1;
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { 'cache-control': 'public, max-age=0' },
      });
    });
    const first = await verifyFirebaseIdToken(firstToken, 'demo');
    const second = await verifyFirebaseIdToken(secondToken, 'demo');
    expect(first.ok && first.user.uid).toBe('user-1');
    expect(second.ok && second.user.uid).toBe('user-2');
    expect(fetches).toBe(2);
  });
});
