/**
 * Sitewide evidence pack builder for Instant Audit / DNA / Notebook.
 *
 * Modes:
 * - off: homepage only
 * - smart (default): discover via Firecrawl /map or homepage links, then selective scrape
 * - deep: Firecrawl /crawl (BYOK or paid hosted plan)
 *
 * Always distills through ContentDistiller with a global token budget so LLM
 * attention does not degrade from raw crawl dumps.
 */

import { configService } from '../configService';
import { contentDistiller } from './contentDistiller';
import { firecrawlService } from './firecrawlService';
import {
  ClassifiedUrl,
  classifyPageType,
  extractInternalLinks,
  PageType,
  prioritizeUrls,
} from './pageTypeClassifier';
import { ScrapedPageEvidence, unifiedScraperService } from './unifiedScraper';

export type SitewideEvidenceMode = 'off' | 'smart' | 'deep';

export interface EvidencePageSlot {
  url: string;
  pageType: PageType;
  title: string;
  providerUsed: string;
  schemaTypes: string[];
  success: boolean;
  distilledChars: number;
  error?: string;
}

export interface SiteEvidencePack {
  success: boolean;
  mode: SitewideEvidenceMode;
  rootUrl: string;
  pages: ScrapedPageEvidence[];
  slots: EvidencePageSlot[];
  /** LLM-ready multi-page evidence block. */
  formattedEvidence: string;
  /** Concatenated distilled text for writing-quality checks. */
  combinedText: string;
  discovery: {
    source: 'firecrawl_map' | 'homepage_links' | 'firecrawl_crawl' | 'homepage_only' | 'none';
    candidateCount: number;
    selectedCount: number;
  };
  latencyMs: number;
  warnings: string[];
  /** True when deep crawl was blocked by paywall (402). */
  upgradeRequired?: boolean;
}

const GLOBAL_BUDGET_CHARS = 14_000;
const PER_PAGE_BUDGET: Record<PageType, number> = {
  home: 4500,
  about: 2200,
  product: 2200,
  pricing: 1800,
  faq: 2000,
  blog: 1500,
  location: 1600,
  contact: 1200,
  legal: 1000,
  other: 1400,
};

export class SiteEvidencePackService {
  private static instance: SiteEvidencePackService;

  private constructor() {}

  public static getInstance(): SiteEvidencePackService {
    if (!SiteEvidencePackService.instance) {
      SiteEvidencePackService.instance = new SiteEvidencePackService();
    }
    return SiteEvidencePackService.instance;
  }

  public async buildPack(
    rootUrl: string,
    options: {
      mode?: SitewideEvidenceMode;
      maxPages?: number;
      focusHint?: string;
    } = {},
  ): Promise<SiteEvidencePack> {
    const start = performance.now();
    const mode = options.mode ?? configService.getSitewideEvidenceMode();
    const maxPages = Math.max(1, Math.min(options.maxPages ?? configService.getSitewideMaxPages(), 12));
    const warnings: string[] = [];
    let upgradeRequired = false;

    // 1) Always scrape the root.
    const home = await unifiedScraperService.scrapeAndDistill(rootUrl, {
      maxChars: PER_PAGE_BUDGET.home,
    });

    if (mode === 'off') {
      return this.finalize({
        rootUrl,
        mode,
        pages: home.success ? [home] : [],
        discovery: {
          source: 'homepage_only',
          candidateCount: 1,
          selectedCount: home.success ? 1 : 0,
        },
        warnings: home.success ? warnings : [home.error || 'Homepage scrape failed'],
        start,
        upgradeRequired,
      });
    }

    // 2) Deep crawl path (Firecrawl /crawl).
    if (mode === 'deep' && configService.getFirecrawlKey()) {
      const crawl = await firecrawlService.crawlSite(rootUrl, {
        limit: maxPages,
        maxDepth: 2,
        timeoutMs: 40_000,
      });

      if (crawl.httpStatus === 402 || crawl.code === 'TIER_UPGRADE_REQUIRED') {
        upgradeRequired = true;
        warnings.push(
          'Hosted Firecrawl deep crawl requires an active Stars/TON/Stripe plan, or a BYOK Firecrawl key. Falling back to smart discovery.',
        );
      } else if (crawl.success && crawl.pages.length > 0) {
        const pages = this.pagesFromCrawl(crawl.pages, rootUrl);
        const prioritized = prioritizeUrls(
          rootUrl,
          pages.map((p) => ({
            url: p.url,
            title: p.title,
            description: p.description,
          })),
          { maxPages },
        );
        const byUrl = new Map(pages.map((p) => [p.url.replace(/\/$/, ''), p]));
        const ordered: ScrapedPageEvidence[] = [];
        for (const slot of prioritized) {
          const hit = byUrl.get(slot.url.replace(/\/$/, ''));
          if (hit) ordered.push(hit);
        }
        if (!ordered.length) ordered.push(...pages.slice(0, maxPages));

        return this.finalize({
          rootUrl,
          mode,
          pages: ordered,
          discovery: {
            source: 'firecrawl_crawl',
            candidateCount: crawl.pages.length,
            selectedCount: ordered.length,
          },
          warnings,
          start,
          upgradeRequired,
        });
      } else if (crawl.error) {
        warnings.push(`Deep crawl unavailable: ${crawl.error}. Falling back to smart discovery.`);
      }
    } else if (mode === 'deep' && !configService.getFirecrawlKey()) {
      warnings.push('Deep crawl needs a Firecrawl key. Falling back to smart discovery.');
    }

    // 3) Smart discovery: Firecrawl map and/or homepage links.
    let candidates: Array<{ url: string; title?: string; description?: string }> = [];
    let discoverySource: SiteEvidencePack['discovery']['source'] = 'homepage_links';

    if (configService.getFirecrawlKey()) {
      try {
        const mapped = await firecrawlService.mapUrl(rootUrl, {
          limit: Math.max(40, maxPages * 8),
          search: options.focusHint,
        });
        if (mapped.success && mapped.links.length) {
          candidates = mapped.links;
          discoverySource = 'firecrawl_map';
        } else if (mapped.error) {
          warnings.push(`Firecrawl map skipped: ${mapped.error}`);
        }
      } catch (e: unknown) {
        warnings.push(`Firecrawl map error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (!candidates.length && home.success && home.rawHtml) {
      candidates = extractInternalLinks(home.rawHtml, rootUrl).map((url) => ({ url }));
      discoverySource = 'homepage_links';
    }

    const selected = prioritizeUrls(rootUrl, candidates, { maxPages });
    const pages: ScrapedPageEvidence[] = [];
    if (home.success) pages.push(home);

    const toFetch = selected.filter((s) => {
      const homeNorm = (home.url || rootUrl).replace(/\/$/, '');
      return s.url.replace(/\/$/, '') !== homeNorm;
    });

    // Parallel selective scrapes with modest concurrency.
    const scraped = await mapPool(toFetch, 3, async (slot: ClassifiedUrl) => {
      const maxChars = PER_PAGE_BUDGET[slot.pageType] ?? 1400;
      return unifiedScraperService.scrapeAndDistill(slot.url, { maxChars });
    });

    for (const res of scraped) {
      if (res.success) pages.push(res);
      else if (res.error) warnings.push(`${res.url}: ${res.error}`);
    }

    if (!pages.length) {
      return this.finalize({
        rootUrl,
        mode: 'smart',
        pages: [],
        discovery: {
          source: candidates.length ? discoverySource : 'none',
          candidateCount: candidates.length + 1,
          selectedCount: 0,
        },
        warnings: [...warnings, 'No pages scraped successfully'],
        start,
        upgradeRequired,
      });
    }

    return this.finalize({
      rootUrl,
      mode: mode === 'deep' ? 'smart' : mode,
      pages,
      discovery: {
        source: discoverySource,
        candidateCount: candidates.length + 1,
        selectedCount: pages.length,
      },
      warnings,
      start,
      upgradeRequired,
    });
  }

  private pagesFromCrawl(
    crawlPages: Array<{ markdown?: string; html?: string; metadata?: Record<string, unknown> }>,
    rootUrl: string,
  ): ScrapedPageEvidence[] {
    const out: ScrapedPageEvidence[] = [];
    for (const p of crawlPages) {
      const url =
        (typeof p.metadata?.sourceURL === 'string' && p.metadata.sourceURL) ||
        (typeof p.metadata?.url === 'string' && (p.metadata.url as string)) ||
        rootUrl;
      const pageType = classifyPageType(url);
      const distilled = contentDistiller.distill(p.html || '', p.markdown || '', {
        maxChars: PER_PAGE_BUDGET[pageType] ?? 1400,
      });
      out.push({
        success: Boolean(p.markdown || p.html),
        providerUsed: 'firecrawl',
        url,
        statusCode: typeof p.metadata?.statusCode === 'number' ? p.metadata.statusCode : 200,
        title: (typeof p.metadata?.title === 'string' ? p.metadata.title : '') || distilled.title,
        description:
          (typeof p.metadata?.description === 'string' ? p.metadata.description : '') ||
          distilled.description,
        markdown: p.markdown || '',
        rawHtml: p.html,
        distilled,
        formattedEvidence: '',
        latencyMs: 0,
      });
    }
    return out.filter((p) => p.success);
  }

  private finalize(args: {
    rootUrl: string;
    mode: SitewideEvidenceMode;
    pages: ScrapedPageEvidence[];
    discovery: SiteEvidencePack['discovery'];
    warnings: string[];
    start: number;
    upgradeRequired: boolean;
  }): SiteEvidencePack {
    const { rootUrl, mode, pages, discovery, warnings, start, upgradeRequired } = args;
    const typed = pages.map((p) => {
      const pageType = classifyPageType(p.url, p.title);
      return { page: p, pageType };
    });

    // Re-budget distilled content under a global cap (home keeps largest share).
    let remaining = GLOBAL_BUDGET_CHARS;
    const blocks: string[] = [];
    const slots: EvidencePageSlot[] = [];
    const textParts: string[] = [];

    blocks.push(`[SITEWIDE EVIDENCE PACK]`);
    blocks.push(`Root: ${rootUrl}`);
    blocks.push(`Mode: ${mode}`);
    blocks.push(`Pages: ${typed.length} (discovery=${discovery.source}, candidates=${discovery.candidateCount})`);
    if (upgradeRequired) {
      blocks.push(`Upgrade: deep crawl gated - use Stars/TON/Stripe plan or BYOK Firecrawl key`);
    }
    blocks.push('');

    for (const { page, pageType } of typed) {
      const want = Math.min(PER_PAGE_BUDGET[pageType] ?? 1400, remaining);
      if (want < 400) break;
      const distilled = contentDistiller.distill(page.rawHtml || '', page.markdown || page.distilled.distilledText || '', {
        maxChars: want,
      });
      remaining -= distilled.formattedEvidence.length;

      blocks.push(`--- PAGE (${pageType.toUpperCase()}) ${page.url} via ${page.providerUsed} ---`);
      blocks.push(distilled.formattedEvidence.trim());
      blocks.push('');

      textParts.push(distilled.distilledText);
      slots.push({
        url: page.url,
        pageType,
        title: distilled.title || page.title,
        providerUsed: page.providerUsed,
        schemaTypes: distilled.schemaTypes,
        success: true,
        distilledChars: distilled.stats.distilledChars,
      });
    }

    if (warnings.length) {
      blocks.push(`[WARNINGS]`);
      for (const w of warnings.slice(0, 8)) blocks.push(`- ${w}`);
    }

    const formattedEvidence = blocks.join('\n').trim();
    return {
      success: pages.length > 0,
      mode,
      rootUrl,
      pages,
      slots,
      formattedEvidence,
      combinedText: textParts.join('\n\n'),
      discovery,
      latencyMs: Math.round(performance.now() - start),
      warnings,
      upgradeRequired: upgradeRequired || undefined,
    };
  }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) || 0 }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export const siteEvidencePackService = SiteEvidencePackService.getInstance();
