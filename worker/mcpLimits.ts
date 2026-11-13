/**
 * MCP abuse limits. The daily counter key is `mcp_calls:<accountId>:<UTC day>`,
 * shared by every token and API key on that account.
 */
import type { Env } from './env';
import { redactSensitive } from './logRedaction';
import {
  enforceKvSlidingWindow,
  meterDailyUse,
  type DailyUseMeter,
  type DualRateLimitResult,
} from './securityHardening';

/** Tool calls per minute for one account. A working session fits. A scrape does not. */
export const MCP_ACCOUNT_BURST_PER_MIN = 30;

/** Tool calls per minute for one OAuth client_id. Sessions and API keys have no client_id. */
export const MCP_CLIENT_BURST_PER_MIN = 30;

/**
 * Hosted paid MCP calls per UTC day on Agency. BYOK is not counted.
 * This is an abuse ceiling so a token cannot resell hosted research. It is not a marketed plan quota.
 */
export const MCP_HOSTED_PAID_DAILY = 200;

/** Dynamic client registration posts per minute per IP. A client registers once. */
export const MCP_OAUTH_REGISTER_PER_MIN = 10;

/** Authorization-code exchanges per minute per IP. */
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

/** Spend one MCP daily unit. `limit` 0 still counts, and never blocks, so whoami can show usage on Growth. */
export async function spendMcpDailyCall(
  env: Env,
  accountId: string,
  limit: number,
  prefix = 'mcp_calls',
  label = 'MCP call',
): Promise<{ ok: true; usage: McpDailyUsage } | { ok: false; usage: McpDailyUsage; error: string }> {
  const meter = await meterDailyUse(env, prefix, accountId, limit, label, true);
  const usage = snapshot(meter);
  if (!meter.ok) return { ok: false, usage, error: meter.error };
  return { ok: true, usage };
}

export function dailyRateHeaders(usage: McpDailyUsage, blocked = false): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(usage.limit),
    'X-RateLimit-Reset': String(usage.resetAt),
  };
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
  const raw = Number(headers.get('X-RateLimit-Reset') || 0);
  return Number.isFinite(raw) ? raw : Math.floor(Date.now() / 1000) + 60;
}

async function sliding(
  env: Env,
  key: string,
  limit: number,
  record = true,
): Promise<{ ok: true } | { ok: false; headers: Record<string, string>; resetAt: number }> {
  const result = await enforceKvSlidingWindow(env, { key, maxRequests: limit, windowSeconds: 60, record });
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
  if (clientKey) {
    const recordedClient = await sliding(env, clientKey, MCP_CLIENT_BURST_PER_MIN, true);
    if (!recordedClient.ok) {
      return denyBurst(
        'MCP_CLIENT_BURST',
        MCP_CLIENT_BURST_PER_MIN,
        recordedClient.resetAt,
        recordedClient.headers,
        accountId,
        clientId,
      );
    }
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
  });
}
