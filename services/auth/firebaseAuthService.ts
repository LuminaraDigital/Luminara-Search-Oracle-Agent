/**
 * Browser Firebase Auth (email/password + Google).
 * Email/password goes through the Worker (IP-throttled Identity Toolkit) then
 * hydrates the client SDK. Google still uses the popup SDK path.
 * Optional App Check (reCAPTCHA v3) attaches when VITE_FIREBASE_APPCHECK_SITE_KEY is set.
 */
import { initializeApp, type FirebaseApp, getApps } from 'firebase/app';
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
export type { User };
import { FIREBASE_PUBLIC_CONFIG } from './firebasePublicConfig';
import { ensureAppCheck, getAppCheckTokenForBackend, isAppCheckConfigured } from './firebaseAppCheck';

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
let cachedIdToken: string | null = null;
let cachedUser: User | null = null;
let initAttempted = false;
const userListeners = new Set<(user: User | null) => void>();

function notifyUserListeners(user: User | null): void {
  for (const fn of userListeners) {
    try { fn(user); } catch { /* ignore listener errors */ }
  }
}

function readConfig(): FirebasePublicConfig | null {
  const env = (import.meta as any).env || {};
  const apiKey = String(env.VITE_FIREBASE_API_KEY || FIREBASE_PUBLIC_CONFIG.apiKey || '').trim();
  const authDomain = String(env.VITE_FIREBASE_AUTH_DOMAIN || FIREBASE_PUBLIC_CONFIG.authDomain || '').trim();
  const projectId = String(env.VITE_FIREBASE_PROJECT_ID || FIREBASE_PUBLIC_CONFIG.projectId || '').trim();
  const appId = String(env.VITE_FIREBASE_APP_ID || FIREBASE_PUBLIC_CONFIG.appId || '').trim();
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    messagingSenderId:
      String(env.VITE_FIREBASE_MESSAGING_SENDER_ID || FIREBASE_PUBLIC_CONFIG.messagingSenderId || '').trim() ||
      undefined,
    storageBucket:
      String(env.VITE_FIREBASE_STORAGE_BUCKET || FIREBASE_PUBLIC_CONFIG.storageBucket || '').trim() || undefined,
  };
}

/** True when VITE_FIREBASE_* is present (signup/signin UI can show). */
export function isFirebaseConfigured(): boolean {
  return readConfig() !== null;
}

export { isAppCheckConfigured };

function ensureAuth(): Auth {
  if (auth) return auth;
  const cfg = readConfig();
  if (!cfg) throw new Error('Firebase is not configured. Add VITE_FIREBASE_* to your .env.');
  app = getApps().length ? getApps()[0]! : initializeApp(cfg);
  ensureAppCheck(app);
  auth = getAuth(app);
  return auth;
}

async function syncSessionCookie(token: string): Promise<void> {
  if (typeof window === 'undefined' || !window.location) return;
  const base = window.location.origin || '';
  if (!base) return;
  try {
    await fetch(`${base}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ idToken: token }),
    });
  } catch {
    /* ignore session cookie sync failures in offline/dev */
  }
}

async function clearSessionCookie(): Promise<void> {
  if (typeof window === 'undefined' || !window.location) return;
  const base = window.location.origin || '';
  if (!base) return;
  try {
    await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    /* ignore logout cookie clearing errors */
  }
}

async function refreshCachedToken(user: User | null): Promise<void> {
  cachedUser = user;
  if (!user) {
    cachedIdToken = null;
    notifyUserListeners(null);
    void clearSessionCookie();
    return;
  }
  try {
    cachedIdToken = await user.getIdToken();
    if (cachedIdToken) {
      void syncSessionCookie(cachedIdToken);
    }
  } catch {
    cachedIdToken = null;
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
  return cachedIdToken;
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
    cachedIdToken = null;
    cachedUser = null;
    return null;
  }
  const token = await user.getIdToken(forceRefresh);
  cachedIdToken = token;
  cachedUser = user;
  return token;
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
  const res = await fetch(`${window.location.origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      email: email.trim(),
      password,
      ...(appCheckToken ? { appCheckToken } : {}),
    }),
  });
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
    err.status === 429
      ? 'auth/too-many-requests'
      : err.code === 'INVALID_EMAIL'
        ? 'auth/invalid-email'
        : err.code === 'WEAK_PASSWORD'
          ? 'auth/weak-password'
          : err.code === 'SIGN_UP_FAILED'
            ? 'auth/email-already-in-use'
            : err.code === 'SIGN_IN_FAILED'
              ? 'auth/invalid-credential'
              : 'auth/credential-gateway';
  throw Object.assign(new Error(err.error), { code });
}

/**
 * Sign up via Worker (rate-limited Identity Toolkit), then hydrate the client SDK.
 */
export async function signUpWithEmail(email: string, password: string): Promise<User> {
  const gated = await workerCredential('/api/auth/sign-up', email, password);
  if (!gated.ok) throwWorkerAuthError(gated);
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
export async function signInWithEmail(email: string, password: string): Promise<User> {
  const gated = await workerCredential('/api/auth/sign-in', email, password);
  if (!gated.ok) throwWorkerAuthError(gated);
  return hydrateClientSession(email, password);
}

export async function signInWithGoogle(): Promise<User> {
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
  const base = window.location.origin || '';
  const res = await fetch(`${base}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ email: trimmed }),
  });
  let body: { success?: boolean; message?: string; error?: string; code?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    body = {};
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
  if (!isFirebaseConfigured()) return;
  await signOut(ensureAuth());
  await refreshCachedToken(null);
  await clearSessionCookie();
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
      return 'Use a password with at least 6 characters.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email or password is incorrect.';
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
    case 'auth/reset-unavailable':
      return 'Password reset is temporarily unavailable. Try again later.';
    default:
      return (err as Error)?.message || 'Sign-in failed. Try again.';
  }
}
