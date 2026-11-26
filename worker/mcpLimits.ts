import type { Env } from './env';
import { invokeDailyQuota } from './dailyQuota';
import { redactSensitive } from './logRedaction';
import {
  enforceKvSlidingWindow,
  isProductionLike,
  meterDailyUse,
  utcDayResetEpoch,
  type DailyUseMeter,
  type DualRateLimitResult,
} from './securityHardening';

export const MCP_ACCOUNT_BURST_PER_MIN = 30;

/** Tool calls per minute for one OAuth client_id. Sessions and API keys have no client_id. */
export const MCP_CLIENT_BURST_PER_MIN = 30;

/**
 * Hosted paid MCP calls per UTC day on Agency. BYOK is not counted.
 * This is an abuse ceiling so a token cannot resell hosted research. It is not a marketed plan quota.
 */
export const MCP_HOSTED_PAID_DAILY = 200;

/** Dynamic client registration posts per minute per IP. */
export const MCP_OAUTH_REGISTER_PER_MIN = 10;

/** Token-endpoint posts per minute per IP. Authorization-code and refresh grants share this bucket. */
export const MCP_OAUTH_TOKEN_PER_MIN = 30;

export type McpDailyUsage = DailyUseMeter;

export type McpBurstDenial = {
  ok: false;
  code: 'MCP_ACCOUNT_BURST' | 'MCP_CLIENT_BURST';
  message: string;
  limit: number;
  resetAt: number;
  headers: Record<string, string>;
};

export type McpBurstResult = { ok: true } | McpBurstDenial;

function snapshot(meter: DailyUseMeter): McpDailyUsage {
  return { used: meter.used, limit: meter.limit, remaining: meter.remaining, resetAt: meter.resetAt };
}

/** Upper ceiling passed to DailyQuota when a plan has no daily cap so usage is still counted atomically. */
const UNLIMITED_METER_CEILING = 1_000_000_000;

function isDoSpendBody(value: unknown): value is { ok: boolean; used: number } {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    'ok' in (value as Record<string, unknown>) &&
    typeof (value as { ok?: unknown }).ok === 'boolean' &&
    'used' in (value as Record<string, unknown>) &&
    typeof (value as { used?: unknown }).used === 'number' &&
    Number.isFinite((value as { used: number }).used)
  );
}

/**
 * Spend one MCP daily unit. Uses atomic SQLite Durable Object (`DAILY_QUOTA`) when bound
 * to eliminate concurrent KV TOCTOU races; falls back to KV with fail-closed write checks
 * when `DAILY_QUOTA` is absent (local/unit tests). `limit` 0 still counts and never blocks.
 */
export async function spendMcpDailyCall(
  env: Env,
  accountId: string,
  limit: number,
  prefix = 'mcp_calls',
  label = 'MCP call',
): Promise<{ ok: true; usage: McpDailyUsage } | { ok: false; usage: McpDailyUsage; error: string; reason: 'limit' | 'store' }> {
  const resetAt = utcDayResetEpoch();
  if (env.DAILY_QUOTA) {
    const day = new Date().toISOString().slice(0, 10);
    const effectiveLimit = limit > 0 ? limit : UNLIMITED_METER_CEILING;
    const body = await invokeDailyQuota(env, `${prefix}:${accountId}:${day}`, 'spend', effectiveLimit);
    if (!isDoSpendBody(body)) {
      if (limit > 0) {
        return {
          ok: false,
          reason: 'store',
          error: `${label} quota store unavailable. Try again later.`,
          usage: { used: 0, limit, remaining: limit, resetAt },
        };
      }
      return { ok: true, usage: { used: 0, limit, remaining: null, resetAt } };
    }
    if (limit > 0 && !body.ok) {
      return {
        ok: false,
        reason: 'limit',
        error: `Daily ${label.toLowerCase()} limit of ${limit} reached.`,
        usage: { used: body.used, limit, remaining: 0, resetAt },
      };
    }
    return {
      ok: true,
      usage: {
        used: body.used,
        limit,
        remaining: limit <= 0 ? null : Math.max(0, limit - body.used),
        resetAt,
      },
    };
  }
  if (!env.LUMINARA_KV && limit > 0 && (env.REQUIRE_TG_AUTH === 'true' || isProductionLike(env))) {
    return {
      ok: false,
      reason: 'store',
      error: `${label} quota store unavailable. Try again later.`,
      usage: { used: 0, limit, remaining: limit, resetAt },
    };
  }
  const meter = await meterDailyUse(env, prefix, accountId, limit, label, true, true);
  const usage = snapshot(meter);
  if (!meter.ok) return { ok: false, usage, error: meter.error, reason: meter.reason };
  return { ok: true, usage };
}

export function dailyRateHeaders(usage: McpDailyUsage, blocked = false): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Reset': String(usage.resetAt),
  };
  if (usage.limit > 0) headers['X-RateLimit-Limit'] = String(usage.limit);
  if (usage.remaining !== null) headers['X-RateLimit-Remaining'] = String(usage.remaining);
  if (blocked) {
    headers['Retry-After'] = String(Math.max(1, usage.resetAt - Math.floor(Date.now() / 1000)));
  }
  return headers;
}

export function logMcpAbuse(fields: {
  kind: string;
  accountId?: string | null;
  clientId?: string | null;
  limit?: number;
  used?: number;
}): void {
  console.warn(
    JSON.stringify(
      redactSensitive({
        event: 'mcp_abuse',
        kind: fields.kind,
        accountId: fields.accountId ?? null,
        clientId: fields.clientId ?? null,
        limit: fields.limit ?? null,
        used: fields.used ?? null,
      }),
    ),
  );
}

function resetFrom(headers: Headers): number {
  const now = Math.floor(Date.now() / 1000);
  const retry = Number(headers.get('Retry-After') || 0);
  if (Number.isFinite(retry) && retry > 0) return now + retry;
  const raw = Number(headers.get('X-RateLimit-Reset') || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : now + 60;
}

async function sliding(
  env: Env,
  key: string,
  limit: number,
  record = true,
): Promise<{ ok: true } | { ok: false; headers: Record<string, string>; resetAt: number }> {
  const result = await enforceKvSlidingWindow(env, {
    key,
    maxRequests: limit,
    windowSeconds: 60,
    record,
    failClosedWithoutKv: isProductionLike(env),
    failClosedOnWriteError: true,
  });
  if (result.ok) return { ok: true };
  const headers: Record<string, string> = {};
  for (const name of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After']) {
    const value = result.response.headers.get(name);
    if (value) headers[name] = value;
  }
  return { ok: false, headers, resetAt: resetFrom(result.response.headers) };
}

function denyBurst(
  code: McpBurstDenial['code'],
  limit: number,
  resetAt: number,
  headers: Record<string, string>,
  accountId: string,
  clientId: string | null,
): McpBurstDenial {
  logMcpAbuse({ kind: code, accountId, clientId, limit });
  const who = code === 'MCP_ACCOUNT_BURST' ? 'this account' : 'this client_id';
  return {
    ok: false,
    code,
    message: `MCP burst limit of ${limit} tool calls per minute for ${who}. Try again after the reset time.`,
    limit,
    resetAt,
    headers,
  };
}

/** Peek both buckets, then record only when both allow the call. A denial must not burn the other bucket. */
export async function enforceMcpBurst(
  env: Env,
  accountId: string,
  clientId: string | null,
): Promise<McpBurstResult> {
  const accountKey = `rl:mcp_burst_acct:${accountId}`;
  const account = await sliding(env, accountKey, MCP_ACCOUNT_BURST_PER_MIN, false);
  if (!account.ok) {
    return denyBurst('MCP_ACCOUNT_BURST', MCP_ACCOUNT_BURST_PER_MIN, account.resetAt, account.headers, accountId, clientId);
  }
  const clientKey = clientId ? `rl:mcp_burst_client:${clientId}` : null;
  if (clientKey) {
    const client = await sliding(env, clientKey, MCP_CLIENT_BURST_PER_MIN, false);
    if (!client.ok) {
      return denyBurst('MCP_CLIENT_BURST', MCP_CLIENT_BURST_PER_MIN, client.resetAt, client.headers, accountId, clientId);
    }
  }
  const recordedClient = clientKey ? await sliding(env, clientKey, MCP_CLIENT_BURST_PER_MIN, true) : null;
  if (recordedClient && !recordedClient.ok) {
    return denyBurst(
      'MCP_CLIENT_BURST',
      MCP_CLIENT_BURST_PER_MIN,
      recordedClient.resetAt,
      recordedClient.headers,
      accountId,
      clientId,
    );
  }
  const recordedAccount = await sliding(env, accountKey, MCP_ACCOUNT_BURST_PER_MIN, true);
  if (!recordedAccount.ok) {
    return denyBurst(
      'MCP_ACCOUNT_BURST',
      MCP_ACCOUNT_BURST_PER_MIN,
      recordedAccount.resetAt,
      recordedAccount.headers,
      accountId,
      clientId,
    );
  }
  return { ok: true };
}

export async function hashKeyPart(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Per-IP sliding window for public OAuth posts. The key stores a hash, not the address. */
export async function enforceMcpOauthIpLimit(
  env: Env,
  action: string,
  ip: string,
  limit: number,
): Promise<DualRateLimitResult> {
  const hashed = await hashKeyPart(ip || 'unknown');
  return enforceKvSlidingWindow(env, {
    key: `rl:${action}:ip:${hashed}`,
    maxRequests: limit,
    windowSeconds: 60,
    failClosedWithoutKv: isProductionLike(env),
    failClosedOnWriteError: true,
  });
}
