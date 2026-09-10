import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnifiedSearchService } from '../services/search/unifiedSearchService';
import { configService } from '../services/configService';
import { TavilyService } from '../services/search/tavilyService';
import * as freeWebSearchModule from '../services/search/freeWebSearch';

describe('UnifiedSearchService - Multi-Provider Fallback Waterfall', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('cascades to freeWebSearch when Tavily and Exa keys are not set', async () => {
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('');
    vi.spyOn(configService, 'getExaKey').mockReturnValue('');
    vi.spyOn(freeWebSearchModule, 'freeWebSearch').mockResolvedValue([
      {
        title: 'Luminara Free Result',
        url: 'https://luminarasuite.com',
        snippet: 'AEO and SEO intelligence.',
      },
    ]);

    const service = UnifiedSearchService.getInstance();
    const resp = await service.search('luminara aeo audit');

    expect(resp.providerUsed).toBe('ddg-free');
    expect(resp.results).toHaveLength(1);
    expect(resp.results[0].title).toBe('Luminara Free Result');
    expect(resp.results[0].source).toBe('ddg-free');
  });

  it('uses Tavily when Tavily key is present and returns results', async () => {
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('tvly-mock-key');
    const tavily = TavilyService.getInstance();
    vi.spyOn(tavily, 'search').mockResolvedValue({
      query: 'luminara',
      answer: 'Luminara Suite is an AEO tool',
      results: [
        {
          title: 'Tavily Result',
          url: 'https://example.com/tavily',
          content: 'Tavily grounded evidence',
          score: 0.95,
        },
      ],
    });

    const service = UnifiedSearchService.getInstance();
    const resp = await service.search('luminara');

    expect(resp.providerUsed).toBe('tavily');
    expect(resp.results).toHaveLength(1);
    expect(resp.results[0].title).toBe('Tavily Result');
    expect(resp.results[0].source).toBe('tavily');
  });

  it('falls back to freeWebSearch if Tavily throws an error', async () => {
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('tvly-mock-key');
    vi.spyOn(configService, 'getExaKey').mockReturnValue('');
    const tavily = TavilyService.getInstance();
    vi.spyOn(tavily, 'search').mockRejectedValue(new Error('Tavily 429 Rate Limit'));

    vi.spyOn(freeWebSearchModule, 'freeWebSearch').mockResolvedValue([
      {
        title: 'Fallback Result',
        url: 'https://example.com/fallback',
        snippet: 'Fallback snippet',
      },
    ]);

    const service = UnifiedSearchService.getInstance();
    const resp = await service.search('test query');

    expect(resp.providerUsed).toBe('ddg-free');
    expect(resp.results).toHaveLength(1);
    expect(resp.results[0].title).toBe('Fallback Result');
  });
});
