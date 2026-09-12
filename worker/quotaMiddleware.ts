import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { resolveAccountId } from './userStore';

export interface QuotaStatus {
  ok: boolean;
  error?: string;
  limit: number;
  used: number;
  remaining: number;
  resetSec: number;
  isUnlimited: boolean;
}

/**
 * Checks whether a user has an active paid subscription stored in KV (sub:<accountId>).
 * Also accepts legacy sub:<loginId> rows written before account linking.
 * Stars, TON, and (later) Stripe all write the same key shape.
 */
export type SubRow = { plan?: string; expiresAt?: number; paymentMethod?: string };

export async function getActiveSubscription(
  env: Env,
  user: HostedIdentity | null,
): Promise<SubRow | null> {
  if (!user || !env.LUMINARA_KV) return null;
  try {
    const accountId = user.accountId || (await resolveAccountId(env, user.id));
    for (const key of [`sub:${accountId}`, `sub:${user.id}`]) {
      const sub = (await env.LUMINARA_KV.get(key, 'json')) as SubRow | null;
      if (sub?.expiresAt && sub.expiresAt > Date.now()) return sub;
    }
    return null;
  } catch {
    return null;
  }
}

export async function isUserSubscribed(env: Env, user: HostedIdentity | null): Promise<boolean> {
  return !!(await getActiveSubscription(env, user));
}

/**
 * Hosted keys are a paid resource. Signed-in users get FREE_DAILY_LIMIT requests per day;
 * an active subscription lifts the cap. Anonymous access is allowed only when REQUIRE_TG_AUTH is off.
 */
export async function checkHostedQuota(env: Env, user: HostedIdentity | null): Promise<QuotaStatus> {
  const now = new Date();
  const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const resetSec = Math.max(0, Math.floor((midnightUtc.getTime() - now.getTime()) / 1000));
  const limit = Number(env.FREE_DAILY_LIMIT || 0);

  if (!user) {
    if (env.REQUIRE_TG_AUTH === 'true') {
      return { ok: false, error: 'Sign in or add your own API key in Settings.', limit, used: 0, remaining: 0, resetSec, isUnlimited: false };
    }
    return { ok: true, limit, used: 0, remaining: limit > 0 ? limit : -1, resetSec, isUnlimited: limit <= 0 };
  }

  if (!env.LUMINARA_KV) {
    // Fail closed when auth/metering is required: without KV we cannot enforce quotas.
    if (env.REQUIRE_TG_AUTH === 'true' && limit > 0) {
      return {
        ok: false,
        error: 'Quota store unavailable. Try again later or add your own API key in Settings.',
        limit,
        used: 0,
        remaining: 0,
        resetSec,
        isUnlimited: false,
      };
    }
    return { ok: true, limit, used: 0, remaining: limit > 0 ? limit : -1, resetSec, isUnlimited: limit <= 0 };
  }

  const accountId = user.accountId || (await resolveAccountId(env, user.id));
  if (await isUserSubscribed(env, { ...user, accountId })) {
    return { ok: true, limit: -1, used: 0, remaining: -1, resetSec, isUnlimited: true };
  }

  if (env.REQUIRE_SUBSCRIPTION === 'true') {
    return {
      ok: false,
      error: user.source === 'telegram'
        ? 'This feature needs an active plan. Subscribe with Telegram Stars or TON, or add your own API key in Settings.'
        : 'This feature needs an active plan. Add your own API key in Settings, or subscribe with TON/Stars.',
      limit,
      used: 0,
      remaining: 0,
      resetSec,
      isUnlimited: false,
    };
  }

  if (limit <= 0) {
    return { ok: true, limit: 0, used: 0, remaining: -1, resetSec, isUnlimited: true };
  }

  const day = now.toISOString().slice(0, 10);
  const key = `quota:${accountId}:${day}`;
  const used = Number((await env.LUMINARA_KV.get(key)) || 0);

  if (used >= limit) {
    return {
      ok: false,
      error: `Daily free limit of ${limit} requests reached. Subscribe for unlimited use or add your own API key in Settings.`,
      limit,
      used,
      remaining: 0,
      resetSec,
      isUnlimited: false,
    };
  }

  const newUsed = used + 1;
  await env.LUMINARA_KV.put(key, String(newUsed), { expirationTtl: 2 * 86400 });
  return {
    ok: true,
    limit,
    used: newUsed,
    remaining: Math.max(0, limit - newUsed),
    resetSec,
    isUnlimited: false,
  };
}
