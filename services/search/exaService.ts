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

  public async search(query: string, options: { numResults?: number; contents?: boolean; summary?: boolean; timeoutMs?: number } = {}): Promise<ExaSearchResponse> {
    const apiKey = configService.getExaKey();
    if (!apiKey) {
      console.warn('[Exa] No Exa.ai API Key configured');
      return { results: [] };
    }

    const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 0;
    const controller = timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
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
        signal: controller?.signal,
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
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Page text when a direct fetch was blocked. Empty when Exa has nothing. */
  public async contents(urls: string[], timeoutMs = 8000): Promise<ExaSearchResult[]> {
    const apiKey = configService.getExaKey();
    const list = urls.map((url) => url.trim()).filter(Boolean).slice(0, 3);
    if (!apiKey || list.length === 0) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await providerFetch('exa', '/contents', 'https://api.exa.ai/contents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          urls: list,
          text: { maxCharacters: 1500 },
        }),
        signal: controller.signal,
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.results || []).map((r: any) => ({
        id: r.id || r.url,
        url: r.url,
        title: r.title || r.url,
        text: r.text,
        summary: r.summary,
      }));
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

export const exaService = ExaService.getInstance();
