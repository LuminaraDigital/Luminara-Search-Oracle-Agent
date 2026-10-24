/**
 * Verify Firebase App Check JWTs on Cloudflare Workers (Web Crypto + jose).
 * Spec: https://firebase.google.com/docs/app-check/custom-resource-backend
 *
 * JWKS: https://firebaseappcheck.googleapis.com/v1/jwks
 * No Admin SDK / service-account private key required.
 *
 * APPCHECK_ENFORCE: off (default) | log | enforce.
 * off skips verification. log records a bad or missing token and still serves
 * the request. enforce returns 401. Health, robots.txt, llms.txt, and webhook
 * routes are exempt. REQUIRE_APP_CHECK still gates Worker-mediated sign-in.
 */
import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import type { Env } from './env';

export const APP_CHECK_JWKS_URL = 'https://firebaseappcheck.googleapis.com/v1/jwks';
export const APP_CHECK_JWKS_TTL_MS = 60 * 60 * 1000;
const APP_CHECK_ISSUER_PREFIX = 'https://firebaseappcheck.googleapis.com/';

type JwksCache = { fetchedAt: number; jwks: JSONWebKeySet };
let jwksCache: JwksCache | null = null;
let jwksPending: Promise<JSONWebKeySet> | null = null;

export type AppCheckMode = 'off' | 'log' | 'enforce';

export type AppCheckLogReason =
  | 'missing'
  | 'expired'
  | 'wrong_aud'
  | 'invalid'
  | 'misconfigured'
  | 'jwks_unavailable';

export type AppCheckLogFields = {
  event: 'appcheck';
  mode: 'log' | 'enforce';
  reason: AppCheckLogReason;
  method: string;
  path: string;
};

export type AppCheckValidationResult =
  | { ok: true; appId: string; payload: JWTPayload }
  | { ok: false; reason: string };

export type AppCheckVerifyOpts = {
  fetchImpl?: typeof fetch;
  nowMs?: number;
};

/** True when Worker should reject auth routes without a valid App Check token. */
export function isAppCheckRequired(env: Env): boolean {
  return String(env.REQUIRE_APP_CHECK || '').trim().toLowerCase() === 'true';
}

/** off | log | enforce. Anything else, including unset, is off. */
export function resolveAppCheckMode(env: { APPCHECK_ENFORCE?: string }): AppCheckMode {
  const raw = String(env.APPCHECK_ENFORCE ?? '').trim().toLowerCase();
  if (raw === 'log' || raw === 'enforce' || raw === 'off') return raw;
  return 'off';
}

/**
 * Numeric Firebase / GCP project number (not the string project id).
 * Prefer FIREBASE_PROJECT_NUMBER.
 */
export function resolveFirebaseProjectNumber(env: Env): string | null {
  const explicit = String(env.FIREBASE_PROJECT_NUMBER || '').trim();
  if (/^\d{6,}$/.test(explicit)) return explicit;
  return null;
}

export function resetAppCheckJwksCache(): void {
  jwksCache = null;
  jwksPending = null;
}

function isJwks(body: unknown): body is JSONWebKeySet {
  if (!body || typeof body !== 'object') return false;
  const keys = (body as { keys?: unknown }).keys;
  return Array.isArray(keys) && keys.length > 0;
}

/** Fetches the App Check JWKS and reuses it until APP_CHECK_JWKS_TTL_MS. */
export async function loadAppCheckJwks(fetchImpl: typeof fetch = fetch, nowMs = Date.now()): Promise<JSONWebKeySet> {
  if (jwksCache && nowMs - jwksCache.fetchedAt < APP_CHECK_JWKS_TTL_MS) return jwksCache.jwks;
  if (!jwksPending) {
    const fetchedAt = nowMs;
    jwksPending = fetchImpl(APP_CHECK_JWKS_URL, { headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error('jwks');
        const body: unknown = await res.json();
        if (!isJwks(body)) throw new Error('jwks');
        jwksCache = { fetchedAt, jwks: body };
        return body;
      })
      .finally(() => {
        jwksPending = null;
      });
  }
  return jwksPending;
}

/**
 * Pure claim checks used by verifyAppCheckToken and unit tests.
 * Signature verification is separate. aud must include projects/<projectNumber>.
 */
export function assertAppCheckClaims(
  payload: JWTPayload,
  projectNumber: string,
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
  if (!audList.includes(`projects/${projectNumber}`)) {
    return { ok: false, reason: 'App Check token audience mismatch' };
  }

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub) return { ok: false, reason: 'App Check token has no subject' };

  return { ok: true, appId: sub };
}

function invalidReason(err: unknown): string {
  if (err instanceof errors.JWTExpired) return 'App Check token expired';
  if (err instanceof errors.JWTClaimValidationFailed) {
    if (err.claim === 'exp') return 'App Check token expired';
    if (err.claim === 'aud') return 'App Check token audience mismatch';
    if (err.claim === 'iss') return 'App Check token issuer mismatch';
  }
  return 'App Check token invalid';
}

/**
 * Verifies an App Check JWT (RS256 + App Check JWKS) for this Firebase project.
 */
export async function verifyAppCheckToken(
  token: string,
  projectNumber: string,
  opts?: AppCheckVerifyOpts,
): Promise<AppCheckValidationResult> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 16_000) {
    return { ok: false, reason: 'App Check token missing or too large' };
  }
  if (!/^\d{6,}$/.test(projectNumber)) {
    return { ok: false, reason: 'FIREBASE_PROJECT_NUMBER not configured' };
  }

  let jwks: JSONWebKeySet;
  try {
    jwks = await loadAppCheckJwks(opts?.fetchImpl ?? fetch, opts?.nowMs ?? Date.now());
  } catch {
    return { ok: false, reason: 'App Check JWKS unavailable' };
  }

  try {
    const { payload, protectedHeader } = await jwtVerify(trimmed, createLocalJWKSet(jwks), {
      algorithms: ['RS256'],
      issuer: `${APP_CHECK_ISSUER_PREFIX}${projectNumber}`,
      audience: `projects/${projectNumber}`,
    });
    if (protectedHeader.alg !== 'RS256') {
      return { ok: false, reason: 'App Check token algorithm must be RS256' };
    }
    if (protectedHeader.typ && protectedHeader.typ !== 'JWT') {
      return { ok: false, reason: 'App Check token type must be JWT' };
    }
    const claims = assertAppCheckClaims(payload, projectNumber);
    if (!claims.ok) return claims;
    return { ok: true, appId: claims.appId, payload };
  } catch (err) {
    return { ok: false, reason: invalidReason(err) };
  }
}

/**
 * Resolve App Check token from the X-Firebase-AppCheck header and/or a body field.
 */
export function extractAppCheckToken(request: Request, bodyToken?: string): string | undefined {
  const header = request.headers.get('X-Firebase-AppCheck')?.trim();
  if (header) return header;
  const fromBody = String(bodyToken || '').trim();
  return fromBody || undefined;
}

function appCheckResponse(status: number, code: string, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error, code }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Health, robots.txt, llms.txt, and any path containing /webhook. */
export function isAppCheckExempt(url: URL): boolean {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/robots.txt' || path === '/llms.txt' || path === '/api/health' || path === '/health') return true;
  return path.includes('/webhook');
}

function logReason(reason: string): AppCheckLogReason {
  if (reason.includes('expired')) return 'expired';
  if (reason.includes('audience')) return 'wrong_aud';
  if (reason.includes('JWKS')) return 'jwks_unavailable';
  if (reason.includes('not configured')) return 'misconfigured';
  if (reason.includes('missing')) return 'missing';
  return 'invalid';
}

function defaultLog(fields: AppCheckLogFields): void {
  console.warn(JSON.stringify(fields));
}

/**
 * API-wide gate. null means the request may continue.
 * off: always null. log: null after a structured log. enforce: 401 or 503.
 */
export async function enforceAppCheckRequest(
  request: Request,
  env: Env,
  opts?: AppCheckVerifyOpts & { log?: (fields: AppCheckLogFields) => void },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (isAppCheckExempt(url)) return null;
  const mode = resolveAppCheckMode(env);
  if (mode === 'off') return null;

  const log = opts?.log ?? defaultLog;
  const projectNumber = resolveFirebaseProjectNumber(env);
  const token = extractAppCheckToken(request);
  const fields = (reason: AppCheckLogReason): AppCheckLogFields => ({
    event: 'appcheck',
    mode,
    reason,
    method: request.method,
    path: url.pathname,
  });

  if (!projectNumber) {
    log(fields('misconfigured'));
    if (mode === 'log') return null;
    return appCheckResponse(503, 'APP_CHECK_MISCONFIGURED', 'App Check is required but FIREBASE_PROJECT_NUMBER is not configured.');
  }
  if (!token) {
    log(fields('missing'));
    if (mode === 'log') return null;
    return appCheckResponse(401, 'APP_CHECK_REQUIRED', 'App Check token required.');
  }

  const verified = await verifyAppCheckToken(token, projectNumber, opts);
  if (verified.ok) return null;
  const reason = logReason(verified.reason);
  log(fields(reason));
  if (mode === 'log') return null;
  if (reason === 'jwks_unavailable') {
    return appCheckResponse(503, 'APP_CHECK_UNAVAILABLE', 'App Check verification is temporarily unavailable.');
  }
  return appCheckResponse(401, 'APP_CHECK_INVALID', 'App Check token invalid.');
}

/**
 * When REQUIRE_APP_CHECK=true, require a cryptographically valid App Check token.
 * When false/unset, verification is skipped (auth routes only; see enforceAppCheckRequest).
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
      response: appCheckResponse(503, 'APP_CHECK_MISCONFIGURED', 'App Check is required but FIREBASE_PROJECT_NUMBER is not configured.'),
    };
  }

  const token = extractAppCheckToken(request, bodyToken);
  if (!token) {
    return {
      ok: false,
      response: appCheckResponse(401, 'APP_CHECK_REQUIRED', 'App Check token required. Update the app or wait for App Check to initialize.'),
    };
  }

  const verified = await verifyAppCheckToken(token, projectNumber);
  if (!verified.ok) {
    return {
      ok: false,
      response: appCheckResponse(401, 'APP_CHECK_INVALID', 'App Check token invalid or expired. Refresh the page and try again.'),
    };
  }

  return { ok: true };
}
