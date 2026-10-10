import { describe, expect, it } from 'vitest';
import { checkHostedQuota, refundDailyQuota, FAIR_USE_DAILY_CAPS } from '../worker/index';
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

  it('unlimited subscription completely bypasses free daily limits with fair-use allowance', async () => {
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
    expect(q.fairUse).toBe(true);
    expect(q.limit).toBe(50);
    expect(q.used).toBe(1);
    expect(q.remaining).toBe(49);
  });

  it('meters one unit per action across multiple provider calls sharing actionId', async () => {
    const kv = createMockKv();
    const env: any = {
      LUMINARA_KV: kv,
      FREE_DAILY_LIMIT: '10',
      REQUIRE_TG_AUTH: 'true',
    };
    const user = { id: 'tg_action_user', source: 'telegram' as const };
    const actionId = 'action_audit_12345';

    // Call 1: First call of the action - should be charged
    const q1 = await checkHostedQuota(env, user, { actionId });
    expect(q1.ok).toBe(true);
    expect(q1.used).toBe(1);
    expect(q1.remaining).toBe(9);
    expect(q1.deduped).toBeUndefined();

    // Calls 2 through 5: Sub-calls sharing the same actionId - should NOT increment quota
    for (let i = 2; i <= 5; i++) {
      const qi = await checkHostedQuota(env, user, { actionId });
      expect(qi.ok).toBe(true);
      expect(qi.used).toBe(1);
      expect(qi.remaining).toBe(9);
      expect(qi.deduped).toBe(true);
    }
  });

  it('refundDailyQuota restores counter and clears action idempotency', async () => {
    const kv = createMockKv();
    const env: any = {
      LUMINARA_KV: kv,
      FREE_DAILY_LIMIT: '10',
      REQUIRE_TG_AUTH: 'true',
    };
    const user = { id: 'tg_refund_user', source: 'telegram' as const };
    const actionId = 'action_fail_999';

    const q1 = await checkHostedQuota(env, user, { actionId });
    expect(q1.used).toBe(1);
    expect(q1.remaining).toBe(9);

    // Upstream fails: trigger refund with actionId
    await refundDailyQuota(env, q1.quotaKeyId!, 1, actionId);

    // KV should have 0 used and actionId removed
    const day = new Date().toISOString().slice(0, 10);
    const usedAfterRefund = Number(await kv.get(`quota:${q1.quotaKeyId}:${day}`) || 0);
    expect(usedAfterRefund).toBe(0);
    expect(await kv.get(`action:${actionId}`)).toBeNull();
  });

  it('enforces fair-use daily caps on paid subscriptions', async () => {
    const kv = createMockKv();
    const env: any = {
      LUMINARA_KV: kv,
      FREE_DAILY_LIMIT: '5',
      REQUIRE_TG_AUTH: 'true',
    };
    const user = { id: 'tg_paid_cap_user', source: 'telegram' as const };

    // Starter plan: cap is 50 actions/day
    expect(FAIR_USE_DAILY_CAPS.starter).toBe(50);
    await kv.put('sub:tg_paid_cap_user', JSON.stringify({
      plan: 'starter',
      expiresAt: Date.now() + 86400_000 * 15,
    }));

    const day = new Date().toISOString().slice(0, 10);
    // Simulate user already used 50 actions today
    await kv.put(`quota:paid:tg_paid_cap_user:${day}`, '50');

    const q = await checkHostedQuota(env, user);
    expect(q.ok).toBe(false);
    expect(q.limit).toBe(50);
    expect(q.used).toBe(50);
    expect(q.remaining).toBe(0);
    expect(q.error).toMatch(/Daily fair-use limit of 50 actions reached/i);
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

  describe('Business AI Paywall: Free Groq vs Paid Engines (OpenRouter, NIM, Ollama)', () => {
    const BOT_TOKEN = '123456:TEST_BOT_TOKEN';

    function signInitData(fields: Record<string, string>, token = BOT_TOKEN): string {
      const { createHmac } = require('node:crypto');
      const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
      const secret = createHmac('sha256', 'WebAppData').update(token).digest();
      const hash = createHmac('sha256', secret).update(dcs).digest('hex');
      const p = new URLSearchParams(fields);
      p.set('hash', hash);
      return p.toString();
    }

    const createEnv = (kv: any) => ({
      LUMINARA_KV: kv,
      BOT_TOKEN,
      REQUIRE_TG_AUTH: 'true',
      FREE_DAILY_LIMIT: '10',
      GROQ_API_KEY: 'gsk_hosted_groq_key',
      NVIDIA_API_KEY: 'nvapi_hosted_nim_key',
      OPENROUTER_API_KEY: 'or-hosted-openrouter-key',
      OLLAMA_API_KEY: 'hosted_ollama_key',
      OLLAMA_BASE_URL: 'https://ollama.business.internal',
    });

    it('blocks free tier user from hosted OpenRouter with 402 TIER_UPGRADE_REQUIRED', async () => {
      const kv = createMockKv();
      const env = createEnv(kv);
      const initData = signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 201, first_name: 'FreeUser' }),
      });

      const req = new Request('https://luminarasuite.com/api/providers/openrouter/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
        },
        body: JSON.stringify({ model: 'anthropic/claude-3.5-sonnet', messages: [] }),
      });

      const { proxyProvider } = await import('../worker/index');
      const res = await proxyProvider(req, env as any, 'openrouter', '/chat/completions');
      expect(res.status).toBe(402);
      const body = await res.json() as any;
      expect(body.code).toBe('TIER_UPGRADE_REQUIRED');
      expect(body.requiredTier).toBe('paid');
      expect(body.provider).toBe('openrouter');
      expect(body.upgrade).toBe(true);
    });

    it('blocks free tier user from hosted NVIDIA NIM with 402 TIER_UPGRADE_REQUIRED', async () => {
      const kv = createMockKv();
      const env = createEnv(kv);
      const initData = signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 202, first_name: 'FreeUser' }),
      });

      const req = new Request('https://luminarasuite.com/api/providers/nim/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
        },
        body: JSON.stringify({ model: 'meta/llama-3.2-11b-vision-instruct', messages: [] }),
      });

      const { proxyProvider } = await import('../worker/index');
      const res = await proxyProvider(req, env as any, 'nim', '/chat/completions');
      expect(res.status).toBe(402);
      const body = await res.json() as any;
      expect(body.code).toBe('TIER_UPGRADE_REQUIRED');
      expect(body.provider).toBe('nim');
    });

    it('blocks free tier user from hosted Sovereign Ollama with 402 TIER_UPGRADE_REQUIRED', async () => {
      const kv = createMockKv();
      const env = createEnv(kv);
      const initData = signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 203, first_name: 'FreeUser' }),
      });

      const req = new Request('https://luminarasuite.com/api/providers/ollama/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
        },
        body: JSON.stringify({ model: 'llama3.2', messages: [] }),
      });

      const { proxyProvider } = await import('../worker/index');
      const res = await proxyProvider(req, env as any, 'ollama', '/v1/chat/completions');
      expect(res.status).toBe(402);
      const body = await res.json() as any;
      expect(body.code).toBe('TIER_UPGRADE_REQUIRED');
      expect(body.provider).toBe('ollama');
    });

    it('allows free tier user to use hosted Groq within daily quota', async () => {
      const kv = createMockKv();
      const env = createEnv(kv);
      const initData = signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 204, first_name: 'FreeUser' }),
      });

      // Mock upstream fetch for Groq
      let capturedBody = '';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url: any, init?: any) => {
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Groq response' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };

      try {
        const req = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-telegram-init-data': initData,
          },
          body: JSON.stringify({ model: 'openai/gpt-oss-120b', messages: [], max_tokens: 999999 }),
        });

        const { proxyProvider } = await import('../worker/index');
        const res = await proxyProvider(req, env as any, 'groq', '/chat/completions');
        expect(res.status).toBe(200);
        expect(res.headers.get('x-quota-remaining')).toBe('9'); // 10 limit - 1 used
        expect(JSON.parse(capturedBody).max_tokens).toBe(1024);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('blocks free tier hosted Firecrawl crawl with 402', async () => {
      const kv = createMockKv();
      const env = { ...createEnv(kv), FIRECRAWL_API_KEY: 'fc_hosted' };
      const initData = signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 207, first_name: 'FreeUser' }),
      });
      const { proxyProvider } = await import('../worker/index');
      const res = await proxyProvider(
        new Request('https://luminarasuite.com/api/providers/firecrawl/crawl', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ url: 'https://example.com' }),
        }),
        env as any,
        'firecrawl',
        '/crawl',
      );
      expect(res.status).toBe(402);
      expect(((await res.json()) as any).code).toBe('TIER_UPGRADE_REQUIRED');
    });

    it('fails closed when KV is missing and auth is required', async () => {
      const env: any = {
        FREE_DAILY_LIMIT: '25',
        REQUIRE_TG_AUTH: 'true',
      };
      const q = await checkHostedQuota(env, { id: 'tg_1', source: 'telegram' });
      expect(q.ok).toBe(false);
      expect(q.error).toMatch(/Quota store unavailable/i);
    });

    it('meters anonymous hosted use by IP when REQUIRE_TG_AUTH is off', async () => {
      const kv = createMockKv();
      const env: any = {
        LUMINARA_KV: kv,
        FREE_DAILY_LIMIT: '2',
        REQUIRE_TG_AUTH: 'false',
      };
      const q1 = await checkHostedQuota(env, null, { clientIp: '203.0.113.10' });
      expect(q1.ok).toBe(true);
      expect(q1.used).toBe(1);
      const q2 = await checkHostedQuota(env, null, { clientIp: '203.0.113.10' });
      expect(q2.ok).toBe(true);
      expect(q2.used).toBe(2);
      const q3 = await checkHostedQuota(env, null, { clientIp: '203.0.113.10' });
      expect(q3.ok).toBe(false);
      expect(q3.error).toMatch(/Daily free limit/i);
      const otherIp = await checkHostedQuota(env, null, { clientIp: '203.0.113.99' });
      expect(otherIp.ok).toBe(true);
      expect(otherIp.used).toBe(1);
    });

    it('allows active paid subscriber to use hosted OpenRouter, NIM, and Ollama', async () => {
      const kv = createMockKv();
      const env = createEnv(kv);

      // Setup active subscription for subscriber tg_205
      await kv.put('sub:205', JSON.stringify({
        plan: 'starter',
        expiresAt: Date.now() + 86400_000 * 30,
      }));

      const initData = signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 205, first_name: 'PaidSubscriber' }),
      });

      let capturedUpstream = '';
      let capturedAuth = '';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url: any, init?: any) => {
        capturedUpstream = String(url);
        capturedAuth = init?.headers?.get?.('authorization') || init?.headers?.Authorization || '';
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Frontier AI response' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };

      try {
        const req = new Request('https://luminarasuite.com/api/providers/openrouter/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-telegram-init-data': initData,
          },
          body: JSON.stringify({ model: 'openai/gpt-4o', messages: [] }),
        });

        const { proxyProvider } = await import('../worker/index');
        const res = await proxyProvider(req, env as any, 'openrouter', '/chat/completions');
        expect(res.status).toBe(200);
        expect(capturedUpstream).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(capturedAuth).toBe('Bearer or-hosted-openrouter-key');
        expect(res.headers.get('x-quota-remaining')).toBe('49');
        expect(res.headers.get('x-quota-fair-use')).toBe('true');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('allows BYOK user to access any engine without subscription or quota tracking', async () => {
      const kv = createMockKv();
      const env = createEnv(kv);
      const initData = signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 206, first_name: 'BYOKUser' }),
      });

      let capturedAuth = '';
      let capturedReferer = '';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url: any, init?: any) => {
        capturedAuth = init?.headers?.get?.('authorization') || init?.headers?.Authorization || '';
        capturedReferer = init?.headers?.get?.('http-referer') || init?.headers?.['HTTP-Referer'] || '';
        return new Response(JSON.stringify({ choices: [{ message: { content: 'BYOK Success' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };

      try {
        const req = new Request('https://luminarasuite.com/api/providers/openrouter/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-telegram-init-data': initData,
            'x-provider-key': 'or-v1-my-personal-custom-key',
          },
          body: JSON.stringify({ model: 'anthropic/claude-3.5-sonnet', messages: [] }),
        });

        const { proxyProvider } = await import('../worker/index');
        const res = await proxyProvider(req, env as any, 'openrouter', '/chat/completions');
        expect(res.status).toBe(200);
        // BYOK key should be forwarded, hosted key should not be used
        expect(capturedAuth).toBe('Bearer or-v1-my-personal-custom-key');
        expect(capturedReferer).toBe('https://luminarasuite.com');
        // No quota headers injected for BYOK
        expect(res.headers.get('x-quota-remaining')).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns consistent unified quota at both /api/auth/quota and /api/quota', async () => {
      const kv = createMockKv();
      const env = createEnv(kv);
      const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

      // 1. Anonymous request
      const anonReq = new Request('https://luminarasuite.com/api/quota', { method: 'GET' });
      const { default: worker } = await import('../worker/index');
      const anonRes1 = await worker.fetch(anonReq, env as any, ctx as any);
      expect(anonRes1.status).toBe(200);
      const anonBody1 = await anonRes1.json() as any;
      expect(anonBody1.authenticated).toBe(false);
      expect(anonBody1.unit).toBe('audits/questions');
      expect(anonBody1.limit).toBe(10);

      // Verify /api/auth/quota returns identical shape
      const anonReq2 = new Request('https://luminarasuite.com/api/auth/quota', { method: 'GET' });
      const anonRes2 = await worker.fetch(anonReq2, env as any, ctx as any);
      expect(anonRes2.status).toBe(200);
      const anonBody2 = await anonRes2.json() as any;
      expect(anonBody2).toEqual(anonBody1);

      // 2. Paid subscriber request
      const initData = signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 301, first_name: 'PaidSubscriber' }),
      });
      await kv.put('sub:301', JSON.stringify({
        plan: 'starter',
        expiresAt: Date.now() + 86400_000 * 30,
      }));

      const paidReq = new Request('https://luminarasuite.com/api/quota', {
        method: 'GET',
        headers: { 'x-telegram-init-data': initData },
      });
      const paidRes = await worker.fetch(paidReq, env as any, ctx as any);
      expect(paidRes.status).toBe(200);
      const paidBody = await paidRes.json() as any;
      expect(paidBody.authenticated).toBe(true);
      expect(paidBody.plan).toBe('starter');
      expect(paidBody.isUnlimited).toBe(true);
      expect(paidBody.fairUse).toBe(true);
      expect(paidBody.limit).toBe(50);
      expect(paidBody.remaining).toBe(50);
      expect(paidBody.unit).toBe('audits/questions');
    });
  });
});
