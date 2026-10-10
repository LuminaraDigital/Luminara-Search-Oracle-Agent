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

/**
 * Values that belong to Luminara's own Firebase projects, per key. Production's four are the
 * constant above. Of staging, the project id and the auth domains Firebase derives from it are
 * known here; the staging API key and app id are not in this repository, so they cannot be listed.
 */
const LUMINARA_VALUES: Record<(typeof REQUIRED_KEYS)[number], readonly string[]> = {
  VITE_FIREBASE_API_KEY: [FIREBASE_PUBLIC_CONFIG.apiKey],
  VITE_FIREBASE_AUTH_DOMAIN: [
    FIREBASE_PUBLIC_CONFIG.authDomain,
    `${FIREBASE_PUBLIC_CONFIG.projectId}.web.app`,
    `${STAGING_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    `${STAGING_FIREBASE_PROJECT_ID}.web.app`,
  ],
  VITE_FIREBASE_PROJECT_ID: [FIREBASE_PUBLIC_CONFIG.projectId, STAGING_FIREBASE_PROJECT_ID],
  VITE_FIREBASE_APP_ID: [FIREBASE_PUBLIC_CONFIG.appId],
};

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
 * "Its own" means all four values: one of Luminara's values among them is a mix, and a mix can
 * sign in against the wrong project (the API key alone picks the project). A switched build that
 * is incomplete, or that carries any Luminara value, gets the constants and one warning that
 * names the keys at fault (never a value).
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
  const luminaras = REQUIRED_KEYS.filter((name) => LUMINARA_VALUES[name].some((value) => same(clean(env[name]), value)));
  if (luminaras.length > 0) {
    warn(
      `VITE_FIREBASE_SELF_HOSTED is set but ${luminaras.join(', ')} ${luminaras.length === 1 ? 'is a value' : 'are values'} of a Luminara Firebase project. A self-hosted build needs all four of its own. Using the built-in production Firebase config.`,
    );
    return { ...FIREBASE_PUBLIC_CONFIG };
  }
  return {
    apiKey: clean(env.VITE_FIREBASE_API_KEY),
    authDomain: clean(env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: clean(env.VITE_FIREBASE_PROJECT_ID),
    appId: clean(env.VITE_FIREBASE_APP_ID),
    messagingSenderId: clean(env.VITE_FIREBASE_MESSAGING_SENDER_ID) || undefined,
    storageBucket: clean(env.VITE_FIREBASE_STORAGE_BUCKET) || undefined,
  };
}

/**
 * The Firebase web config a build signs in with.
 *
 * A production build uses the constant above and ignores every VITE_FIREBASE_* value, so staging
 * or test values left in a local .env file or in the shell cannot ship to production by accident.
 * That covers every production-kind build, whatever its mode is called: Vite sets PROD for any
 * `vite build` (`--mode prod` included), and a mode spelled "Production" counts too. Only a
 * staging build is treated differently (below). A self-hosted operator opts out on purpose: with
 * VITE_FIREBASE_SELF_HOSTED=true and all four of the API key, auth domain, project id and app id
 * set, the build signs in with those values (see productionConfig for what is refused).
 *
 * Local development (the dev server) and tests: each VITE_FIREBASE_* value overrides the constant.
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
  const mode = clean(env.MODE).toLowerCase();
  const staging = mode === 'staging';
  if (!staging && (env.PROD === true || mode === 'production')) return productionConfig(env, warn);
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
