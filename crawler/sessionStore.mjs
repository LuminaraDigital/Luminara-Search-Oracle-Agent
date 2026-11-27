/**
 * In-memory browser session store for indexed DOM observe/act.
 * TTL: 10 minutes idle. Cap: 32 sessions (also bounded by CRAWLER_MAX_CONCURRENCY
 * when each session holds a long-lived browser slot).
 */

import { randomUUID } from 'node:crypto';

export const SESSION_TTL_MS = 10 * 60 * 1000;
export const MAX_SESSIONS = 32;

/**
 * @typedef {object} BrowserSession
 * @property {string} id
 * @property {import('patchright').Browser} browser
 * @property {import('patchright').BrowserContext} context
 * @property {import('patchright').Page} page
 * @property {number} createdAt
 * @property {number} lastUsed
 * @property {string} [accountKey]
 * @property {() => void} [releaseSlot]  Semaphore release for the long-lived browser slot
 * @property {object} [lastObserve]     Last observe payload (for fingerprint / act lookup)
 */

/**
 * Verifies that callerAccountKey matches the session's tenant owner.
 * Tenant-owned sessions require an exact matching caller key; unowned sessions require no caller key.
 */
export function isSessionOwner(session, callerAccountKey) {
  if (!session) return false;
  const owner = typeof session.accountKey === 'string' ? session.accountKey.trim() : '';
  const caller = typeof callerAccountKey === 'string' ? callerAccountKey.trim() : '';
  if (!owner) return !caller;
  return Boolean(caller) && caller === owner;
}

/**
 * @param {{ ttlMs?: number, maxSessions?: number, now?: () => number }} [opts]
 */
export function createSessionStore({
  ttlMs = SESSION_TTL_MS,
  maxSessions = MAX_SESSIONS,
  now = Date.now,
} = {}) {
  /** @type {Map<string, BrowserSession>} */
  const sessions = new Map();

  function create(fields) {
    const at = now();
    if (sessions.size >= maxSessions) {
      return { ok: false, error: 'Session cap reached; close idle sessions or retry later' };
    }
    const id = fields.id || randomUUID();
    if (sessions.has(id)) {
      return { ok: false, error: 'Session id already exists' };
    }
    const accountKey =
      typeof fields.accountKey === 'string' && fields.accountKey.trim()
        ? fields.accountKey.trim().slice(0, 128)
        : undefined;
    /** @type {BrowserSession} */
    const session = {
      id,
      browser: fields.browser,
      context: fields.context,
      page: fields.page,
      createdAt: at,
      lastUsed: at,
      accountKey,
      releaseSlot: fields.releaseSlot,
      lastObserve: fields.lastObserve ?? null,
    };
    sessions.set(id, session);
    return { ok: true, session };
  }

  function get(id) {
    if (!id || typeof id !== 'string') return null;
    return sessions.get(id) || null;
  }

  function getOwned(id, callerAccountKey) {
    const session = get(id);
    if (!session) return { ok: false, status: 404, error: 'Unknown or expired session' };
    if (!isSessionOwner(session, callerAccountKey)) {
      return { ok: false, status: 403, error: 'Session belongs to another account' };
    }
    return { ok: true, session };
  }

  function touch(id) {
    const session = sessions.get(id);
    if (!session) return null;
    session.lastUsed = now();
    return session;
  }

  /**
   * Remove a session from the map. Does not close the browser; the caller must
   * close browser/context and invoke releaseSlot.
   * @returns {BrowserSession | null}
   */
  function destroy(id) {
    const session = sessions.get(id);
    if (!session) return null;
    sessions.delete(id);
    return session;
  }

  function destroyOwned(id, callerAccountKey) {
    const owned = getOwned(id, callerAccountKey);
    if (!owned.ok) return owned;
    sessions.delete(owned.session.id);
    return owned;
  }

  /**
   * Remove idle sessions past TTL. Returns the removed session objects so the
   * caller can close browsers and release slots.
   * @returns {BrowserSession[]}
   */
  function destroyExpired() {
    const at = now();
    const expired = [];
    for (const [id, session] of sessions) {
      if (at - session.lastUsed >= ttlMs) {
        sessions.delete(id);
        expired.push(session);
      }
    }
    return expired;
  }

  return {
    create,
    get,
    getOwned,
    touch,
    destroy,
    destroyOwned,
    destroyExpired,
    get size() {
      return sessions.size;
    },
    get maxSessions() {
      return maxSessions;
    },
    get ttlMs() {
      return ttlMs;
    },
  };
}
