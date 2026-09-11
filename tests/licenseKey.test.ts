import { describe, expect, it } from 'vitest';
import {
  activateLicenseKey,
  generateLicenseKeys,
  importLicenseKeys,
  normalizeLicenseKey,
  formatGeneratedLicenseKey,
  BUILTIN_CAMPAIGN_KEYS,
} from '../worker/licenseService';

function createMockKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (!val) return null;
      if (type === 'json') {
        try {
          return JSON.parse(val);
        } catch {
          return null;
        }
      }
      return val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

describe('Temporary License Key & Growth Engine', () => {
  it('normalizes raw keys properly', () => {
    expect(normalizeLicenseKey('  lum-growth-3day  ')).toBe('LUM-GROWTH-3DAY');
    expect(normalizeLicenseKey('lum_growth_3day')).toBe('LUMGROWTH3DAY');
    expect(normalizeLicenseKey('LUM-PRO-30D-ABCD-1234')).toBe('LUM-PRO-30D-ABCD-1234');
  });

  it('formats generated keys with tier, duration, and random entropy', () => {
    const key = formatGeneratedLicenseKey('growth', 3);
    expect(key).toMatch(/^LUM-GROWTH-3D-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const agencyKey = formatGeneratedLicenseKey('agency', 30);
    expect(agencyKey).toMatch(/^LUM-PRO-30D-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('activates built-in 72-hour (3-day) Growth Sprint pass', async () => {
    const kv = createMockKv();
    const env: any = { LUMINARA_KV: kv };

    const res = await activateLicenseKey(env, 'user_founder_1', 'LUM-GROWTH-3DAY');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan).toBe('growth');
      expect(res.durationDays).toBe(3);
      expect(res.expiresAt).toBeGreaterThan(Date.now() + 86400_000 * 2.9);

      // Verify subscription record written to KV
      const sub = await kv.get('sub:user_founder_1', 'json');
      expect(sub).not.toBeNull();
      expect(sub.plan).toBe('growth');
      expect(sub.paymentMethod).toBe('license_key');
    }
  });

  it('enforces anti-abuse: blocks user from claiming a second trial key', async () => {
    const kv = createMockKv();
    const env: any = { LUMINARA_KV: kv };

    // First trial redemption succeeds
    const res1 = await activateLicenseKey(env, 'user_abuser', 'LUM-GROWTH-3DAY');
    expect(res1.ok).toBe(true);

    // Second trial redemption is blocked
    const res2 = await activateLicenseKey(env, 'user_abuser', 'LUM-TRIAL-3D');
    expect(res2.ok).toBe(false);
    expect(res2.error).toMatch(/promotional trial has already been redeemed/i);
  });

  it('rejects unminted serial-shaped keys (no fabricate-on-miss)', async () => {
    const kv = createMockKv();
    const env: any = { LUMINARA_KV: kv };

    const serial = 'LUM-GROWTH-30D-AB12-CD34';
    const res = await activateLicenseKey(env, 'user_customer_2', serial);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid or unrecognized/i);
  });

  it('allows admins to batch generate unique keys and verifies single-use redemption', async () => {
    const kv = createMockKv();
    const env: any = { LUMINARA_KV: kv };

    const keys = await generateLicenseKeys(env, {
      plan: 'agency',
      durationDays: 30,
      count: 2,
      campaign: 'enterprise_q3',
    });

    expect(keys.length).toBe(2);
    const key1 = keys[0].key;

    // User A activates key 1
    const resA = await activateLicenseKey(env, 'user_a', key1);
    expect(resA.ok).toBe(true);
    expect(resA.plan).toBe('agency');
    expect(resA.durationDays).toBe(30);

    // User B attempts to redeem the same key 1 -> Should be rejected
    const resB = await activateLicenseKey(env, 'user_b', key1);
    expect(resB.ok).toBe(false);
    expect(resB.error).toMatch(/already been redeemed/i);
  });

  it('rejects invalid or non-existent keys', async () => {
    const kv = createMockKv();
    const env: any = { LUMINARA_KV: kv };

    const res = await activateLicenseKey(env, 'user_test', 'INVALID-KEY-XYZ');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid or unrecognized/i);
  });

  it('extends an already active subscription instead of overwriting remaining time', async () => {
    const kv = createMockKv();
    const env: any = { LUMINARA_KV: kv };

    const existingExpiry = Date.now() + 86400_000 * 10;
    await kv.put('sub:user_extending', JSON.stringify({
      plan: 'growth',
      expiresAt: existingExpiry,
    }));

    // Generate and redeem a 30-day key
    const keys = await generateLicenseKeys(env, { plan: 'growth', durationDays: 30, count: 1 });
    const res = await activateLicenseKey(env, 'user_extending', keys[0].key);

    expect(res.ok).toBe(true);
    if (res.ok) {
      // Expiry should be existingExpiry + 30 days
      expect(res.expiresAt).toBeGreaterThanOrEqual(existingExpiry + 86400_000 * 29.9);
    }
  });

  it('activates only when vault-shaped keys are pre-seeded in KV', async () => {
    const kv = createMockKv();
    const env: any = { LUMINARA_KV: kv };

    const starterKey = 'LUM-STARTER-30D-M2K8-P7W4';
    await kv.put(`license:key:${starterKey}`, JSON.stringify({
      key: starterKey,
      plan: 'starter',
      durationDays: 30,
      isTrial: false,
      campaign: 'ops_mint',
      createdAt: Date.now(),
      redeemed: false,
      maxRedemptions: 1,
      redemptionCount: 0,
    }));

    const starterRes = await activateLicenseKey(env, 'user_starter_vault', starterKey);
    expect(starterRes.ok).toBe(true);
    expect(starterRes.plan).toBe('starter');
    expect(starterRes.durationDays).toBe(30);

    // Never-minted serial fails
    const growthRes = await activateLicenseKey(env, 'user_growth_vault', 'LUM-GROWTH-30D-K8M2-P4T9');
    expect(growthRes.ok).toBe(false);
  });

  it('importLicenseKeys seeds vault serials idempotently then activates', async () => {
    const kv = createMockKv();
    const env: any = { LUMINARA_KV: kv };
    const key = 'LUM-GROWTH-30D-K8M2-P4T9';

    const first = await importLicenseKeys(env, [
      { key, plan: 'growth', durationDays: 30, isTrial: false, campaign: 'vault_test' },
    ]);
    expect(first.imported).toEqual([key]);
    expect(first.skipped).toEqual([]);

    const second = await importLicenseKeys(env, [
      { key, plan: 'growth', durationDays: 30, isTrial: false, campaign: 'vault_test' },
    ]);
    expect(second.imported).toEqual([]);
    expect(second.skipped).toEqual([key]);

    const res = await activateLicenseKey(env, 'user_growth_import', key);
    expect(res.ok).toBe(true);
    expect(res.plan).toBe('growth');
    expect(res.durationDays).toBe(30);

    const again = await activateLicenseKey(env, 'user_growth_import_2', key);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/already been redeemed/i);
  });
});
