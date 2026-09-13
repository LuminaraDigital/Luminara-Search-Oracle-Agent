/**
 * Luminara Suite - Core Temporary License Key Subsystem
 *
 * Powers promotional growth campaigns, partner passes, and enterprise prepaid keys.
 * Enforces 1-trial-per-account anti-abuse rules, multi-tier entitlement elevation,
 * and cross-platform synchronization between Telegram Mini App and Web.
 *
 * Redemption is claimed atomically in D1 (worker/paymentLedger.ts) before any entitlement is written.
 * KV `license:key:*` stays the record store and read cache.
 */
import type { Env } from './index';
import { claimLicenseRedemption, releaseLicenseRedemption } from './paymentLedger';
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
  revoked?: boolean;
  revokedAt?: number;
}

export interface LicenseActivationResult {
  ok: boolean;
  plan?: string;
  expiresAt?: number;
  durationDays?: number;
  error?: string;
}

const LICENSE_UNAVAILABLE_ERROR = 'License activation is temporarily unavailable. Please try again in a few minutes.';
const LICENSE_REDEEMED_ERROR = 'This license key has already been redeemed.';
const LICENSE_REDEEMED_BY_ACCOUNT_ERROR = 'This license key has already been redeemed on this account.';
const LICENSE_REVOKED_ERROR =
  'This license key has been revoked and can no longer be redeemed. Contact support if you think this is a mistake.';
const TRIAL_CLAIMED_ERROR =
  'A temporary promotional trial has already been redeemed on this account. Upgrade with Telegram Stars for continued access.';

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

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomKeyChars(length: number): string {
  let out = '';
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      // 252 is the largest multiple of 36 below 256; skipping higher bytes keeps characters uniform.
      if (byte < 252 && out.length < length) out += KEY_ALPHABET[byte % KEY_ALPHABET.length];
    }
  }
  return out;
}

/**
 * Generates a clean, memorable license key formatted as LUM-TIER-XXD-XXXX-XXXX.
 */
export function formatGeneratedLicenseKey(plan: string, durationDays: number): string {
  const normPlan = normalizePlanId(plan);
  const tag = normPlan === 'agency' ? 'PRO' : normPlan.toUpperCase().slice(0, 6);
  const rand = randomKeyChars(8);
  return `LUM-${tag}-${durationDays}D-${rand.slice(0, 4)}-${rand.slice(4)}`;
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

  if (keyRecord.revoked === true) {
    return { ok: false, error: LICENSE_REVOKED_ERROR };
  }

  // 2. Fast rejects from KV (also covers trials and redemptions recorded before the D1 ledger existed)
  if (keyRecord.isTrial) {
    const alreadyClaimed = await env.LUMINARA_KV.get(`license:trial:claimed:${accountId}`);
    if (alreadyClaimed) {
      return { ok: false, error: TRIAL_CLAIMED_ERROR };
    }
  }

  const maxUses = Math.max(1, keyRecord.maxRedemptions || 1);
  const currentUses = keyRecord.redemptionCount || 0;
  // Same condition existing KV records were judged by before the ledger; the D1 claim enforces the count.
  if (keyRecord.redeemed === true && currentUses >= maxUses) {
    return { ok: false, error: LICENSE_REDEEMED_ERROR };
  }

  // 3. Atomic claim (single-use count, one redemption per account, one trial per account)
  const claim = await claimLicenseRedemption(env, {
    key,
    accountId,
    maxRedemptions: maxUses,
    priorRedemptions: currentUses,
    isTrial: keyRecord.isTrial,
  });
  if (!claim.ok) {
    switch (claim.reason) {
      case 'trial_already_claimed':
        return { ok: false, error: TRIAL_CLAIMED_ERROR };
      case 'account_already_redeemed':
        return { ok: false, error: LICENSE_REDEEMED_BY_ACCOUNT_ERROR };
      case 'exhausted':
        return { ok: false, error: LICENSE_REDEEMED_ERROR };
      default:
        return { ok: false, error: LICENSE_UNAVAILABLE_ERROR };
    }
  }

  const now = Date.now();
  const durationMs = keyRecord.durationDays * 86400_000;
  let expiresAt: number;

  // 4. Extend subscription
  try {
    const existingSub = (await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as { plan?: string; expiresAt?: number } | null;
    const baseTime = existingSub?.expiresAt && existingSub.expiresAt > now ? existingSub.expiresAt : now;
    expiresAt = baseTime + durationMs;

    await writeSubscriptionRecord(env, userId, {
      plan: keyRecord.plan,
      paymentMethod: 'license_key',
      orderId: `lic_${key}`,
      startedAt: now,
      expiresAt,
    });
  } catch (err) {
    // Release so the user can retry; if the write partly landed, a retry may extend twice, which beats burning a paid key.
    await releaseLicenseRedemption(env, { key, accountId, isTrial: keyRecord.isTrial });
    console.error(`[License] Subscription write failed after claim; claim released: ${err instanceof Error ? err.message : err}`);
    return { ok: false, error: LICENSE_UNAVAILABLE_ERROR };
  }

  // 5. Refresh KV cache. The D1 claim is authoritative, so a failure here must not undo the grant.
  try {
    if (keyRecord.isTrial) {
      await env.LUMINARA_KV.put(
        `license:trial:claimed:${accountId}`,
        JSON.stringify({ key, redeemedAt: now, plan: keyRecord.plan, durationDays: keyRecord.durationDays }),
        { expirationTtl: 31536000 }, // 1 year anti-abuse persistence
      );
    }

    // Re-read so an operator revocation written meanwhile is not overwritten.
    const latest = (await env.LUMINARA_KV.get(kvKey, 'json')) as LicenseKeyRecord | null;
    const updatedRecord: LicenseKeyRecord = {
      ...(latest ?? keyRecord),
      redeemed: claim.redemptionCount >= claim.maxRedemptions,
      redeemedBy: accountId,
      redeemedAt: now,
      redemptionCount: claim.redemptionCount,
    };
    await env.LUMINARA_KV.put(kvKey, JSON.stringify(updatedRecord), { expirationTtl: 86400 * 365 });
  } catch (err) {
    console.error(`[License] KV cache refresh failed after a granted redemption: ${err instanceof Error ? err.message : err}`);
  }

  return {
    ok: true,
    plan: keyRecord.plan,
    expiresAt,
    durationDays: keyRecord.durationDays,
  };
}

/**
 * Admin utility to mint new license keys. Never overwrites an existing key record.
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
  const MAX_ATTEMPTS = 5;

  for (let i = 0; i < count; i++) {
    let key = '';
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !key; attempt++) {
      const candidate = formatGeneratedLicenseKey(plan, durationDays);
      if (generated.some((r) => r.key === candidate)) continue;
      if ((await env.LUMINARA_KV.get(`license:key:${candidate}`)) === null) key = candidate;
    }
    if (!key) {
      console.error('[License] Could not mint a non-colliding key after several attempts; skipping one key.');
      continue;
    }
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

export type LicenseSeedInput = {
  key: string;
  plan: string;
  durationDays: number;
  isTrial?: boolean;
  campaign?: string;
  maxRedemptions?: number;
};

/**
 * Idempotently import known serial keys into KV (ops vault seed).
 * Skips any key that already has a record (even unparseable), so revoked/redeemed state is preserved.
 */
export async function importLicenseKeys(
  env: Env,
  seeds: LicenseSeedInput[],
): Promise<{ imported: string[]; skipped: string[]; invalid: string[] }> {
  const imported: string[] = [];
  const skipped: string[] = [];
  const invalid: string[] = [];
  if (!env.LUMINARA_KV) return { imported, skipped, invalid };

  const now = Date.now();
  for (const seed of seeds) {
    const key = normalizeLicenseKey(seed.key);
    if (!key || key.length < 8 || !key.startsWith('LUM-')) {
      invalid.push(String(seed.key || ''));
      continue;
    }
    const kvKey = `license:key:${key}`;
    const existing = await env.LUMINARA_KV.get(kvKey);
    if (existing !== null) {
      skipped.push(key);
      continue;
    }
    const durationDays = Math.max(1, Number(seed.durationDays) || 3);
    const plan = normalizePlanId(seed.plan);
    const record: LicenseKeyRecord = {
      key,
      plan,
      durationDays,
      isTrial: seed.isTrial ?? durationDays <= 7,
      campaign: seed.campaign || 'ops_vault_seed',
      createdAt: now,
      redeemed: false,
      maxRedemptions: Math.max(1, seed.maxRedemptions || 1),
      redemptionCount: 0,
    };
    await env.LUMINARA_KV.put(kvKey, JSON.stringify(record));
    imported.push(key);
  }
  return { imported, skipped, invalid };
}
