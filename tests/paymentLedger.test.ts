import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimLicenseRedemption,
  claimStarsCharge,
  claimTonTransaction,
  releaseLicenseRedemption,
  releaseStarsCharge,
} from '../worker/paymentLedger';
import { createSqliteD1 } from './helpers/sqliteD1';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('paymentLedger: license claims', () => {
  it('seeds the counter from legacy KV redemptions so an exhausted key stays exhausted', async () => {
    const env = { DB: createSqliteD1() };
    const res = await claimLicenseRedemption(env, {
      key: 'LUM-K1', accountId: 'acct_1', maxRedemptions: 2, priorRedemptions: 2, isTrial: false,
    });
    expect(res).toEqual({ ok: false, reason: 'exhausted' });
  });

  it('rolls back the whole claim when any constraint fails', async () => {
    const env = { DB: createSqliteD1() };
    const base = { accountId: 'acct_trial', maxRedemptions: 100, priorRedemptions: 0, isTrial: true };
    expect((await claimLicenseRedemption(env, { ...base, key: 'LUM-TRIAL-A' })).ok).toBe(true);

    const second = await claimLicenseRedemption(env, { ...base, key: 'LUM-TRIAL-B' });
    expect(second).toEqual({ ok: false, reason: 'trial_already_claimed' });
    const row = env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM license_key_claims WHERE license_key = ?').get('LUM-TRIAL-B');
    expect(row.n).toBe(0);
  });

  it('release restores the slot exactly once', async () => {
    const env = { DB: createSqliteD1() };
    const input = { key: 'LUM-K2', accountId: 'acct_2', maxRedemptions: 1, priorRedemptions: 0, isTrial: true };
    expect((await claimLicenseRedemption(env, input)).ok).toBe(true);

    await releaseLicenseRedemption(env, input);
    await releaseLicenseRedemption(env, input);
    const counter = env.DB.sqlite.prepare('SELECT claim_count FROM license_key_claims WHERE license_key = ?').get('LUM-K2');
    expect(counter.claim_count).toBe(0);

    expect((await claimLicenseRedemption(env, input)).ok).toBe(true);
  });
});

describe('paymentLedger: TON transactions', () => {
  it('distinguishes a replayed tx from an already credited order', async () => {
    const env = { DB: createSqliteD1() };
    expect(await claimTonTransaction(env, { txHash: 'tx1', orderId: 'order1', accountId: 'a' })).toEqual({ ok: true });
    expect(await claimTonTransaction(env, { txHash: 'tx1', orderId: 'order1' })).toEqual({ ok: false, reason: 'order_already_credited' });
    expect(await claimTonTransaction(env, { txHash: 'tx1', orderId: 'order2' })).toEqual({ ok: false, reason: 'tx_credited_to_other_order' });
    expect(await claimTonTransaction(env, { txHash: 'tx2', orderId: 'order1' })).toEqual({ ok: false, reason: 'order_already_credited' });
  });

  it('concurrent claims of one tx for different orders give exactly one success', async () => {
    const env = { DB: createSqliteD1() };
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => claimTonTransaction(env, { txHash: 'tx_hot', orderId: `order_${i}` })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('refuses an empty tx hash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await claimTonTransaction({ DB: createSqliteD1() }, { txHash: '', orderId: 'order1' })).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('paymentLedger: Telegram Stars charges', () => {
  it('claims a charge once, even concurrently, and allows re-claim after release', async () => {
    const env = { DB: createSqliteD1() };
    const results = await Promise.all([
      claimStarsCharge(env, 'charge_1', 'acct'),
      claimStarsCharge(env, 'charge_1', 'acct'),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: 'duplicate' });

    await releaseStarsCharge(env, 'charge_1');
    expect(await claimStarsCharge(env, 'charge_1', 'acct')).toEqual({ ok: true });
  });

  it('fails closed without DB, without tables, or without a charge id', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await claimStarsCharge({}, 'charge_2')).toEqual({ ok: false, reason: 'unavailable' });
    expect(await claimStarsCharge({ DB: createSqliteD1({ skipMigrations: ['0004'] }) }, 'charge_2')).toEqual({ ok: false, reason: 'unavailable' });
    expect(await claimStarsCharge({ DB: createSqliteD1() }, '')).toEqual({ ok: false, reason: 'missing_charge_id' });
    expect(errors.mock.calls.flat().join(' ')).toMatch(/0004_payment_atomicity/);
  });
});
