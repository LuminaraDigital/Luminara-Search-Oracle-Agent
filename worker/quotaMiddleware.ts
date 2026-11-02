import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { resolveAccountId } from './userStore';
import { referralBonusRemaining, tryConsumeReferralCredit } from './referrals';
import { invokeDailyQuota, meterName, QUOTA_CAPACITY_ERROR } from './dailyQuota';
import { entitlementsFor, normalizePlanId, type PlanId } from '../services/plans/planEntitlements';

export { QUOTA_CAPACITY_ERROR };

export type QuotaBucket = 'audit' | 'ask' | 'ask-search';

export interface QuotaStatus {
  ok: boolean;
  error?: string;
  limit: number;
  used: number;
  remaining: number;
  resetSec: number;
  isUnlimited: boolean;
  /** Which daily meter this check used. Audit stays the free hosted-check meter. */
  bucket?: QuotaBucket;
  /** Unused referral hosted-scout credits after this check. Omitted when the ledger was not read. */
  bonusRemaining?: number;
  /** True when this request was allowed by a referral credit after the daily cap. */
  bonusConsumed?: boolean;
  /** DailyQuota object name for this UTC day. Set only when a free unit was taken. */
  meterKey?: string;
}

const AUDIT_CAP_COPY = (limit: number) =>
  `Daily free limit reached: that's your ${limit} free audits for today. They're saved. You'll get ${limit} more at midnight UTC.`;

const ASK_CAP_COPY = (limit: number) =>
  `You've used today's ${limit} questions. Your audit and fix list are still here. More questions at midnight UTC.`;

function deniedCopy(bucket: QuotaBucket, limit: number): string {
  return bucket === 'audit' ? AUDIT_CAP_COPY(limit) : ASK_CAP_COPY(limit);
}

function bucketLimit(env: Env, bucket: QuotaBucket): number {
  if (bucket === 'audit') return Number(env.FREE_DAILY_LIMIT || 3);
  const parsed = Number(env.ASK_DAILY_LIMIT ?? 10);
  return Number.isFinite(parsed) ? parsed : 10;
}

/** Ask meters are separate Durable Object names so a question does not spend an audit. */
function bucketMeterId(id: string, bucket: QuotaBucket): string {
  return bucket === 'audit' ? id : `${id}:${bucket}`;
}

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
  if (!body.ok) return { ok: false, code: 'PAYWALL_EXCEEDED', error: AUDIT_CAP_COPY(limit), used: body.used };
  return { ok: true, used: body.used, meterKey: name };
}

/** Give back one unit on a UTC-day meter. The meter stops refunding after `limit` refunds that day. */
export async function refundDailyQuota(env: Env, meterKey: string, limit: number): Promise<{ refunded: boolean; capped: boolean }> {
  const body = await invokeDailyQuota(env, meterKey, 'refund', limit);
  if (!isRefundBody(body)) return { refunded: false, capped: false };
  return { refunded: body.refunded, capped: body.capped };
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
 * Stars, TON, Stripe, and license keys write the same key shape.
 */
export type SubRow = {
  plan?: string;
  expiresAt?: number;
  paymentMethod?: string;
  reversedAt?: number;
  reversedStripeSessions?: unknown;
};

/** Account key first, then the legacy login key. A KV miss or fault is an empty list. */
async function readStoredSubs(env: Env, user: HostedIdentity | null): Promise<SubRow[]> {
  if (!user || !env.LUMINARA_KV) return [];
  try {
    const accountId = user.accountId || (await resolveAccountId(env, user.id));
    const rows: SubRow[] = [];
    const seen = new Set<string>();
    for (const key of [`sub:${accountId}`, `sub:${user.id}`]) {
      if (seen.has(key)) continue;
      seen.add(key);
      const sub = (await env.LUMINARA_KV.get(key, 'json')) as SubRow | null;
      if (sub) rows.push(sub);
    }
    return rows;
  } catch {
    return [];
  }
}

export async function getActiveSubscription(
  env: Env,
  user: HostedIdentity | null,
): Promise<SubRow | null> {
  const now = Date.now();
  const active = (await readStoredSubs(env, user)).find((sub) => sub.expiresAt && sub.expiresAt > now);
  return active ?? null;
}

export type HostedEntitlementStatus = 'none' | 'active' | 'canceled';

/** guest: signed out. free: signed in without a live paid term. Otherwise the stored plan id. */
export type HostedEntitlement = {
  tier: 'guest' | PlanId;
  name: string;
  status: HostedEntitlementStatus;
};

function stripeTermCanceled(row: SubRow, now: number): boolean {
  if (row.paymentMethod !== 'stripe') return false;
  const expiresAt = Number(row.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt > now) return false;
  if (typeof row.reversedAt === 'number') return true;
  return Array.isArray(row.reversedStripeSessions) && row.reversedStripeSessions.length > 0;
}

/**
 * Plan the Worker already stored. Stripe Checkout is a prepaid term (mode=payment), so a
 * refund or dispute that ends the term is canceled. Invoice past_due is not stored and is not returned.
 */
export function mapHostedEntitlement(input: {
  signedIn: boolean;
  active: SubRow | null;
  records: SubRow[];
  now: number;
}): HostedEntitlement {
  if (!input.signedIn) return { tier: 'guest', name: 'Guest', status: 'none' };
  if (input.active?.expiresAt && input.active.expiresAt > input.now) {
    const planId = normalizePlanId(input.active.plan);
    if (planId !== 'free') {
      return { tier: planId, name: entitlementsFor(planId).title, status: 'active' };
    }
  }
  if (input.records.some((row) => stripeTermCanceled(row, input.now))) {
    return { tier: 'free', name: 'Free', status: 'canceled' };
  }
  return { tier: 'free', name: 'Free', status: 'none' };
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
  return refundDailyQuota(env, status.meterKey, status.limit);
}

/**
 * Hosted keys are a paid resource. Signed-in users get FREE_DAILY_LIMIT requests per day;
 * an active subscription lifts the cap. Anonymous access is allowed only when REQUIRE_TG_AUTH is off,
 * and is metered by IP when a client IP is provided (staging / open auth).
 */
export async function checkHostedQuota(
  env: Env,
  user: HostedIdentity | null,
  opts?: { clientIp?: string | null; bucket?: QuotaBucket },
): Promise<QuotaStatus> {
  const now = new Date();
  const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const resetSec = Math.max(0, Math.floor((midnightUtc.getTime() - now.getTime()) / 1000));
  const bucket = opts?.bucket ?? 'audit';
  const limit = bucketLimit(env, bucket);
  const meterOf = (id: string) => bucketMeterId(id, bucket);
  const voiced = (status: QuotaStatus): QuotaStatus => {
    if (status.ok || status.error === QUOTA_CAPACITY_ERROR) return { ...status, bucket };
    return { ...status, error: deniedCopy(bucket, limit), bucket };
  };

  if (!user) {
    if (env.REQUIRE_TG_AUTH === 'true') {
      return { ok: false, error: 'Sign in to use hosted AI.', limit, used: 0, remaining: 0, resetSec, isUnlimited: false, bucket };
    }
    if (!env.LUMINARA_KV) {
      return { ok: true, limit, used: 0, remaining: limit > 0 ? limit : -1, resetSec, isUnlimited: limit <= 0, bucket };
    }
    const ip = (opts?.clientIp || '').trim() || 'unknown';
    return voiced(await meterDailyQuota(env, meterOf(`anon:${ip}`), limit, resetSec));
  }

  if (!env.LUMINARA_KV) {
    // Fail closed when auth/metering is required: without KV we cannot enforce quotas.
    if (env.REQUIRE_TG_AUTH === 'true' && limit > 0) {
      return {
        ok: false,
        error: 'Quota store unavailable. Try again in a minute.',
        limit,
        used: 0,
        remaining: 0,
        resetSec,
        isUnlimited: false,
        bucket,
      };
    }
    return { ok: true, limit, used: 0, remaining: limit > 0 ? limit : -1, resetSec, isUnlimited: limit <= 0, bucket };
  }

  const accountId = user.accountId || (await resolveAccountId(env, user.id));
  if (await isUserSubscribed(env, { ...user, accountId })) {
    // Active plans are unlimited. Leave referral credits on the ledger for after the plan ends.
    return { ok: true, limit: -1, used: 0, remaining: -1, resetSec, isUnlimited: true, bucket };
  }

  if (env.REQUIRE_SUBSCRIPTION === 'true') {
    return {
      ok: false,
      error: user.source === 'telegram'
        ? 'This feature needs an active plan. Subscribe with Telegram Stars or a license key.'
        : 'This feature needs an active plan. Your plan syncs when you sign in.',
      limit,
      used: 0,
      remaining: 0,
      resetSec,
      isUnlimited: false,
      bucket,
    };
  }

  // Entitlement: one UTC-day meter, then unused referral credits on the audit meter only.
  // Anonymous callers never reach this branch. Bonus spend requires this Telegram or Firebase identity.
  const daily = await meterDailyQuota(env, meterOf(accountId), limit, resetSec);
  if (daily.error === QUOTA_CAPACITY_ERROR) return { ...daily, bucket };
  if (bucket !== 'audit') return voiced(daily);
  const bonusRemaining = await referralBonusRemaining(env, accountId);
  if (daily.ok) return { ...daily, bonusRemaining, bucket };
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
        bucket,
      };
    }
  }
  return voiced({ ...daily, bonusRemaining: 0 });
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
      askLimit: number;
      askUsed: number;
      askRemaining: number;
      entitlement: HostedEntitlement;
    }
  | { ok: false; error: string; code: 'HOSTED_CAPACITY' };

/** The signed-in body of GET /auth/quota, shared with the boot snapshot. */
export async function readQuotaSnapshot(env: Env, user: HostedIdentity): Promise<QuotaView> {
  const limit = Number(env.FREE_DAILY_LIMIT || 3);
  const askLimit = bucketLimit(env, 'ask');
  const now = new Date();
  const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const resetSec = Math.max(0, Math.floor((midnightUtc.getTime() - now.getTime()) / 1000));
  const accountId = user.accountId || user.id;
  const nowMs = now.getTime();
  const records = await readStoredSubs(env, user);
  const sub = records.find((row) => row.expiresAt && row.expiresAt > nowMs) ?? null;
  const entitlement = mapHostedEntitlement({ signedIn: true, active: sub, records, now: nowMs });
  if (sub?.expiresAt && sub.expiresAt > nowMs) {
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
      askLimit: -1,
      askUsed: 0,
      askRemaining: -1,
      entitlement,
    };
  }
  const used = await readFreeUsed(env, accountId, limit);
  if (used === null) return { ok: false, error: QUOTA_CAPACITY_ERROR, code: 'HOSTED_CAPACITY' };
  const askUsed = askLimit > 0 ? await readFreeUsed(env, bucketMeterId(accountId, 'ask'), askLimit) : 0;
  if (askUsed === null) return { ok: false, error: QUOTA_CAPACITY_ERROR, code: 'HOSTED_CAPACITY' };
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
    askLimit: askLimit > 0 ? askLimit : -1,
    askUsed,
    askRemaining: askLimit > 0 ? Math.max(0, askLimit - askUsed) : -1,
    entitlement,
  };
}
