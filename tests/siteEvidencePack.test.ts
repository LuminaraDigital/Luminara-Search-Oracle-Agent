import { describe, it, expect, vi, beforeEach } from 'vitest';
import { siteEvidencePackService } from '../services/scraping/siteEvidencePack';
import { unifiedScraperService } from '../services/scraping/unifiedScraper';
import { firecrawlService } from '../services/scraping/firecrawlService';
import { configService } from '../services/configService';

function mockPage(url: string, title: string, html: string) {
  return {
    success: true as const,
    providerUsed: 'patchright' as const,
    url,
    statusCode: 200,
    title,
    description: `${title} desc`,
    markdown: `# ${title}`,
    rawHtml: html,
    distilled: {
      title,
      description: `${title} desc`,
      openGraph: {},
      schemas: [],
      schemaTypes: [] as string[],
      headings: [{ level: 1, text: title }],
      distilledText: `${title} body content for audit evidence.`,
      formattedEvidence: `[PAGE TITLE]: ${title}\n[DISTILLED CONTENT CORE]:\n${title} body`,
      stats: { rawChars: 200, distilledChars: 80, compressionRatio: 0.4 },
    },
    formattedEvidence: `[REAL SITE SCRAPE]\n${title}`,
    latencyMs: 12,
  };
}

describe('siteEvidencePackService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(configService, 'getSitewideEvidenceMode').mockReturnValue('smart');
    vi.spyOn(configService, 'getSitewideMaxPages').mockReturnValue(4);
    vi.spyOn(configService, 'getFirecrawlKey').mockReturnValue('');
  });

  it('builds homepage-only pack when mode is off', async () => {
    vi.spyOn(configService, 'getSitewideEvidenceMode').mockReturnValue('off');
    vi.spyOn(unifiedScraperService, 'scrapeAndDistill').mockResolvedValueOnce(
      mockPage('https://example.com', 'Home', '<html><body><h1>Home</h1></body></html>'),
    );

    const pack = await siteEvidencePackService.buildPack('https://example.com', { mode: 'off' });
    expect(pack.success).toBe(true);
    expect(pack.mode).toBe('off');
    expect(pack.pages).toHaveLength(1);
    expect(pack.formattedEvidence).toContain('SITEWIDE EVIDENCE PACK');
    expect(pack.discovery.source).toBe('homepage_only');
  });

  it('expands from homepage links without Firecrawl', async () => {
    const homeHtml = `
      <html><body>
        <h1>Home</h1>
        <a href="/about">About</a>
        <a href="/faq">FAQ</a>
        <a href="/products/widget">Product</a>
      </body></html>
    `;

    vi.spyOn(unifiedScraperService, 'scrapeAndDistill')
      .mockResolvedValueOnce(mockPage('https://example.com', 'Home', homeHtml))
      .mockResolvedValueOnce(mockPage('https://example.com/about', 'About', '<h1>About</h1><p>Team</p>'))
      .mockResolvedValueOnce(mockPage('https://example.com/faq', 'FAQ', '<h1>FAQ</h1><p>Q</p>'))
      .mockResolvedValueOnce(mockPage('https://example.com/products/widget', 'Widget', '<h1>Widget</h1>'));

    const pack = await siteEvidencePackService.buildPack('https://example.com', { mode: 'smart', maxPages: 4 });
    expect(pack.success).toBe(true);
    expect(pack.slots.length).toBeGreaterThan(1);
    expect(pack.discovery.source).toBe('homepage_links');
    expect(pack.formattedEvidence).toContain('PAGE (');
    expect(pack.combinedText.length).toBeGreaterThan(10);
  });

  it('uses Firecrawl map candidates when key is present', async () => {
    vi.spyOn(configService, 'getFirecrawlKey').mockReturnValue('fc-test');
    vi.spyOn(firecrawlService, 'mapUrl').mockResolvedValueOnce({
      success: true,
      links: [
        { url: 'https://example.com/about', title: 'About' },
        { url: 'https://example.com/pricing', title: 'Pricing' },
      ],
    });

    vi.spyOn(unifiedScraperService, 'scrapeAndDistill')
      .mockResolvedValueOnce(mockPage('https://example.com', 'Home', '<h1>Home</h1>'))
      .mockResolvedValueOnce(mockPage('https://example.com/about', 'About', '<h1>About</h1>'))
      .mockResolvedValueOnce(mockPage('https://example.com/pricing', 'Pricing', '<h1>Pricing</h1>'));

    const pack = await siteEvidencePackService.buildPack('https://example.com', { mode: 'smart', maxPages: 3 });
    expect(pack.discovery.source).toBe('firecrawl_map');
    expect(pack.success).toBe(true);
    expect(firecrawlService.mapUrl).toHaveBeenCalled();
  });
});
