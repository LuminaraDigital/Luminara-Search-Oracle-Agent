import { configService } from '../configService';

export interface LocalSerpResult {
  rank: number;
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

export interface LocalSerpResponse {
  success: boolean;
  query: string;
  tier?: 'fast-http' | 'patchright-stealth';
  latencyMs?: number;
  aiOverview?: { text: string; sources: Array<{ title: string; url: string }> };
  featuredSnippet?: { title: string; snippet: string; url: string };
  results: LocalSerpResult[];
  peopleAlsoAsk?: string[];
  error?: string;
}

export class LocalSerpService {
  private static instance: LocalSerpService;

  private constructor() {}

  public static getInstance(): LocalSerpService {
    if (!LocalSerpService.instance) {
      LocalSerpService.instance = new LocalSerpService();
    }
    return LocalSerpService.instance;
  }

  /**
   * Health check to test if the local SERP scraper endpoint is reachable.
   */
  public async checkHealth(customEndpoint?: string): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const endpoint = (customEndpoint || configService.getLocalSerpUrl() || 'http://localhost:3001').replace(/\/$/, '');
    const startTime = performance.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${endpoint}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - startTime);

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return {
          ok: true,
          message: data.message || 'Local SERP Scraper sidecar connected',
          latencyMs,
        };
      }
      return {
        ok: false,
        message: `HTTP ${res.status}: ${res.statusText}`,
        latencyMs,
      };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        ok: false,
        message: err.name === 'AbortError' ? 'Connection timed out' : (err.message || 'Sidecar unreachable'),
        latencyMs,
      };
    }
  }

  /**
   * Dispatches a search query to the local SERP scraper sidecar.
   */
  public async search(
    query: string,
    options: {
      num?: number;
      hl?: string;
      gl?: string;
      proxy?: string;
      preferStealth?: boolean;
      timeout?: number;
    } = {}
  ): Promise<LocalSerpResponse> {
    const endpoint = (configService.getLocalSerpUrl() || 'http://localhost:3001').replace(/\/$/, '');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeout || 25000);

      const res = await fetch(`${endpoint}/serp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...configService.crawlerAuthHeaders() },
        body: JSON.stringify({
          query,
          num: options.num || 10,
          hl: options.hl || 'en',
          gl: options.gl || 'us',
          proxy: options.proxy,
          preferStealth: options.preferStealth || false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          success: false,
          query,
          results: [],
          error: `Sidecar error ${res.status}: ${errText || res.statusText}`,
        };
      }

      const data: LocalSerpResponse = await res.json();
      return data;
    } catch (err: any) {
      console.warn('[LocalSerp] Query dispatch failed:', err.message);
      return {
        success: false,
        query,
        results: [],
        error: err.name === 'AbortError' ? 'Search request timed out' : err.message,
      };
    }
  }

  /**
   * Formats the local SERP findings into an LLM prompt grounding context block.
   */
  public async getGroundingContext(
    query: string
  ): Promise<{ contextText: string; sources: Array<{ uri: string; title: string }> }> {
    const resp = await this.search(query, { num: 6 });
    if (!resp.success || !resp.results.length) {
      return { contextText: '', sources: [] };
    }

    const sources = resp.results.map(r => ({ uri: r.url, title: r.title }));
    const lines: string[] = [
      `[LOCAL LIVE SERP GROUNDING] (Source: Google Search via Sidecar ${resp.tier || 'Fast'})`,
      resp.featuredSnippet
        ? `Featured Snippet: "${resp.featuredSnippet.snippet}" (${resp.featuredSnippet.url})`
        : resp.aiOverview
        ? `AI Overview Summary: "${resp.aiOverview.text}"`
        : '',
      'Search Evidence & Rankings:',
      ...resp.results.map(
        r => `[${r.rank}] "${r.title}" (${r.url}):\n${r.snippet}`
      ),
      ...(resp.peopleAlsoAsk && resp.peopleAlsoAsk.length
        ? [`People Also Ask: ${resp.peopleAlsoAsk.slice(0, 4).map(q => `"${q}"`).join(', ')}`]
        : []),
      '--------------------------------------------------',
    ].filter(Boolean);

    return {
      contextText: lines.join('\n'),
      sources,
    };
  }
}

export const localSerpService = LocalSerpService.getInstance();
