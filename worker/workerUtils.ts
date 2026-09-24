import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { validateInitData } from './telegramAuth';
import { bearerFromAuthorization, verifyFirebaseIdToken } from './firebaseAuth';
import { linkTelegramAndFirebase, withAccountId } from './userStore';

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
 */
export function applyCorsHeaders(response: Response, cors: Record<string, string>): Response {
  const mergeKeys = new Set([
    'access-control-allow-headers',
    'access-control-allow-methods',
    'access-control-expose-headers',
  ]);
  for (const [k, v] of Object.entries(cors)) {
    if (mergeKeys.has(k.toLowerCase())) {
      response.headers.set(k, unionCorsHeaderValues(response.headers.get(k), v));
    } else {
      response.headers.set(k, v);
    }
  }
  return response;
}

export function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || env.WEBAPP_URL || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.some(a => origin === a || origin === a.replace(/\/$/, ''));
  return ok
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          'content-type, accept, authorization, x-telegram-init-data, x-provider-key, x-goog-api-key, x-goog-api-client, x-share-password, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
        'Access-Control-Expose-Headers':
          'x-quota-limit, x-quota-remaining, x-quota-reset, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, retry-after, mcp-session-id',
        'Access-Control-Allow-Credentials': 'true',
        'Vary': 'Origin',
      }
    : {};
}

/** Extract __session token from Cookie header */
export function getSessionCookieToken(request: Request): string | null {
  const cookie = request.headers.get('cookie') || '';
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)__session=([^;]+)/);
  return match ? decodeURIComponent(match[1].trim()) : null;
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
 * 1) HttpOnly __session cookie token (Cookie: __session=…), or
 * 2) Firebase Auth ID token (Authorization: Bearer …), or
 * 3) Telegram Mini App initData (x-telegram-init-data),
 * and when BOTH are present, links them onto one account_id so Stars/TON/Stripe share entitlements.
 * Upserts a durable user row when identity succeeds.
 * Returns null when auth is optional and absent.
 */
export async function identify(request: Request, env: Env): Promise<{ user: HostedIdentity | null; error?: string }> {
  const initData = request.headers.get('x-telegram-init-data');
  const cookieToken = getSessionCookieToken(request);
  const bearer = bearerFromAuthorization(request.headers.get('authorization')) || cookieToken;

  // CSRF protection: verify Origin header on state-changing cookie-based mutations
  if (cookieToken && !initData && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if (origin) {
      const allowed = (env.ALLOWED_ORIGINS || env.WEBAPP_URL || '').split(',').map(s => s.trim()).filter(Boolean);
      const isAllowed = allowed.some(a => origin === a || origin === a.replace(/\/$/, ''));
      if (!isAllowed) {
        return { user: null, error: 'CSRF validation failed: Origin header rejected' };
      }
    }
  }

  let telegramUser: HostedIdentity | null = null;
  let firebaseUser: HostedIdentity | null = null;

  if (initData) {
    if (!env.BOT_TOKEN) return { user: null, error: 'Server has no BOT_TOKEN configured' };
    const result = await validateInitData(initData, env.BOT_TOKEN);
    if (!result.ok) return { user: null, error: result.reason };
    const tg = result.user;
    telegramUser = {
      id: String(tg.id),
      source: 'telegram',
      name: [tg.first_name, tg.last_name].filter(Boolean).join(' ') || tg.username,
    };
  }

  if (bearer && env.FIREBASE_PROJECT_ID) {
    const result = await verifyFirebaseIdToken(bearer, env.FIREBASE_PROJECT_ID);
    if (!result.ok) {
      // Telegram-only callers still succeed when Firebase token is bad/expired.
      if (!telegramUser) return { user: null, error: result.reason };
    } else {
      firebaseUser = {
        id: `fb:${result.user.uid}`,
        source: 'firebase',
        email: result.user.email,
        name: result.user.name,
      };
    }
  }

  if (telegramUser && firebaseUser) {
    try {
      const linked = await linkTelegramAndFirebase(
        env,
        telegramUser.id,
        firebaseUser.id.replace(/^fb:/, ''),
        { email: firebaseUser.email, name: firebaseUser.name, tgName: telegramUser.name },
      );
      // Prefer Telegram identity inside the Mini App; accountId is shared either way.
      const primary = initData ? telegramUser : firebaseUser;
      return { user: { ...primary, accountId: linked.accountId } };
    } catch {
      /* fall through to single-identity upsert */
    }
  }

  const primary = telegramUser || firebaseUser;
  if (primary) {
    try {
      return { user: await withAccountId(env, primary) };
    } catch {
      return { user: primary };
    }
  }

  if (env.REQUIRE_TG_AUTH === 'true') {
    const hint = env.FIREBASE_PROJECT_ID
      ? 'Sign in with Firebase or open the app inside Telegram.'
      : 'Telegram sign-in required';
    return { user: null, error: hint };
  }
  return { user: null };
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
