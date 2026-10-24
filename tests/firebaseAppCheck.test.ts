import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseApp } from 'firebase/app';

const init = vi.hoisted(() => vi.fn(() => ({ name: 'app-check' })));
const constructed: string[] = [];

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: init,
  getToken: vi.fn(),
  ReCaptchaEnterpriseProvider: class ReCaptchaEnterpriseProvider {
    readonly siteKey: string;
    constructor(siteKey: string) {
      this.siteKey = siteKey;
      constructed.push(siteKey);
    }
  },
}));

async function loadAppCheck() {
  vi.resetModules();
  return import('../services/auth/firebaseAppCheck');
}

afterEach(() => {
  constructed.length = 0;
  init.mockClear();
  delete (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown }).FIREBASE_APPCHECK_DEBUG_TOKEN;
});

describe('ensureAppCheck', () => {
  it('does nothing when the Enterprise site key is empty', async () => {
    const { ensureAppCheck, isAppCheckConfigured } = await loadAppCheck();
    expect(isAppCheckConfigured({})).toBe(false);
    expect(ensureAppCheck({} as FirebaseApp, {})).toBeNull();
    expect(init).not.toHaveBeenCalled();
    expect(constructed).toEqual([]);
  });

  it('uses ReCaptchaEnterpriseProvider, refreshes tokens, and keeps the debug token', async () => {
    const { ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
    const { ensureAppCheck } = await loadAppCheck();
    const app = { name: 'suite' } as FirebaseApp;
    ensureAppCheck(app, {
      VITE_FIREBASE_APPCHECK_SITE_KEY: 'enterprise-site-key',
      VITE_FIREBASE_APPCHECK_DEBUG_TOKEN: 'true',
    });
    expect(constructed).toEqual(['enterprise-site-key']);
    expect(init).toHaveBeenCalledWith(app, {
      provider: expect.any(ReCaptchaEnterpriseProvider),
      isTokenAutoRefreshEnabled: true,
    });
    expect((globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown }).FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
  });
});
