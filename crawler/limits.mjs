/**
 * Request limits for the crawler: CORS origin allowlist, browser-session semaphore and per-IP
 * rate limiter. Pure helpers (no express, no browser) so the Vitest suite can cover them.
 */

export function parsePositiveInt(raw, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return fallback;
  const n = Number(text);
  if (!Number.isSafeInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Comma-separated exact origins. A trailing slash is dropped because Origin headers never carry one. */
export function parseAllowedOrigins(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map(s => s.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
}

/** Returns the origin to echo in Access-Control-Allow-Origin, or null when it is not allowlisted. */
export function resolveCorsOrigin(origin, allowed) {
  if (typeof origin !== 'string' || !origin || !allowed || allowed.size === 0) return null;
  return allowed.has(origin) ? origin : null;
}

/**
 * Non-blocking counting semaphore. `tryAcquire()` returns a release function, or null when
 * saturated. Each release function frees its slot at most once, however often it is called.
 */
export function createSemaphore(max) {
  const limit = Math.max(1, Math.floor(Number(max)) || 1);
  let active = 0;
  return {
    get active() {
      return active;
    },
    get max() {
      return limit;
    },
    tryAcquire() {
      if (active >= limit) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}

/**
 * Fixed-window counter per key. Expired buckets are pruned at most once per window, and the map is
 * hard-capped at `maxBuckets` (oldest evicted) so a spread of source addresses cannot grow memory.
 */
export function createRateLimiter({ limit, windowMs = 60_000, maxBuckets = 10_000, now = Date.now } = {}) {
  const cap = Math.max(1, Math.floor(Number(limit)) || 1);
  const buckets = new Map();
  let lastPrune = now();

  function prune(at = now()) {
    for (const [key, bucket] of buckets) {
      if (at - bucket.start >= windowMs) buckets.delete(key);
    }
    lastPrune = at;
  }

  function hit(key) {
    const at = now();
    if (at - lastPrune >= windowMs) prune(at);

    let bucket = buckets.get(key);
    if (!bucket || at - bucket.start >= windowMs) {
      if (bucket) buckets.delete(key);
      bucket = { start: at, count: 0 };
      buckets.set(key, bucket);
      while (buckets.size > maxBuckets) {
        buckets.delete(buckets.keys().next().value);
      }
    }

    bucket.count += 1;
    const retryAfterSec = Math.max(1, Math.ceil((bucket.start + windowMs - at) / 1000));
    if (bucket.count > cap) return { allowed: false, remaining: 0, retryAfterSec };
    return { allowed: true, remaining: cap - bucket.count, retryAfterSec };
  }

  return {
    hit,
    prune,
    get size() {
      return buckets.size;
    },
  };
}

function normalizeIp(ip) {
  const raw = String(ip || '').trim().replace(/^\[|\]$/g, '');
  return raw.toLowerCase().startsWith('::ffff:') && raw.includes('.') ? raw.slice(7) : raw;
}

/**
 * Socket address by default. With `trustProxy`, the right-most X-Forwarded-For entry is used: it is
 * the one appended by the proxy directly in front of us, whereas left-most entries are client-supplied.
 */
export function resolveClientIp(remoteAddress, forwardedFor, trustProxy = false) {
  if (trustProxy && forwardedFor) {
    const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : String(forwardedFor);
    const hops = header.split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length > 0) return normalizeIp(hops[hops.length - 1]);
  }
  return normalizeIp(remoteAddress) || 'unknown';
}
