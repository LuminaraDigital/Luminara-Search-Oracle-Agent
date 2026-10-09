import { describe, expect, it } from 'vitest';
import { resolveExecutionResources } from '../worker/resourceTank';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';

describe('worker/resourceTank', () => {
  it('resolves default hosted providers when keys exist in Env', async () => {
    const env = {
      GROQ_API_KEY: 'gsk_test',
      NVIDIA_API_KEY: 'nvapi_test',
      TAVILY_API_KEY: 'tvly_test',
      FIRECRAWL_API_KEY: 'fc_test',
    } as unknown as Env;

    const res = await resolveExecutionResources(env, null);

    expect(res.ok).toBe(true);
    expect(res.resources.model.primary).toBe('groq');
    expect(res.resources.model.fallback).toBe('nim');
    expect(res.resources.search.primary).toBe('tavily');
    expect(res.resources.scraping.primary).toBe('firecrawl');
    expect(res.resources.model.isByok).toBe(false);
  });

  it('detects and applies BYOK credentials passed in request headers', async () => {
    const env = {} as unknown as Env;
    const headers = new Headers({
      'x-provider-key': 'gsk_custom_key',
      'x-byok-provider': 'groq',
    });

    const res = await resolveExecutionResources(env, null, headers);

    expect(res.ok).toBe(true);
    expect(res.resources.model.primary).toBe('groq');
    expect(res.resources.model.isByok).toBe(true);
    expect(res.diagnostics.some((d) => d.includes('BYOK Groq'))).toBe(true);
  });

  it('gracefully degrades to free/fallback providers when hosted keys are missing', async () => {
    const env = {} as unknown as Env;

    const res = await resolveExecutionResources(env, null);

    expect(res.ok).toBe(true);
    expect(res.resources.search.primary).toBe('free_web');
    expect(res.resources.scraping.primary).toBe('jina');
    expect(res.resources.model.primary).toBe('gemini');
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('reflects paid subscription plan caps when user has active plan in KV', async () => {
    const mockKv = {
      get: async (key: string) => {
        if (key.includes('sub:acc_growth')) {
          return { plan: 'growth', expiresAt: Date.now() + 86400000 };
        }
        return null;
      },
    };

    const env = {
      LUMINARA_KV: mockKv,
      GROQ_API_KEY: 'gsk_test',
    } as unknown as Env;

    const user: HostedIdentity = {
      id: 'usr_1',
      accountId: 'acc_growth',
      source: 'telegram',
    };

    const res = await resolveExecutionResources(env, user);

    expect(res.ok).toBe(true);
    expect(res.resources.planId).toBe('growth');
    expect(res.resources.hasUnlimitedQuota).toBe(true);
    expect(res.resources.estimatedCostCents).toBe(0);
  });
});
