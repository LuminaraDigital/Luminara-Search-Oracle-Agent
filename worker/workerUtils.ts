import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { validateInitData, verifyTelegramSessionToken } from './telegramAuth';
import { bearerFromAuthorization, firebaseAuthTiming, verifyFirebaseIdToken, type FirebaseAuthTiming } from './firebaseAuth';
import { withAccountId } from './userStore';
import {
  isOpaqueSessionId,
  loadOpaqueSession,
  looksLikeJwt,
} from './opaqueSession';

export const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });

/** Case-insensitive union of comma-separated CORS header values. */
export function unionCorsHeaderValues(...parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    for (const raw of part.split(',')) {
      const token = raw.trim();
      if (!token) continue;
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(token);
    }
  }
  return out.join(', ');
}

/**
 * Apply app CORS onto a response. List-valued CORS headers are merged with any
 * values already set (e.g. MCP Allow-Headers for mcp-session-id) so withCors
 * cannot wipe protocol-specific headers.
 * Response.redirect() and the Cache API return immutable headers. headers.set
 * on those throws TypeError, which the /api catch turns into Internal error.
 */
export function applyCorsHeaders(response: Response, cors: Record<string, string>): Response {
  const mergeKeys = new Set([
    'access-control-allow-headers',
    'access-control-allow-methods',
    'access-control-expose-headers',
  ]);
  const out = Object.keys(cors).length === 0 ? response : new Response(response.body, response);
  for (const [k, v] of Object.entries(cors)) {
    if (mergeKeys.has(k.toLowerCase())) {
      out.headers.set(k, unionCorsHeaderValues(out.headers.get(k), v));
    } else {
      out.headers.set(k, v);
    }
  }
  return out;
}

function isAllowedOrigin(env: Env, origin: string): boolean {
  const allowed = (env.ALLOWED_ORIGINS || env.WEBAPP_URL || '').split(',').map(s => s.trim()).filter(Boolean);
  return allowed.some(a => origin === a || origin === a.replace(/\/$/, ''));
}

export function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  return isAllowedOrigin(env, origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          'content-type, accept, authorization, x-firebase-appcheck, x-telegram-init-data, x-provider-key, x-accept-fallback, x-audit-run, x-audit-domain, x-goog-api-key, x-goog-api-client, x-share-password, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
        'Access-Control-Expose-Headers':
          'x-quota-limit, x-quota-remaining, x-quota-reset, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, retry-after, mcp-session-id, x-scout-receipt, x-quota-bonus, x-provider-fallback, x-provider-fallback-model, x-provider-fallback-reason',
        'Access-Control-Allow-Credentials': 'true',
        'Vary': 'Origin',
      }
    : {};
}

export type CrossSiteRefusal = 'cross_site' | 'origin_missing' | 'origin_rejected';

/** Why a browser request is not from an allowlisted app page, or null when it is. */
export function crossSiteRefusal(request: Request, env: Env): CrossSiteRefusal | null {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return 'cross_site';
  const origin = request.headers.get('Origin');
  if (!origin) return 'origin_missing';
  return isAllowedOrigin(env, origin) ? null : 'origin_rejected';
}

const CSRF_ERRORS: Record<CrossSiteRefusal, string> = {
  cross_site: 'CSRF validation failed: Cross-site request rejected',
  origin_missing: 'CSRF validation failed: Origin header required',
  origin_rejected: 'CSRF validation failed: Origin header rejected',
};

/** The first __session token in the Cookie header; null when absent or not valid URI encoding. */
export function getSessionCookieToken(request: Request): string | null {
  const cookie = request.headers.get('cookie') || '';
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)__session=([^;]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return null;
  }
}

/** Constant-time string comparison for shared secrets (webhook token). */
export function secretEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function billingId(user: HostedIdentity): string {
  return user.accountId || user.id;
}

/**
 * Identifies the caller:
 * 1) Authorization Bearer (Firebase ID token or tg_sess_ token). When one is sent the cookie is
 *    not read: a cookie planted by a cross-site login cannot replace it, and a Bearer that fails
 *    verification never falls back to the cookie. It is an error unless valid initData on the
 *    same request identifies the Telegram user. Otherwise
 * 2) HttpOnly __session cookie token (Cookie: __session=…), and
 * 3) Telegram Mini App initData (x-telegram-init-data).
 * Each side is stored on its own account_id. This function never links them.
 * Sharing a plan requires POST /api/auth/link with { confirm: true }.
 * When initData is valid, or the opaque session belongs to a Telegram user,
 * the returned identity is the Telegram user. Otherwise the Firebase user is returned.
 * Upserts a durable user row when identity succeeds.
 * Returns null when auth is optional and absent.
 */
export async function identify(request: Request, env: Env): Promise<{
  user: HostedIdentity | null;
  error?: string;
  authTiming?: FirebaseAuthTiming;
}> {
  let authTiming: FirebaseAuthTiming | undefined;
  const pack = (body: { user: HostedIdentity | null; error?: string }) => ({ ...body, authTiming });
  const initData = request.headers.get('x-telegram-init-data');
  const authBearer = bearerFromAuthorization(request.headers.get('authorization'));
  const cookieToken = authBearer ? null : getSessionCookieToken(request);

  // CSRF: cookie-authenticated mutations require an allowlisted Origin (fail closed if missing).
  // Bearer and Telegram initData paths are not cookie CSRF vectors.
  if (cookieToken && !initData && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const refusal = crossSiteRefusal(request, env);
    if (refusal) return pack({ user: null, error: CSRF_ERRORS[refusal] });
  }

  let telegramUser: HostedIdentity | null = null;
  let firebaseUser: HostedIdentity | null = null;

  if (initData) {
    if (!env.BOT_TOKEN) return pack({ user: null, error: 'Server has no BOT_TOKEN configured' });
    const result = await validateInitData(initData, env.BOT_TOKEN);
    if (!result.ok) return pack({ user: null, error: result.reason });
    const tg = result.user;
    telegramUser = {
      id: String(tg.id),
      source: 'telegram',
      name: [tg.first_name, tg.last_name].filter(Boolean).join(' ') || tg.username,
    };
  }

  // Opaque server session (preferred): cookie holds sid_*, identity resolved from KV.
  if (cookieToken && isOpaqueSessionId(cookieToken)) {
    const sess = await loadOpaqueSession(env, cookieToken);
    if (sess) {
      if (sess.uid.startsWith('tg:')) {
        telegramUser = {
          id: sess.uid.replace(/^tg:/, ''),
          source: 'telegram',
          name: sess.name,
        };
      } else {
        firebaseUser = {
          id: `fb:${sess.uid}`,
          source: 'firebase',
          email: sess.email,
          name: sess.name,
        };
      }
    } else if (!initData) {
      return pack({ user: null, error: 'Session expired or revoked' });
    }
  }

  // Signed Telegram session token (cookie or Authorization Bearer)
  const tgTokenCandidate =
    (cookieToken && cookieToken.startsWith('tg_sess_') ? cookieToken : null) ||
    (authBearer && authBearer.startsWith('tg_sess_') ? authBearer : null);
  if (tgTokenCandidate && env.BOT_TOKEN && !telegramUser) {
    const tgVerified = await verifyTelegramSessionToken(tgTokenCandidate, env.BOT_TOKEN);
    if (tgVerified.ok) {
      telegramUser = {
        id: String(tgVerified.user.id),
        source: 'telegram',
        name:
          [tgVerified.user.first_name, tgVerified.user.last_name].filter(Boolean).join(' ') ||
          tgVerified.user.username,
      };
    }
  }

  // Authorization Bearer, or legacy cookie that still holds a raw Firebase JWT (migration window).
  const jwtCandidate = authBearer || (cookieToken && looksLikeJwt(cookieToken) ? cookieToken : null);

  if (jwtCandidate && env.FIREBASE_PROJECT_ID && !firebaseUser) {
    const result = await verifyFirebaseIdToken(jwtCandidate, env.FIREBASE_PROJECT_ID);
    authTiming = firebaseAuthTiming(result);
    if (!result.ok) {
      // Telegram-only callers still succeed when Firebase token is bad/expired.
      if (!telegramUser) return pack({ user: null, error: result.reason });
    } else {
      firebaseUser = {
        id: `fb:${result.user.uid}`,
        source: 'firebase',
        email: result.user.email,
        name: result.user.name,
      };
    }
  }

  if (firebaseUser) {
    const { settleFirebaseErase } = await import('./accountDeletion');
    const uid = firebaseUser.id.startsWith('fb:') ? firebaseUser.id.slice(3) : firebaseUser.id;
    const erased = await settleFirebaseErase(env, uid, jwtCandidate || null, {
      appCheckToken: request.headers.get('X-Firebase-AppCheck')?.trim() || undefined,
    });
    if (erased.kind === 'reject') {
      if (!telegramUser) return pack({ user: null, error: erased.error });
      firebaseUser = null;
    }
  }

  if (telegramUser && firebaseUser) {
    // Do not merge. A dual-credential request must not change the other row's account_id
    // or mirror sub:* keys. The user links explicitly via POST /api/auth/link.
    let resolvedTelegram = telegramUser;
    try {
      resolvedTelegram = await withAccountId(env, telegramUser);
    } catch {
      /* keep the verified in-memory Telegram identity */
    }
    try {
      await withAccountId(env, firebaseUser);
    } catch {
      /* Firebase row stays as it was; still do not merge */
    }
    return pack({ user: resolvedTelegram });
  }

  const primary = telegramUser || firebaseUser;
  if (primary) {
    try {
      return pack({ user: await withAccountId(env, primary) });
    } catch {
      return pack({ user: primary });
    }
  }

  if (env.REQUIRE_TG_AUTH === 'true') {
    const hint = env.FIREBASE_PROJECT_ID
      ? 'Sign in with Firebase or open the app inside Telegram.'
      : 'Telegram sign-in required';
    return pack({ user: null, error: hint });
  }
  return pack({ user: null });
}

export async function fetchWithTimeout(input: string, init: RequestInit, ms: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function isAbortError(e: unknown): boolean {
  return Boolean(
    e &&
      typeof e === 'object' &&
      ((e as { name?: string }).name === 'AbortError' ||
        /abort/i.test(String((e as { message?: string }).message || '')))
  );
}
