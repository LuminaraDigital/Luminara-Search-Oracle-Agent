import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { resolveAccountId } from './userStore';
import { referralBonusRemaining, tryConsumeReferralCredit } from './referrals';
import { invokeDailyQuota, meterName, QUOTA_CAPACITY_ERROR } from './dailyQuota';

export { QUOTA_CAPACITY_ERROR };

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
  /** DailyQuota object name for this UTC day. Set only when a free unit was taken. */
  meterKey?: string;
}

const dailyLimitError = (limit: number) =>
  `Daily free limit of ${limit} requests reached. Subscribe for unlimited use or add your own API key in Settings.`;

function isSpendBody(v: unknown): v is { ok: boolean; used: number } {
  return !!v && typeof v === 'object' && 'ok' in v && typeof v.ok === 'boolean' && 'used' in v && typeof v.used === 'number';
}

function isRefundBody(v: unknown): v is { refunded: boolean; capped: boolean } {
  return !!v && typeof v === 'object' && 'refunded' in v && typeof v.refunded === 'boolean' && 'capped' in v && typeof v.capped === 'boolean';
}

function isReadBody(v: unknown): v is { used: number } {
  return !!v && typeof v === 'object' && 'used' in v && typeof v.used === 'number';
}

export type DailySpend =
  | { ok: true; used: number; meterKey: string }
  | { ok: false; code: 'HOSTED_CAPACITY'; error: string; used: number }
  | { ok: false; code: 'PAYWALL_EXCEEDED'; error: string; used: number };

/** Atomic spend on the account's UTC-day object. A missing object fails closed. */
export async function spendDailyQuota(env: Env, quotaKeyId: string, limit: number): Promise<DailySpend> {
  if (!(limit > 0)) return { ok: true, used: 0, meterKey: '' };
  const name = meterName(quotaKeyId);
  const body = await invokeDailyQuota(env, name, 'spend', limit);
  if (!isSpendBody(body)) return { ok: false, code: 'HOSTED_CAPACITY', error: QUOTA_CAPACITY_ERROR, used: 0 };
  if (!body.ok) return { ok: false, code: 'PAYWALL_EXCEEDED', error: dailyLimitError(limit), used: body.used };
  return { ok: true, used: body.used, meterKey: name };
}

/** Today's used count. null means the meter could not be read. */
export async function readFreeUsed(env: Env, quotaKeyId: string, limit: number): Promise<number | null> {
  if (!(limit > 0)) return 0;
  const body = await invokeDailyQuota(env, meterName(quotaKeyId), 'read', 0);
  if (!isReadBody(body)) return null;
  return body.used;
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

function capacityStatus(limit: number, resetSec: number): QuotaStatus {
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

async function meterDailyQuota(
  env: Env,
  quotaKeyId: string,
  limit: number,
  resetSec: number,
): Promise<QuotaStatus> {
  if (limit <= 0) {
    return { ok: true, limit: 0, used: 0, remaining: -1, resetSec, isUnlimited: true };
  }
  const spent = await spendDailyQuota(env, quotaKeyId, limit);
  if (!spent.ok) {
    if (spent.code === 'HOSTED_CAPACITY') return capacityStatus(limit, resetSec);
    return {
      ok: false,
      error: spent.error,
      limit,
      used: spent.used,
      remaining: 0,
      resetSec,
      isUnlimited: false,
    };
  }
  return {
    ok: true,
    limit,
    used: spent.used,
    remaining: Math.max(0, limit - spent.used),
    resetSec,
    isUnlimited: false,
    meterKey: spent.meterKey,
  };
}

/**
 * Give back one metered unit after a hosted call that produced no result.
 * Refunds stop at FREE_DAILY_LIMIT per UTC day so forced failures cannot keep restoring the meter.
 */
export async function refundMeteredQuota(
  env: Env,
  status: QuotaStatus | null,
): Promise<{ refunded: boolean; capped: boolean }> {
  if (!status?.meterKey || status.limit <= 0) return { refunded: false, capped: false };
  const body = await invokeDailyQuota(env, status.meterKey, 'refund', status.limit);
  if (!isRefundBody(body)) return { refunded: false, capped: false };
  return { refunded: body.refunded, capped: body.capped };
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
  if (daily.error === QUOTA_CAPACITY_ERROR) return daily;
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

export type QuotaView =
  | {
      ok: true;
      authenticated: true;
      accountId: string;
      plan?: string;
      expiresAt?: number;
      limit: number;
      used: number;
      remaining: number;
      resetSec: number;
      isUnlimited: boolean;
      bonusRemaining?: number;
    }
  | { ok: false; error: string; code: 'HOSTED_CAPACITY' };

/** The signed-in body of GET /auth/quota, shared with the boot snapshot. */
export async function readQuotaSnapshot(env: Env, user: HostedIdentity): Promise<QuotaView> {
  const limit = Number(env.FREE_DAILY_LIMIT || 3);
  const now = new Date();
  const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const resetSec = Math.max(0, Math.floor((midnightUtc.getTime() - now.getTime()) / 1000));
  const accountId = user.accountId || user.id;
  const sub = await getActiveSubscription(env, user);
  if (sub?.expiresAt && sub.expiresAt > Date.now()) {
    return {
      ok: true,
      authenticated: true,
      accountId,
      plan: sub.plan,
      expiresAt: sub.expiresAt,
      limit: -1,
      used: 0,
      remaining: -1,
      resetSec,
      isUnlimited: true,
    };
  }
  const used = await readFreeUsed(env, accountId, limit);
  if (used === null) return { ok: false, error: QUOTA_CAPACITY_ERROR, code: 'HOSTED_CAPACITY' };
  const bonusRemaining = await referralBonusRemaining(env, accountId);
  return {
    ok: true,
    authenticated: true,
    accountId,
    plan: 'free',
    limit,
    used,
    remaining: Math.max(0, limit - used),
    bonusRemaining,
    resetSec,
    isUnlimited: limit <= 0,
  };
}
