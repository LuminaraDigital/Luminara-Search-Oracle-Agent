import { configService } from '../configService';
import { providerFetch } from '../apiClient';

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
  images?: string[];
}

export class TavilyService {
  private static instance: TavilyService;

  private constructor() {}

  public static getInstance(): TavilyService {
    if (!TavilyService.instance) {
      TavilyService.instance = new TavilyService();
    }
    return TavilyService.instance;
  }

  public async search(query: string, options: { maxResults?: number; searchDepth?: 'basic' | 'advanced'; includeAnswer?: boolean } = {}): Promise<TavilySearchResponse> {
    const apiKey = configService.getTavilyKey();
    if (!apiKey) {
      console.warn('[Tavily] No Tavily API Key configured - falling back to zero-key search');
      const freeResults = await import('./freeWebSearch').then(m => m.freeWebSearch(query, options.maxResults || 5)).catch(() => []);
      return {
        query,
        results: freeResults.map(r => ({
          title: r.title,
          url: r.url,
          content: r.snippet,
        })),
      };
    }

    try {
      const response = await providerFetch('tavily', '/search', 'https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: options.searchDepth || 'basic',
          include_answer: options.includeAnswer ?? true,
          max_results: options.maxResults || 5,
        }),
      }, { userKey: apiKey });

      if (!response.ok) {
        throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return {
        query,
        answer: data.answer,
        results: (data.results || []).map((r: any) => ({
          title: r.title || r.url,
          url: r.url,
          content: r.content || '',
          score: r.score,
        })),
        images: data.images || [],
      };
    } catch (err) {
      console.error('[Tavily] Search failed, falling back to zero-key search:', err);
      const freeResults = await import('./freeWebSearch').then(m => m.freeWebSearch(query, options.maxResults || 5)).catch(() => []);
      return {
        query,
        results: freeResults.map(r => ({
          title: r.title,
          url: r.url,
          content: r.snippet,
        })),
      };
    }
  }

  /**
   * Helper to format Tavily results as grounding context string
   */
  public async getGroundingContext(query: string): Promise<{ contextText: string; sources: Array<{ uri: string; title: string }> }> {
    const resp = await this.search(query, { maxResults: 5, includeAnswer: true });
    if (!resp.results.length && !resp.answer) {
      return { contextText: '', sources: [] };
    }

    const sources = resp.results.map(r => ({ uri: r.url, title: r.title }));
    const lines: string[] = [
      `[TAVILY LIVE SERP GROUNDING]`,
      resp.answer ? `Direct Answer: ${resp.answer}` : '',
      'Search Evidence:',
      ...resp.results.map((r, i) => `[${i + 1}] "${r.title}" (${r.url}):\n${r.content}`),
      '--------------------------------------------------',
    ].filter(Boolean);

    return {
      contextText: lines.join('\n'),
      sources,
    };
  }
}

export const tavilyService = TavilyService.getInstance();
