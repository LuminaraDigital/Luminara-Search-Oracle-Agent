import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateLicenseKey,
  generateLicenseKeys,
  importLicenseKeys,
  normalizeLicenseKey,
  formatGeneratedLicenseKey,
} from '../worker/licenseService';
import { createSqliteD1 } from './helpers/sqliteD1';

function createMockKv() {
  const store = new Map<string, string>();
  return {
    store,
    failPutsMatching: null as RegExp | null,
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (val === undefined) return null;
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
      if (this.failPutsMatching?.test(key)) throw new Error('simulated KV outage');
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function makeEnv(options: { db?: boolean; skipMigrations?: string[] } = {}) {
  const kv = createMockKv();
  const DB = options.db === false ? undefined : createSqliteD1({ skipMigrations: options.skipMigrations });
  const env: any = { LUMINARA_KV: kv, DB };
  return { env, kv, DB };
}

function seedRecord(key: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    key,
    plan: 'growth',
    durationDays: 30,
    isTrial: false,
    campaign: 'test_seed',
    createdAt: Date.now(),
    redeemed: false,
    maxRedemptions: 1,
    redemptionCount: 0,
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Temporary License Key & Growth Engine', () => {
  it('normalizes raw keys properly', () => {
    expect(normalizeLicenseKey('  lum-growth-3day  ')).toBe('LUM-GROWTH-3DAY');
    expect(normalizeLicenseKey('lum_growth_3day')).toBe('LUMGROWTH3DAY');
    expect(normalizeLicenseKey('LUM-PRO-30D-ABCD-1234')).toBe('LUM-PRO-30D-ABCD-1234');
  });

  it('formats generated keys with tier, duration, and random entropy', () => {
    for (let i = 0; i < 50; i++) {
      expect(formatGeneratedLicenseKey('growth', 3)).toMatch(/^LUM-GROWTH-3D-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(formatGeneratedLicenseKey('agency', 30)).toMatch(/^LUM-PRO-30D-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
  });

  it('activates built-in 72-hour (3-day) Growth Sprint pass', async () => {
    const { env, kv } = makeEnv();

    const res = await activateLicenseKey(env, 'user_founder_1', 'LUM-GROWTH-3DAY');
    expect(res.ok).toBe(true);
    expect(res.plan).toBe('growth');
    expect(res.durationDays).toBe(3);
    expect(res.expiresAt).toBeGreaterThan(Date.now() + 86400_000 * 2.9);

    const sub = await kv.get('sub:user_founder_1', 'json');
    expect(sub.plan).toBe('growth');
    expect(sub.paymentMethod).toBe('license_key');
  });

  it('enforces anti-abuse: blocks user from claiming a second trial key', async () => {
    const { env } = makeEnv();

    expect((await activateLicenseKey(env, 'user_abuser', 'LUM-GROWTH-3DAY')).ok).toBe(true);

    const res2 = await activateLicenseKey(env, 'user_abuser', 'LUM-TRIAL-3D');
    expect(res2.ok).toBe(false);
    expect(res2.error).toMatch(/promotional trial has already been redeemed/i);
  });

  it('rejects unminted serial-shaped keys (no fabricate-on-miss)', async () => {
    const { env } = makeEnv();
    const res = await activateLicenseKey(env, 'user_customer_2', 'LUM-GROWTH-30D-AB12-CD34');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid or unrecognized/i);
  });

  it('minted key redeems once and the second redeemer fails', async () => {
    const { env } = makeEnv();

    const keys = await generateLicenseKeys(env, { plan: 'agency', durationDays: 30, count: 2, campaign: 'enterprise_q3' });
    expect(keys.length).toBe(2);
    expect(keys[0].key).not.toBe(keys[1].key);

    const resA = await activateLicenseKey(env, 'user_a', keys[0].key);
    expect(resA.ok).toBe(true);
    expect(resA.plan).toBe('agency');
    expect(resA.durationDays).toBe(30);

    const resB = await activateLicenseKey(env, 'user_b', keys[0].key);
    expect(resB.ok).toBe(false);
    expect(resB.error).toMatch(/already been redeemed/i);
  });

  it('rejects invalid or non-existent keys', async () => {
    const { env } = makeEnv();
    const res = await activateLicenseKey(env, 'user_test', 'INVALID-KEY-XYZ');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid or unrecognized/i);
  });

  it('extends an already active subscription instead of overwriting remaining time', async () => {
    const { env, kv } = makeEnv();

    const existingExpiry = Date.now() + 86400_000 * 10;
    await kv.put('sub:user_extending', JSON.stringify({ plan: 'growth', expiresAt: existingExpiry }));

    const keys = await generateLicenseKeys(env, { plan: 'growth', durationDays: 30, count: 1 });
    const res = await activateLicenseKey(env, 'user_extending', keys[0].key);

    expect(res.ok).toBe(true);
    expect(res.expiresAt).toBeGreaterThanOrEqual(existingExpiry + 86400_000 * 29.9);
  });

  it('activates only when vault-shaped keys are pre-seeded in KV', async () => {
    const { env, kv } = makeEnv();

    const starterKey = 'LUM-STARTER-30D-M2K8-P7W4';
    await kv.put(`license:key:${starterKey}`, seedRecord(starterKey, { plan: 'starter' }));

    const starterRes = await activateLicenseKey(env, 'user_starter_vault', starterKey);
    expect(starterRes.ok).toBe(true);
    expect(starterRes.plan).toBe('starter');
    expect(starterRes.durationDays).toBe(30);

    const growthRes = await activateLicenseKey(env, 'user_growth_vault', 'LUM-GROWTH-30D-K8M2-P4T9');
    expect(growthRes.ok).toBe(false);
  });

  it('importLicenseKeys seeds vault serials idempotently then activates', async () => {
    const { env } = makeEnv();
    const key = 'LUM-GROWTH-30D-K8M2-P4T9';
    const seed = { key, plan: 'growth', durationDays: 30, isTrial: false, campaign: 'vault_test' };

    const first = await importLicenseKeys(env, [seed]);
    expect(first.imported).toEqual([key]);
    expect(first.skipped).toEqual([]);

    const second = await importLicenseKeys(env, [seed]);
    expect(second.imported).toEqual([]);
    expect(second.skipped).toEqual([key]);

    const res = await activateLicenseKey(env, 'user_growth_import', key);
    expect(res.ok).toBe(true);

    const again = await activateLicenseKey(env, 'user_growth_import_2', key);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/already been redeemed/i);
  });
});

describe('License revocation', () => {
  it('rejects a revoked key before the trial check and without touching the ledger', async () => {
    const { env, kv, DB } = makeEnv();
    const key = 'LUM-GROWTH-3D-RVKD-0001';
    await kv.put(`license:key:${key}`, seedRecord(key, { isTrial: true, durationDays: 3, revoked: true, revokedAt: Date.now() }));
    await kv.put('license:trial:claimed:user_revoked', JSON.stringify({ key: 'LUM-TRIAL-3D' }));

    const res = await activateLicenseKey(env, 'user_revoked', key);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/revoked/i);
    expect(await kv.get('sub:user_revoked')).toBeNull();
    expect(DB!.sqlite.prepare('SELECT COUNT(*) AS n FROM license_key_claims').get().n).toBe(0);
  });

  it('judges a legacy record flagged redeemed with uses left exactly as before: one more redemption, then refused', async () => {
    const { env, kv } = makeEnv();
    const key = 'LUM-GROWTH-30D-LEGA-CY01';
    await kv.put(`license:key:${key}`, seedRecord(key, { redeemed: true, redemptionCount: 0 }));

    expect((await activateLicenseKey(env, 'user_legacy', key)).ok).toBe(true);
    const second = await activateLicenseKey(env, 'user_legacy_2', key);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already been redeemed/i);
  });
});

describe('Existing KV keys on the ledger code path (no backfill)', () => {
  it('a never-redeemed key stored by the old seeding shape redeems once and the second redemption is refused', async () => {
    const { env, kv, DB } = makeEnv();
    const key = 'LUM-AGENCY-365D-OLDK-0001';
    await kv.put(`license:key:${key}`, JSON.stringify({
      key,
      plan: 'agency',
      durationDays: 365,
      isTrial: false,
      campaign: 'ops_vault_seed',
      createdAt: 1_700_000_000_000,
      redeemed: false,
      maxRedemptions: 1,
      redemptionCount: 0,
    }));
    expect(DB!.sqlite.prepare('SELECT COUNT(*) AS n FROM license_key_claims').get().n).toBe(0);

    const first = await activateLicenseKey(env, 'user_existing_a', key);
    expect(first.ok).toBe(true);
    expect(first.plan).toBe('agency');
    expect(DB!.sqlite.prepare('SELECT claim_count FROM license_key_claims WHERE license_key = ?').get(key).claim_count).toBe(1);

    const otherAccount = await activateLicenseKey(env, 'user_existing_b', key);
    expect(otherAccount.ok).toBe(false);
    expect(otherAccount.error).toMatch(/already been redeemed/i);

    const sameAccount = await activateLicenseKey(env, 'user_existing_a', key);
    expect(sameAccount.ok).toBe(false);
  });

  it('importLicenseKeys leaves revoked and redeemed records untouched', async () => {
    const { env, kv } = makeEnv();
    const revokedKey = 'LUM-GROWTH-30D-RVKD-0002';
    const redeemedKey = 'LUM-GROWTH-30D-USED-0003';
    const revokedRaw = seedRecord(revokedKey, { revoked: true, revokedAt: 1 });
    const redeemedRaw = seedRecord(redeemedKey, { redeemed: true, redemptionCount: 1, redeemedBy: 'acct_1' });
    await kv.put(`license:key:${revokedKey}`, revokedRaw);
    await kv.put(`license:key:${redeemedKey}`, redeemedRaw);

    const result = await importLicenseKeys(env, [
      { key: revokedKey, plan: 'agency', durationDays: 365, maxRedemptions: 50 },
      { key: redeemedKey, plan: 'agency', durationDays: 365, maxRedemptions: 50 },
    ]);

    expect(result.imported).toEqual([]);
    expect(result.skipped).toEqual([revokedKey, redeemedKey]);
    expect(kv.store.get(`license:key:${revokedKey}`)).toBe(revokedRaw);
    expect(kv.store.get(`license:key:${redeemedKey}`)).toBe(redeemedRaw);
  });

  it('generateLicenseKeys never overwrites an existing key on a random collision', async () => {
    const { env, kv } = makeEnv();
    const collidingKey = 'LUM-GROWTH-30D-AAAA-AAAA';
    const existingRaw = seedRecord(collidingKey, { revoked: true, redeemed: true, redemptionCount: 1 });
    await kv.put(`license:key:${collidingKey}`, existingRaw);

    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementationOnce(((array: Uint8Array) => array.fill(0)) as any);

    const keys = await generateLicenseKeys(env, { plan: 'growth', durationDays: 30, count: 1 });
    expect(keys).toHaveLength(1);
    expect(keys[0].key).not.toBe(collidingKey);
    expect(kv.store.get(`license:key:${collidingKey}`)).toBe(existingRaw);
  });
});

describe('Atomic license redemption (D1 ledger)', () => {
  it('two concurrent activations of a single-use key give exactly one success', async () => {
    const { env, kv, DB } = makeEnv();
    const [minted] = await generateLicenseKeys(env, { plan: 'growth', durationDays: 30, count: 1 });

    const results = await Promise.all([
      activateLicenseKey(env, 'racer_1', minted.key),
      activateLicenseKey(env, 'racer_2', minted.key),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.error).toMatch(/already been redeemed/i);
    const subs = ['racer_1', 'racer_2'].filter((id) => kv.store.has(`sub:${id}`));
    expect(subs).toHaveLength(1);
    expect(DB!.sqlite.prepare('SELECT claim_count FROM license_key_claims WHERE license_key = ?').get(minted.key).claim_count).toBe(1);
  });

  it('many concurrent activations of a single-use key still give exactly one success', async () => {
    const { env } = makeEnv();
    const [minted] = await generateLicenseKeys(env, { plan: 'starter', durationDays: 30, count: 1 });

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => activateLicenseKey(env, `swarm_${i}`, minted.key)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('concurrent trial claims on one account give exactly one success', async () => {
    const { env } = makeEnv();

    const results = await Promise.all([
      activateLicenseKey(env, 'trial_racer', 'LUM-GROWTH-3DAY'),
      activateLicenseKey(env, 'trial_racer', 'LUM-VIP-7DAY'),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.error).toMatch(/promotional trial has already been redeemed/i);
  });

  it('the same account cannot redeem a multi-use key twice', async () => {
    const { env, kv } = makeEnv();
    const key = 'LUM-GROWTH-30D-MULT-0001';
    await kv.put(`license:key:${key}`, seedRecord(key, { maxRedemptions: 5 }));

    expect((await activateLicenseKey(env, 'multi_user', key)).ok).toBe(true);
    const second = await activateLicenseKey(env, 'multi_user', key);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already been redeemed on this account/i);

    expect((await activateLicenseKey(env, 'multi_user_2', key)).ok).toBe(true);
  });

  it('fails closed when the D1 binding is missing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, kv } = makeEnv({ db: false });
    const [minted] = await generateLicenseKeys(env, { plan: 'growth', durationDays: 30, count: 1 });

    const res = await activateLicenseKey(env, 'no_db_user', minted.key);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/temporarily unavailable/i);
    expect(kv.store.has('sub:no_db_user')).toBe(false);
    expect(errors.mock.calls.flat().join(' ')).toMatch(/0004_payment_atomicity/);
  });

  it('fails closed when migration 0004 has not been applied', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, kv } = makeEnv({ skipMigrations: ['0004'] });

    const res = await activateLicenseKey(env, 'no_table_user', 'LUM-GROWTH-3DAY');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/temporarily unavailable/i);
    expect(kv.store.has('sub:no_table_user')).toBe(false);
    expect(kv.store.has('license:trial:claimed:no_table_user')).toBe(false);
    expect(errors.mock.calls.flat().join(' ')).toMatch(/0004_payment_atomicity/);
  });

  it('releases the claim when the subscription write fails so the user can retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, kv } = makeEnv();
    const [minted] = await generateLicenseKeys(env, { plan: 'growth', durationDays: 30, count: 1 });

    kv.failPutsMatching = /^sub:/;
    const failed = await activateLicenseKey(env, 'flaky_user', minted.key);
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/temporarily unavailable/i);

    kv.failPutsMatching = null;
    const retried = await activateLicenseKey(env, 'flaky_user', minted.key);
    expect(retried.ok).toBe(true);
  });
});
