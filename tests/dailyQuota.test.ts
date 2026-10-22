import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { checkHostedQuota, readFreeUsed, refundMeteredQuota, QUOTA_CAPACITY_ERROR } from '../worker/quotaMiddleware';
import { METER_DDL, refundMeter, rowsOf, spendMeter, type SqlRunner } from '../worker/dailyQuota';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';
import type { Env } from '../worker/env';

function sqliteRunner(): SqlRunner {
  const db = new DatabaseSync(':memory:');
  db.exec(METER_DDL);
  return {
    exec(query, ...bindings) {
      return rowsOf(db.prepare(query).all(...bindings));
    },
  };
}

function envFor(limit: string): Env {
  return {
    LUMINARA_KV: {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
    },
    DAILY_QUOTA: memoryDailyQuotaNamespace(),
    FREE_DAILY_LIMIT: limit,
    REQUIRE_TG_AUTH: 'true',
  } as Env;
}

const user = { id: 'race', source: 'firebase' as const, accountId: 'race' };

describe('daily quota single writer', () => {
  it('spends N concurrent SQL calls up to the limit and refuses the rest', async () => {
    const sql = sqliteRunner();
    const results = await Promise.all(
      Array.from({ length: 8 }, async () => {
        await Promise.resolve();
        return spendMeter(sql, 3);
      }),
    );
    expect(results.filter((row) => row.ok)).toHaveLength(3);
    expect(results.filter((row) => row.ok).map((row) => row.used).sort()).toEqual([1, 2, 3]);
    expect(results.filter((row) => !row.ok).every((row) => row.used === 3)).toBe(true);

    const refunds = await Promise.all(
      Array.from({ length: 4 }, async () => {
        await Promise.resolve();
        return refundMeter(sql, 3);
      }),
    );
    expect(refunds.filter((row) => row.refunded)).toHaveLength(3);
    expect(refunds.filter((row) => row.capped)).toHaveLength(1);
    expect(spendMeter(sql, 3).ok).toBe(true);
    expect(refundMeter(sql, 3).capped).toBe(true);
  });

  it('spends N simultaneous hosted checks and refuses the next', async () => {
    const env = envFor('3');
    const results = await Promise.all(Array.from({ length: 8 }, () => checkHostedQuota(env, user)));
    const ok = results.filter((row) => row.ok);
    expect(ok).toHaveLength(3);
    expect(ok.map((row) => row.used).sort()).toEqual([1, 2, 3]);
    expect(results.filter((row) => !row.ok).every((row) => /Daily free limit/i.test(row.error || ''))).toBe(true);
    expect(await readFreeUsed(env, 'race', 3)).toBe(3);
    const fourth = await checkHostedQuota(env, user);
    expect(fourth.ok).toBe(false);
    expect(fourth.error).toMatch(/Daily free limit/i);
  });

  it('fails closed when the meter object is unavailable', async () => {
    const env = envFor('3');
    env.DAILY_QUOTA = undefined;
    const missing = await checkHostedQuota(env, user);
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe(QUOTA_CAPACITY_ERROR);

    env.DAILY_QUOTA = {
      idFromName: () => ({ toString: () => 'x' }) as unknown as DurableObjectId,
      get: () => ({ fetch: async () => { throw new Error('do down'); } }),
    } as unknown as DurableObjectNamespace;
    const thrown = await checkHostedQuota(env, user);
    expect(thrown.ok).toBe(false);
    expect(thrown.error).toBe(QUOTA_CAPACITY_ERROR);
    expect(thrown.meterKey).toBeUndefined();
  });

  it('refunds through the same object and stops at the daily cap', async () => {
    const env = envFor('1');
    const spent = await checkHostedQuota(env, user);
    expect(spent.ok).toBe(true);
    expect(await refundMeteredQuota(env, spent)).toEqual({ refunded: true, capped: false });
    expect(await readFreeUsed(env, 'race', 1)).toBe(0);
    const again = await checkHostedQuota(env, user);
    expect(await refundMeteredQuota(env, again)).toEqual({ refunded: false, capped: true });
    expect(await readFreeUsed(env, 'race', 1)).toBe(1);
  });
});
