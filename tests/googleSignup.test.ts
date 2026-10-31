/**
 * Google is one button on both tabs of the auth panel, so who counts as a signup comes from
 * Firebase's new-user flag, not from the tab.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({ isNewUser: false }));

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  getApps: () => [{ name: '[DEFAULT]' }],
}));

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: vi.fn(),
  getToken: vi.fn(async () => ({ token: '' })),
  ReCaptchaEnterpriseProvider: class ReCaptchaEnterpriseProvider {},
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: null, authStateReady: async () => {} }),
  getAdditionalUserInfo: () => ({ isNewUser: firebase.isNewUser }),
  onIdTokenChanged: () => () => {},
  setPersistence: vi.fn(async () => {}),
  browserLocalPersistence: {},
  browserSessionPersistence: {},
  signOut: vi.fn(),
  GoogleAuthProvider: class GoogleAuthProvider {
    setCustomParameters() {}
  },
  signInWithPopup: vi.fn(async () => ({
    user: { uid: 'u1', getIdToken: async () => 'token-u1' },
  })),
}));

describe('signInWithGoogle', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  });

  it.each([true, false])('passes on Firebase new-user flag %s', async (isNewUser) => {
    firebase.isNewUser = isNewUser;
    const { signInWithGoogle } = await import('../services/auth/firebaseAuthService');
    const result = await signInWithGoogle();
    expect(result).toEqual({ user: expect.objectContaining({ uid: 'u1' }), isNewUser });
  });
});
