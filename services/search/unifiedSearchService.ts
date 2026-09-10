import { configService } from '../configService';
import { TavilyService, type TavilySearchResult } from './tavilyService';
import { ExaService, type ExaSearchResult } from './exaService';
import { freeWebSearch, type FreeSearchResult } from './freeWebSearch';

export interface UnifiedSearchResult {
  title: string;
  url: string;
  content: string;
  snippet?: string;
  score?: number;
  source: 'tavily' | 'exa' | 'ddg-free';
}

export interface UnifiedSearchResponse {
  query: string;
  answer?: string;
  results: UnifiedSearchResult[];
  providerUsed: 'tavily' | 'exa' | 'ddg-free' | 'none';
}

export interface UnifiedSearchOptions {
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeAnswer?: boolean;
  preferredProvider?: 'auto' | 'tavily' | 'exa' | 'ddg-free';
}

export class UnifiedSearchService {
  private static instance: UnifiedSearchService;

  private constructor() {}

  public static getInstance(): UnifiedSearchService {
    if (!UnifiedSearchService.instance) {
      UnifiedSearchService.instance = new UnifiedSearchService();
    }
    return UnifiedSearchService.instance;
  }

  /**
   * Search orchestrator that cascades through Tavily -> Exa -> Free DuckDuckGo Lite.
   * Guarantees that search evidence is returned even when commercial API keys are absent.
   */
  public async search(
    query: string,
    options: UnifiedSearchOptions = {}
  ): Promise<UnifiedSearchResponse> {
    const maxResults = options.maxResults || 5;
    const preferred = options.preferredProvider || 'auto';

    // 1. Direct request to DuckDuckGo Free if requested
    if (preferred === 'ddg-free') {
      return this.executeFreeSearch(query, maxResults);
    }

    // 2. Try Tavily (if configured or preferred)
    if (preferred === 'auto' || preferred === 'tavily') {
      const tavilyKey = configService.getTavilyKey();
      if (tavilyKey) {
        try {
          const tavily = TavilyService.getInstance();
          const tavilyRes = await tavily.search(query, {
            maxResults,
            searchDepth: options.searchDepth,
            includeAnswer: options.includeAnswer,
          });

          if (tavilyRes.results && tavilyRes.results.length > 0) {
            return {
              query,
              answer: tavilyRes.answer,
              providerUsed: 'tavily',
              results: tavilyRes.results.map((r: TavilySearchResult) => ({
                title: r.title,
                url: r.url,
                content: r.content,
                snippet: r.content,
                score: r.score,
                source: 'tavily' as const,
              })),
            };
          }
        } catch (err) {
          console.warn('[UnifiedSearch] Tavily search failed, falling through to secondary/free providers:', err);
        }
      }
    }

    // 3. Try Exa (if configured or preferred)
    if (preferred === 'auto' || preferred === 'exa') {
      const exaKey = configService.getExaKey();
      if (exaKey) {
        try {
          const exa = ExaService.getInstance();
          const exaRes = await exa.search(query, {
            numResults: maxResults,
            contents: true,
            summary: true,
          });

          if (exaRes.results && exaRes.results.length > 0) {
            return {
              query,
              providerUsed: 'exa',
              results: exaRes.results.map((r: ExaSearchResult) => ({
                title: r.title,
                url: r.url,
                content: r.text || r.summary || '',
                snippet: r.summary || r.text || '',
                score: r.score,
                source: 'exa' as const,
              })),
            };
          }
        } catch (err) {
          console.warn('[UnifiedSearch] Exa search failed, falling through to free provider:', err);
        }
      }
    }

    // 4. Ultimate Fallback: Free DuckDuckGo Lite Scraper
    return this.executeFreeSearch(query, maxResults);
  }

  private async executeFreeSearch(query: string, maxResults: number): Promise<UnifiedSearchResponse> {
    try {
      const freeResults = await freeWebSearch(query, maxResults);
      if (freeResults.length > 0) {
        return {
          query,
          providerUsed: 'ddg-free',
          results: freeResults.map((r: FreeSearchResult) => ({
            title: r.title,
            url: r.url,
            content: r.snippet,
            snippet: r.snippet,
            source: 'ddg-free' as const,
          })),
        };
      }
    } catch (err) {
      console.error('[UnifiedSearch] All search providers including free fallback failed:', err);
    }

    return {
      query,
      results: [],
      providerUsed: 'none',
    };
  }
}

export const unifiedSearchService = UnifiedSearchService.getInstance();
