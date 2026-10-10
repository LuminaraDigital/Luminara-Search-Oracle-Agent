/**
 * Public Firebase web app config (safe to ship in the browser bundle).
 * A production build signs in with exactly these values unless it is switched to self-hosted.
 * Env VITE_FIREBASE_* overrides them in local development; a staging build uses only its own
 * (see resolveFirebaseWebConfig).
 */
export const FIREBASE_PUBLIC_CONFIG = {
  apiKey: 'AIzaSyDPX87WXZHFQu7XuCJyHhDoVcyY1-z8bxc',
  authDomain: 'luminara-suite.firebaseapp.com',
  projectId: 'luminara-suite',
  appId: '1:274315225068:web:092053650dfce884f482c9',
  messagingSenderId: '274315225068',
  storageBucket: 'luminara-suite.firebasestorage.app',
} as const;

/** Luminara's staging Firebase project, the one the staging Worker verifies (wrangler.jsonc, staging vars). */
export const STAGING_FIREBASE_PROJECT_ID = 'luminara-suite-staging';

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
};

const clean = (value: unknown): string => String(value ?? '').trim();
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const REQUIRED_KEYS = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'] as const;

const alreadyWarned = new Set<string>();
/** The app resolves its config on every sign-in call; each distinct problem is logged once. */
function warnOnce(message: string): void {
  if (alreadyWarned.has(message)) return;
  alreadyWarned.add(message);
  console.warn(message);
}

/**
 * A production build's config. The committed constants, unless the build is explicitly switched
 * to self-hosted with VITE_FIREBASE_SELF_HOSTED=true and carries a complete config of its own.
 * A switched build that is incomplete, or that names Luminara's staging project, gets the
 * constants and one warning that names the key at fault (never its value).
 */
function productionConfig(env: Record<string, unknown>, warn: (message: string) => void): FirebaseWebConfig {
  if (clean(env.VITE_FIREBASE_SELF_HOSTED) !== 'true') return { ...FIREBASE_PUBLIC_CONFIG };
  const missing = REQUIRED_KEYS.filter((name) => !clean(env[name]));
  if (missing.length > 0) {
    warn(
      `VITE_FIREBASE_SELF_HOSTED is set but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing. Using the built-in production Firebase config.`,
    );
    return { ...FIREBASE_PUBLIC_CONFIG };
  }
  const projectId = clean(env.VITE_FIREBASE_PROJECT_ID);
  if (same(projectId, STAGING_FIREBASE_PROJECT_ID)) {
    warn(
      'VITE_FIREBASE_SELF_HOSTED is set but VITE_FIREBASE_PROJECT_ID names the staging project, which a production build must not use. Using the built-in production Firebase config.',
    );
    return { ...FIREBASE_PUBLIC_CONFIG };
  }
  return {
    apiKey: clean(env.VITE_FIREBASE_API_KEY),
    authDomain: clean(env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId,
    appId: clean(env.VITE_FIREBASE_APP_ID),
    messagingSenderId: clean(env.VITE_FIREBASE_MESSAGING_SENDER_ID) || undefined,
    storageBucket: clean(env.VITE_FIREBASE_STORAGE_BUCKET) || undefined,
  };
}

/**
 * The Firebase web config a build signs in with.
 *
 * A production build (`vite build`, MODE "production") uses the constant above and ignores every
 * VITE_FIREBASE_* value, so staging or test values left in a local .env file or in the shell
 * cannot ship to production by accident. A self-hosted operator opts out on purpose: with
 * VITE_FIREBASE_SELF_HOSTED=true and all four of the API key, auth domain, project id and app id
 * set, the build signs in with those values (see productionConfig for what is refused).
 *
 * Local development and tests: each VITE_FIREBASE_* value overrides the constant above.
 *
 * A staging build (`vite build --mode staging`) uses only its own VITE_FIREBASE_* values and never
 * falls back to the production project. The staging Worker verifies tokens for its own Firebase
 * project, so a token minted for production would be refused there after the user had typed
 * their password; with no staging values, sign-in says it is not configured instead. The same
 * holds when any of the four required values is the production one, as a local .env written for
 * production would give.
 */
export function resolveFirebaseWebConfig(
  env: Record<string, unknown>,
  warn: (message: string) => void = warnOnce,
): FirebaseWebConfig | null {
  const mode = clean(env.MODE);
  if (mode === 'production') return productionConfig(env, warn);
  const staging = mode === 'staging';
  const pick = (name: string, fallback: string): string => clean(env[name]) || (staging ? '' : fallback);
  const apiKey = pick('VITE_FIREBASE_API_KEY', FIREBASE_PUBLIC_CONFIG.apiKey);
  const authDomain = pick('VITE_FIREBASE_AUTH_DOMAIN', FIREBASE_PUBLIC_CONFIG.authDomain);
  const projectId = pick('VITE_FIREBASE_PROJECT_ID', FIREBASE_PUBLIC_CONFIG.projectId);
  const appId = pick('VITE_FIREBASE_APP_ID', FIREBASE_PUBLIC_CONFIG.appId);
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  const takenFromProduction =
    same(apiKey, FIREBASE_PUBLIC_CONFIG.apiKey) ||
    same(authDomain, FIREBASE_PUBLIC_CONFIG.authDomain) ||
    same(projectId, FIREBASE_PUBLIC_CONFIG.projectId) ||
    same(appId, FIREBASE_PUBLIC_CONFIG.appId);
  if (staging && takenFromProduction) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    messagingSenderId: pick('VITE_FIREBASE_MESSAGING_SENDER_ID', FIREBASE_PUBLIC_CONFIG.messagingSenderId) || undefined,
    storageBucket: pick('VITE_FIREBASE_STORAGE_BUCKET', FIREBASE_PUBLIC_CONFIG.storageBucket) || undefined,
  };
}
