import { configService } from '../configService';
import { providerFetch } from '../apiClient';

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
    [key: string]: any;
  };
  error?: string;
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

  public async scrapeUrl(url: string, formats: ('markdown' | 'html')[] = ['markdown']): Promise<FirecrawlScrapeResult> {
    const apiKey = configService.getFirecrawlKey();
    if (!apiKey) {
      console.warn('[Firecrawl] No Firecrawl API Key configured');
      return { success: false, error: 'No Firecrawl API Key configured' };
    }

    try {
      const response = await providerFetch('firecrawl', '/scrape', 'https://api.firecrawl.dev/v1/scrape', {
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
      }, { userKey: apiKey });

      if (!response.ok) {
        throw new Error(`Firecrawl scrape error: ${response.status} ${response.statusText}`);
      }

      const resData = await response.json();
      const data = resData.data || resData;

      return {
        success: true,
        markdown: data.markdown,
        html: data.html,
        metadata: data.metadata,
      };
    } catch (err: any) {
      console.error('[Firecrawl] Scrape failed:', err);
      return {
        success: false,
        error: err?.message || 'Scrape failed',
      };
    }
  }
}

export const firecrawlService = FirecrawlService.getInstance();
