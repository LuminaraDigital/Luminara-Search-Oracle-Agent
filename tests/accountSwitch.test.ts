/**
 * Sign-out and account switch: nothing from the previous Firebase user survives into the next
 * session (quota snapshot, boot request, ID token).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuotaInfo } from '../services/apiClient';

type FakeUser = { uid: string; getIdToken: () => Promise<string> };

const firebase = vi.hoisted(() => ({
  onIdToken: null as null | ((user: FakeUser | null) => void),
  currentUser: null as FakeUser | null,
}));

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
  getAuth: () => ({
    get currentUser() {
      return firebase.currentUser;
    },
    authStateReady: async () => {},
  }),
  onIdTokenChanged: (_auth: unknown, listener: (user: FakeUser | null) => void) => {
    firebase.onIdToken = listener;
    return () => {};
  },
  signOut: vi.fn(),
  GoogleAuthProvider: class GoogleAuthProvider {},
  signInWithPopup: vi.fn(),
}));

const LIMITED = new Headers({ 'x-quota-limit': '3', 'x-quota-remaining': '1', 'x-quota-reset': '600' });
const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }));

function user(uid: string): FakeUser {
  return { uid, getIdToken: async () => `token-${uid}` };
}

function deferredToken(): { promise: Promise<string>; resolve: (token: string) => void } {
  let resolve: (token: string) => void = () => {};
  const promise = new Promise<string>((done) => { resolve = done; });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function bootRequests(): string[] {
  return fetchMock.mock.calls
    .map((call) => call as unknown as [RequestInfo | URL, RequestInit | undefined])
    .filter(([url]) => String(url).endsWith('/api/boot'))
    .map(([, init]) => new Headers(init?.headers).get('authorization') || '');
}

async function load() {
  const api = await import('../services/apiClient');
  const auth = await import('../services/auth/firebaseAuthService');
  const users: Array<FakeUser | null> = [];
  auth.subscribeFirebaseUser((u) => users.push(u as FakeUser | null));
  return { api, auth, users, emit: (u: FakeUser | null) => firebase.onIdToken!(u) };
}

beforeEach(() => {
  vi.resetModules();
  firebase.onIdToken = null;
  firebase.currentUser = null;
  fetchMock.mockClear();
  vi.stubGlobal('window', { location: { origin: 'https://luminarasuite.com' } });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account switch', () => {
  it('signing out clears the quota snapshot and tells its subscribers', async () => {
    const { api, emit } = await load();
    emit(user('A'));
    await flush();
    expect(bootRequests()).toEqual(['Bearer token-A']);
    api.updateQuotaFromHeaders(LIMITED);
    const seen: Array<QuotaInfo | null> = [];
    api.subscribeQuota((q) => seen.push(q));

    emit(null);

    expect(api.getCurrentQuotaSync()).toBeNull();
    expect(seen.map((q) => q?.remaining ?? null)).toEqual([1, null]);
  });

  it('a second account starts with no quota snapshot, before its token arrives', async () => {
    const { api, emit } = await load();
    emit(user('A'));
    await flush();
    api.updateQuotaFromHeaders(LIMITED);
    expect(api.getCurrentQuotaSync()?.remaining).toBe(1);

    emit({ uid: 'B', getIdToken: () => new Promise<string>(() => {}) });

    expect(api.getCurrentQuotaSync()).toBeNull();
  });

  it('a token that resolves after sign-out is dropped and starts no boot', async () => {
    const { auth, users, emit } = await load();
    const tokenA = deferredToken();
    emit({ uid: 'A', getIdToken: () => tokenA.promise });
    emit(null);
    tokenA.resolve('token-A');
    await flush();

    expect(auth.getFirebaseIdTokenSync()).toBeNull();
    expect(users.at(-1)).toBeNull();
    expect(bootRequests()).toEqual([]);
  });

  it('getFirebaseIdToken drops a token minted for a user who has since switched', async () => {
    const { auth, emit } = await load();
    const tokenA = deferredToken();
    firebase.currentUser = { uid: 'A', getIdToken: () => tokenA.promise };
    const pending = auth.getFirebaseIdToken(true);
    firebase.currentUser = user('B');
    emit(firebase.currentUser);
    await flush();
    tokenA.resolve('token-A');

    await expect(pending).resolves.toBeNull();
    expect(auth.getFirebaseIdTokenSync()).toBe('token-B');
  });
});
