import { describe, expect, it, vi, beforeEach } from 'vitest';
import { localSerpService } from '../services/search/localSerpService';
import { configService } from '../services/configService';

const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};

if (!globalThis.localStorage) {
  (globalThis as any).localStorage = mockLocalStorage;
}

describe('LocalSerpService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is exported as a singleton instance', () => {
    expect(localSerpService).toBeDefined();
    expect(typeof localSerpService.search).toBe('function');
    expect(typeof localSerpService.getGroundingContext).toBe('function');
    expect(typeof localSerpService.checkHealth).toBe('function');
  });

  it('handles sidecar offline / fetch failure gracefully without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection refused'));

    const res = await localSerpService.search('test query');
    expect(res.success).toBe(false);
    expect(res.results).toEqual([]);
    expect(res.error).toContain('Connection refused');
  });

  it('formats grounding context with featured snippets and organic rankings', async () => {
    vi.spyOn(localSerpService, 'search').mockResolvedValueOnce({
      success: true,
      query: 'best generative engine optimization tools',
      tier: 'fast-http',
      latencyMs: 120,
      featuredSnippet: {
        title: 'GEO Overview',
        snippet: 'Generative Engine Optimization optimizes content for AI search engines.',
        url: 'https://example.com/geo-guide',
      },
      peopleAlsoAsk: ['What is GEO in SEO?', 'How to rank in AI Overviews?'],
      results: [
        {
          rank: 1,
          title: 'Luminara Suite - AI Visibility',
          url: 'https://luminarasuite.com',
          snippet: 'Open-source AEO and GEO visibility suite.',
        },
        {
          rank: 2,
          title: 'Search Optimization 2026',
          url: 'https://searchengineland.com/geo-2026',
          snippet: 'Latest algorithmic factors in generative AI responses.',
        },
      ],
    });

    const grounding = await localSerpService.getGroundingContext('best generative engine optimization tools');
    expect(grounding.contextText).toContain('[LOCAL LIVE SERP GROUNDING]');
    expect(grounding.contextText).toContain('Featured Snippet: "Generative Engine Optimization optimizes content');
    expect(grounding.contextText).toContain('[1] "Luminara Suite - AI Visibility" (https://luminarasuite.com)');
    expect(grounding.contextText).toContain('[2] "Search Optimization 2026"');
    expect(grounding.contextText).toContain('People Also Ask: "What is GEO in SEO?", "How to rank in AI Overviews?"');
    expect(grounding.sources.length).toBe(2);
    expect(grounding.sources[0].uri).toBe('https://luminarasuite.com');
  });

  it('returns empty grounding context if search fails or has no results', async () => {
    vi.spyOn(localSerpService, 'search').mockResolvedValueOnce({
      success: false,
      query: 'unknown keyword',
      results: [],
    });

    const grounding = await localSerpService.getGroundingContext('unknown keyword');
    expect(grounding.contextText).toBe('');
    expect(grounding.sources).toEqual([]);
  });

  it('checks sidecar health endpoint and parses response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, message: 'Luminara Patchright Stealth Runner & SERP Engine is active' }),
    } as any);

    const health = await localSerpService.checkHealth('http://localhost:3001');
    expect(health.ok).toBe(true);
    expect(health.message).toContain('active');
  });

  it('toggles local SERP setting in configService', () => {
    configService.setLocalSerpEnabled(false);
    expect(configService.isLocalSerpEnabled()).toBe(false);

    configService.setLocalSerpEnabled(true);
    expect(configService.isLocalSerpEnabled()).toBe(true);
  });
});
