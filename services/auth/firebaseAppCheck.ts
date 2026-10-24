/**
 * Firebase App Check (reCAPTCHA Enterprise). Optional until VITE_FIREBASE_APPCHECK_SITE_KEY is set.
 * The value is the Enterprise site key registered on the web app.
 *
 * When enforcement is enabled in Firebase for Authentication, requests without a valid
 * App Check token are rejected, which closes direct Identity Toolkit abuse with the
 * public web API key (the residual bypass around Worker-mediated auth).
 *
 * @see https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
 */
import type { FirebaseApp } from 'firebase/app';
import {
  initializeAppCheck,
  getToken,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';

let appCheck: AppCheck | null = null;
let initAttempted = false;

function viteEnv(): Record<string, string | undefined> {
  return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
}

function siteKeyFrom(source: Record<string, string | undefined>): string {
  return String(source.VITE_FIREBASE_APPCHECK_SITE_KEY || '').trim();
}

function parseAppCheckDebugToken(raw: string | undefined): string | boolean | undefined {
  const value = String(raw || '').trim();
  if (!value) return undefined;
  if (value === 'true' || value === '1') return true;
  return value;
}

/** True when a reCAPTCHA Enterprise site key is present (App Check can initialize). */
export function isAppCheckConfigured(source: Record<string, string | undefined> = viteEnv()): boolean {
  return Boolean(siteKeyFrom(source));
}

/**
 * Initialize App Check once, before Auth usage. No-op when site key is unset
 * so local/staging builds without App Check keep working.
 */
export function ensureAppCheck(
  app: FirebaseApp,
  source: Record<string, string | undefined> = viteEnv(),
): AppCheck | null {
  if (appCheck) return appCheck;
  if (initAttempted) return null;
  initAttempted = true;

  const siteKey = siteKeyFrom(source);
  if (!siteKey) return null;

  const debug = parseAppCheckDebugToken(source.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN);
  if (debug != null && typeof globalThis !== 'undefined') {
    // Required for local/dev when enforcement is on; register the token in Firebase console.
    (globalThis as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debug;
  }

  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
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
