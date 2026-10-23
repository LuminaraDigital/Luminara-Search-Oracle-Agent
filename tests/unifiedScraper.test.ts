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
    unifiedScraperService.resetFirecrawlSkipNotice();
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

  it('reads rawHtml from a Firecrawl scrape response', async () => {
    vi.spyOn(configService, 'getFirecrawlKey').mockReturnValue('fc-test-key');
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { formats?: string[] };
      expect(body.formats).toContain('rawHtml');
      return new Response(JSON.stringify({
        success: true,
        data: {
          markdown: '# Hi',
          html: '<main><p>Hi</p></main>',
          rawHtml: '<script type="application/ld+json">{"@type":"ProfessionalService","name":"Luminara Digital"}</script>',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const result = await firecrawlService.scrapeUrl('https://luminara.digital', ['markdown', 'html', 'rawHtml']);
    expect(result.success).toBe(true);
    expect(result.rawHtml).toContain('ProfessionalService');
  });

  it('reads JSON-LD from Firecrawl rawHtml when main-content HTML has no script', async () => {
    vi.spyOn(configService, 'getCrawlerProvider').mockReturnValue('auto');
    vi.spyOn(configService, 'isLocalSidecarAllowed').mockReturnValue(false);
    vi.spyOn(configService, 'getFirecrawlKey').mockReturnValue('fc-test-key');
    const graph = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'Luminara Suite' },
        { '@type': 'WebSite', name: 'Luminara Suite' },
      ],
    });
    const scrape = vi.spyOn(firecrawlService, 'scrapeUrl').mockResolvedValueOnce({
      success: true,
      markdown: '# Luminara Suite\nMain content from Firecrawl.',
      html: '<main><h1>Luminara Suite</h1><p>Main content from Firecrawl.</p></main>',
      rawHtml: `<html><head><script id="ld" type="application/ld+json">${graph}</script></head><body></body></html>`,
      metadata: { title: 'Luminara Suite', statusCode: 200 },
    });

    const result = await unifiedScraperService.scrapeAndDistill('https://www.luminarasuite.com');

    expect(scrape).toHaveBeenCalledWith('https://www.luminarasuite.com', ['markdown', 'html', 'rawHtml']);
    expect(result.providerUsed).toBe('firecrawl');
    expect(result.distilled.schemaTypes).toEqual(expect.arrayContaining(['Organization', 'WebSite']));
    expect(result.distilled.formattedEvidence).toContain('Detected schemas:');
    expect(result.distilled.formattedEvidence).not.toContain('None detected');
    expect(result.distilled.distilledText).toContain('Main content from Firecrawl');
  });

  it('fails over to Firecrawl when Patchright encounters an error in auto mode', async () => {
    vi.spyOn(configService, 'getCrawlerProvider').mockReturnValue('auto');
    vi.spyOn(configService, 'isLocalSidecarAllowed').mockReturnValue(true);
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
    vi.spyOn(configService, 'isLocalSidecarAllowed').mockReturnValue(true);
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

  it('records the Firecrawl skip reason once when the key is empty and Jina is used', async () => {
    vi.spyOn(configService, 'getCrawlerProvider').mockReturnValue('auto');
    vi.spyOn(configService, 'isLocalSidecarAllowed').mockReturnValue(false);
    vi.spyOn(configService, 'getFirecrawlKey').mockReturnValue('');
    const page = `${'# Example\n'}${'visible page text '.repeat(12)}`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(page, { status: 200 })));

    const first = await unifiedScraperService.scrapeAndDistill('https://example.com');
    const second = await unifiedScraperService.scrapeAndDistill('https://example.com/about');

    expect(first.success).toBe(true);
    expect(first.providerUsed).toBe('jina');
    expect(first.fallbackNote).toBe('Page fetch did not run (status not ready)');
    expect(second.success).toBe(true);
    expect(second.fallbackNote).toBeUndefined();
  });
});
