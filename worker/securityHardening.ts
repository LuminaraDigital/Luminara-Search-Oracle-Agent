/**
 * Zero-trust helpers for Worker trust boundaries (IDOR, PII projection,
 * dual rate limits, mass-assignment allow-lists).
 *
 * Stack note: this product uses Cloudflare Workers + D1 + Firebase Auth ID
 * tokens. There is no Cloud Firestore; identity is derived from verified
 * Telegram / Firebase / API-key / MCP OAuth credentials, never from client
 * body fields such as userId.
 */
import type { Env } from './env';
import type { EncryptedKeyBag } from './userTypes';
import type { WorkspacePayload } from './userStore';
import { json } from './workerUtils';

const MAX_STORAGE_KEYS = 200;
const MAX_STORAGE_VALUE_CHARS = 200_000;
const MAX_KEY_BAG_ENTRIES = 64;
const MAX_KEY_VALUE_CHARS = 8_000;

/** Privilege / billing fields that must never be client-writable via workspace blobs. */
const FORBIDDEN_WORKSPACE_TOP_LEVEL = new Set([
  'role',
  'plan',
  'credits',
  'wallet_balance',
  'walletBalance',
  'is_verified',
  'isVerified',
  'accountId',
  'userId',
  'tenantId',
  'apiAccess',
  'mcpAccess',
]);

export function isProductionLike(env: Env): boolean {
  const e = String(env.ENVIRONMENT || '').toLowerCase();
  return e === 'production' || e === 'prod';
}

/**
 * OAuth HMAC material. Production fails closed without an explicit secret.
 * Local / staging may fall back to AUTH_WEBHOOK_SECRET or BOT_TOKEN only.
 */
export function resolveOAuthSigningSecret(env: Env): { ok: true; secret: string } | { ok: false; error: string } {
  const primary = (env.MCP_OAUTH_SECRET || '').trim();
  if (primary) return { ok: true, secret: primary };

  if (isProductionLike(env)) {
    return {
      ok: false,
      error: 'MCP_OAUTH_SECRET is required in production. Set it via Wrangler secrets.',
    };
  }

  const fallback = (env.AUTH_WEBHOOK_SECRET || env.BOT_TOKEN || '').trim();
  if (fallback) return { ok: true, secret: fallback };

  return {
    ok: false,
    error: 'No OAuth signing secret configured. Set MCP_OAUTH_SECRET (preferred) or AUTH_WEBHOOK_SECRET.',
  };
}

export type AdminUserProjection = {
  id: string;
  source: string;
  accountId: string;
  createdAt: number;
  lastSeenAt: number;
  hasEmail: boolean;
  hasTelegram: boolean;
  hasFirebase: boolean;
};

/** Strip email / telegram_id / firebase_uid from admin list payloads. */
export function projectAdminUser(row: {
  id: string;
  source: string;
  account_id: string;
  email?: string;
  telegram_id?: string;
  firebase_uid?: string;
  created_at: number;
  last_seen_at: number;
}): AdminUserProjection {
  return {
    id: row.id,
    source: row.source,
    accountId: row.account_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    hasEmail: Boolean(row.email),
    hasTelegram: Boolean(row.telegram_id),
    hasFirebase: Boolean(row.firebase_uid),
  };
}

function clampStringRecord(
  input: Record<string, unknown> | undefined,
  maxEntries: number,
  maxValueChars: number,
): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(input)) {
    if (n >= maxEntries) break;
    if (typeof k !== 'string' || !k.trim()) continue;
    if (typeof v !== 'string') continue;
    out[k.slice(0, 200)] = v.slice(0, maxValueChars);
    n += 1;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Mass-assignment defense for PUT /workspace.
 * Allow-lists storage / keys / encryptedKeys only; rejects privilege fields.
 */
export function sanitizeWorkspaceWrite(
  raw: unknown,
): { ok: true; payload: WorkspacePayload } | { ok: false; error: string } {
  if (raw == null) return { ok: true, payload: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'payload must be an object' };
  }
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_WORKSPACE_TOP_LEVEL.has(key)) {
      return { ok: false, error: `Forbidden field in workspace payload: ${key}` };
    }
    if (key !== 'storage' && key !== 'keys' && key !== 'encryptedKeys') {
      return { ok: false, error: `Unexpected workspace field: ${key}. Allowed: storage, keys, encryptedKeys.` };
    }
  }

  const payload: WorkspacePayload = {};
  if (body.storage !== undefined) {
    if (typeof body.storage !== 'object' || body.storage === null || Array.isArray(body.storage)) {
      return { ok: false, error: 'storage must be a string map' };
    }
    payload.storage = clampStringRecord(body.storage as Record<string, unknown>, MAX_STORAGE_KEYS, MAX_STORAGE_VALUE_CHARS);
  }
  if (body.keys !== undefined) {
    if (typeof body.keys !== 'object' || body.keys === null || Array.isArray(body.keys)) {
      return { ok: false, error: 'keys must be a string map' };
    }
    payload.keys = clampStringRecord(body.keys as Record<string, unknown>, MAX_KEY_BAG_ENTRIES, MAX_KEY_VALUE_CHARS);
  }
  if (body.encryptedKeys !== undefined) {
    if (typeof body.encryptedKeys !== 'object' || body.encryptedKeys === null || Array.isArray(body.encryptedKeys)) {
      return { ok: false, error: 'encryptedKeys must be an object' };
    }
    payload.encryptedKeys = body.encryptedKeys as EncryptedKeyBag;
  }
  return { ok: true, payload };
}

/** Standard rate-limit response headers (Limit / Remaining / Reset + Retry-After on breach). */
export function rateLimitHeaders(opts: {
  limit: number;
  remaining: number;
  windowSec: number;
  retryAfterSec?: number;
}): Record<string, string> {
  const resetEpoch = Math.floor(Date.now() / 1000) + Math.max(1, opts.windowSec);
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(opts.limit),
    'X-RateLimit-Remaining': String(Math.max(0, opts.remaining)),
    'X-RateLimit-Reset': String(resetEpoch),
  };
  if (opts.retryAfterSec != null) {
    headers['Retry-After'] = String(Math.max(1, opts.retryAfterSec));
  }
  return headers;
}

export function rateLimitedResponse(opts: {
  limit: number;
  remaining?: number;
  windowSec: number;
  retryAfterSec?: number;
  code?: string;
  error?: string;
}): Response {
  const windowSec = Math.max(1, opts.windowSec);
  const retryAfterSec = opts.retryAfterSec ?? windowSec;
  return json(
    {
      ok: false,
      error: opts.error || 'Too many requests. Slow down and try again.',
      code: opts.code || 'RATE_LIMITED',
    },
    429,
    rateLimitHeaders({
      limit: opts.limit,
      remaining: opts.remaining ?? 0,
      windowSec,
      retryAfterSec,
    }),
  );
}

export type DualRateLimitResult =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; response: Response };

/**
 * Dual-key fixed window via KV (account + IP). Fail closed when KV missing
 * and auth is required. Returns standard X-RateLimit-* headers on allow or 429.
 */
export async function enforceDualRateLimit(
  env: Env,
  opts: {
    action: string;
    accountId?: string | null;
    ip: string;
    limitPerKey: number;
    windowSec: number;
  },
): Promise<DualRateLimitResult> {
  if (!env.LUMINARA_KV) {
    if (String(env.REQUIRE_TG_AUTH || '').toLowerCase() === 'true') {
      return {
        ok: false,
        response: json(
          { ok: false, error: 'Rate limit store unavailable. Try again later.', code: 'RATE_STORE_UNAVAILABLE' },
          503,
        ),
      };
    }
    return {
      ok: true,
      headers: rateLimitHeaders({
        limit: opts.limitPerKey,
        remaining: opts.limitPerKey,
        windowSec: opts.windowSec,
      }),
    };
  }

  const windowSec = Math.max(1, opts.windowSec);
  const limit = Math.max(1, opts.limitPerKey);
  const keys: string[] = [`rl:${opts.action}:ip:${opts.ip || 'unknown'}`];
  if (opts.accountId) keys.push(`rl:${opts.action}:acct:${opts.accountId}`);

  let worstRemaining = limit;
  for (const key of keys) {
    const raw = await env.LUMINARA_KV.get(key);
    const count = Number(raw || 0) + 1;
    if (count > limit) {
      console.warn(
        JSON.stringify({
          event: 'rate_limit_exceeded',
          action: opts.action,
          key,
          count,
          limit,
          windowSec,
          accountId: opts.accountId || null,
          ip: opts.ip,
        }),
      );
      return {
        ok: false,
        response: rateLimitedResponse({ limit, windowSec, remaining: 0 }),
      };
    }
    await env.LUMINARA_KV.put(key, String(count), { expirationTtl: windowSec });
    worstRemaining = Math.min(worstRemaining, Math.max(0, limit - count));
  }

  return {
    ok: true,
    headers: rateLimitHeaders({ limit, remaining: worstRemaining, windowSec }),
  };
}

/**
 * Cloudflare Workers Rate Limiting binding (edge-local, multi-isolate within a colo).
 * Optional: when the binding is absent (local tests), this is a no-op allow.
 */
export async function enforceEdgeBindingLimit(
  limiter: { limit: (opts: { key: string }) => Promise<{ success: boolean }> } | undefined,
  key: string,
  meta: { action: string; limit: number; windowSec: number },
): Promise<DualRateLimitResult> {
  if (!limiter) {
    return {
      ok: true,
      headers: rateLimitHeaders({
        limit: meta.limit,
        remaining: meta.limit,
        windowSec: meta.windowSec,
      }),
    };
  }
  const { success } = await limiter.limit({ key });
  if (!success) {
    console.warn(
      JSON.stringify({
        event: 'edge_rate_limit_exceeded',
        action: meta.action,
        key,
        limit: meta.limit,
        windowSec: meta.windowSec,
      }),
    );
    return {
      ok: false,
      response: rateLimitedResponse({
        limit: meta.limit,
        windowSec: meta.windowSec,
        code: 'EDGE_RATE_LIMITED',
      }),
    };
  }
  return {
    ok: true,
    headers: rateLimitHeaders({
      limit: meta.limit,
      remaining: Math.max(0, meta.limit - 1),
      windowSec: meta.windowSec,
    }),
  };
}

/** Attach rate-limit headers onto an existing response (success path). */
export function withRateLimitHeaders(response: Response, headers: Record<string, string>): Response {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) {
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}

// ---- Sliding-window / burst / outbound budget (toll-fraud defense) ----------------------------

type SlidingBucket = { timestamps: number[] };

async function readSlidingBucket(kv: KVNamespace, key: string): Promise<number[]> {
  const raw = await kv.get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SlidingBucket;
    return Array.isArray(parsed.timestamps)
      ? parsed.timestamps.filter((t) => typeof t === 'number' && Number.isFinite(t))
      : [];
  } catch {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Array.from({ length: Math.min(n, 10_000) }, () => Date.now()) : [];
  }
}

/**
 * Atomic-ish sliding window on KV. Not strongly consistent across isolates;
 * pair with edge Rate Limiting bindings for burst fail-closed.
 */
export async function enforceKvSlidingWindow(
  env: Env,
  opts: {
    key: string;
    maxRequests: number;
    windowSeconds: number;
    failClosedWithoutKv?: boolean;
  },
): Promise<DualRateLimitResult> {
  const windowSec = Math.max(1, opts.windowSeconds);
  const limit = Math.max(1, opts.maxRequests);
  if (!env.LUMINARA_KV) {
    if (opts.failClosedWithoutKv || String(env.REQUIRE_TG_AUTH || '').toLowerCase() === 'true') {
      return {
        ok: false,
        response: json(
          { ok: false, error: 'Rate limit store unavailable. Try again later.', code: 'RATE_STORE_UNAVAILABLE' },
          503,
        ),
      };
    }
    return {
      ok: true,
      headers: rateLimitHeaders({ limit, remaining: limit, windowSec }),
    };
  }

  const now = Date.now();
  const windowMs = windowSec * 1000;
  const cutoff = now - windowMs;
  const prior = (await readSlidingBucket(env.LUMINARA_KV, opts.key)).filter((t) => t > cutoff);
  if (prior.length >= limit) {
    const oldest = Math.min(...prior);
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    console.warn(
      JSON.stringify({
        event: 'rate_limit_exceeded',
        kind: 'sliding_window',
        key: opts.key,
        count: prior.length,
        limit,
        windowSec,
      }),
    );
    return {
      ok: false,
      response: rateLimitedResponse({
        limit,
        windowSec,
        remaining: 0,
        retryAfterSec,
        code: 'RATE_LIMITED',
      }),
    };
  }

  const next = [...prior, now];
  await env.LUMINARA_KV.put(opts.key, JSON.stringify({ timestamps: next } satisfies SlidingBucket), {
    expirationTtl: Math.max(60, windowSec + 60),
  });
  return {
    ok: true,
    headers: rateLimitHeaders({
      limit,
      remaining: Math.max(0, limit - next.length),
      windowSec,
    }),
  };
}

/**
 * Reusable sliding-window limiter factory for public or authenticated keys.
 * Usage: `const limitReset = rateLimiter({ maxRequests: 3, windowSeconds: 900, keyPrefix: 'rl:pwd_reset' })`
 * then `await limitReset(env, \`ip:${ip}\`)`.
 */
export function rateLimiter(opts: {
  maxRequests: number;
  windowSeconds: number;
  keyPrefix: string;
  failClosedWithoutKv?: boolean;
}): (env: Env, keySuffix: string) => Promise<DualRateLimitResult> {
  const prefix = opts.keyPrefix.replace(/:+$/, '');
  return (env, keySuffix) =>
    enforceKvSlidingWindow(env, {
      key: `${prefix}:${keySuffix}`,
      maxRequests: opts.maxRequests,
      windowSeconds: opts.windowSeconds,
      failClosedWithoutKv: opts.failClosedWithoutKv,
    });
}

/** Password reset: max 3 / 15 minutes per IP. */
export const passwordResetIpLimiter = rateLimiter({
  maxRequests: 3,
  windowSeconds: 15 * 60,
  keyPrefix: 'rl:pwd_reset',
  failClosedWithoutKv: true,
});

/** OTP / verification triggers: max 5 / hour per IP (reserved for future SMS/email OTP). */
export const otpIpLimiter = rateLimiter({
  maxRequests: 5,
  windowSeconds: 60 * 60,
  keyPrefix: 'rl:otp',
  failClosedWithoutKv: true,
});

/** Sign-up: max 5 / hour per IP (credential stuffing / mass registration). */
export const signUpIpLimiter = rateLimiter({
  maxRequests: 5,
  windowSeconds: 60 * 60,
  keyPrefix: 'rl:signup',
  failClosedWithoutKv: true,
});

/** Sign-in: max 20 / 15 minutes per IP (brute-force flooding). */
export const signInIpLimiter = rateLimiter({
  maxRequests: 20,
  windowSeconds: 15 * 60,
  keyPrefix: 'rl:signin',
  failClosedWithoutKv: true,
});

/**
 * Dual-key sliding window: reject if either `uid:<id>` or `ip:<ip>` bucket is exhausted.
 * Prefer verified auth.uid / billing account id for the uid key.
 */
export async function enforceDualKeySlidingLimit(
  env: Env,
  opts: {
    action: string;
    uid: string;
    ip: string;
    maxRequests: number;
    windowSeconds: number;
  },
): Promise<DualRateLimitResult> {
  const uidKey = `uid:${opts.uid || 'anonymous'}`;
  const ipKey = `ip:${opts.ip || 'unknown'}`;
  const prefix = `rl:${opts.action}`;
  const limitUid = await enforceKvSlidingWindow(env, {
    key: `${prefix}:${uidKey}`,
    maxRequests: opts.maxRequests,
    windowSeconds: opts.windowSeconds,
    failClosedWithoutKv: true,
  });
  if (!limitUid.ok) return limitUid;
  const limitIp = await enforceKvSlidingWindow(env, {
    key: `${prefix}:${ipKey}`,
    maxRequests: opts.maxRequests,
    windowSeconds: opts.windowSeconds,
    failClosedWithoutKv: true,
  });
  if (!limitIp.ok) return limitIp;
  const remUid = Number(limitUid.headers['X-RateLimit-Remaining'] || 0);
  const remIp = Number(limitIp.headers['X-RateLimit-Remaining'] || 0);
  return {
    ok: true,
    headers: rateLimitHeaders({
      limit: opts.maxRequests,
      remaining: Math.min(remUid, remIp),
      windowSec: opts.windowSeconds,
    }),
  };
}

/** Isolate-local burst gate: fail closed at 5+ requests / second from one IP. */
const burstLimiter = (() => {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    check(ip: string, maxPerSec = 5): DualRateLimitResult {
      const now = Date.now();
      const key = `burst:${ip || 'unknown'}`;
      let b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + 1000 };
        buckets.set(key, b);
        if (buckets.size > 20_000) buckets.clear();
      }
      b.count += 1;
      if (b.count > maxPerSec) {
        console.warn(
          JSON.stringify({
            event: 'burst_rate_limit_exceeded',
            ip,
            count: b.count,
            limit: maxPerSec,
            windowSec: 1,
          }),
        );
        return {
          ok: false,
          response: rateLimitedResponse({
            limit: maxPerSec,
            windowSec: 1,
            remaining: 0,
            retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
            code: 'BURST_RATE_LIMITED',
            error: 'Request burst rejected. Slow down.',
          }),
        };
      }
      return {
        ok: true,
        headers: rateLimitHeaders({
          limit: maxPerSec,
          remaining: Math.max(0, maxPerSec - b.count),
          windowSec: 1,
        }),
      };
    },
  };
})();

export function enforceBurstLimit(ip: string, maxPerSec = 5): DualRateLimitResult {
  return burstLimiter.check(ip, maxPerSec);
}

const DEFAULT_OUTBOUND_DAILY_LIMIT = 200;

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Financial killswitch: daily outbound email/OTP dispatch counter.
 * KV doc: `system_metrics:outbound_daily:{YYYY-MM-DD}`.
 */
export async function checkOutboundDailyBudget(
  env: Env,
  opts?: { limit?: number },
): Promise<{ ok: true; remaining: number; limit: number } | { ok: false; response: Response }> {
  const limit = Math.max(
    1,
    opts?.limit ??
      (Number(env.OUTBOUND_EMAIL_DAILY_LIMIT || DEFAULT_OUTBOUND_DAILY_LIMIT) ||
        DEFAULT_OUTBOUND_DAILY_LIMIT),
  );
  if (!env.LUMINARA_KV) {
    // No counter store means no killswitch. Failing open here would let a flood
    // bill the project without limit, so production refuses to dispatch at all.
    if (isProductionLike(env)) {
      console.error(
        JSON.stringify({
          event: 'outbound_budget_store_unavailable',
          alert: 'admin_emergency',
          detail: 'LUMINARA_KV missing; outbound messaging failed closed.',
        }),
      );
      return {
        ok: false,
        response: json(
          {
            ok: false,
            error: 'Outbound messaging is temporarily unavailable. Try again later.',
            code: 'OUTBOUND_BUDGET_UNAVAILABLE',
          },
          503,
        ),
      };
    }
    return { ok: true, remaining: limit, limit };
  }
  const key = `system_metrics:outbound_daily:${utcDayKey()}`;
  const count = Number((await env.LUMINARA_KV.get(key)) || 0);
  if (count >= limit) {
    console.error(
      JSON.stringify({
        event: 'outbound_daily_budget_exhausted',
        key,
        count,
        limit,
        alert: 'admin_emergency',
      }),
    );
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: 'Outbound messaging temporarily paused. Try again tomorrow.',
          code: 'OUTBOUND_BUDGET_EXCEEDED',
        },
        503,
      ),
    };
  }
  return { ok: true, remaining: Math.max(0, limit - count), limit };
}

/** Increment daily outbound counter after a successful provider dispatch. */
export async function incrementOutboundDaily(env: Env, by = 1): Promise<number> {
  if (!env.LUMINARA_KV || by <= 0) return 0;
  const key = `system_metrics:outbound_daily:${utcDayKey()}`;
  const next = Number((await env.LUMINARA_KV.get(key)) || 0) + by;
  await env.LUMINARA_KV.put(key, String(next), { expirationTtl: 60 * 60 * 48 });
  const limit =
    Number(env.OUTBOUND_EMAIL_DAILY_LIMIT || DEFAULT_OUTBOUND_DAILY_LIMIT) || DEFAULT_OUTBOUND_DAILY_LIMIT;
  if (next >= limit) {
    console.error(
      JSON.stringify({
        event: 'outbound_daily_budget_exhausted',
        key,
        count: next,
        limit,
        alert: 'admin_emergency',
      }),
    );
  } else if (next >= Math.floor(limit * 0.8)) {
    console.warn(
      JSON.stringify({
        event: 'outbound_daily_budget_warning',
        key,
        count: next,
        limit,
      }),
    );
  }
  return next;
}
