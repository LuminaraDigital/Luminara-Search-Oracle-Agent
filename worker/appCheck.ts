/**
 * Verify Firebase App Check JWTs on Cloudflare Workers (Web Crypto + jose).
 * Spec: https://firebase.google.com/docs/app-check/custom-resource-backend
 *
 * JWKS: https://firebaseappcheck.googleapis.com/v1/jwks
 * No Admin SDK / service-account private key required.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from './env';

const APP_CHECK_JWKS_URL = 'https://firebaseappcheck.googleapis.com/v1/jwks';
const APP_CHECK_ISSUER_PREFIX = 'https://firebaseappcheck.googleapis.com/';

/** Cached remote JWKS (jose refreshes on key rotation). */
const JWKS = createRemoteJWKSet(new URL(APP_CHECK_JWKS_URL));

export type AppCheckValidationResult =
  | { ok: true; appId: string; payload: JWTPayload }
  | { ok: false; reason: string };

/** True when Worker should reject auth routes without a valid App Check token. */
export function isAppCheckRequired(env: Env): boolean {
  return String(env.REQUIRE_APP_CHECK || '').trim().toLowerCase() === 'true';
}

/**
 * Numeric Firebase / GCP project number (not the string project id).
 * Prefer FIREBASE_PROJECT_NUMBER; falls back to parsing `1:NUMBER:web:...` app ids if ever set.
 */
export function resolveFirebaseProjectNumber(env: Env): string | null {
  const explicit = String(env.FIREBASE_PROJECT_NUMBER || '').trim();
  if (/^\d{6,}$/.test(explicit)) return explicit;
  return null;
}

/**
 * Pure claim checks used by verifyAppCheckToken and unit tests.
 * Signature verification is separate.
 */
export function assertAppCheckClaims(
  payload: JWTPayload,
  projectNumber: string,
  projectId?: string,
): { ok: true; appId: string } | { ok: false; reason: string } {
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return { ok: false, reason: 'App Check token expired' };
  }
  if (typeof payload.iat === 'number' && payload.iat > now + 60) {
    return { ok: false, reason: 'App Check token iat invalid' };
  }

  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  if (!iss.startsWith(APP_CHECK_ISSUER_PREFIX)) {
    return { ok: false, reason: 'App Check token issuer mismatch' };
  }
  if (iss.slice(APP_CHECK_ISSUER_PREFIX.length) !== projectNumber) {
    return { ok: false, reason: 'App Check token issuer project mismatch' };
  }

  const aud = payload.aud;
  const audList = Array.isArray(aud) ? aud.map(String) : typeof aud === 'string' ? [aud] : [];
  const allowed = new Set([`projects/${projectNumber}`]);
  const pid = String(projectId || '').trim();
  if (pid) allowed.add(`projects/${pid}`);
  if (!audList.some((a) => allowed.has(a))) {
    return { ok: false, reason: 'App Check token audience mismatch' };
  }

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub) return { ok: false, reason: 'App Check token has no subject' };

  return { ok: true, appId: sub };
}

/**
 * Verifies an App Check JWT (RS256 + App Check JWKS) for this Firebase project.
 */
export async function verifyAppCheckToken(
  token: string,
  projectNumber: string,
  projectId?: string,
): Promise<AppCheckValidationResult> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 16_000) {
    return { ok: false, reason: 'App Check token missing or too large' };
  }
  if (!/^\d{6,}$/.test(projectNumber)) {
    return { ok: false, reason: 'FIREBASE_PROJECT_NUMBER not configured' };
  }

  try {
    const { payload, protectedHeader } = await jwtVerify(trimmed, JWKS, {
      algorithms: ['RS256'],
    });
    if (protectedHeader.alg !== 'RS256') {
      return { ok: false, reason: 'App Check token algorithm must be RS256' };
    }
    if (protectedHeader.typ && protectedHeader.typ !== 'JWT') {
      return { ok: false, reason: 'App Check token type must be JWT' };
    }
    const claims = assertAppCheckClaims(payload, projectNumber, projectId);
    if (!claims.ok) return claims;
    return { ok: true, appId: claims.appId, payload };
  } catch {
    return { ok: false, reason: 'App Check token invalid' };
  }
}

/**
 * Resolve App Check token from body field and/or X-Firebase-AppCheck header.
 */
export function extractAppCheckToken(request: Request, bodyToken?: string): string | undefined {
  const header = request.headers.get('X-Firebase-AppCheck')?.trim();
  if (header) return header;
  const fromBody = String(bodyToken || '').trim();
  return fromBody || undefined;
}

/**
 * When REQUIRE_APP_CHECK=true, require a cryptographically valid App Check token.
 * When false/unset, verification is skipped (monitor-only / gradual rollout).
 */
export async function enforceAppCheckIfRequired(
  request: Request,
  env: Env,
  bodyToken?: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!isAppCheckRequired(env)) return { ok: true };

  const projectNumber = resolveFirebaseProjectNumber(env);
  if (!projectNumber) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          ok: false,
          error: 'App Check is required but FIREBASE_PROJECT_NUMBER is not configured.',
          code: 'APP_CHECK_MISCONFIGURED',
        }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
    };
  }

  const token = extractAppCheckToken(request, bodyToken);
  if (!token) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          ok: false,
          error: 'App Check token required. Update the app or wait for App Check to initialize.',
          code: 'APP_CHECK_REQUIRED',
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    };
  }

  const verified = await verifyAppCheckToken(token, projectNumber, env.FIREBASE_PROJECT_ID);
  if (!verified.ok) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          ok: false,
          error: 'App Check token invalid or expired. Refresh the page and try again.',
          code: 'APP_CHECK_INVALID',
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    };
  }

  return { ok: true };
}
