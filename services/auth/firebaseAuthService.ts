/**
 * Browser Firebase Auth (email/password + Google).
 * Public VITE_FIREBASE_* config only; the Worker verifies ID tokens with JWKS.
 */
import { initializeApp, type FirebaseApp, getApps } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth';
export type { User };
import { FIREBASE_PUBLIC_CONFIG } from './firebasePublicConfig';

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

function ensureAuth(): Auth {
  if (auth) return auth;
  const cfg = readConfig();
  if (!cfg) throw new Error('Firebase is not configured. Add VITE_FIREBASE_* to your .env.');
  app = getApps().length ? getApps()[0]! : initializeApp(cfg);
  auth = getAuth(app);
  return auth;
}

async function refreshCachedToken(user: User | null): Promise<void> {
  cachedUser = user;
  if (!user) {
    cachedIdToken = null;
    notifyUserListeners(null);
    return;
  }
  try {
    cachedIdToken = await user.getIdToken();
  } catch {
    cachedIdToken = null;
  }
  notifyUserListeners(user);
}

/**
 * Starts listening for auth changes and keeps a sync ID token cache for apiClient.
 * Safe to call once from the app shell or AuthPanel.
 */
export function startFirebaseAuthListener(): () => void {
  if (!isFirebaseConfigured()) return () => {};
  if (initAttempted && auth) {
    return () => {};
  }
  initAttempted = true;
  const a = ensureAuth();
  return onAuthStateChanged(a, (u) => { void refreshCachedToken(u); });
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

export async function signUpWithEmail(email: string, password: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(ensureAuth(), email.trim(), password);
  await refreshCachedToken(cred.user);
  return cred.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(ensureAuth(), email.trim(), password);
  await refreshCachedToken(cred.user);
  return cred.user;
}

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(ensureAuth(), provider);
  await refreshCachedToken(cred.user);
  return cred.user;
}

export async function signOutFirebase(): Promise<void> {
  if (!isFirebaseConfigured()) return;
  await signOut(ensureAuth());
  await refreshCachedToken(null);
}

/** Maps Firebase Auth error codes to short user-facing copy. */
export function friendlyFirebaseError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email already has an account. Sign in instead.';
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
    default:
      return (err as Error)?.message || 'Sign-in failed. Try again.';
  }
}
