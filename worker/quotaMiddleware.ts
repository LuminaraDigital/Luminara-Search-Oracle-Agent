import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { resolveAccountId } from './userStore';
import { referralBonusRemaining, tryConsumeReferralCredit } from './referrals';

export interface QuotaStatus {
  ok: boolean;
  error?: string;
  limit: number;
  used: number;
  remaining: number;
  resetSec: number;
  isUnlimited: boolean;
  fairUse?: boolean;
  deduped?: boolean;
  actionId?: string;
  /** Key identifier in KV used for metering (used for refund on failure) */
  quotaKeyId?: string;
  /** Unused referral hosted-scout credits after this check. Omitted when the ledger was not read. */
  bonusRemaining?: number;
  /** True when this request was allowed by a referral credit after the daily cap. */
  bonusConsumed?: boolean;
}

export const FAIR_USE_DAILY_CAPS: Record<string, number> = {
  starter: 50,
  growth: 200,
  agency: 1000,
  pro: 1000,
  enterprise: 5000,
};

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
  actionId?: string | null,
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
  const used = Number((await env.LUMINARA_KV.get(key)) || 0);
  if (used >= limit) {
    return {
      ok: false,
      error: `Daily free limit of ${limit} actions reached. Subscribe for unlimited use or add your own API key in Settings.`,
      limit,
      used,
      remaining: 0,
      resetSec,
      isUnlimited: false,
      quotaKeyId,
    };
  }
  const newUsed = used + 1;
  await env.LUMINARA_KV.put(key, String(newUsed), { expirationTtl: 2 * 86400 });
  if (actionId) {
    await env.LUMINARA_KV.put(`action:${actionId}`, '1', { expirationTtl: 86400 });
  }
  return {
    ok: true,
    limit,
    used: newUsed,
    remaining: Math.max(0, limit - newUsed),
    resetSec,
    isUnlimited: false,
    quotaKeyId,
    actionId: actionId || undefined,
  };
}

/**
 * Refunds quota when an upstream request or action ultimately fails.
 * Decrements the KV counter without dropping below 0 and clears the action id.
 */
export async function refundDailyQuota(
  env: Env,
  quotaKeyId: string,
  count = 1,
  actionId?: string | null,
): Promise<void> {
  if (!env.LUMINARA_KV || count <= 0) return;
  try {
    if (actionId) {
      await env.LUMINARA_KV.delete(`action:${actionId}`);
    }
    const day = new Date().toISOString().slice(0, 10);
    const key = `quota:${quotaKeyId}:${day}`;
    const used = Number((await env.LUMINARA_KV.get(key)) || 0);
    const newUsed = Math.max(0, used - count);
    await env.LUMINARA_KV.put(key, String(newUsed), { expirationTtl: 2 * 86400 });
  } catch (err) {
    console.warn('[Quota refund error]', err);
  }
}

/**
 * Hosted keys are a paid resource. Signed-in users get FREE_DAILY_LIMIT actions per day;
 * an active subscription lifts the cap to a generous daily fair-use allowance.
 * Multiple sub-calls sharing an actionId are billed as a single user action.
 */
export async function checkHostedQuota(
  env: Env,
  user: HostedIdentity | null,
  opts?: { clientIp?: string | null; actionId?: string | null },
): Promise<QuotaStatus> {
  const now = new Date();
  const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const resetSec = Math.max(0, Math.floor((midnightUtc.getTime() - now.getTime()) / 1000));
  const limit = Number(env.FREE_DAILY_LIMIT || 0);
  const day = now.toISOString().slice(0, 10);

  // Check action idempotency: if this action was already charged, allow subsequent sub-calls without re-billing.
  if (opts?.actionId && env.LUMINARA_KV) {
    const actionKey = `action:${opts.actionId}`;
    const alreadyProcessed = await env.LUMINARA_KV.get(actionKey);
    if (alreadyProcessed) {
      if (!user) {
        const ip = (opts?.clientIp || '').trim() || 'unknown';
        const ipKey = `anon:${ip}`;
        const used = Number((await env.LUMINARA_KV.get(`quota:${ipKey}:${day}`)) || 0);
        return {
          ok: true,
          limit,
          used,
          remaining: Math.max(0, limit - used),
          resetSec,
          isUnlimited: limit <= 0,
          deduped: true,
          quotaKeyId: ipKey,
          actionId: opts.actionId,
        };
      }
      const accountId = user.accountId || (await resolveAccountId(env, user.id));
      const sub = await getActiveSubscription(env, { ...user, accountId });
      if (sub) {
        const planName = (sub.plan || 'growth').toLowerCase();
        const fairUseLimit = FAIR_USE_DAILY_CAPS[planName] ?? FAIR_USE_DAILY_CAPS.growth ?? 200;
        const paidUsed = Number((await env.LUMINARA_KV.get(`quota:paid:${accountId}:${day}`)) || 0);
        return {
          ok: true,
          limit: fairUseLimit,
          used: paidUsed,
          remaining: Math.max(0, fairUseLimit - paidUsed),
          resetSec,
          isUnlimited: true,
          fairUse: true,
          deduped: true,
          quotaKeyId: `paid:${accountId}`,
          actionId: opts.actionId,
        };
      }
      const freeUsed = Number((await env.LUMINARA_KV.get(`quota:${accountId}:${day}`)) || 0);
      const bonusRemaining = await referralBonusRemaining(env, accountId);
      return {
        ok: true,
        limit,
        used: freeUsed,
        remaining: Math.max(0, limit - freeUsed),
        resetSec,
        isUnlimited: limit <= 0,
        deduped: true,
        quotaKeyId: accountId,
        bonusRemaining,
        actionId: opts.actionId,
      };
    }
  }

  if (!user) {
    if (env.REQUIRE_TG_AUTH === 'true') {
      return { ok: false, error: 'Sign in or add your own API key in Settings.', limit, used: 0, remaining: 0, resetSec, isUnlimited: false };
    }
    if (!env.LUMINARA_KV) {
      return { ok: true, limit, used: 0, remaining: limit > 0 ? limit : -1, resetSec, isUnlimited: limit <= 0 };
    }
    const ip = (opts?.clientIp || '').trim() || 'unknown';
    return meterDailyQuota(env, `anon:${ip}`, limit, resetSec, opts?.actionId);
  }

  if (!env.LUMINARA_KV) {
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
  const sub = await getActiveSubscription(env, { ...user, accountId });
  if (sub) {
    const planName = (sub.plan || 'growth').toLowerCase();
    const fairUseLimit = FAIR_USE_DAILY_CAPS[planName] ?? FAIR_USE_DAILY_CAPS.growth ?? 200;
    const paidKey = `quota:paid:${accountId}:${day}`;
    const paidUsed = Number((await env.LUMINARA_KV.get(paidKey)) || 0);

    if (paidUsed >= fairUseLimit) {
      return {
        ok: false,
        error: `Daily fair-use limit of ${fairUseLimit} actions reached for the ${planName} plan. Usage resets at midnight UTC.`,
        limit: fairUseLimit,
        used: paidUsed,
        remaining: 0,
        resetSec,
        isUnlimited: false,
        fairUse: true,
      };
    }

    const newPaidUsed = paidUsed + 1;
    await env.LUMINARA_KV.put(paidKey, String(newPaidUsed), { expirationTtl: 2 * 86400 });
    if (opts?.actionId) {
      await env.LUMINARA_KV.put(`action:${opts.actionId}`, '1', { expirationTtl: 86400 });
    }
    return {
      ok: true,
      limit: fairUseLimit,
      used: newPaidUsed,
      remaining: Math.max(0, fairUseLimit - newPaidUsed),
      resetSec,
      isUnlimited: true,
      fairUse: true,
      quotaKeyId: `paid:${accountId}`,
      actionId: opts?.actionId || undefined,
    };
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

  // Entitlement: FREE_DAILY_LIMIT per UTC day, then unused referral credits (FIFO, one per action).
  const daily = await meterDailyQuota(env, accountId, limit, resetSec, opts?.actionId);
  const bonusRemaining = await referralBonusRemaining(env, accountId);
  if (daily.ok) return { ...daily, bonusRemaining };
  if (user.source === 'telegram' || user.source === 'firebase') {
    const spent = await tryConsumeReferralCredit(env, accountId);
    if (spent.ok) {
      if (opts?.actionId) {
        await env.LUMINARA_KV.put(`action:${opts.actionId}`, '1', { expirationTtl: 86400 });
      }
      return {
        ok: true,
        limit,
        used: daily.used,
        remaining: 0,
        resetSec,
        isUnlimited: false,
        bonusConsumed: true,
        bonusRemaining: spent.remaining,
        quotaKeyId: accountId,
        actionId: opts?.actionId || undefined,
      };
    }
  }
  return { ...daily, bonusRemaining: 0 };
}
