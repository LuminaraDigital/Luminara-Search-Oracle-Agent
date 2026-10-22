import { describe, expect, it } from 'vitest';
import { checkHostedQuota, QUOTA_CAPACITY_ERROR, readFreeUsed, refundMeteredQuota } from '../worker/quotaMiddleware';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';
import type { Env } from '../worker/env';

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function envFor(limit: string) {
  const kv = memoryKv();
  const env = {
    LUMINARA_KV: kv,
    DAILY_QUOTA: memoryDailyQuotaNamespace(),
    FREE_DAILY_LIMIT: limit,
    REQUIRE_TG_AUTH: 'true',
  } as Env;
  return { env, kv };
}

const user = { id: 'acct_free', source: 'firebase' as const, accountId: 'acct_free' };

describe('failed hosted checks', () => {
  it('refunds a failed check and stops refunding at the daily cap', async () => {
    const { env } = envFor('1');
    const failed = await checkHostedQuota(env, user);
    expect(failed.ok).toBe(true);
    expect(failed.used).toBe(1);
    const back = await refundMeteredQuota(env, failed);
    expect(back).toEqual({ refunded: true, capped: false });
    expect(await readFreeUsed(env, 'acct_free', 1)).toBe(0);

    const counted = await checkHostedQuota(env, user);
    expect(counted.ok).toBe(true);
    const capped = await refundMeteredQuota(env, counted);
    expect(capped).toEqual({ refunded: false, capped: true });
    expect(counted.used).toBe(1);

    const blocked = await checkHostedQuota(env, user);
    expect(blocked.ok).toBe(false);
  });

  it('does not let forced failures raise successful checks above the free limit', async () => {
    const { env } = envFor('2');
    let refunds = 0;
    let held = 0;
    for (let i = 0; i < 8; i++) {
      const attempt = await checkHostedQuota(env, user);
      if (!attempt.ok) break;
      const back = await refundMeteredQuota(env, attempt);
      if (back.refunded) refunds += 1;
      else held += 1;
    }
    expect(refunds).toBe(2);
    expect(held).toBe(2);
    const extra = await checkHostedQuota(env, user);
    expect(extra.ok).toBe(false);
  });

  it('refuses the call when the meter object is unavailable', async () => {
    const { env } = envFor('3');
    env.DAILY_QUOTA = undefined;
    const refused = await checkHostedQuota(env, user);
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe(QUOTA_CAPACITY_ERROR);
    expect(refused.meterKey).toBeUndefined();
    expect(refused.remaining).toBe(0);
  });
});
