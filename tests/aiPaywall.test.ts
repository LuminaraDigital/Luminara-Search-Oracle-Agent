import { describe, expect, it } from 'vitest';
import { checkHostedQuota } from '../worker/index';
import { updateQuotaFromHeaders, getCurrentQuotaSync } from '../services/apiClient';

function createMockKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (!val) return null;
      if (type === 'json') return JSON.parse(val);
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

describe('AI Paywall & Quota Engine', () => {
  it('meters daily free quota correctly and tracks remaining requests', async () => {
    const kv = createMockKv();
    const env: any = {
      LUMINARA_KV: kv,
      FREE_DAILY_LIMIT: '3',
      REQUIRE_TG_AUTH: 'true',
    };
    const user = { id: 'tg_100', source: 'telegram' as const };

    // Request 1
    const q1 = await checkHostedQuota(env, user);
    expect(q1.ok).toBe(true);
    expect(q1.limit).toBe(3);
    expect(q1.used).toBe(1);
    expect(q1.remaining).toBe(2);
    expect(q1.isUnlimited).toBe(false);

    // Request 2
    const q2 = await checkHostedQuota(env, user);
    expect(q2.ok).toBe(true);
    expect(q2.used).toBe(2);
    expect(q2.remaining).toBe(1);

    // Request 3
    const q3 = await checkHostedQuota(env, user);
    expect(q3.ok).toBe(true);
    expect(q3.used).toBe(3);
    expect(q3.remaining).toBe(0);

    // Request 4 (Should be blocked by Paywall)
    const q4 = await checkHostedQuota(env, user);
    expect(q4.ok).toBe(false);
    expect(q4.remaining).toBe(0);
    expect(q4.error).toMatch(/Daily free limit/i);
  });

  it('unlimited subscription completely bypasses free daily limits', async () => {
    const kv = createMockKv();
    const env: any = {
      LUMINARA_KV: kv,
      FREE_DAILY_LIMIT: '5',
      REQUIRE_TG_AUTH: 'true',
    };
    const user = { id: 'tg_sub_user', source: 'telegram' as const };

    // Provision active subscription
    await kv.put('sub:tg_sub_user', JSON.stringify({
      plan: 'starter',
      expiresAt: Date.now() + 86400_000 * 15,
    }));

    const q = await checkHostedQuota(env, user);
    expect(q.ok).toBe(true);
    expect(q.isUnlimited).toBe(true);
    expect(q.remaining).toBe(-1);
  });

  it('client parses X-Quota response headers accurately', () => {
    const headers = new Headers();
    headers.set('x-quota-limit', '25');
    headers.set('x-quota-remaining', '18');
    headers.set('x-quota-reset', '3600');

    updateQuotaFromHeaders(headers);
    const state = getCurrentQuotaSync();

    expect(state).not.toBeNull();
    if (state) {
      expect(state.limit).toBe(25);
      expect(state.remaining).toBe(18);
      expect(state.used).toBe(7);
      expect(state.resetSec).toBe(3600);
      expect(state.isUnlimited).toBe(false);
    }
  });

  it('client parses unlimited quota headers', () => {
    const headers = new Headers();
    headers.set('x-quota-limit', 'unlimited');
    headers.set('x-quota-remaining', 'unlimited');

    updateQuotaFromHeaders(headers);
    const state = getCurrentQuotaSync();

    expect(state).not.toBeNull();
    if (state) {
      expect(state.isUnlimited).toBe(true);
      expect(state.remaining).toBe(-1);
    }
  });
});
