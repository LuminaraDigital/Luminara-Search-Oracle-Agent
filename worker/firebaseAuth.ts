/**
 * Verifies Firebase Auth ID tokens on Cloudflare Workers (Web Crypto + jose).
 * Spec: https://firebase.google.com/docs/auth/admin/verify-id-tokens
 *
 * Public keys: https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
 * No Admin SDK / service-account private key is required for verification.
 */

import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload, type JWTVerifyGetKey } from 'jose';

const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const JWKS_FALLBACK_MS = 600_000;
const TOKEN_CACHE_MAX = 64;

export interface FirebaseUser {
  /** Stable Firebase Auth uid. */
  uid: string;
  email?: string;
  name?: string;
  emailVerified?: boolean;
}

export type FirebaseValidationResult =
  | { ok: true; user: FirebaseUser; payload: JWTPayload }
  | { ok: false; reason: string };

export type FirebaseAuthTiming = {
  jwksMs: number;
  verifyMs: number;
  cache: 'hit' | 'miss';
};

const resultTiming = new WeakMap<object, FirebaseAuthTiming>();

export function firebaseAuthTiming(result: object): FirebaseAuthTiming | undefined {
  return resultTiming.get(result);
}

type JwksEntry = { keys: JWTVerifyGetKey; expiresAt: number };
let jwksEntry: JwksEntry | null = null;
let jwksInflight: Promise<JWTVerifyGetKey> | null = null;

type TokenHit = { expMs: number; result: Extract<FirebaseValidationResult, { ok: true }> };
const tokenCache = new Map<string, TokenHit>();
const tokenInflight = new Map<string, Promise<FirebaseValidationResult>>();

/** Test hook. Production callers never clear this except by isolate recycle. */
export function resetFirebaseAuthCache(): void {
  jwksEntry = null;
  jwksInflight = null;
  tokenCache.clear();
  tokenInflight.clear();
}

function note(result: FirebaseValidationResult, timing: FirebaseAuthTiming): FirebaseValidationResult {
  resultTiming.set(result, timing);
  return result;
}

/** max-age from Cache-Control. Missing header keeps keys for ten minutes. */
export function jwksFreshForMs(cacheControl: string | null): number {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl || '');
  if (!match) return JWKS_FALLBACK_MS;
  return Number(match[1]) * 1000;
}

function isJwkSet(value: unknown): value is JSONWebKeySet {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { keys?: unknown }).keys)) return false;
  return (value as { keys: unknown[] }).keys.every((key) => {
    if (!key || typeof key !== 'object') return false;
    return typeof (key as { kty?: unknown }).kty === 'string';
  });
}

async function fetchJwks(): Promise<JWTVerifyGetKey> {
  const started = Date.now();
  const res = await fetch(FIREBASE_JWKS_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('jwks');
  const json: unknown = await res.json();
  if (!isJwkSet(json)) throw new Error('jwks');
  const keys = createLocalJWKSet(json);
  jwksEntry = { keys, expiresAt: started + jwksFreshForMs(res.headers.get('cache-control')) };
  return keys;
}

async function firebaseJwks(): Promise<{ keys: JWTVerifyGetKey; jwksMs: number }> {
  if (jwksEntry && jwksEntry.expiresAt > Date.now()) return { keys: jwksEntry.keys, jwksMs: 0 };
  const started = Date.now();
  if (!jwksInflight) {
    jwksInflight = fetchJwks().finally(() => {
      jwksInflight = null;
    });
  }
  try {
    const keys = await jwksInflight;
    return { keys, jwksMs: Date.now() - started };
  } catch {
    // shortcut: a shared fetch can fail when another request's isolate context cancels it. One local retry.
    const keys = await fetchJwks();
    return { keys, jwksMs: Date.now() - started };
  }
}

function rememberToken(key: string, result: Extract<FirebaseValidationResult, { ok: true }>): void {
  const exp = result.payload.exp;
  if (typeof exp !== 'number') return;
  const expMs = exp * 1000;
  if (expMs <= Date.now()) return;
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const oldest = tokenCache.keys().next().value;
    if (oldest) tokenCache.delete(oldest);
  }
  tokenCache.set(key, { expMs, result });
}

async function verifyFresh(idToken: string, projectId: string, key: string): Promise<FirebaseValidationResult> {
  const started = Date.now();
  let jwksMs = 0;
  try {
    const jwks = await firebaseJwks();
    jwksMs = jwks.jwksMs;
    const verifyStarted = Date.now();
    const { payload, protectedHeader } = await jwtVerify(idToken, jwks.keys, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    const verifyMs = Date.now() - verifyStarted;
    if (protectedHeader.alg !== 'RS256') {
      return note({ ok: false, reason: 'Firebase token algorithm must be RS256' }, { jwksMs, verifyMs, cache: 'miss' });
    }
    const claims = assertFirebaseClaims(payload, projectId);
    if (!claims.ok) return note(claims, { jwksMs, verifyMs, cache: 'miss' });
    const result: Extract<FirebaseValidationResult, { ok: true }> = { ok: true, user: claims.user, payload };
    rememberToken(key, result);
    // shortcut: a disabled Firebase account stays accepted until exp. This path does not call accounts:lookup.
    return note(result, { jwksMs, verifyMs, cache: 'miss' });
  } catch {
    return note({ ok: false, reason: 'Firebase token invalid' }, { jwksMs, verifyMs: Date.now() - started, cache: 'miss' });
  }
}

/**
 * Pure claim checks used by verifyFirebaseIdToken and unit tests.
 * Signature verification is separate.
 */
export function assertFirebaseClaims(
  payload: JWTPayload,
  projectId: string,
): { ok: true; user: FirebaseUser } | { ok: false; reason: string } {
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return { ok: false, reason: 'Firebase token expired' };
  }
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) {
    return { ok: false, reason: 'Firebase token iat invalid' };
  }
  if (typeof payload.auth_time === 'number' && payload.auth_time > now + 60) {
    return { ok: false, reason: 'Firebase token auth_time invalid' };
  }
  if (payload.aud !== projectId) {
    return { ok: false, reason: 'Firebase token audience mismatch' };
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    return { ok: false, reason: 'Firebase token issuer mismatch' };
  }
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) return { ok: false, reason: 'Firebase token has no subject' };

  return {
    ok: true,
    user: {
      uid: sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      emailVerified: payload.email_verified === true,
    },
  };
}

/**
 * Verifies a Firebase ID token (RS256 + Google JWKS) for the given project.
 * Successful results stay in this isolate until the token's exp.
 */
export async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string,
): Promise<FirebaseValidationResult> {
  const trimmed = idToken.trim();
  if (!trimmed || trimmed.length > 16_000) {
    return { ok: false, reason: 'Firebase token missing or too large' };
  }
  if (!projectId.trim()) {
    return { ok: false, reason: 'FIREBASE_PROJECT_ID not configured' };
  }

  const key = `${projectId}:${trimmed}`;
  const hit = tokenCache.get(key);
  if (hit && hit.expMs > Date.now()) {
    return note(hit.result, { jwksMs: 0, verifyMs: 0, cache: 'hit' });
  }
  if (hit) tokenCache.delete(key);

  const running = tokenInflight.get(key);
  if (running) return running;
  const run = verifyFresh(trimmed, projectId, key).finally(() => {
    tokenInflight.delete(key);
  });
  tokenInflight.set(key, run);
  return run;
}

/** Extracts a Bearer token from an Authorization header value. */
export function bearerFromAuthorization(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(\S+)/i);
  return m ? m[1] : null;
}
