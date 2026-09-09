import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unifiedScraperService } from '../services/scraping/unifiedScraper';
import { patchrightClient } from '../services/scraping/patchrightClient';
import { firecrawlService } from '../services/scraping/firecrawlService';
import { configService } from '../services/configService';

describe('UnifiedScraperService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses Patchright when available and successful', async () => {
    vi.spyOn(patchrightClient, 'scrape').mockResolvedValueOnce({
      success: true,
      url: 'https://example.com',
      statusCode: 200,
      title: 'Example Domain',
      description: 'Example website description',
      html: `
        <html>
          <head>
            <title>Example Domain</title>
            <script type="application/ld+json">{"@type": "WebSite", "name": "Example"}</script>
          </head>
          <body>
            <h1>Welcome to Example</h1>
            <p>This is a real site scrape.</p>
          </body>
        </html>
      `,
      markdown: '# Welcome to Example\nThis is a real site scrape.',
      antiBotBypassed: true,
    });

    const result = await unifiedScraperService.scrapeAndDistill('https://example.com', {
      providerOverride: 'patchright',
    });

    expect(result.success).toBe(true);
    expect(result.providerUsed).toBe('patchright');
    expect(result.title).toBe('Example Domain');
    expect(result.distilled.schemaTypes).toContain('WebSite');
    expect(result.distilled.headings[0].text).toBe('Welcome to Example');
    expect(result.formattedEvidence).toContain('[REAL SITE SCRAPE EVIDENCE - VIA PATCHRIGHT STEALTH RUNNER]');
  });

  it('fails over to Firecrawl when Patchright encounters an error in auto mode', async () => {
    vi.spyOn(configService, 'getCrawlerProvider').mockReturnValue('auto');
    vi.spyOn(configService, 'getFirecrawlKey').mockReturnValue('fc-test-key');

    // Patchright fails (e.g. runner offline or blocked)
    vi.spyOn(patchrightClient, 'scrape').mockResolvedValueOnce({
      success: false,
      url: 'https://protected-site.com',
      error: 'Connection refused',
    });

    // Firecrawl succeeds
    vi.spyOn(firecrawlService, 'scrapeUrl').mockResolvedValueOnce({
      success: true,
      markdown: '# Protected Site Content\nRecovered via Firecrawl fallback.',
      metadata: {
        title: 'Protected Site',
        description: 'Bypassed via Firecrawl',
        statusCode: 200,
      },
    });

    const result = await unifiedScraperService.scrapeAndDistill('https://protected-site.com');

    expect(result.success).toBe(true);
    expect(result.providerUsed).toBe('firecrawl');
    expect(result.title).toBe('Protected Site');
    expect(result.formattedEvidence).toContain('[REAL SITE SCRAPE EVIDENCE - VIA FIRECRAWL API]');
  });
});
