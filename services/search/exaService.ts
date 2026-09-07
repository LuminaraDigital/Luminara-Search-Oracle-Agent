import { configService } from '../configService';
import { providerFetch } from '../apiClient';

export interface ExaSearchResult {
  id: string;
  url: string;
  title: string;
  score?: number;
  publishedDate?: string;
  author?: string;
  text?: string;
  summary?: string;
}

export interface ExaSearchResponse {
  results: ExaSearchResult[];
  autopromptString?: string;
}

export class ExaService {
  private static instance: ExaService;

  private constructor() {}

  public static getInstance(): ExaService {
    if (!ExaService.instance) {
      ExaService.instance = new ExaService();
    }
    return ExaService.instance;
  }

  public async search(query: string, options: { numResults?: number; contents?: boolean; summary?: boolean } = {}): Promise<ExaSearchResponse> {
    const apiKey = configService.getExaKey();
    if (!apiKey) {
      console.warn('[Exa] No Exa.ai API Key configured');
      return { results: [] };
    }

    try {
      const body: any = {
        query,
        numResults: options.numResults || 5,
        useAutoprompt: true,
      };

      if (options.contents) {
        body.contents = {
          text: { maxCharacters: 1500 },
          summary: options.summary ?? true,
        };
      }

      const response = await providerFetch('exa', '/search', 'https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Exa API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return {
        results: (data.results || []).map((r: any) => ({
          id: r.id,
          url: r.url,
          title: r.title || r.url,
          score: r.score,
          publishedDate: r.publishedDate,
          author: r.author,
          text: r.text,
          summary: r.summary,
        })),
        autopromptString: data.autopromptString,
      };
    } catch (err) {
      console.error('[Exa] Search failed:', err);
      return { results: [] };
    }
  }
}

export const exaService = ExaService.getInstance();
