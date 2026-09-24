/**
 * Firebase App Check (reCAPTCHA v3). Optional until VITE_FIREBASE_APPCHECK_SITE_KEY is set
 * and App Check is registered in the Firebase console.
 *
 * When enforcement is enabled in Firebase for Authentication, requests without a valid
 * App Check token are rejected, which closes direct Identity Toolkit abuse with the
 * public web API key (the residual bypass around Worker-mediated auth).
 *
 * @see https://firebase.google.com/docs/app-check/web/recaptcha-provider
 */
import type { FirebaseApp } from 'firebase/app';
import {
  initializeAppCheck,
  getToken,
  ReCaptchaV3Provider,
  type AppCheck,
} from 'firebase/app-check';

let appCheck: AppCheck | null = null;
let initAttempted = false;

function readSiteKey(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env || {};
  return String(env.VITE_FIREBASE_APPCHECK_SITE_KEY || '').trim();
}

function readDebugToken(): string | boolean | undefined {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env || {};
  const raw = String(env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || '').trim();
  if (!raw) return undefined;
  if (raw === 'true' || raw === '1') return true;
  return raw;
}

/** True when a reCAPTCHA v3 site key is present (App Check can initialize). */
export function isAppCheckConfigured(): boolean {
  return Boolean(readSiteKey());
}

/**
 * Initialize App Check once, before Auth usage. No-op when site key is unset
 * so local/staging builds without App Check keep working.
 */
export function ensureAppCheck(app: FirebaseApp): AppCheck | null {
  if (appCheck) return appCheck;
  if (initAttempted) return null;
  initAttempted = true;

  const siteKey = readSiteKey();
  if (!siteKey) return null;

  const debug = readDebugToken();
  if (debug != null && typeof globalThis !== 'undefined') {
    // Required for local/dev when enforcement is on; register the token in Firebase console.
    (globalThis as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debug;
  }

  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('[app-check] init failed', err);
    appCheck = null;
  }
  return appCheck;
}

/** Limited-use / standard App Check token for Worker backends. Empty when App Check is off. */
export async function getAppCheckTokenForBackend(): Promise<string | undefined> {
  if (!appCheck) return undefined;
  try {
    const { token } = await getToken(appCheck, /* forceRefresh */ false);
    return token || undefined;
  } catch {
    return undefined;
  }
}
