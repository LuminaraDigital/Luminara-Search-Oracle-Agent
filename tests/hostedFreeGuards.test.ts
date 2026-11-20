/**
 * Free hosted use is bounded across all accounts (shared daily ceiling per provider), and the verified-email gate refuses only an explicit unverified email sign-up when on.
 */
import { describe, expect, it } from 'vitest';
import type { Env } from '../worker/env';
import {
  DEFAULT_FREE_DAILY_CEILING,
  freeDailyCeiling,
  takeFreeHostedCall,
  unverifiedEmailRefusal,
} from '../worker/hostedFreeGuards';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, type?: string) {
      const value = store.get(key);
      if (value == null) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function testEnv(extra: Partial<Env> = {}): Env {
  return {
    LUMINARA_KV: memoryKv(),
    DAILY_QUOTA: memoryDailyQuotaNamespace(),
    REQUIRE_TG_AUTH: 'true',
    ...extra,
  } as unknown as Env;
}

describe('free hosted ceiling', () => {
  it('uses the default, an override, and treats a bad override as the default', () => {
    expect(freeDailyCeiling({}, 'tavily')).toBe(DEFAULT_FREE_DAILY_CEILING.tavily);
    expect(freeDailyCeiling({ HOSTED_FREE_DAILY_CEILING: '{"tavily":2}' }, 'tavily')).toBe(2);
    expect(freeDailyCeiling({ HOSTED_FREE_DAILY_CEILING: '{"tavily":2}' }, 'groq')).toBe(DEFAULT_FREE_DAILY_CEILING.groq);
    expect(freeDailyCeiling({ HOSTED_FREE_DAILY_CEILING: 'not json' }, 'exa')).toBe(DEFAULT_FREE_DAILY_CEILING.exa);
    expect(freeDailyCeiling({ HOSTED_FREE_DAILY_CEILING: '{"exa":-1}' }, 'exa')).toBe(DEFAULT_FREE_DAILY_CEILING.exa);
  });

  it('is shared across callers: once spent, every free call to that provider is refused', async () => {
    const env = testEnv({ HOSTED_FREE_DAILY_CEILING: '{"tavily":2}' });
    expect(await takeFreeHostedCall(env, 'tavily')).toBe(true);
    expect(await takeFreeHostedCall(env, 'tavily')).toBe(true);
    expect(await takeFreeHostedCall(env, 'tavily')).toBe(false);
    expect(await takeFreeHostedCall(env, 'groq')).toBe(true);
  });

  it('0 pauses a provider, and a missing meter fails closed', async () => {
    expect(await takeFreeHostedCall(testEnv({ HOSTED_FREE_DAILY_CEILING: '{"exa":0}' }), 'exa')).toBe(false);
    expect(await takeFreeHostedCall(testEnv({ DAILY_QUOTA: undefined }), 'groq')).toBe(false);
  });
});

describe('verified email gate', () => {
  const unverified = { id: 'fb:u1', source: 'firebase' as const, emailVerified: false };
  const plain = new Request('https://luminarasuite.com/api/providers/groq/chat/completions');
  const withToken = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
    headers: { authorization: 'Bearer stale-id-token' },
  });
  const lookup = (account: { localId: string; emailVerified: boolean }) => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ users: [account] }), { status: 200 });
    }) as typeof fetch;
    return { calls, fetchImpl };
  };
  const gateEnv = () => testEnv({ HOSTED_REQUIRE_VERIFIED_EMAIL: 'true', FIREBASE_WEB_API_KEY: 'web-key' });

  it('is off unless HOSTED_REQUIRE_VERIFIED_EMAIL is true', async () => {
    expect(await unverifiedEmailRefusal(testEnv(), unverified, plain)).toBeNull();
  });

  it('refuses only an explicitly unverified email sign-up', async () => {
    const env = gateEnv();
    const refused = await unverifiedEmailRefusal(env, unverified, plain);
    expect(refused?.status).toBe(403);
    expect(((await refused!.json()) as { code: string }).code).toBe('EMAIL_UNVERIFIED');
    expect(await unverifiedEmailRefusal(env, { ...unverified, emailVerified: true }, plain)).toBeNull();
    expect(await unverifiedEmailRefusal(env, { id: 'fb:u2', source: 'firebase' }, plain)).toBeNull();
    expect(await unverifiedEmailRefusal(env, { id: '42', source: 'telegram' }, plain)).toBeNull();
  });

  it('lets a user through once Firebase says they confirmed after the token was issued, then remembers it', async () => {
    const env = gateEnv();
    const confirmed = lookup({ localId: 'u1', emailVerified: true });
    expect(await unverifiedEmailRefusal(env, unverified, withToken, confirmed.fetchImpl)).toBeNull();
    expect(confirmed.calls).toHaveLength(1);
    expect(await unverifiedEmailRefusal(env, unverified, plain, confirmed.fetchImpl)).toBeNull();
    expect(confirmed.calls).toHaveLength(1);
  });

  it('still refuses when Firebase says unconfirmed, or the token belongs to someone else', async () => {
    expect(await unverifiedEmailRefusal(gateEnv(), unverified, withToken, lookup({ localId: 'u1', emailVerified: false }).fetchImpl)).not.toBeNull();
    expect(await unverifiedEmailRefusal(gateEnv(), unverified, withToken, lookup({ localId: 'other', emailVerified: true }).fetchImpl)).not.toBeNull();
  });
});

describe('provider relay under the free ceiling', () => {
  it('stops hosted Tavily calls for free callers once the shared ceiling is spent, and leaves BYOK alone', async () => {
    const { proxyProvider } = await import('../worker/providerRelay');
    const original = globalThis.fetch;
    let upstream = 0;
    globalThis.fetch = (async () => {
      upstream += 1;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;
    try {
      const env = testEnv({
        REQUIRE_TG_AUTH: 'false',
        FREE_DAILY_LIMIT: '100',
        ASK_DAILY_LIMIT: '100',
        TAVILY_API_KEY: 'tvly_test',
        HOSTED_FREE_DAILY_CEILING: '{"tavily":1}',
      } as Partial<Env>);
      const call = (headers: Record<string, string> = {}) =>
        proxyProvider(
          new Request('https://luminarasuite.com/api/providers/tavily/search', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify({ query: 'ping' }),
          }),
          env,
          'tavily',
          '/search',
        );
      expect((await call()).status).toBe(200);
      const refused = await call();
      expect(refused.status).toBe(503);
      expect(((await refused.json()) as { code: string }).code).toBe('HOSTED_CAPACITY');
      expect((await call({ 'x-provider-key': 'tvly_own_key' })).status).toBe(200);
      expect(upstream).toBe(2);
    } finally {
      globalThis.fetch = original;
    }
  });
});
