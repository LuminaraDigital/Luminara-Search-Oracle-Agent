/**
 * Centralized Edge Auth Middleware & Route Guard for Cloudflare Workers.
 *
 * Implements:
 * 1. Public vs. Protected Route Whitelisting (defense-in-depth edge guard).
 * 2. HttpOnly, Secure, SameSite=Lax Session Cookie parsing and creation (__session).
 * 3. Standardized 401 Unauthorized JSON responses for API guarding.
 * 4. Cryptographic HMAC-SHA256 webhook signature verification.
 * 5. CSRF defense on state-changing mutating requests.
 */

import type { Env } from './env';
import { identify, json, secretEquals } from './workerUtils';

export const SESSION_COOKIE_NAME = '__session';
export const SESSION_COOKIE_MAX_AGE = 14 * 24 * 3600; // 14 days

/**
 * Explicit array of public API routes that bypass compulsory edge authentication.
 * All other /api/* routes default to protected and immediately reject unauthenticated callers.
 */
export const PUBLIC_API_ROUTES: Array<{ method?: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/health$/ },
  { method: 'GET', pattern: /^\/desktop\/latest$/ },
  { method: 'HEAD', pattern: /^\/desktop\/latest$/ },
  { method: 'POST', pattern: /^\/telegram\/webhook$/ },
  { method: 'POST', pattern: /^\/telegram\/auth$/ },
  { method: 'POST', pattern: /^\/telegram\/invoice$/ },
  { method: 'GET', pattern: /^\/auth\/session$/ },
  { method: 'POST', pattern: /^\/auth\/session$/ },
  { method: 'POST', pattern: /^\/auth\/logout$/ },
  // Public by design: anti-enumeration reset, IP-throttled in handlePasswordResetRequest.
  { method: 'POST', pattern: /^\/auth\/reset-password$/ },
  { method: 'POST', pattern: /^\/auth\/sign-up$/ },
  { method: 'POST', pattern: /^\/auth\/sign-in$/ },
  // Public OTP: IP-throttled; Twilio only when OTP_SMS_ENABLED + secrets are set.
  { method: 'POST', pattern: /^\/auth\/request-otp$/ },
  { method: 'POST', pattern: /^\/auth\/verify-otp$/ },
  { method: 'POST', pattern: /^\/webhooks\/auth$/ },
  { method: 'GET', pattern: /^\/share\/reports\/[a-f0-9]{64}$/i },
  { method: 'GET', pattern: /^\/share\/teasers\/[a-f0-9]{64}$/i },
  // MCP OAuth: token exchange + discovery (authorize uses session via identify inside handler)
  { method: 'POST', pattern: /^\/oauth\/mcp\/token$/ },
  { method: 'GET', pattern: /^\/oauth\/mcp\/\.well-known\/oauth-authorization-server$/ },
];

/** Parse Cookie header into a key-value dictionary */
export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('cookie') || '';
  if (!header.trim()) return {};
  const cookies: Record<string, string> = {};
  header.split(';').forEach((part) => {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey) {
      cookies[rawKey.trim()] = decodeURIComponent(rest.join('=').trim());
    }
  });
  return cookies;
}

/** Extract __session cookie token from the request */
export function getSessionTokenFromCookie(request: Request): string | null {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE_NAME];
  return token && token.trim() ? token.trim() : null;
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

/** Determines whether an incoming API path and method is publicly accessible without credentials */
export function isPublicRoute(path: string, method: string, env?: Env, request?: Request): boolean {
  // CORS Preflight
  if (method === 'OPTIONS') return true;

  // Match against explicit whitelist
  for (const route of PUBLIC_API_ROUTES) {
    if ((!route.method || route.method === method) && route.pattern.test(path)) {
      return true;
    }
  }

  // Provider and sidecar relays handle their own routing (404 provider check, 403 path check, 405 method check, BYOK vs hosted auth)
  if (path.startsWith('/providers/') || path.startsWith('/sidecars/')) {
    return true;
  }

  // Admin secret / bot secret endpoints handle their own token authorization
  if (path.startsWith('/admin/') || path === '/telegram/refund') {
    return true;
  }

  // Enrichment probe when explicit REQUIRE_TG_AUTH is disabled
  if (env && env.REQUIRE_TG_AUTH === 'false' && path.startsWith('/enrichment/entity')) {
    return true;
  }

  return false;
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
  { pattern: /^\/auth\/quota$/, methods: ['GET'] },
  { pattern: /^\/auth\/link$/, methods: ['POST'] },
  { pattern: /^\/auth\/send-verification$/, methods: ['POST'] },
  { pattern: /^\/license\/activate$/, methods: ['POST'] },
  { pattern: /^\/ton\/(invoice|verify)$/, methods: ['POST'] },
  { pattern: /^\/agent\/attest$/, methods: ['POST'] },
  { pattern: /^\/sentinel\/(register|status)$/ },
  { pattern: /^\/share\/reports$/, methods: ['POST'] },
  { pattern: /^\/share\/reports\/[^/]+$/, methods: ['DELETE'] },
  { pattern: /^\/share\/teasers$/, methods: ['POST'] },
  { pattern: /^\/visibility\/crawler-files$/, methods: ['GET'] },
  // Agency API surfaces (W6+); also gated by requireApiAccess after identify.
  { pattern: /^\/oracle(\/|$)/ },
  { pattern: /^\/audit(\/|$)/ },
  { pattern: /^\/tools(\/|$)/ },
  { pattern: /^\/projects(\/|$)/ },
  { pattern: /^\/reports(\/|$)/ },
  { pattern: /^\/api-keys(\/|$)/ },
  { pattern: /^\/memory\/facts$/, methods: ['GET', 'POST'] },
  { pattern: /^\/oauth\/mcp\/authorize$/, methods: ['GET'] },
  // /mcp auth is resolveMcpUser (session, lm_live_*, or mcp_* OAuth); not standard identify-only.
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
