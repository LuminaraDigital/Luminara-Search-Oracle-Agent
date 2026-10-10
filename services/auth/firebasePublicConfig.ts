/**
 * Public Firebase web app config (safe to ship in the browser bundle).
 * Env VITE_FIREBASE_* overrides these when set; values here keep production
 * Cloudflare builds working when .env is not present on the build machine.
 */
export const FIREBASE_PUBLIC_CONFIG = {
  apiKey: 'AIzaSyDPX87WXZHFQu7XuCJyHhDoVcyY1-z8bxc',
  authDomain: 'luminara-suite.firebaseapp.com',
  projectId: 'luminara-suite',
  appId: '1:274315225068:web:092053650dfce884f482c9',
  messagingSenderId: '274315225068',
  storageBucket: 'luminara-suite.firebasestorage.app',
} as const;

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
};

const clean = (value: unknown): string => String(value ?? '').trim();

/**
 * The Firebase web config a build signs in with.
 *
 * Production and local builds: each VITE_FIREBASE_* value overrides the constant above.
 *
 * A staging build (`vite build --mode staging`) uses only its own VITE_FIREBASE_* values and never
 * falls back to the production project. The staging Worker verifies tokens for its own Firebase
 * project, so a token minted for production would be refused there after the user had typed
 * their password; with no staging values, sign-in says it is not configured instead.
 */
export function resolveFirebaseWebConfig(env: Record<string, unknown>): FirebaseWebConfig | null {
  const staging = clean(env.MODE) === 'staging';
  const pick = (name: string, fallback: string): string => clean(env[name]) || (staging ? '' : fallback);
  const apiKey = pick('VITE_FIREBASE_API_KEY', FIREBASE_PUBLIC_CONFIG.apiKey);
  const authDomain = pick('VITE_FIREBASE_AUTH_DOMAIN', FIREBASE_PUBLIC_CONFIG.authDomain);
  const projectId = pick('VITE_FIREBASE_PROJECT_ID', FIREBASE_PUBLIC_CONFIG.projectId);
  const appId = pick('VITE_FIREBASE_APP_ID', FIREBASE_PUBLIC_CONFIG.appId);
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    messagingSenderId: pick('VITE_FIREBASE_MESSAGING_SENDER_ID', FIREBASE_PUBLIC_CONFIG.messagingSenderId) || undefined,
    storageBucket: pick('VITE_FIREBASE_STORAGE_BUCKET', FIREBASE_PUBLIC_CONFIG.storageBucket) || undefined,
  };
}
