/**
 * Opaque HttpOnly session records in KV.
 * Cookie value is `sid_*` (never a raw Firebase ID token).
 */
import type { Env } from './env';

/** Keep in sync with authMiddleware SESSION_COOKIE_MAX_AGE. */
const SESSION_TTL_SECONDS = 14 * 24 * 3600;

export const OPAQUE_SESSION_PREFIX = 'sid_';

export type OpaqueSessionRecord = {
  uid: string;
  email?: string;
  name?: string;
  createdAt: number;
  exp: number;
};

export function isOpaqueSessionId(token: string): boolean {
  return /^sid_[a-f0-9]{32,64}$/i.test(String(token || '').trim());
}

/** Heuristic: three base64url segments (legacy cookie that still holds a Firebase ID token). */
export function looksLikeJwt(token: string): boolean {
  const parts = String(token || '').split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function opaqueSessionKvKey(sessionId: string): string {
  return `session:${sessionId}`;
}

export async function mintOpaqueSession(
  env: Env,
  user: { uid: string; email?: string; name?: string },
): Promise<string | null> {
  if (!env.LUMINARA_KV) return null;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const id = `${OPAQUE_SESSION_PREFIX}${hex}`;
  const now = Date.now();
  const record: OpaqueSessionRecord = {
    uid: user.uid,
    email: user.email,
    name: user.name,
    createdAt: now,
    exp: now + SESSION_TTL_SECONDS * 1000,
  };
  await env.LUMINARA_KV.put(opaqueSessionKvKey(id), JSON.stringify(record), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return id;
}

export async function loadOpaqueSession(env: Env, sessionId: string): Promise<OpaqueSessionRecord | null> {
  if (!env.LUMINARA_KV || !isOpaqueSessionId(sessionId)) return null;
  const record = (await env.LUMINARA_KV.get(opaqueSessionKvKey(sessionId), 'json')) as OpaqueSessionRecord | null;
  if (!record || typeof record.uid !== 'string' || !record.uid) return null;
  if (typeof record.exp === 'number' && record.exp < Date.now()) {
    await env.LUMINARA_KV.delete(opaqueSessionKvKey(sessionId));
    return null;
  }
  return record;
}

export async function revokeOpaqueSession(env: Env, sessionId: string): Promise<void> {
  if (!env.LUMINARA_KV || !isOpaqueSessionId(sessionId)) return;
  await env.LUMINARA_KV.delete(opaqueSessionKvKey(sessionId));
}
