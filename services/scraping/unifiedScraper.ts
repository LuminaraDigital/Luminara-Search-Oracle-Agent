/**
 * Unified Scraping & Crawling Orchestrator
 * 
 * Provides resilient, multi-tier web extraction with automated failover:
 * Tier 1: Patchright Stealth Runner (Zero-cost, anti-bot resilient via AST-patched CDP)
 * Tier 2: Firecrawl Managed API (High-fidelity cloud scraping)
 * Tier 3: Jina Reader / Direct Fetch (Zero-configuration lightweight fallback)
 * 
 * Post-processes all incoming data through ContentDistiller for token budgeting,
 * JSON-LD schema extraction, and boilerplate removal.
 */

import { configService } from '../configService';
import { patchrightClient } from './patchrightClient';
import { firecrawlService } from './firecrawlService';
import { contentDistiller, DistilledContentResult } from './contentDistiller';

export type ScraperProviderType = 'auto' | 'patchright' | 'firecrawl' | 'jina';

export interface ScrapedPageEvidence {
  success: boolean;
  providerUsed: 'patchright' | 'firecrawl' | 'jina' | 'direct';
  url: string;
  statusCode?: number;
  title: string;
  description: string;
  markdown: string;
  rawHtml?: string;
  distilled: DistilledContentResult;
  formattedEvidence: string;
  latencyMs: number;
  antiBotBypassed?: boolean;
  error?: string;
}

export class UnifiedScraperService {
  private static instance: UnifiedScraperService;

  private constructor() {}

  public static getInstance(): UnifiedScraperService {
    if (!UnifiedScraperService.instance) {
      UnifiedScraperService.instance = new UnifiedScraperService();
    }
    return UnifiedScraperService.instance;
  }

  /**
   * Scrapes a URL using the preferred or auto-resolved provider, then distills the content for LLMs.
   */
  public async scrapeAndDistill(
    url: string,
    options: {
      providerOverride?: ScraperProviderType;
      maxChars?: number;
      waitFor?: number;
    } = {}
  ): Promise<ScrapedPageEvidence> {
    const startTime = performance.now();
    const providerPref = options.providerOverride || configService.getCrawlerProvider() || 'auto';
    let lastError = '';

    // Strategy 1: Explicit Patchright or Auto
    if (providerPref === 'patchright' || providerPref === 'auto') {
      try {
        const prRes = await patchrightClient.scrape(url, { waitFor: options.waitFor });
        if (prRes.success && (prRes.markdown || prRes.html)) {
          const distilled = contentDistiller.distill(prRes.html || '', prRes.markdown || '', {
            maxChars: options.maxChars,
          });

          return {
            success: true,
            providerUsed: 'patchright',
            url,
            statusCode: prRes.statusCode || 200,
            title: prRes.title || distilled.title,
            description: prRes.description || distilled.description,
            markdown: prRes.markdown || '',
            rawHtml: prRes.html,
            distilled,
            formattedEvidence: this.buildEvidenceBlock('Patchright Stealth Runner', url, distilled),
            latencyMs: Math.round(performance.now() - startTime),
            antiBotBypassed: prRes.antiBotBypassed,
          };
        }
        if (prRes.error) lastError = `Patchright: ${prRes.error}`;
      } catch (err: any) {
        lastError = `Patchright error: ${err.message}`;
      }

      // If user strictly requested Patchright and it failed, don't silently fallback unless in auto mode
      if (providerPref === 'patchright') {
        return this.buildFailureResult(url, 'patchright', lastError, startTime);
      }
    }

    // Strategy 2: Firecrawl (if key configured or requested)
    if (providerPref === 'firecrawl' || (providerPref === 'auto' && configService.getFirecrawlKey())) {
      try {
        const fcRes = await firecrawlService.scrapeUrl(url, ['markdown', 'html']);
        if (fcRes.success && (fcRes.markdown || fcRes.html)) {
          const distilled = contentDistiller.distill(fcRes.html || '', fcRes.markdown || '', {
            maxChars: options.maxChars,
          });

          return {
            success: true,
            providerUsed: 'firecrawl',
            url,
            statusCode: fcRes.metadata?.statusCode || 200,
            title: fcRes.metadata?.title || distilled.title,
            description: fcRes.metadata?.description || distilled.description,
            markdown: fcRes.markdown || '',
            rawHtml: fcRes.html,
            distilled,
            formattedEvidence: this.buildEvidenceBlock('Firecrawl API', url, distilled),
            latencyMs: Math.round(performance.now() - startTime),
          };
        }
        if (fcRes.error) lastError = `Firecrawl: ${fcRes.error}`;
      } catch (err: any) {
        lastError = `Firecrawl error: ${err.message}`;
      }

      if (providerPref === 'firecrawl') {
        return this.buildFailureResult(url, 'firecrawl', lastError, startTime);
      }
    }

    // Strategy 3: Jina Reader / Direct Zero-Key Fallback (e.g. https://r.jina.ai/{url})
    if (providerPref === 'jina' || providerPref === 'auto') {
      try {
        const jinaUrl = `https://r.jina.ai/${url.replace(/^https?:\/\//i, 'https://')}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);

        const jinaRes = await fetch(jinaUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/markdown, text/plain',
            'X-Return-Format': 'markdown',
          },
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (jinaRes.ok) {
          const mdText = await jinaRes.text();
          if (mdText && mdText.trim().length > 100) {
            const distilled = contentDistiller.distill('', mdText, { maxChars: options.maxChars });

            return {
              success: true,
              providerUsed: 'jina',
              url,
              statusCode: jinaRes.status,
              title: distilled.title || url,
              description: distilled.description,
              markdown: mdText,
              distilled,
              formattedEvidence: this.buildEvidenceBlock('Jina Reader (Zero-Key Fallback)', url, distilled),
              latencyMs: Math.round(performance.now() - startTime),
            };
          }
        }
        lastError = `Jina Reader HTTP ${jinaRes.status}`;
      } catch (err: any) {
        lastError = `Jina fallback error: ${err.message}`;
      }
    }

    return this.buildFailureResult(url, 'auto', lastError || 'All scraping strategies exhausted', startTime);
  }

  private buildEvidenceBlock(providerName: string, url: string, distilled: DistilledContentResult): string {
    return `
[REAL SITE SCRAPE EVIDENCE - VIA ${providerName.toUpperCase()}]
Target URL: ${url}
${distilled.formattedEvidence}--------------------------------------------------
`.trim();
  }

  private buildFailureResult(
    url: string,
    provider: any,
    error: string,
    startTime: number
  ): ScrapedPageEvidence {
    return {
      success: false,
      providerUsed: provider,
      url,
      title: '',
      description: '',
      markdown: '',
      distilled: {
        title: '',
        description: '',
        openGraph: {},
        schemas: [],
        schemaTypes: [],
        headings: [],
        distilledText: '',
        formattedEvidence: '',
        stats: { rawChars: 0, distilledChars: 0, compressionRatio: 0 },
      },
      formattedEvidence: '',
      latencyMs: Math.round(performance.now() - startTime),
      error,
    };
  }
}

export const unifiedScraperService = UnifiedScraperService.getInstance();
