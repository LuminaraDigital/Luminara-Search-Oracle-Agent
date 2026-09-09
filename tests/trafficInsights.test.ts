import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/apiClient', () => ({
  sidecarFetch: vi.fn(),
  isSidecarConfiguredOnServer: vi.fn(() => false),
  isProviderConfiguredOnServer: vi.fn(() => false),
  isProxyMode: vi.fn(() => false),
  providerFetch: vi.fn(),
}));

import { sidecarFetch, isSidecarConfiguredOnServer } from '../services/apiClient';
import {
  trafficInsightsService,
  classifyReferrer,
  pctChange,
  normalizeStat,
  normalizeHost,
} from '../services/analytics/trafficInsightsService';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('classifyReferrer', () => {
  it.each([
    ['chatgpt.com', 'ai', 'ChatGPT'],
    ['https://chat.openai.com/', 'ai', 'ChatGPT'],
    ['www.perplexity.ai', 'ai', 'Perplexity'],
    ['gemini.google.com', 'ai', 'Gemini'],
    ['bard.google.com', 'ai', 'Gemini'],
    ['copilot.microsoft.com', 'ai', 'Copilot'],
    ['claude.ai', 'ai', 'Claude'],
    ['you.com', 'ai', 'You.com'],
    ['meta.ai', 'ai', 'Meta AI'],
    ['poe.com', 'ai', 'Poe'],
    ['chat.mistral.ai', 'ai', 'Mistral'],
    ['chat.deepseek.com', 'ai', 'DeepSeek'],
    ['grok.com', 'ai', 'Grok'],
    ['x.ai', 'ai', 'Grok'],
    ['google.com', 'search', 'Google'],
    ['www.google.co.uk', 'search', 'Google'],
    ['google.de', 'search', 'Google'],
    ['bing.com', 'search', 'Bing'],
    ['bing.com/chat', 'search', 'Bing'],
    ['duckduckgo.com', 'search', 'DuckDuckGo'],
    ['search.yahoo.com', 'search', 'Yahoo'],
    ['ecosia.org', 'search', 'Ecosia'],
    ['search.brave.com', 'search', 'Brave'],
    ['yandex.ru', 'search', 'Yandex'],
    ['baidu.com', 'search', 'Baidu'],
    ['facebook.com', 'other', 'facebook.com'],
    ['', 'other', ''],
  ])('%s -> %s / %s', (host, kind, name) => {
    expect(classifyReferrer(host)).toEqual({ kind, name });
  });
});

describe('pctChange', () => {
  it('computes rounded percentage change and handles zero baselines', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(90, 100)).toBe(-10);
    expect(pctChange(1, 3)).toBe(-66.7);
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(NaN, 1)).toBeNull();
  });
});

describe('normalizeStat / normalizeHost', () => {
  it('normalises the three stats shapes', () => {
    expect(normalizeStat({ value: 10, prev: 8 })).toEqual({ value: 10, prev: 8 });
    expect(normalizeStat({ value: 10, change: 2 })).toEqual({ value: 10, prev: 8 });
    expect(normalizeStat(7)).toEqual({ value: 7, prev: null });
    expect(normalizeStat(undefined)).toEqual({ value: 0, prev: null });
  });

  it('strips protocol, www, ports and paths', () => {
    expect(normalizeHost('https://www.Example.com:8443/path?x=1')).toBe('example.com');
  });
});

describe('trafficInsightsService.getImpact', () => {
  beforeEach(() => {
    vi.mocked(sidecarFetch).mockReset();
    vi.mocked(isSidecarConfiguredOnServer).mockReturnValue(false);
  });

  it('returns not_configured when there is no way to reach the service', async () => {
    vi.mocked(sidecarFetch).mockResolvedValue(null);
    const r = await trafficInsightsService.getImpact('example.com');
    expect(r.status).toBe('not_configured');
    expect(r.domain).toBe('example.com');
    expect(trafficInsightsService.summaryForLlm(r)).toContain('not connected');
  });

  it('returns no_website when nothing tracked matches the domain', async () => {
    vi.mocked(sidecarFetch).mockResolvedValue(json({ data: [{ id: 'w1', name: 'Other', domain: 'other.com' }], count: 1 }));
    const r = await trafficInsightsService.getImpact('example.com');
    expect(r.status).toBe('no_website');
    expect(r.message).toContain('example.com');
  });

  it('aggregates stats and AI / search referrals for both windows', async () => {
    vi.mocked(sidecarFetch).mockImplementation(async (_id, path) => {
      if (path.endsWith('/websites')) {
        return json([{ id: 'site-1', name: 'Example', domain: 'www.example.com' }]); // older bare-array shape
      }
      const url = new URL(`http://x${path}`);
      const startAt = Number(url.searchParams.get('startAt'));
      const endAt = Number(url.searchParams.get('endAt'));
      const isPrevious = endAt - startAt > 0 && endAt < Date.now() - 24 * 3600 * 1000;
      if (path.includes('/stats')) {
        return json({ pageviews: { value: 500, prev: 400 }, visitors: { value: 120, prev: 100 }, visits: { value: 150, prev: 125 } });
      }
      if (url.searchParams.get('type') === 'referrer') {
        return json(isPrevious
          ? [{ x: 'chatgpt.com', y: 4 }, { x: 'google.com', y: 50 }, { x: 'facebook.com', y: 10 }]
          : [{ x: 'chatgpt.com', y: 12 }, { x: 'chat.openai.com', y: 3 }, { x: 'perplexity.ai', y: 5 }, { x: 'google.com', y: 60 }, { x: 'bing.com', y: 20 }, { x: 'facebook.com', y: 30 }]);
      }
      if (url.searchParams.get('type') === 'url') {
        return json([{ x: '/', y: 300 }, { x: '/pricing', y: 120 }]);
      }
      return json({});
    });

    const r = await trafficInsightsService.getImpact('https://example.com', { days: 30 });
    expect(r.status).toBe('ready');
    expect(r.websiteId).toBe('site-1');
    expect(r.period.days).toBe(30);

    expect(r.visitors).toEqual({ current: 120, previous: 100, changePct: 20 });
    expect(r.pageviews).toEqual({ current: 500, previous: 400, changePct: 25 });
    expect(r.visits).toEqual({ current: 150, previous: 125, changePct: 20 });

    expect(r.aiAssistantReferrals.total).toBe(20);
    expect(r.aiAssistantReferrals.previousTotal).toBe(4);
    expect(r.aiAssistantReferrals.changePct).toBe(400);
    expect(r.aiAssistantReferrals.bySource).toEqual([
      { name: 'ChatGPT', host: 'chatgpt.com', visits: 15 },
      { name: 'Perplexity', host: 'perplexity.ai', visits: 5 },
    ]);

    expect(r.searchReferrals.total).toBe(80);
    expect(r.searchReferrals.previousTotal).toBe(50);
    expect(r.searchReferrals.changePct).toBe(60);
    expect(r.searchReferrals.bySource.map(s => s.name)).toEqual(['Google', 'Bing']);

    expect(r.topReferrers[0]).toEqual({ name: 'Google', host: 'google.com', visits: 60 });
    expect(r.topPages).toEqual([{ path: '/', views: 300 }, { path: '/pricing', views: 120 }]);

    // Previous-window referrer metrics must always be fetched separately.
    const referrerCalls = vi.mocked(sidecarFetch).mock.calls.filter(c => String(c[1]).includes('type=referrer'));
    expect(referrerCalls).toHaveLength(2);
    // Relay mode (no direct URL) always uses the /api prefix.
    expect(vi.mocked(sidecarFetch).mock.calls.every(c => String(c[1]).startsWith('/api/'))).toBe(true);

    const summary = trafficInsightsService.summaryForLlm(r);
    expect(summary).toContain('last 30 days');
    expect(summary).toContain('ChatGPT 15');
    expect(summary).toContain('measured figures');
  });

  it('fetches previous-window stats when the server only returns plain numbers', async () => {
    let statsCalls = 0;
    vi.mocked(sidecarFetch).mockImplementation(async (_id, path) => {
      if (path.endsWith('/websites')) return json({ data: [{ id: 's', name: 'S', domain: 'example.com' }] });
      if (path.includes('/stats')) {
        statsCalls += 1;
        return json(statsCalls === 1 ? { pageviews: 50, visitors: 10, visits: 12 } : { pageviews: 25, visitors: 5, visits: 6 });
      }
      return json([]);
    });
    const r = await trafficInsightsService.getImpact('example.com');
    expect(r.status).toBe('ready');
    expect(statsCalls).toBe(2);
    expect(r.visitors).toEqual({ current: 10, previous: 5, changePct: 100 });
    expect(r.aiAssistantReferrals.total).toBe(0);
  });

  it('returns error (never throws) when the service answers with HTML', async () => {
    vi.mocked(sidecarFetch).mockResolvedValue(new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const r = await trafficInsightsService.getImpact('example.com');
    expect(r.status).toBe('error');
    expect(r.message).toBeTruthy();
  });

  it('builds a tracking snippet', () => {
    expect(trafficInsightsService.trackingSnippet('abc', 'https://stats.example.com/')).toBe('<script defer src="https://stats.example.com/script.js" data-website-id="abc"></script>');
  });
});
