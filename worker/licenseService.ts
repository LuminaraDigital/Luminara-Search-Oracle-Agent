/**
 * Luminara Suite - Core Temporary License Key Subsystem
 *
 * Powers promotional growth campaigns, partner passes, and enterprise prepaid keys.
 * Enforces 1-trial-per-account anti-abuse rules, multi-tier entitlement elevation,
 * and cross-platform synchronization between Telegram Mini App and Web.
 */
import type { Env } from './index';
import { normalizePlanId } from './telegramBot';
import { resolveAccountId, writeSubscriptionRecord } from './userStore';

export interface LicenseKeyRecord {
  key: string;
  plan: string;
  durationDays: number;
  isTrial: boolean;
  campaign?: string;
  createdAt: number;
  redeemed: boolean;
  redeemedBy?: string;
  redeemedAt?: number;
  maxRedemptions?: number;
  redemptionCount?: number;
}

export interface LicenseActivationResult {
  ok: boolean;
  plan?: string;
  expiresAt?: number;
  durationDays?: number;
  error?: string;
}

/**
 * Built-in Promotional Trial Keys:
 * Recognized campaign codes that grant immediate 72-hour (3-day) Growth Sprint passes
 * or 7-day VIP access. Each account may only redeem ONE promotional trial key.
 */
export const BUILTIN_CAMPAIGN_KEYS: Record<string, { plan: string; durationDays: number; isTrial: boolean; campaign: string }> = {
  'LUM-GROWTH-3DAY': { plan: 'growth', durationDays: 3, isTrial: true, campaign: 'growth_sprint' },
  'LUM-TRIAL-3D': { plan: 'growth', durationDays: 3, isTrial: true, campaign: 'growth_sprint' },
  'LUM-LAUNCH-3D': { plan: 'growth', durationDays: 3, isTrial: true, campaign: 'product_launch' },
  'LUM-PROMO-3DAY': { plan: 'starter', durationDays: 3, isTrial: true, campaign: 'starter_promo' },
  'LUM-VIP-7DAY': { plan: 'growth', durationDays: 7, isTrial: true, campaign: 'vip_partner' },
  'LUM-AGENCY-7DAY': { plan: 'agency', durationDays: 7, isTrial: true, campaign: 'agency_evaluation' },
};

/**
 * Normalizes input license key: removes whitespace, dashes/underscores standard formatting, uppercase.
 */
export function normalizeLicenseKey(rawKey: string): string {
  return String(rawKey || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
}

/**
 * Generates a clean, memorable license key formatted as LUM-TIER-XXD-XXXX.
 */
export function formatGeneratedLicenseKey(plan: string, durationDays: number): string {
  const normPlan = normalizePlanId(plan);
  const tag = normPlan === 'agency' ? 'PRO' : normPlan.toUpperCase().slice(0, 6);
  const randPart = Math.random().toString(36).substring(2, 6).toUpperCase() +
                   '-' +
                   Math.random().toString(36).substring(2, 6).toUpperCase();
  return `LUM-${tag}-${durationDays}D-${randPart}`;
}

/**
 * Activates a license key for the given authenticated user.
 * Elevates account plan in KV/D1 and records anti-abuse metrics.
 */
export async function activateLicenseKey(
  env: Env,
  userId: string,
  rawKey: string,
): Promise<LicenseActivationResult> {
  if (!env.LUMINARA_KV) {
    return { ok: false, error: 'Database storage is currently unavailable. Please try again in a moment.' };
  }

  const key = normalizeLicenseKey(rawKey);
  if (!key || key.length < 8) {
    return { ok: false, error: 'Please enter a valid license key (format: LUM-...)' };
  }

  const accountId = await resolveAccountId(env, userId);

  // 1. Check if key is a built-in campaign key or in KV
  let keyRecord: LicenseKeyRecord | null = null;
  const kvKey = `license:key:${key}`;
  const stored = await env.LUMINARA_KV.get(kvKey, 'json') as LicenseKeyRecord | null;

  if (stored) {
    keyRecord = stored;
  } else if (BUILTIN_CAMPAIGN_KEYS[key]) {
    const builtin = BUILTIN_CAMPAIGN_KEYS[key];
    keyRecord = {
      key,
      plan: builtin.plan,
      durationDays: builtin.durationDays,
      isTrial: builtin.isTrial,
      campaign: builtin.campaign,
      createdAt: Date.now(),
      redeemed: false,
      maxRedemptions: 100000, // Multi-use campaign code
      redemptionCount: 0,
    };
  }
  // Serial-shaped keys must be pre-minted into KV via generateLicenseKeys.
  // Do not fabricate entitlements from the key string alone.

  if (!keyRecord) {
    return { ok: false, error: 'Invalid or unrecognized license key. Please check the code and try again.' };
  }

  // 2. Anti-Abuse Check: Only ONE promotional trial allowed per account
  if (keyRecord.isTrial) {
    const trialClaimKey = `license:trial:claimed:${accountId}`;
    const alreadyClaimed = await env.LUMINARA_KV.get(trialClaimKey);
    if (alreadyClaimed) {
      return {
        ok: false,
        error: 'A temporary promotional trial has already been redeemed on this account. Upgrade with Telegram Stars or TON for continued access.',
      };
    }
  }

  // 3. Single-use redemption check for unique keys
  const maxUses = keyRecord.maxRedemptions || 1;
  const currentUses = keyRecord.redemptionCount || 0;
  if (keyRecord.redeemed && currentUses >= maxUses) {
    return { ok: false, error: 'This license key has already been redeemed.' };
  }

  const now = Date.now();
  const durationMs = keyRecord.durationDays * 86400_000;

  // 4. Calculate subscription extension
  const existingSub = (await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as { plan?: string; expiresAt?: number } | null;
  const baseTime = existingSub?.expiresAt && existingSub.expiresAt > now ? existingSub.expiresAt : now;
  const expiresAt = baseTime + durationMs;

  // 5. Update user subscription state in KV & D1
  await writeSubscriptionRecord(env, userId, {
    plan: keyRecord.plan,
    paymentMethod: 'license_key',
    orderId: `lic_${key}`,
    startedAt: now,
    expiresAt,
  });

  // 6. Record trial claim if applicable
  if (keyRecord.isTrial) {
    await env.LUMINARA_KV.put(
      `license:trial:claimed:${accountId}`,
      JSON.stringify({ key, redeemedAt: now, plan: keyRecord.plan, durationDays: keyRecord.durationDays }),
      { expirationTtl: 31536000 }, // 1 year anti-abuse persistence
    );
  }

  // 7. Update license record
  const nextUses = currentUses + 1;
  const updatedRecord: LicenseKeyRecord = {
    ...keyRecord,
    redeemed: nextUses >= maxUses,
    redeemedBy: accountId,
    redeemedAt: now,
    redemptionCount: nextUses,
  };
  await env.LUMINARA_KV.put(kvKey, JSON.stringify(updatedRecord), { expirationTtl: 86400 * 365 });

  return {
    ok: true,
    plan: keyRecord.plan,
    expiresAt,
    durationDays: keyRecord.durationDays,
  };
}

/**
 * Admin utility to mint new license keys.
 */
export async function generateLicenseKeys(
  env: Env,
  opts: {
    plan: string;
    durationDays: number;
    count?: number;
    campaign?: string;
    isTrial?: boolean;
  },
): Promise<LicenseKeyRecord[]> {
  if (!env.LUMINARA_KV) return [];

  const count = Math.min(100, Math.max(1, opts.count || 1));
  const plan = normalizePlanId(opts.plan);
  const durationDays = Math.max(1, opts.durationDays || 3);
  const isTrial = opts.isTrial ?? (durationDays <= 7);
  const campaign = opts.campaign || 'admin_mint';

  const generated: LicenseKeyRecord[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const key = formatGeneratedLicenseKey(plan, durationDays);
    const record: LicenseKeyRecord = {
      key,
      plan,
      durationDays,
      isTrial,
      campaign,
      createdAt: now,
      redeemed: false,
      maxRedemptions: 1,
      redemptionCount: 0,
    };
    await env.LUMINARA_KV.put(`license:key:${key}`, JSON.stringify(record));
    generated.push(record);
  }

  return generated;
}
