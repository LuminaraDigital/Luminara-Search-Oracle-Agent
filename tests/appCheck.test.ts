import { describe, expect, it } from 'vitest';
import {
  assertAppCheckClaims,
  extractAppCheckToken,
  isAppCheckRequired,
  resolveFirebaseProjectNumber,
} from '../worker/appCheck';
import type { Env } from '../worker/env';

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
      'luminara-suite',
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.appId).toContain('274315225068');
  });

  it('assertAppCheckClaims also accepts projects/{projectId} audience', () => {
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
      'luminara-suite',
    );
    expect(ok.ok).toBe(true);
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
        'luminara-suite',
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
