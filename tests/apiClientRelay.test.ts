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
  }, 15000);

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

describe('the header that asks the Worker for a fallback answer', () => {
  const DIRECT_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const RELAY_URL = 'https://luminarasuite.com/api/providers/groq/chat/completions';

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  /** Loads apiClient on a page served by the Worker, with health loaded, and records every fetch. */
  async function onWorkerOrigin() {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', hostname: 'luminarasuite.com', port: '', origin: 'https://luminarasuite.com' },
      dispatchEvent: () => true,
    });
    const calls: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      calls.push({ url, headers: new Headers(init?.headers || {}) });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const api = await import('../services/apiClient');
    await api.loadServerHealth();
    expect(api.isProxyMode()).toBe(true);
    return { api, calls };
  }

  const init = (headers: Record<string, string> = {}): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer proxy', ...headers },
    body: '{}',
  });

  it('is sent on a hosted relay call when the caller asks for it', async () => {
    const { api, calls } = await onWorkerOrigin();

    await api.providerFetch('groq', '/chat/completions', DIRECT_URL, init(), { userKey: 'proxy', acceptFallback: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(RELAY_URL);
    expect(calls[0].headers.get(api.ACCEPT_FALLBACK_HEADER)).toBe('1');
  }, 15000);

  it('is not sent when the caller does not ask, even if a header of that name was passed in', async () => {
    const { api, calls } = await onWorkerOrigin();

    await api.providerFetch('groq', '/chat/completions', DIRECT_URL, init(), { userKey: 'proxy' });
    await api.providerFetch('groq', '/chat/completions', DIRECT_URL, init({ 'x-accept-fallback': '1' }), { userKey: 'proxy' });

    expect(calls).toHaveLength(2);
    expect(calls.map(c => c.headers.get(api.ACCEPT_FALLBACK_HEADER))).toEqual([null, null]);
  }, 15000);

  it('is not sent with the user own key: a BYOK call never gets a fallback answer', async () => {
    const { api, calls } = await onWorkerOrigin();

    await api.providerFetch('groq', '/chat/completions', DIRECT_URL, init(), { userKey: 'gsk_user_own_key', acceptFallback: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(RELAY_URL);
    expect(calls[0].headers.get('x-provider-key')).toBe('gsk_user_own_key');
    expect(calls[0].headers.get(api.ACCEPT_FALLBACK_HEADER)).toBeNull();
  }, 15000);

  it('is not added to a direct vendor call, which would fail the vendor CORS check', async () => {
    vi.stubGlobal('window', { location: { protocol: 'file:', hostname: '', port: '', origin: 'null' } });
    const seen: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, requestInit?: RequestInit) => {
      seen.push({ url: String(input), headers: new Headers(requestInit?.headers || {}) });
      return new Response('{}', { status: 200 });
    }));
    const api = await import('../services/apiClient');

    await api.providerFetch('groq', '/chat/completions', DIRECT_URL, init(), { userKey: 'gsk_user_own_key', acceptFallback: true });

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(DIRECT_URL);
    expect(seen[0].headers.get(api.ACCEPT_FALLBACK_HEADER)).toBeNull();
  }, 15000);
});
