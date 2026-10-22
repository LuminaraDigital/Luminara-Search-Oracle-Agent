/**
 * Browser Firebase Auth (email/password + Google).
 * Email/password goes through the Worker (IP-throttled Identity Toolkit) then
 * hydrates the client SDK. Google still uses the popup SDK path.
 * Optional App Check (reCAPTCHA v3) attaches when VITE_FIREBASE_APPCHECK_SITE_KEY is set.
 */
import { initializeApp, type FirebaseApp, getApps } from 'firebase/app';
import * as firebaseAuthSdk from 'firebase/auth';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onIdTokenChanged,
  GoogleAuthProvider,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth';
import { resolveFirebaseWebConfig } from './firebasePublicConfig';
import {
  clearPersistedAuthSession,
  markPersistedAuthSession,
  readCachedFirebaseIdToken,
  writeCachedFirebaseIdToken,
} from './firebaseIdToken';
import { ensureAppCheck, getAppCheckTokenForBackend, isAppCheckConfigured } from './firebaseAppCheck';

export type { User };
export { isAppCheckConfigured };

/** True when VITE_FIREBASE_* is present (signup/signin UI can show). */
export function isFirebaseConfigured(): boolean {
  return readConfig() !== null;
}

export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let cachedUser: User | null = null;
let initAttempted = false;
const userListeners = new Set<(user: User | null) => void>();

function notifyUserListeners(user: User | null): void {
  for (const fn of userListeners) {
    try { fn(user); } catch { /* ignore listener errors */ }
  }
}

function readConfig(): FirebasePublicConfig | null {
  return resolveFirebaseWebConfig((import.meta as any).env || {});
}

function ensureAuth(): Auth {
  if (auth) return auth;
  const cfg = readConfig();
  if (!cfg) throw new Error('Firebase is not configured. Add VITE_FIREBASE_* to your .env.');
  app = getApps().length ? getApps()[0]! : initializeApp(cfg);
  ensureAppCheck(app);
  auth = getAuth(app);
  return auth;
}

let lastSyncedToken: string | null = null;
let inFlightSync: Promise<void> | null = null;

async function syncSessionCookie(token: string): Promise<void> {
  if (typeof window === 'undefined' || !window.location) return;
  const base = window.location.origin || '';
  if (!base) return;
  if (lastSyncedToken === token && inFlightSync) {
    await inFlightSync;
    return;
  }
  if (lastSyncedToken === token) return;
  lastSyncedToken = token;
  const p = (async () => {
    try {
      await fetch(`${base}/api/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ idToken: token }),
      });
    } catch {
      lastSyncedToken = null;
      /* ignore session cookie sync failures in offline/dev */
    }
  })();
  inFlightSync = p;
  await p;
  if (inFlightSync === p) inFlightSync = null;
}

let inFlightClear: Promise<void> | null = null;

async function clearSessionCookie(): Promise<void> {
  lastSyncedToken = null;
  if (typeof window === 'undefined' || !window.location) return;
  const base = window.location.origin || '';
  if (!base) return;
  if (inFlightClear) {
    await inFlightClear;
    return;
  }
  const p = (async () => {
    try {
      await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch {
      /* ignore logout cookie clearing errors */
    }
  })();
  inFlightClear = p;
  await p;
  if (inFlightClear === p) inFlightClear = null;
}

async function refreshCachedToken(user: User | null): Promise<void> {
  const previous = cachedUser;
  cachedUser = user;
  if (!user) {
    if (previous) clearPersistedAuthSession();
    const hadSession = readCachedFirebaseIdToken() !== null || lastSyncedToken !== null;
    writeCachedFirebaseIdToken(null);
    notifyUserListeners(null);
    if (hadSession) {
      await clearSessionCookie();
    }
    return;
  }
  markPersistedAuthSession();
  try {
    const nextToken = await user.getIdToken();
    writeCachedFirebaseIdToken(nextToken);
    if (nextToken) await syncSessionCookie(nextToken);
  } catch {
    writeCachedFirebaseIdToken(null);
  }
  notifyUserListeners(user);
}

/**
 * Starts listening for auth / ID-token changes and keeps a sync cache for apiClient.
 * Uses onIdTokenChanged so refreshed tokens (hourly) stay current for Worker calls.
 * Safe to call once from the app shell or AuthPanel.
 */
export function startFirebaseAuthListener(): () => void {
  if (!isFirebaseConfigured()) return () => {};
  if (initAttempted && auth) {
    return () => {};
  }
  initAttempted = true;
  const a = ensureAuth();
  return onIdTokenChanged(a, (u) => { void refreshCachedToken(u); });
}

/** Subscribe to Firebase user changes (also receives the current cached user immediately). */
export function subscribeFirebaseUser(fn: (user: User | null) => void): () => void {
  userListeners.add(fn);
  fn(cachedUser);
  startFirebaseAuthListener();
  return () => { userListeners.delete(fn); };
}

/** Sync snapshot used by Worker proxy headers (refreshed by the auth listener). */
export function getFirebaseIdTokenSync(): string | null {
  return readCachedFirebaseIdToken();
}

export function getFirebaseUserSync(): User | null {
  return cachedUser;
}

/** Fresh token (forces refresh when forceRefresh is true). */
export async function getFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  const a = ensureAuth();
  const user = a.currentUser;
  if (!user) {
    writeCachedFirebaseIdToken(null);
    cachedUser = null;
    return null;
  }
  const token = await user.getIdToken(forceRefresh);
  writeCachedFirebaseIdToken(token);
  cachedUser = user;
  return token;
}

type AuthWithReady = Auth & { authStateReady?: () => Promise<void> };

/** Wait until persisted auth has settled, without clearing a token that arrives late. */
async function waitForAuthUser(a: Auth): Promise<User | null> {
  const ready = (a as AuthWithReady).authStateReady;
  if (typeof ready === 'function') {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 8_000);
      Promise.resolve()
        .then(() => ready.call(a))
        .then(() => {
          clearTimeout(timer);
          resolve();
        }, () => {
          clearTimeout(timer);
          resolve();
        });
    });
  }
  return a.currentUser;
}

/**
 * Resolves with the current authenticated user after persisted auth has settled.
 */
export async function whenFirebaseAuthReady(): Promise<User | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const a = ensureAuth();
    return await waitForAuthUser(a);
  } catch {
    return null;
  }
}

/**
 * Ensure the sync ID-token cache is filled when Firebase already has a session.
 * Hosted key checks read that cache synchronously; quota and crawler routes await a token.
 */
export async function ensureFirebaseIdTokenCached(): Promise<string | null> {
  const cached = getFirebaseIdTokenSync();
  if (cached) return cached;
  if (!isFirebaseConfigured()) return null;
  try {
    const a = ensureAuth();
    const user = await waitForAuthUser(a);
    if (!user) return getFirebaseIdTokenSync();
    return await getFirebaseIdToken(false);
  } catch {
    return getFirebaseIdTokenSync();
  }
}

type WorkerCredentialOk = {
  ok: true;
  idToken: string;
  refreshToken: string;
  localId: string;
  email: string;
  expiresIn: string;
};

type WorkerCredentialErr = {
  ok: false;
  status: number;
  error: string;
  code: string;
};

async function workerCredential(
  path: '/api/auth/sign-up' | '/api/auth/sign-in',
  email: string,
  password: string,
): Promise<WorkerCredentialOk | WorkerCredentialErr> {
  if (typeof window === 'undefined' || !window.location) {
    return { ok: false, status: 500, error: 'Auth requires a browser context.', code: 'NO_BROWSER' };
  }
  ensureAuth();
  const appCheckToken = await getAppCheckTokenForBackend();
  let res: Response;
  try {
    res = await fetch(`${window.location.origin}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        email: email.trim(),
        password,
        ...(appCheckToken ? { appCheckToken } : {}),
      }),
    });
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'Authentication service is unreachable. Check your connection and try again.',
      code: 'NETWORK_ERROR',
    };
  }
  let body: {
    ok?: boolean;
    idToken?: string;
    refreshToken?: string;
    localId?: string;
    email?: string;
    expiresIn?: string;
    error?: string;
    code?: string;
  } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    body = {};
  }
  if (!res.ok || !body.idToken || !body.refreshToken || !body.localId) {
    return {
      ok: false,
      status: res.status,
      error: body.error || 'Authentication failed.',
      code: body.code || 'AUTH_FAILED',
    };
  }
  return {
    ok: true,
    idToken: body.idToken,
    refreshToken: body.refreshToken,
    localId: body.localId,
    email: body.email || email.trim(),
    expiresIn: body.expiresIn || '3600',
  };
}

export const MIN_PASSWORD_LENGTH = 8;

async function applyAuthPersistence(keepSignedIn = false): Promise<void> {
  try {
    const a = ensureAuth();
    const setPersistenceFn = (firebaseAuthSdk as { setPersistence?: (auth: Auth, p: unknown) => Promise<void> })
      .setPersistence;
    const persistence = keepSignedIn
      ? (firebaseAuthSdk as { browserLocalPersistence?: unknown }).browserLocalPersistence
      : (firebaseAuthSdk as { browserSessionPersistence?: unknown }).browserSessionPersistence;
    if (typeof setPersistenceFn === 'function' && persistence) {
      await setPersistenceFn(a, persistence);
    }
  } catch {
    /* ignore persistence errors in restricted storage or test mocks */
  }
}

/**
 * Hydrate the Firebase client SDK after a successful Worker-mediated auth.
 * Reuses the same credentials once so onIdTokenChanged / persistence keep working.
 * App Check (when enforced) still protects direct Toolkit calls that skip the Worker.
 */
async function hydrateClientSession(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(ensureAuth(), email.trim(), password);
  await refreshCachedToken(cred.user);
  return cred.user;
}

function throwWorkerAuthError(err: WorkerCredentialErr): never {
  const code =
    err.code === 'ACCOUNT_RATE_LIMITED'
      ? 'ACCOUNT_RATE_LIMITED'
      : err.status === 429
        ? 'auth/too-many-requests'
        : err.code === 'APP_CHECK_REQUIRED' || err.code === 'APP_CHECK_INVALID'
          ? 'auth/app-check-required'
          : err.code === 'INVALID_EMAIL'
            ? 'auth/invalid-email'
            : err.code === 'WEAK_PASSWORD'
              ? 'auth/weak-password'
              : err.code === 'AUTH_UNAVAILABLE'
                ? 'AUTH_UNAVAILABLE'
                : err.code === 'NETWORK_ERROR'
                  ? 'NETWORK_ERROR'
                  : err.code === 'SIGN_UP_FAILED'
                    ? 'auth/email-already-in-use'
                    : err.code === 'SIGN_IN_FAILED'
                      ? 'auth/invalid-credential'
                      : 'auth/credential-gateway';
  throw Object.assign(new Error(err.error), { code });
}

function shouldFallbackToBrowserSdk(err: WorkerCredentialErr): boolean {
  if (err.status === 429) return false;
  if (err.code === 'APP_CHECK_REQUIRED' || err.code === 'APP_CHECK_INVALID') return false;
  if (err.code === 'INVALID_EMAIL' || err.code === 'WEAK_PASSWORD') return false;
  return err.status >= 500 || err.code === 'AUTH_UNAVAILABLE' || err.code === 'NETWORK_ERROR';
}

/**
 * Sign up via Worker (rate-limited Identity Toolkit), then hydrate the client SDK.
 * Falls back to the browser Firebase SDK only when the Worker gateway is unreachable or returns
 * 503 AUTH_UNAVAILABLE (e.g. local dev without Worker or upstream API key restriction).
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  opts?: { keepSignedIn?: boolean },
): Promise<User> {
  await applyAuthPersistence(opts?.keepSignedIn ?? false);
  const gated = await workerCredential('/api/auth/sign-up', email, password);
  if (!gated.ok) {
    if (!shouldFallbackToBrowserSdk(gated)) {
      throwWorkerAuthError(gated);
    }
    const createFn = (
      firebaseAuthSdk as {
        createUserWithEmailAndPassword?: (auth: Auth, email: string, password: string) => Promise<{ user: User }>;
      }
    ).createUserWithEmailAndPassword;
    if (typeof createFn === 'function') {
      const cred = await createFn(ensureAuth(), email.trim(), password);
      await refreshCachedToken(cred.user);
      return cred.user;
    }
    throwWorkerAuthError(gated);
  }
  try {
    return await hydrateClientSession(email, password);
  } catch {
    // Worker already created the account; hydrate may race. Retry sign-in once.
    return hydrateClientSession(email, password);
  }
}

/**
 * Sign in via Worker (rate-limited Identity Toolkit), then hydrate the client SDK.
 */
export async function signInWithEmail(
  email: string,
  password: string,
  opts?: { keepSignedIn?: boolean },
): Promise<User> {
  await applyAuthPersistence(opts?.keepSignedIn ?? false);
  const gated = await workerCredential('/api/auth/sign-in', email, password);
  if (!gated.ok) {
    if (!shouldFallbackToBrowserSdk(gated)) {
      throwWorkerAuthError(gated);
    }
    return hydrateClientSession(email, password);
  }
  return hydrateClientSession(email, password);
}

export async function signInWithGoogle(opts?: { keepSignedIn?: boolean }): Promise<User> {
  await applyAuthPersistence(opts?.keepSignedIn ?? false);
  ensureAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(ensureAuth(), provider);
  await refreshCachedToken(cred.user);
  return cred.user;
}

/**
 * Requests a password-reset email via the Worker (IP-throttled, anti-enumeration).
 * Always resolves on HTTP 200 with a neutral message; never reveals whether the
 * email exists. Throws only on network / hard server failures (429, 5xx, invalid).
 */
export async function resetPasswordWithEmail(email: string): Promise<{ success: true; message: string }> {
  const trimmed = email.trim();
  if (!trimmed) {
    throw Object.assign(new Error('Enter your email to reset your password.'), { code: 'auth/missing-email' });
  }
  if (typeof window === 'undefined' || !window.location) {
    throw new Error('Password reset requires a browser context.');
  }
  ensureAuth();
  const appCheckToken = await getAppCheckTokenForBackend();
  const base = window.location.origin || '';
  const res = await fetch(`${base}/api/auth/reset-password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
    },
    credentials: 'same-origin',
    body: JSON.stringify({
      email: trimmed,
      ...(appCheckToken ? { appCheckToken } : {}),
    }),
  });
  let body: { success?: boolean; message?: string; error?: string; code?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    body = {};
  }
  if (res.status === 401 && (body.code === 'APP_CHECK_REQUIRED' || body.code === 'APP_CHECK_INVALID')) {
    throw Object.assign(
      new Error(
        body.error ||
          (isAppCheckConfigured()
            ? 'App Check token rejected. Refresh and try again.'
            : 'App Check is required. Rebuild with VITE_FIREBASE_APPCHECK_SITE_KEY.'),
      ),
      { code: 'auth/app-check-required' },
    );
  }
  if (res.status === 429) {
    throw Object.assign(new Error(body.error || 'Too many reset attempts. Wait and try again.'), {
      code: 'auth/too-many-requests',
    });
  }
  if (res.status === 400) {
    throw Object.assign(new Error(body.error || 'Enter a valid email address.'), {
      code: 'auth/invalid-email',
    });
  }
  if (!res.ok) {
    throw Object.assign(
      new Error(body.error || 'Password reset is temporarily unavailable. Try again later.'),
      { code: body.code || 'auth/reset-unavailable' },
    );
  }
  return {
    success: true,
    message:
      body.message ||
      'If an account exists with this email address, a password reset link has been dispatched.',
  };
}

export async function signOutFirebase(): Promise<void> {
  clearPersistedAuthSession();
  if (!isFirebaseConfigured()) return;
  await signOut(ensureAuth());
  await refreshCachedToken(null);
}

/** Maps Firebase Auth error codes to short user-facing copy (no account-existence leaks). */
export function friendlyFirebaseError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/email-already-in-use':
    case 'auth/credential-gateway':
      // Anti-enumeration: do not confirm the email is registered.
      return 'Could not create an account with those details. Try signing in or reset your password.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/weak-password':
      return `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email or password is incorrect.';
    case 'ACCOUNT_RATE_LIMITED':
      return (err as Error)?.message || 'Too many failed sign-in attempts. This account is temporarily locked.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was cancelled.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is disabled in the Firebase console.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase Authentication settings.';
    case 'auth/missing-email':
      return 'Enter your email to reset your password.';
    case 'AUTH_UNAVAILABLE':
      return 'Authentication is temporarily unavailable. Wait a moment and try again.';
    case 'RESET_UNAVAILABLE':
    case 'auth/reset-unavailable':
      return 'Password reset is temporarily unavailable. Try again later.';
    case 'NETWORK_ERROR':
    case 'auth/network-request-failed':
      return 'Network error while reaching authentication service. Check your connection and try again.';
    default:
      return (err as Error)?.message || 'Sign-in failed. Try again.';
  }
}
