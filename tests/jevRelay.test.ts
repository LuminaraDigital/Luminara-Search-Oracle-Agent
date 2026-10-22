import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import { proxyProvider } from '../worker/providerRelay';
import { resetDailyCapForTests } from '../worker/isolateDailyCap';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';

const EXCERPT = 'PAGE_EXCERPT_DO_NOT_LOG';

function env(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: vi.fn() } as unknown as Env['ASSETS'],
    REQUIRE_TG_AUTH: 'false',
    FREE_DAILY_LIMIT: '100',
    LUMINARA_KV: {
      get: async () => null,
      put: async () => { throw new Error('kv write'); },
      delete: async () => { throw new Error('kv write'); },
    } as unknown as Env['LUMINARA_KV'],
    DAILY_QUOTA: memoryDailyQuotaNamespace(),
    ...overrides,
  };
}

function post(provider: string, path: string, body: unknown): Request {
  return new Request(`https://luminarasuite.com/api/providers/${provider}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('hosted Jev and Exa caps', () => {
  const original = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = original;
    resetDailyCapForTests();
    vi.restoreAllMocks();
  });

  it('sends one Jev call with the worker secret and writes no KV', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((line) => { logs.push(String(line)); });
    vi.spyOn(console, 'warn').mockImplementation((line) => { logs.push(String(line)); });
    vi.spyOn(console, 'log').mockImplementation((line) => { logs.push(String(line)); });
    const seen: Array<{ url: string; auth: string | null }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(url), auth: headers.get('authorization') });
      return new Response(JSON.stringify({ model: 'jev-latest', answers: {} }), { status: 200 });
    }) as typeof fetch;

    const res = await proxyProvider(
      post('typesafe', '/v1/systemone', { model: 'jev-latest', state: { pages: [{ excerpt: EXCERPT }] }, questions: {} }),
      env({ TYPESAFE_API_KEY: 'ts_test_key' }),
      'typesafe',
      '/v1/systemone',
    );

    expect(res.status).toBe(200);
    expect(seen).toEqual([{ url: 'https://api.typesafe.ai/v1/systemone', auth: 'Bearer ts_test_key' }]);
    expect(logs.join('\n')).not.toContain(EXCERPT);
    expect(logs.join('\n')).not.toContain('ts_test_key');
  });

  it('stops a free account after the Exa daily cap', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as typeof fetch;
    const hosted = env({ EXA_API_KEY: 'exa_test_key', EXA_FREE_DAILY_CAP: '2' });
    const first = await proxyProvider(post('exa', '/search', { query: 'ping' }), hosted, 'exa', '/search');
    const second = await proxyProvider(post('exa', '/search', { query: 'ping' }), hosted, 'exa', '/search');
    const third = await proxyProvider(post('exa', '/search', { query: 'ping' }), hosted, 'exa', '/search');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(((await third.json()) as { code: string }).code).toBe('EXA_DAILY_CAP');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('fail-opens the evidence check when the free Jev cap is spent', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch;
    const hosted = env({ TYPESAFE_API_KEY: 'ts_test_key', TYPESAFE_FREE_DAILY_CAP: '1' });
    const body = { model: 'jev-latest', state: { pages: [] }, questions: {} };
    const first = await proxyProvider(post('typesafe', '/v1/systemone', body), hosted, 'typesafe', '/v1/systemone');
    const second = await proxyProvider(post('typesafe', '/v1/systemone', body), hosted, 'typesafe', '/v1/systemone');
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(((await second.json()) as { code: string }).code).toBe('JEV_DAILY_CAP');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
