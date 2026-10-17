import { describe, expect, it } from 'vitest';
import { assertFirebaseClaims, bearerFromAuthorization } from '../worker/firebaseAuth';

const projectId = 'demo-luminara';

function freshPayload(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    exp: now + 3600,
    iat: now - 10,
    auth_time: now - 10,
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: 'uid-abc',
    email: 'ada@example.com',
    email_verified: true,
    name: 'Ada',
    ...overrides,
  };
}

describe('assertFirebaseClaims', () => {
  it('accepts a valid payload', () => {
    const r = assertFirebaseClaims(freshPayload(), projectId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.uid).toBe('uid-abc');
      expect(r.user.email).toBe('ada@example.com');
    }
  });

  it('rejects wrong audience', () => {
    const r = assertFirebaseClaims(freshPayload({ aud: 'other' }), projectId);
    expect(r.ok).toBe(false);
  });

  it('rejects wrong issuer', () => {
    const r = assertFirebaseClaims(freshPayload({ iss: 'https://evil.example' }), projectId);
    expect(r.ok).toBe(false);
  });

  it('rejects expired tokens', () => {
    const r = assertFirebaseClaims(freshPayload({ exp: Math.floor(Date.now() / 1000) - 10 }), projectId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expired/i);
  });

  it('rejects missing subject', () => {
    const r = assertFirebaseClaims(freshPayload({ sub: '' }), projectId);
    expect(r.ok).toBe(false);
  });
});

describe('bearerFromAuthorization', () => {
  it('parses Bearer tokens', () => {
    expect(bearerFromAuthorization('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerFromAuthorization('bearer xyz')).toBe('xyz');
  });

  it('rejects missing or malformed headers', () => {
    expect(bearerFromAuthorization(null)).toBeNull();
    expect(bearerFromAuthorization('Basic x')).toBeNull();
    expect(bearerFromAuthorization('')).toBeNull();
  });
});

describe('friendlyFirebaseError', () => {
  it('maps Worker and Firebase error codes to actionable user messages', async () => {
    const { friendlyFirebaseError } = await import('../services/auth/firebaseAuthService');

    expect(friendlyFirebaseError({ code: 'AUTH_UNAVAILABLE', message: 'raw' })).toMatch(
      /temporarily unavailable/i,
    );
    expect(friendlyFirebaseError({ code: 'RESET_UNAVAILABLE', message: 'raw' })).toMatch(
      /Password reset is temporarily unavailable/i,
    );
    expect(friendlyFirebaseError({ code: 'NETWORK_ERROR', message: 'raw' })).toMatch(
      /Network error/i,
    );
    expect(friendlyFirebaseError({ code: 'ACCOUNT_RATE_LIMITED', message: 'Account locked for 15m' })).toBe(
      'Account locked for 15m',
    );
    expect(friendlyFirebaseError({ code: 'auth/email-already-in-use', message: 'raw' })).toMatch(
      /Could not create an account with those details/i,
    );
    expect(friendlyFirebaseError({ code: 'auth/invalid-credential', message: 'raw' })).toMatch(
      /Email or password is incorrect/i,
    );
  });
});

