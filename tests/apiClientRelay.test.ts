import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('apiClient BYOK relay gating', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('relays BYOK when apiBase is set even if health has not loaded', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', hostname: 'luminarasuite.com', port: '', origin: 'https://luminarasuite.com' },
    });
    const { canRelayWithOwnKey, getServerHealthSync } = await import('../services/apiClient');
    expect(getServerHealthSync().ok).toBe(false);
    expect(canRelayWithOwnKey('groq')).toBe(true);
    expect(canRelayWithOwnKey('tavily')).toBe(true);
    expect(canRelayWithOwnKey('unknown-vendor')).toBe(false);
  });

  it('does not relay when there is no http(s) origin', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'file:', hostname: '', port: '', origin: 'null' },
    });
    const { canRelayWithOwnKey, apiBase } = await import('../services/apiClient');
    expect(apiBase()).toBe('');
    expect(canRelayWithOwnKey('groq')).toBe(false);
  });
});

describe('hosted paid provider gating', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('treats free quota as not paid', async () => {
    const api = await import('../services/apiClient');
    api.updateQuotaFromHeaders(new Headers({
      'x-quota-remaining': '16',
      'x-quota-limit': '25',
      'x-quota-reset': '3600',
    }));
    expect(api.hasActivePaidPlanSync()).toBe(false);
    expect(api.isPaidHostedProvider('nim')).toBe(true);
    expect(api.isPaidHostedProvider('groq')).toBe(false);
  });

  it('treats unlimited quota as paid', async () => {
    const api = await import('../services/apiClient');
    api.updateQuotaFromHeaders(new Headers({
      'x-quota-remaining': 'unlimited',
      'x-quota-limit': 'unlimited',
      'x-quota-reset': '0',
    }));
    expect(api.hasActivePaidPlanSync()).toBe(true);
  });
});
