/**
 * Centralized Edge Auth Middleware & Route Guard for Cloudflare Workers.
 *
 * Implements:
 * 1. Protected route guard (PROTECTED_API_ROUTES); every other route owns its auth.
 * 2. HttpOnly, Secure, SameSite=Lax Session Cookie creation (__session) and its login CSRF guard.
 * 3. Standardized 401 Unauthorized JSON responses for API guarding.
 * 4. Cryptographic HMAC-SHA256 webhook signature verification.
 * 5. CSRF defense on state-changing mutating requests.
 */

import type { Env } from './env';
import { crossSiteRefusal, identify, json, secretEquals } from './workerUtils';

const identifiedOnRequest = new WeakMap<Request, Awaited<ReturnType<typeof identify>>>();

/** Identity guardApiRoute already resolved for this request, so the route does not look it up again. */
export function identifiedForRequest(request: Request): Awaited<ReturnType<typeof identify>> | null {
  return identifiedOnRequest.get(request) ?? null;
}

export const SESSION_COOKIE_NAME = '__session';
export const SESSION_COOKIE_MAX_AGE = 14 * 24 * 3600; // 14 days

// Re-export opaque session helpers so callers can import from authMiddleware.
export {
  OPAQUE_SESSION_PREFIX,
  isOpaqueSessionId,
  looksLikeJwt,
  opaqueSessionKvKey,
  mintOpaqueSession,
  loadOpaqueSession,
  revokeOpaqueSession,
  revokeSessionsForDeletedUser,
} from './opaqueSession';
export type { OpaqueSessionRecord } from './opaqueSession';

/**
 * Login CSRF guard for the routes that set or clear __session (POST /auth/session,
 * POST /telegram/auth, POST /auth/logout): a foreign Origin or a cross-site fetch gets 403.
 */
export function refuseCrossSiteSessionWrite(request: Request, env: Env): Response | null {
  const refusal = crossSiteRefusal(request, env);
  if (!refusal) return null;
  const path = new URL(request.url).pathname;
  if (refusal === 'origin_missing') {
    // shortcut: a missing Origin passes because Telegram webviews are not proven to send one;
    // refuse it once csrf_origin_missing stops showing in the logs.
    console.warn(JSON.stringify({ event: 'csrf_origin_missing', path }));
    return null;
  }
  console.warn(JSON.stringify({ event: 'csrf_rejected', path, reason: refusal }));
  return json(
    { ok: false, error: 'Request refused: it came from another site. Open Luminara and try again.', code: 'CSRF_REJECTED' },
    403,
  );
}

/** Build an HttpOnly, Secure, SameSite=Lax Set-Cookie header string */
export function buildSessionCookie(token: string, maxAgeSec: number = SESSION_COOKIE_MAX_AGE): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}

/** Build an expired Set-Cookie header string to invalidate the session cookie */
export function buildLogoutCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/** Verify HMAC-SHA256 signature for signed webhooks */
export async function verifyWebhookSignature(payload: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    const computedHex = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return secretEquals(computedHex, signature.trim().toLowerCase());
  } catch {
    return false;
  }
}

export type ProtectedRouteSpec = {
  pattern: RegExp;
  // Methods that require identity. Other methods reach the handler, which owns public reads and 405s.
  methods?: string[];
};

/**
 * Protected application API routes that require verified user identity.
 */
export const PROTECTED_API_ROUTES: ProtectedRouteSpec[] = [
  { pattern: /^\/workspace$/, methods: ['GET', 'PUT'] },
  { pattern: /^\/enterprise\/audit-logs$/, methods: ['GET'] },
  // Trust Network. /trust/receipts/:id GET and /trust/keys are public reads (handler enforces visibility).
  { pattern: /^\/trust\/audit-chain\/verify$/, methods: ['GET'] },
  { pattern: /^\/trust\/receipts$/, methods: ['GET'] },
  { pattern: /^\/trust\/receipts\/[^/]+\/(visibility|revoke)$/, methods: ['POST'] },
  { pattern: /^\/trust\/domains(\/|$)/ },
  { pattern: /^\/citation-watches(\/|$)/ },
  { pattern: /^\/audit-receipts$/, methods: ['POST'] },
  { pattern: /^\/audit-receipts\/[^/]+\/revoke$/, methods: ['POST'] },
  { pattern: /^\/auth\/quota$/, methods: ['GET'] },
  { pattern: /^\/boot$/, methods: ['GET'] },
  // /auth/link is not guarded here. guardApiRoute calls identify(), which upserts
  // each login. The link handler must reject a missing { confirm: true } before any
  // user-store write, then validate both credentials itself.
  { pattern: /^\/auth\/send-verification$/, methods: ['POST'] },
  { pattern: /^\/license\/activate$/, methods: ['POST'] },
  { pattern: /^\/ton\/(invoice|verify)$/, methods: ['POST'] },
  { pattern: /^\/stripe\/create-checkout-session$/, methods: ['POST'] },
  { pattern: /^\/agent\/attest$/, methods: ['POST'] },
  { pattern: /^\/proof\/anchor$/, methods: ['POST'] },
  { pattern: /^\/sentinel\/(register|status)$/ },
  { pattern: /^\/share\/reports$/, methods: ['POST'] },
  { pattern: /^\/share\/reports\/[^/]+$/, methods: ['DELETE'] },
  { pattern: /^\/wins$/, methods: ['POST'] },
  { pattern: /^\/wins\/[a-f0-9]{32}$/i, methods: ['DELETE'] },
  { pattern: /^\/findings$/, methods: ['GET'] },
  { pattern: /^\/findings\/bulk$/, methods: ['POST'] },
  { pattern: /^\/findings\/[^/]+$/, methods: ['PATCH'] },
  { pattern: /^\/share\/teasers$/, methods: ['POST'] },
  { pattern: /^\/referrals\/(me|claim|qualify)$/ },
  { pattern: /^\/missions\/complete$/, methods: ['POST'] },
  { pattern: /^\/idea-scout(\/|$)/ },
  // Agency API surfaces (W6+); also gated by requireApiAccess after identify.
  { pattern: /^\/oracle(\/|$)/ },
  { pattern: /^\/audit(\/|$)/ },
  { pattern: /^\/tools(\/|$)/ },
  { pattern: /^\/projects(\/|$)/ },
  { pattern: /^\/reports(\/|$)/ },
  { pattern: /^\/api-keys(\/|$)/ },
  { pattern: /^\/agent-connections(\/|$)/ },
  { pattern: /^\/memory\/facts$/, methods: ['GET', 'POST'] },
  { pattern: /^\/budgets\/self(\/resume)?$/, methods: ['GET', 'PUT', 'POST'] },
  { pattern: /^\/mcp-action-requests$/, methods: ['GET'] },
  { pattern: /^\/mcp-action-requests\/[^/]+\/(approve|deny)$/, methods: ['POST'] },
  { pattern: /^\/enquiries(\/|$)/ },
  { pattern: /^\/outcomes(\/|$)/ },
  { pattern: /^\/recovery(\/|$)/ },
  { pattern: /^\/cms-mcp(\/|$)/ },
  // /mcp auth is resolveMcpUser (session, lm_live_*, or mcp_* OAuth); not standard identify-only.
  // /oauth/mcp/authorize checks identity itself: a signed-out owner must reach sign-in, not a 401.
];

/**
 * Universal Route Guarding Middleware
 * Intercepts requests to protected application endpoints.
 * 1. Checks user credentials via identify() for the protected methods of a matched route.
 * 2. Returns standardized 401 Unauthorized JSON response if unauthenticated.
 * 3. Returns null if allowed to proceed.
 */
export async function guardApiRoute(request: Request, env: Env, path: string): Promise<Response | null> {
  // CORS Preflight is always allowed
  if (request.method === 'OPTIONS') return null;

  // Find matching protected route specification
  const protectedRoute = PROTECTED_API_ROUTES.find((r) => r.pattern.test(path));
  if (!protectedRoute) {
    // Public routes, relays (/providers, /sidecars), admin endpoints, and unmapped routes fall through
    return null;
  }

  if (protectedRoute.methods && !protectedRoute.methods.includes(request.method)) {
    return null;
  }

  // Check identity (via __session cookie, Authorization Bearer, or Telegram initData)
  const who = await identify(request, env);
  identifiedOnRequest.set(request, who);
  if (who.error || !who.user) {
    return json(
      {
        ok: false,
        error: who.error || 'Unauthorized: Authentication required',
        code: 'AUTH_REQUIRED',
      },
      401,
      { 'WWW-Authenticate': 'Bearer error="invalid_token", Cookie name="__session"' }
    );
  }

  return null;
}
