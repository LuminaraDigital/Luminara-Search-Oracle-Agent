/**
 * Firecrawl client: scrape, map, crawl (+ status poll).
 * Routes through Worker proxy when hosted / BYOK relay is active (see providerFetch).
 * Uses Firecrawl v1 paths to match worker PROVIDERS.firecrawl.base.
 */

import { configService } from '../configService';
import { providerFetch } from '../apiClient';

const FIRECRAWL_V1 = 'https://api.firecrawl.dev/v1';

export interface FirecrawlScrapeResult {
  success: boolean;
  markdown?: string;
  html?: string;
  metadata?: {
    title?: string;
    description?: string;
    language?: string;
    sourceURL?: string;
    statusCode?: number;
    ogImage?: string;
    [key: string]: unknown;
  };
  error?: string;
  /** HTTP status from Firecrawl / proxy (402 = upgrade required). */
  httpStatus?: number;
  code?: string;
}

export interface FirecrawlMapLink {
  url: string;
  title?: string;
  description?: string;
}

export interface FirecrawlMapResult {
  success: boolean;
  links: FirecrawlMapLink[];
  error?: string;
  httpStatus?: number;
  code?: string;
}

export interface FirecrawlCrawlPage {
  markdown?: string;
  html?: string;
  metadata?: FirecrawlScrapeResult['metadata'];
}

export interface FirecrawlCrawlResult {
  success: boolean;
  id?: string;
  status?: string;
  pages: FirecrawlCrawlPage[];
  total?: number;
  completed?: number;
  creditsUsed?: number;
  error?: string;
  httpStatus?: number;
  code?: string;
}

export interface FirecrawlCrawlOptions {
  limit?: number;
  maxDepth?: number;
  includePaths?: string[];
  excludePaths?: string[];
  /** Poll timeout for async crawl jobs. */
  timeoutMs?: number;
  pollIntervalMs?: number;
}

async function parseErrorBody(res: Response): Promise<{ error: string; code?: string }> {
  try {
    const body = await res.json() as { error?: string; code?: string; message?: string };
    return {
      error: body.error || body.message || `Firecrawl HTTP ${res.status}`,
      code: body.code,
    };
  } catch {
    return { error: `Firecrawl HTTP ${res.status}` };
  }
}

export class FirecrawlService {
  private static instance: FirecrawlService;

  private constructor() {}

  public static getInstance(): FirecrawlService {
    if (!FirecrawlService.instance) {
      FirecrawlService.instance = new FirecrawlService();
    }
    return FirecrawlService.instance;
  }

  private apiKey(): string {
    return configService.getFirecrawlKey();
  }

  public async scrapeUrl(
    url: string,
    formats: ('markdown' | 'html')[] = ['markdown'],
  ): Promise<FirecrawlScrapeResult> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      return { success: false, error: 'No Firecrawl API Key configured' };
    }

    try {
      const response = await providerFetch(
        'firecrawl',
        '/scrape',
        `${FIRECRAWL_V1}/scrape`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            url,
            formats,
            onlyMainContent: true,
            waitFor: 1000,
          }),
        },
        { userKey: apiKey },
      );

      if (!response.ok) {
        const err = await parseErrorBody(response);
        return { success: false, ...err, httpStatus: response.status };
      }

      const resData = await response.json();
      const data = resData.data || resData;

      return {
        success: true,
        markdown: data.markdown,
        html: data.html,
        metadata: data.metadata,
        httpStatus: response.status,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Scrape failed';
      console.error('[Firecrawl] Scrape failed:', err);
      return { success: false, error: message };
    }
  }

  /**
   * Fast URL discovery (sitemap + on-page links). One credit per call on Firecrawl Cloud.
   */
  public async mapUrl(
    url: string,
    options: { limit?: number; includeSubdomains?: boolean; search?: string } = {},
  ): Promise<FirecrawlMapResult> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      return { success: false, links: [], error: 'No Firecrawl API Key configured' };
    }

    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));

    try {
      const response = await providerFetch(
        'firecrawl',
        '/map',
        `${FIRECRAWL_V1}/map`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            url,
            limit,
            includeSubdomains: options.includeSubdomains ?? false,
            ignoreSitemap: false,
            ...(options.search ? { search: options.search } : {}),
          }),
        },
        { userKey: apiKey },
      );

      if (!response.ok) {
        const err = await parseErrorBody(response);
        return { success: false, links: [], ...err, httpStatus: response.status };
      }

      const resData = await response.json();
      const rawLinks = resData.links || resData.data?.links || resData.data || [];
      const links: FirecrawlMapLink[] = [];

      if (Array.isArray(rawLinks)) {
        for (const item of rawLinks) {
          if (typeof item === 'string') {
            links.push({ url: item });
          } else if (item && typeof item === 'object' && typeof item.url === 'string') {
            links.push({
              url: item.url,
              title: typeof item.title === 'string' ? item.title : undefined,
              description: typeof item.description === 'string' ? item.description : undefined,
            });
          }
        }
      }

      return { success: true, links, httpStatus: response.status };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Map failed';
      console.error('[Firecrawl] Map failed:', err);
      return { success: false, links: [], error: message };
    }
  }

  /** Start crawl job; returns job id. Hosted Worker keys require an active paid plan. */
  public async startCrawl(url: string, options: FirecrawlCrawlOptions = {}): Promise<FirecrawlCrawlResult> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      return { success: false, pages: [], error: 'No Firecrawl API Key configured' };
    }

    const limit = Math.max(1, Math.min(options.limit ?? 8, 25));
    const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 2, 3));

    try {
      const response = await providerFetch(
        'firecrawl',
        '/crawl',
        `${FIRECRAWL_V1}/crawl`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            url,
            limit,
            maxDepth,
            allowBackwardLinks: false,
            allowExternalLinks: false,
            ignoreSitemap: false,
            includePaths: options.includePaths,
            excludePaths: options.excludePaths ?? [
              'blog/.*',
              'tag/.*',
              'category/.*',
              'wp-admin/.*',
              'cart/.*',
              'checkout/.*',
            ],
            scrapeOptions: {
              formats: ['markdown', 'html'],
              onlyMainContent: true,
            },
          }),
        },
        { userKey: apiKey },
      );

      if (!response.ok) {
        const err = await parseErrorBody(response);
        return { success: false, pages: [], ...err, httpStatus: response.status };
      }

      const resData = await response.json();
      const id = resData.id || resData.jobId || resData.data?.id;
      if (!id) {
        // Some responses may return completed data inline.
        const pages = this.normalizeCrawlPages(resData.data || resData.pages || []);
        if (pages.length) {
          return { success: true, status: 'completed', pages, httpStatus: response.status };
        }
        return { success: false, pages: [], error: 'Firecrawl crawl returned no job id', httpStatus: response.status };
      }

      return { success: true, id: String(id), status: 'scraping', pages: [], httpStatus: response.status };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Crawl start failed';
      console.error('[Firecrawl] Crawl start failed:', err);
      return { success: false, pages: [], error: message };
    }
  }

  public async getCrawlStatus(jobId: string): Promise<FirecrawlCrawlResult> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      return { success: false, pages: [], error: 'No Firecrawl API Key configured' };
    }

    const path = `/crawl/${encodeURIComponent(jobId)}`;
    try {
      const response = await providerFetch(
        'firecrawl',
        path,
        `${FIRECRAWL_V1}${path}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
        { userKey: apiKey },
      );

      if (!response.ok) {
        const err = await parseErrorBody(response);
        return { success: false, pages: [], ...err, httpStatus: response.status };
      }

      const resData = await response.json();
      const status = String(resData.status || 'unknown');
      const pages = this.normalizeCrawlPages(resData.data || []);

      return {
        success: status === 'completed' || pages.length > 0,
        id: jobId,
        status,
        pages,
        total: typeof resData.total === 'number' ? resData.total : undefined,
        completed: typeof resData.completed === 'number' ? resData.completed : undefined,
        creditsUsed: typeof resData.creditsUsed === 'number' ? resData.creditsUsed : undefined,
        httpStatus: response.status,
        error: status === 'failed' ? (resData.error || 'Crawl failed') : undefined,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Crawl status failed';
      console.error('[Firecrawl] Crawl status failed:', err);
      return { success: false, pages: [], error: message };
    }
  }

  /** Start crawl and poll until completed, failed, or timeout. */
  public async crawlSite(url: string, options: FirecrawlCrawlOptions = {}): Promise<FirecrawlCrawlResult> {
    const started = await this.startCrawl(url, options);
    if (!started.success) return started;
    if (started.pages.length > 0 && started.status === 'completed') return started;
    if (!started.id) return { ...started, success: false, error: started.error || 'Missing crawl id' };

    const timeoutMs = options.timeoutMs ?? 45_000;
    const pollIntervalMs = options.pollIntervalMs ?? 1_500;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const status = await this.getCrawlStatus(started.id);
      if (status.status === 'completed') return status;
      if (status.status === 'failed' || status.status === 'cancelled') {
        return { ...status, success: false, error: status.error || `Crawl ${status.status}` };
      }
    }

    // Return partial pages if any were collected before timeout.
    const last = await this.getCrawlStatus(started.id);
    if (last.pages.length > 0) {
      return {
        ...last,
        success: true,
        status: last.status || 'partial',
        error: undefined,
      };
    }
    return {
      success: false,
      id: started.id,
      pages: [],
      error: 'Crawl timed out before pages were ready',
      httpStatus: last.httpStatus,
    };
  }

  private normalizeCrawlPages(raw: unknown): FirecrawlCrawlPage[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p) => p && typeof p === 'object')
      .map((p: any) => ({
        markdown: typeof p.markdown === 'string' ? p.markdown : undefined,
        html: typeof p.html === 'string' ? p.html : undefined,
        metadata: p.metadata && typeof p.metadata === 'object' ? p.metadata : undefined,
      }));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const firecrawlService = FirecrawlService.getInstance();
