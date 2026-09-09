/**
 * Verifies Firebase Auth ID tokens on Cloudflare Workers (Web Crypto + jose).
 * Spec: https://firebase.google.com/docs/auth/admin/verify-id-tokens
 *
 * Public keys: https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
 * No Admin SDK / service-account private key is required for verification.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** Cached remote JWKS (jose refreshes on its own when keys rotate). */
const JWKS = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));

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

  try {
    const { payload, protectedHeader } = await jwtVerify(trimmed, JWKS, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    if (protectedHeader.alg !== 'RS256') {
      return { ok: false, reason: 'Firebase token algorithm must be RS256' };
    }
    const claims = assertFirebaseClaims(payload, projectId);
    if (!claims.ok) return claims;
    return { ok: true, user: claims.user, payload };
  } catch {
    return { ok: false, reason: 'Firebase token invalid' };
  }
}

/** Extracts a Bearer token from an Authorization header value. */
export function bearerFromAuthorization(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(\S+)/i);
  return m ? m[1] : null;
}
