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
    /** @type {BrowserSession} */
    const session = {
      id,
      browser: fields.browser,
      context: fields.context,
      page: fields.page,
      createdAt: at,
      lastUsed: at,
      accountKey: fields.accountKey,
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
    touch,
    destroy,
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
