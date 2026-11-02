import { describe, expect, it } from 'vitest';
import { checkHostedQuota, mapHostedEntitlement, readQuotaSnapshot, type SubRow } from '../worker/quotaMiddleware';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';
import type { Env } from '../worker/env';
import type { KVNamespace } from '@cloudflare/workers-types';

const NOW = 1_700_000_000_000;

function kvOf(rows: Record<string, unknown>): KVNamespace {
  const store = new Map(Object.entries(rows).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    get: async (key: string, type?: unknown) => {
      const raw = store.get(key);
      if (raw == null) return null;
      return type === 'json' ? JSON.parse(raw) as unknown : raw;
    },
  } as unknown as KVNamespace;
}

function envFor(rows: Record<string, unknown>): Env {
  return {
    LUMINARA_KV: kvOf(rows),
    DAILY_QUOTA: memoryDailyQuotaNamespace(),
    FREE_DAILY_LIMIT: '3',
  } as Env;
}

const user = { id: 'fb:acct', source: 'firebase' as const, accountId: 'fb:acct' };

describe('hosted entitlement mapping', () => {
  it('signed-out callers are guests and a lapsed prepaid term is not past_due', () => {
    expect(mapHostedEntitlement({ signedIn: false, active: null, records: [], now: NOW })).toEqual({
      tier: 'guest',
      name: 'Guest',
      status: 'none',
    });
    const expired: SubRow = { plan: 'starter', expiresAt: NOW - 1, paymentMethod: 'stripe' };
    expect(mapHostedEntitlement({ signedIn: true, active: null, records: [expired], now: NOW })).toEqual({
      tier: 'free',
      name: 'Free',
      status: 'none',
    });
  });

  it('reads a live plan, a free meter, and a reversed Stripe term from the stored record', async () => {
    const free = await readQuotaSnapshot(envFor({}), user);
    expect(free).toMatchObject({
      ok: true,
      plan: 'free',
      limit: 3,
      used: 0,
      remaining: 3,
      isUnlimited: false,
      entitlement: { tier: 'free', name: 'Free', status: 'none' },
    });

    const live = await readQuotaSnapshot(envFor({
      'sub:fb:acct': { plan: 'growth', expiresAt: Date.now() + 86_400_000, paymentMethod: 'stripe' },
    }), user);
    expect(live).toMatchObject({
      ok: true,
      plan: 'growth',
      isUnlimited: true,
      remaining: -1,
      entitlement: { tier: 'growth', name: 'Growth', status: 'active' },
    });

    const stars = await readQuotaSnapshot(envFor({
      'sub:fb:acct': { plan: 'starter', expiresAt: Date.now() + 86_400_000, paymentMethod: 'stars' },
    }), user);
    expect(stars).toMatchObject({
      entitlement: { tier: 'starter', name: 'Starter', status: 'active' },
      isUnlimited: true,
    });

    const canceled = await readQuotaSnapshot(envFor({
      'sub:fb:acct': {
        plan: 'agency',
        expiresAt: Date.now() - 1,
        paymentMethod: 'stripe',
        reversedAt: Date.now() - 1,
        reversedStripeSessions: ['cs_test_reversed'],
      },
    }), user);
    expect(canceled).toMatchObject({
      ok: true,
      plan: 'free',
      isUnlimited: false,
      remaining: 3,
      entitlement: { tier: 'free', name: 'Free', status: 'canceled' },
    });
    expect(JSON.stringify(canceled)).not.toContain('past_due');
  });

  it('counts questions apart from audits and does not mention an API key', async () => {
    const env = envFor({});
    const audit = await checkHostedQuota(env, user);
    expect(audit.remaining).toBe(2);
    const ask = await checkHostedQuota(env, user, { bucket: 'ask' });
    expect(ask).toMatchObject({ ok: true, limit: 10, remaining: 9, bucket: 'ask' });
    const again = await readQuotaSnapshot(env, user);
    expect(again).toMatchObject({ remaining: 2, askLimit: 10, askRemaining: 9 });
    for (let i = 0; i < 9; i += 1) {
      expect((await checkHostedQuota(env, user, { bucket: 'ask' })).ok).toBe(true);
    }
    const blocked = await checkHostedQuota(env, user, { bucket: 'ask' });
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.toLowerCase()).not.toContain('api key');
    expect(blocked.error).toMatch(/10 questions/);
    const auditsLeft = await checkHostedQuota(env, user);
    expect(auditsLeft.remaining).toBe(1);
  });
});
