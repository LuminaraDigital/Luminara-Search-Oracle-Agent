import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { resolveAccountId } from './userStore';
import { referralBonusRemaining, tryConsumeReferralCredit } from './referrals';

/** Shown when the free meter cannot be read or written. Not a paywall. */
export const QUOTA_CAPACITY_ERROR = "We're at capacity right now, please try again shortly.";

export interface QuotaStatus {
  ok: boolean;
  error?: string;
  limit: number;
  used: number;
  remaining: number;
  resetSec: number;
  isUnlimited: boolean;
  /** Unused referral hosted-scout credits after this check. Omitted when the ledger was not read. */
  bonusRemaining?: number;
  /** True when this request was allowed by a referral credit after the daily cap. */
  bonusConsumed?: boolean;
  /** KV key incremented for this call. Set only when a free unit was taken. */
  meterKey?: string;
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

async function meterDailyQuota(
  env: Env,
  quotaKeyId: string,
  limit: number,
  resetSec: number,
): Promise<QuotaStatus> {
  if (!env.LUMINARA_KV) {
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
  if (limit <= 0) {
    return { ok: true, limit: 0, used: 0, remaining: -1, resetSec, isUnlimited: true };
  }
  const day = new Date().toISOString().slice(0, 10);
  const key = `quota:${quotaKeyId}:${day}`;
  try {
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
      meterKey: key,
    };
  } catch {
    // Fail closed. A missed write must not turn into an uncounted free audit.
    console.warn(JSON.stringify({ event: 'quota_store_error' }));
    return {
      ok: false,
      error: QUOTA_CAPACITY_ERROR,
      limit,
      used: 0,
      remaining: 0,
      resetSec,
      isUnlimited: false,
    };
  }
}

/**
 * Give back one metered unit after a hosted call that produced no result.
 * Refunds stop at FREE_DAILY_LIMIT per UTC day so forced failures cannot keep restoring the meter.
 * shortcut: KV get-then-put can refund a concurrent call's unit, upgrade when the meter is atomic.
 */
export async function refundMeteredQuota(
  env: Env,
  status: QuotaStatus | null,
): Promise<{ refunded: boolean; capped: boolean }> {
  if (!status?.meterKey || !env.LUMINARA_KV || status.limit <= 0) {
    return { refunded: false, capped: false };
  }
  const cap = status.limit;
  const refundKey = status.meterKey.replace(/^quota:/, 'quota-refund:');
  try {
    const refunded = Number((await env.LUMINARA_KV.get(refundKey)) || 0);
    if (refunded >= cap) return { refunded: false, capped: true };
    const used = Number((await env.LUMINARA_KV.get(status.meterKey)) || 0);
    if (used <= 0) return { refunded: false, capped: false };
    await env.LUMINARA_KV.put(status.meterKey, String(used - 1), { expirationTtl: 2 * 86400 });
    await env.LUMINARA_KV.put(refundKey, String(refunded + 1), { expirationTtl: 2 * 86400 });
    return { refunded: true, capped: false };
  } catch {
    return { refunded: false, capped: false };
  }
}

/**
 * Hosted keys are a paid resource. Signed-in users get FREE_DAILY_LIMIT requests per day;
 * an active subscription lifts the cap. Anonymous access is allowed only when REQUIRE_TG_AUTH is off,
 * and is metered by IP when a client IP is provided (staging / open auth).
 */
export async function checkHostedQuota(
  env: Env,
  user: HostedIdentity | null,
  opts?: { clientIp?: string | null },
): Promise<QuotaStatus> {
  const now = new Date();
  const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const resetSec = Math.max(0, Math.floor((midnightUtc.getTime() - now.getTime()) / 1000));
  const limit = Number(env.FREE_DAILY_LIMIT || 3);

  if (!user) {
    if (env.REQUIRE_TG_AUTH === 'true') {
      return { ok: false, error: 'Sign in or add your own API key in Settings.', limit, used: 0, remaining: 0, resetSec, isUnlimited: false };
    }
    if (!env.LUMINARA_KV) {
      return { ok: true, limit, used: 0, remaining: limit > 0 ? limit : -1, resetSec, isUnlimited: limit <= 0 };
    }
    const ip = (opts?.clientIp || '').trim() || 'unknown';
    return meterDailyQuota(env, `anon:${ip}`, limit, resetSec);
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
    // Active plans are unlimited. Leave referral credits on the ledger for after the plan ends.
    return { ok: true, limit: -1, used: 0, remaining: -1, resetSec, isUnlimited: true };
  }

  if (env.REQUIRE_SUBSCRIPTION === 'true') {
    return {
      ok: false,
      error: user.source === 'telegram'
        ? 'This feature needs an active plan. Subscribe with Telegram Stars or a license key, or add your own API key in Settings.'
        : 'This feature needs an active plan. Add your own API key in Settings, activate a license key, or subscribe in the Telegram app.',
      limit,
      used: 0,
      remaining: 0,
      resetSec,
      isUnlimited: false,
    };
  }

  // Entitlement: FREE_DAILY_LIMIT per UTC day, then unused referral credits (FIFO, one per request).
  // Anonymous callers never reach this branch. Bonus spend requires this Telegram or Firebase identity.
  const daily = await meterDailyQuota(env, accountId, limit, resetSec);
  const bonusRemaining = await referralBonusRemaining(env, accountId);
  if (daily.ok) return { ...daily, bonusRemaining };
  if (user.source === 'telegram' || user.source === 'firebase') {
    const spent = await tryConsumeReferralCredit(env, accountId);
    if (spent.ok) {
      return {
        ok: true,
        limit,
        used: daily.used,
        remaining: 0,
        resetSec,
        isUnlimited: false,
        bonusConsumed: true,
        bonusRemaining: spent.remaining,
      };
    }
  }
  return { ...daily, bonusRemaining: 0 };
}
