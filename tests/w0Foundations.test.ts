import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  dataForSeoBasicAuthHeader,
  encodeHttpBasicAuth,
  hasDataForSeoCredentials,
  parseDataForSeoLoginPassword,
  resolveDataForSeoCredential,
} from '../services/config/runtimeKeys';
import { findingStableKey } from '../services/audit/findingStableKey';
import {
  aggregateMeasuredCitationRate,
  notMeasuredEngine,
  type EngineVisibilityResult,
} from '../services/visibility/engineVisibilityTypes';
import { entitlementsFor } from '../services/plans/planEntitlements';
import { isPathAllowed, PROVIDERS } from '../worker/providerRelay';
import {
  guardApiAccessRoute,
  isApiAccessRoute,
  requireApiAccess,
} from '../worker/apiAccess';
import { planCapsFor } from '../worker/telegramBot';
import type { Env } from '../worker/env';
import worker from '../worker/index';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:W0_TEST_TOKEN';

function signInitData(fields: Record<string, string>, token = botToken): string {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(store: Map<string, string>, overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(store),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    BOT_TOKEN: botToken,
    ...overrides,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

describe('W0 foundations: runtime keys', () => {
  it('resolves DataForSEO login:password from bag', () => {
    expect(
      resolveDataForSeoCredential({
        luminara_dataforseo_login: 'user@x.com',
        luminara_dataforseo_password: 'secret',
      }),
    ).toBe('user@x.com:secret');
    expect(hasDataForSeoCredentials({ luminara_dataforseo_key: 'a:b' })).toBe(true);
    expect(hasDataForSeoCredentials({ luminara_dataforseo_key: 'nocolon' })).toBe(false);
    expect(parseDataForSeoLoginPassword('a:b:c')).toEqual({ login: 'a', password: 'b:c' });
    const header = dataForSeoBasicAuthHeader('login:pass');
    expect(header).toBe(`Basic ${encodeHttpBasicAuth('login', 'pass')}`);
  });
});

describe('W0 foundations: finding stable keys + visibility types', () => {
  it('stable keys are domain/category/title invariant to www and casing', () => {
    const a = findingStableKey('https://www.Example.com/path', 'schema', 'Missing Organization Schema');
    const b = findingStableKey('example.com', 'SCHEMA', 'missing organization schema');
    expect(a).toBe(b);
    expect(a.startsWith('fk_')).toBe(true);
  });

  it('aggregates citation rate only over measured product engines (excludes LLM probes)', () => {
    const results: EngineVisibilityResult[] = [
      notMeasuredEngine('chatgpt', 'no key'),
      {
        engine: 'perplexity',
        measurementStatus: 'estimated',
        method: 'llm_answer_probe',
        cited: true,
        citationRatePercent: 40,
        evidence: [],
        measuredAt: 1,
      },
      {
        engine: 'google_aio',
        measurementStatus: 'measured',
        method: 'dataforseo_llm_mentions',
        cited: false,
        citationRatePercent: 20,
        evidence: [],
        measuredAt: 1,
      },
    ];
    expect(aggregateMeasuredCitationRate(results)).toBe(20);
    expect(aggregateMeasuredCitationRate([notMeasuredEngine('chatgpt', 'x')])).toBeNull();
  });
});

describe('W0 foundations: entitlements + DataForSEO relay', () => {
  it('shareLinks on growth/agency only; apiAccess agency only', () => {
    expect(entitlementsFor('free').shareLinks).toBe(false);
    expect(entitlementsFor('starter').shareLinks).toBe(false);
    expect(entitlementsFor('growth').shareLinks).toBe(true);
    expect(entitlementsFor('agency').shareLinks).toBe(true);
    expect(planCapsFor('growth').shareLinks).toBe(true);
    expect(planCapsFor('starter').apiAccess).toBe(false);
    expect(planCapsFor('agency').apiAccess).toBe(true);
  });

  it('registers dataforseo provider with AI Optimization path allowlist', () => {
    expect(PROVIDERS.dataforseo).toBeTruthy();
    expect(isPathAllowed(PROVIDERS.dataforseo, '/v3/ai_optimization/llm_mentions/search_mentions/live')).toBe(true);
    expect(isPathAllowed(PROVIDERS.dataforseo, '/v3/serp/google/organic/live/advanced')).toBe(true);
    expect(isPathAllowed(PROVIDERS.dataforseo, '/v3/admin/evil')).toBe(false);
  });
});

describe('W0 foundations: apiAccess gate', () => {
  it('classifies Agency API routes', () => {
    expect(isApiAccessRoute('/oracle/chat')).toBe(true);
    expect(isApiAccessRoute('/audit/run')).toBe(true);
    expect(isApiAccessRoute('/tools/list')).toBe(true);
    expect(isApiAccessRoute('/mcp')).toBe(false);
    expect(isApiAccessRoute('/workspace')).toBe(false);
  });

  it('requireApiAccess blocks free plans and allows agency', async () => {
    const env = makeEnv(new Map());
    const user = { id: '42', source: 'telegram' as const };
    const blocked = await requireApiAccess(env, user);
    expect(blocked?.status).toBe(403);

    const envAgency = makeEnv(
      new Map([['sub:42', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86400_000 })]]),
    );
    expect(await requireApiAccess(envAgency, user)).toBeNull();
  });

  it('unsigned Agency stubs return 401; free signed-in return 403; agency return 503 when flags off', async () => {
    const store = new Map<string, string>();
    const env = makeEnv(store);
    const unsigned = await worker.fetch(
      new Request('https://luminarasuite.com/api/oracle/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.9.0.1' },
        body: '{}',
      }),
      env,
      ctx,
    );
    expect(unsigned.status).toBe(401);

    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 99, first_name: 'Free' }),
    });
    const free = await worker.fetch(
      new Request('https://luminarasuite.com/api/oracle/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
          'cf-connecting-ip': '10.9.0.2',
        },
        body: '{}',
      }),
      env,
      ctx,
    );
    expect(free.status).toBe(403);
    const freeBody = (await free.json()) as { code?: string };
    expect(freeBody.code).toBe('API_ACCESS_REQUIRED');

    const agencyStore = new Map<string, string>([
      ['sub:99', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86400_000 })],
    ]);
    const agencyEnv = makeEnv(agencyStore);
    const agencyInit = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 99, first_name: 'Agency' }),
    });
    const agency = await worker.fetch(
      new Request('https://luminarasuite.com/api/audit/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': agencyInit,
          'cf-connecting-ip': '10.9.0.3',
        },
        body: '{}',
      }),
      agencyEnv,
      ctx,
    );
    expect(agency.status).toBe(503);
    const agencyBody = (await agency.json()) as { code?: string };
    expect(agencyBody.code).toBe('AUDIT_DISABLED');
  });

  it('guardApiAccessRoute is a no-op for non-API-access paths', async () => {
    const env = makeEnv(new Map());
    const req = new Request('https://luminarasuite.com/api/workspace');
    expect(await guardApiAccessRoute(req, env, '/workspace')).toBeNull();
  });
});
