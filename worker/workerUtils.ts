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

export function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || env.WEBAPP_URL || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.some(a => origin === a || origin === a.replace(/\/$/, ''));
  return ok
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, x-telegram-init-data, x-provider-key, authorization, x-goog-api-key, x-goog-api-client',
        'Access-Control-Expose-Headers': 'x-quota-limit, x-quota-remaining, x-quota-reset',
        'Vary': 'Origin',
      }
    : {};
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
 * 1) Telegram Mini App initData (x-telegram-init-data), or
 * 2) Firebase Auth ID token (Authorization: Bearer …),
 * and when BOTH are present, links them onto one account_id so Stars/TON/Stripe share entitlements.
 * Upserts a durable user row when identity succeeds.
 * Returns null when auth is optional and absent.
 */
export async function identify(request: Request, env: Env): Promise<{ user: HostedIdentity | null; error?: string }> {
  const initData = request.headers.get('x-telegram-init-data');
  const bearer = bearerFromAuthorization(request.headers.get('authorization'));

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
