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

function deletedUserKvKey(uid: string): string {
  return `session_revoked_user:${uid}`;
}

/**
 * Sessions are keyed by session id with no per-user index, so a deleted user's sessions cannot be
 * listed and removed. Instead this marker, kept for one session lifetime, makes every session for
 * that uid fail to load, including one minted afterwards from a Firebase ID token that has not
 * expired yet. Firebase never reuses a uid, so the marker cannot block a later account.
 */
export async function revokeSessionsForDeletedUser(env: Env, uid: string): Promise<void> {
  if (!env.LUMINARA_KV || !uid) return;
  await env.LUMINARA_KV.put(deletedUserKvKey(uid), String(Date.now()), { expirationTtl: SESSION_TTL_SECONDS });
}

/** True when this login was deleted and its sessions were cut off. */
export async function isSessionRevokedUser(env: Env, userId: string): Promise<boolean> {
  if (!env.LUMINARA_KV || !userId) return false;
  const uid = userId.startsWith('fb:') ? userId.slice(3) : userId;
  return Boolean(await env.LUMINARA_KV.get(deletedUserKvKey(uid)));
}

/** Revoke all MCP OAuth KV access tokens and connection indexes for an erased account. */
export async function revokeAccountOAuthKvTokens(env: Env, accountId: string): Promise<number> {
  if (!accountId) return 0;
  let revoked = 0;
  if (env.DB) {
    try {
      const rows = await env.DB.prepare(
        `SELECT access_hash FROM mcp_oauth_refresh_access
         WHERE family_id IN (SELECT family_id FROM mcp_oauth_refresh_family WHERE account_id = ?)`,
      )
        .bind(accountId)
        .all<{ access_hash: string }>();
      for (const row of rows.results ?? []) {
        if (row.access_hash && env.LUMINARA_KV) {
          await env.LUMINARA_KV.delete(`mcp_oauth_token:${row.access_hash}`).catch(() => undefined);
          revoked += 1;
        }
      }
      await env.DB.prepare(`UPDATE mcp_oauth_refresh_family SET revoked = 1 WHERE account_id = ?`)
        .bind(accountId)
        .run()
        .catch(() => undefined);
    } catch {
      /* table may not exist in older fixtures */
    }
  }
  if (env.LUMINARA_KV && typeof env.LUMINARA_KV.list === 'function') {
    const { sha256Hex } = await import('./workerUtils');
    const prefix = `mcp_oauth_connection:${await sha256Hex(accountId)}:`;
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const listed = await env.LUMINARA_KV.list({ prefix, cursor });
      for (const item of listed.keys) {
        const suffix = item.name.slice(prefix.length);
        if (/^[a-f0-9]{64}$/.test(suffix)) {
          await env.LUMINARA_KV.delete(`mcp_oauth_token:${suffix}`).catch(() => undefined);
        }
        await env.LUMINARA_KV.delete(item.name).catch(() => undefined);
        revoked += 1;
      }
      if (listed.list_complete || !listed.cursor || listed.cursor === cursor) break;
      cursor = listed.cursor;
    }
  }
  return revoked;
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
  try {
    await env.LUMINARA_KV.put(opaqueSessionKvKey(id), JSON.stringify(record), {
      expirationTtl: SESSION_TTL_SECONDS,
    });
  } catch {
    console.warn(JSON.stringify({ event: 'session_store_error' }));
    return null;
  }
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
  if (await env.LUMINARA_KV.get(deletedUserKvKey(record.uid))) {
    await env.LUMINARA_KV.delete(opaqueSessionKvKey(sessionId));
    return null;
  }
  return record;
}

export async function revokeOpaqueSession(env: Env, sessionId: string): Promise<void> {
  if (!env.LUMINARA_KV || !isOpaqueSessionId(sessionId)) return;
  await env.LUMINARA_KV.delete(opaqueSessionKvKey(sessionId));
}
