import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unifiedScraperService } from '../services/scraping/unifiedScraper';
import { patchrightClient } from '../services/scraping/patchrightClient';
import { firecrawlService } from '../services/scraping/firecrawlService';
import { configService } from '../services/configService';
import { classifyProviderFailure } from '../services/resilience/failureClassification';
import { resetHostedAuthCircuit } from '../services/resilience/hostedAuthCircuit';

describe('UnifiedScraperService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetHostedAuthCircuit();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetHostedAuthCircuit();
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

  it('stops further Firecrawl calls after the first 401', async () => {
    expect(classifyProviderFailure({
      providerId: 'firecrawl',
      statusCode: 401,
      message: 'unauthorized',
    }).retryable).toBe(false);

    vi.spyOn(configService, 'getFirecrawlKey').mockReturnValue('fc-test-key');
    vi.spyOn(configService, 'getCrawlerProvider').mockReturnValue('auto');
    vi.spyOn(patchrightClient, 'scrape').mockResolvedValue({
      success: false,
      url: 'https://example.com',
      error: 'runner offline',
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await unifiedScraperService.scrapeAndDistill('https://example.com');
    const firecrawlCalls = () => fetchMock.mock.calls.filter((call) => String(call[0]).includes('firecrawl.dev')).length;
    expect(firecrawlCalls()).toBe(1);

    const beforeMap = fetchMock.mock.calls.length;
    const mapped = await firecrawlService.mapUrl('https://example.com');
    expect(mapped.httpStatus).toBe(401);
    expect(mapped.code).toBe('HOSTED_AUTH_CIRCUIT');
    expect(fetchMock.mock.calls.length).toBe(beforeMap);
    expect(firecrawlCalls()).toBeLessThanOrEqual(1);
  });
});
