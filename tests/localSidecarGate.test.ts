import { afterEach, describe, expect, it, vi } from 'vitest';
import { serpRadarAgent } from '../services/agentCore/agents/serpRadarAgent';
import { scoutAgent } from '../services/agentCore/agents/scoutAgent';
import { empiricalCitationService } from '../services/audit/empiricalCitationService';
import { configService } from '../services/configService';
import { resetHostedAuthCircuit } from '../services/resilience/hostedAuthCircuit';
import { patchrightClient } from '../services/scraping/patchrightClient';
import { siteEvidencePackService } from '../services/scraping/siteEvidencePack';
import { unifiedScraperService } from '../services/scraping/unifiedScraper';
import { localSerpService } from '../services/search/localSerpService';

const LOOPBACK = /localhost|127\.0\.0\.1|\[::1\]/i;

function memoryStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: (key: string) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const key of Object.keys(store)) delete store[key]; },
  };
}

function installBrowser(opts: {
  hostname: string;
  search?: string;
  desktop?: boolean;
  storage?: Record<string, string>;
}) {
  const protocol = opts.hostname === 'localhost' || opts.hostname === '127.0.0.1' ? 'http:' : 'https:';
  const origin = `${protocol}//${opts.hostname}`;
  vi.stubGlobal('localStorage', memoryStorage(opts.storage));
  vi.stubGlobal('window', {
    location: {
      hostname: opts.hostname,
      host: opts.hostname,
      origin,
      protocol,
      href: `${origin}/`,
      search: opts.search ?? '',
    },
    luminaraDesktop: opts.desktop
      ? { getInfo: async () => ({ shellVersion: '1.0.0', webappUrl: origin, platform: 'linux', packaged: true }) }
      : undefined,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

function fetchUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

function loopbackUrls(urls: string[]): string[] {
  return urls.filter((url) => LOOPBACK.test(url));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetHostedAuthCircuit();
});

describe('hosted web does not call localhost sidecars', () => {
  it('treats an empty luminarasuite.com session as not configured, even with a stale enabled flag', () => {
    installBrowser({
      hostname: 'luminarasuite.com',
      storage: { luminara_local_serp_enabled: 'true' },
    });

    expect(configService.isLocalSidecarAllowed()).toBe(false);
    expect(configService.isLocalSerpEnabled()).toBe(false);
    expect(configService.getPatchrightUrl()).toBe('');
    expect(configService.getLocalSerpUrl()).toBe('');
  });

  it('does not fetch loopback during guest-like SERP and scrape', async () => {
    installBrowser({
      hostname: 'luminarasuite.com',
      storage: { luminara_local_serp_enabled: 'true' },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (LOOPBACK.test(url)) throw new Error(`unexpected loopback fetch: ${url}`);
      return new Response(`${'page text '.repeat(20)}`, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(configService.getTavilyKey()).toBe('');
    expect(configService.isLocalSerpEnabled()).toBe(false);

    await serpRadarAgent.execute('example.com', null, () => {});
    await scoutAgent.execute('https://example.com', () => {});

    expect(loopbackUrls(fetchUrls(fetchMock))).toEqual([]);
  });

  it('does not fetch loopback during signed-in scrape and citation probe', async () => {
    installBrowser({ hostname: 'luminarasuite.com' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (LOOPBACK.test(url)) throw new Error(`unexpected loopback fetch: ${url}`);
      return new Response(JSON.stringify({
        success: true,
        data: {
          markdown: `# Example\n${'signed in page '.repeat(30)}`,
          html: '<h1>Example</h1><p>signed in page</p>',
          metadata: { title: 'Example', description: 'Example', statusCode: 200 },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(configService, 'getFirecrawlKey').mockReturnValue('fc-signed-in');
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('');
    const localScrape = vi.spyOn(patchrightClient, 'scrape');
    const localSearch = vi.spyOn(localSerpService, 'search');

    const pack = await siteEvidencePackService.buildPack('https://example.com', { mode: 'off' });
    await empiricalCitationService.probeDomainCitations('https://example.com', 'Example');

    expect(localScrape).not.toHaveBeenCalled();
    expect(localSearch).not.toHaveBeenCalled();
    expect(loopbackUrls(fetchUrls(fetchMock))).toEqual([]);
    expect(pack.pages[0]?.providerUsed).toBe('firecrawl');
  });

  it('skips the local scraper in auto mode and does not invent localhost for an explicit patchright choice', async () => {
    installBrowser({ hostname: 'luminarasuite.com' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (LOOPBACK.test(url)) throw new Error(`unexpected loopback fetch: ${url}`);
      return new Response('short', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const forced = await unifiedScraperService.scrapeAndDistill('https://example.com', { providerOverride: 'patchright' });
    const serp = await localSerpService.search('hosted query');
    const health = await configService.testPatchright();
    const serpHealth = await configService.testLocalSerp();

    expect(forced.success).toBe(false);
    expect(forced.error || '').toContain('not configured');
    expect(serp.success).toBe(false);
    expect(serp.error).toContain('not configured');
    expect(health.success).toBe(false);
    expect(serpHealth.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const auto = await unifiedScraperService.scrapeAndDistill('https://example.com');
    expect(auto.providerUsed).not.toBe('patchright');
    expect(loopbackUrls(fetchUrls(fetchMock))).toEqual([]);
  });
});

describe('desktop, local dev, and explicit URLs can still call the sidecar', () => {
  it('calls localhost:3001 from a localhost page when no URL is saved', async () => {
    installBrowser({ hostname: 'localhost' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      query: 'widgets',
      results: [],
      markdown: '# Local\nLocal page text that is long enough to keep.',
      html: '<h1>Local</h1>',
      title: 'Local',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    expect(configService.isLocalSidecarAllowed()).toBe(true);
    expect(configService.isLocalSerpEnabled()).toBe(true);
    expect(configService.getPatchrightUrl()).toBe('http://localhost:3001');
    expect(configService.getLocalSerpUrl()).toBe('http://localhost:3001');

    await localSerpService.search('widgets');
    await patchrightClient.scrape('https://example.com');

    const urls = fetchUrls(fetchMock);
    expect(urls.some((url) => url.startsWith('http://localhost:3001/serp'))).toBe(true);
    expect(urls.some((url) => url.startsWith('http://localhost:3001/scrape'))).toBe(true);
  });

  it('treats 127.0.0.1 like local dev', () => {
    installBrowser({ hostname: '127.0.0.1' });
    expect(configService.isPageServedLocally()).toBe(true);
    expect(configService.isLocalSidecarAllowed()).toBe(true);
    expect(configService.getPatchrightUrl()).toBe('http://localhost:3001');
  });

  it('calls localhost:3001 from the desktop app even when the page origin is hosted', async () => {
    installBrowser({ hostname: 'luminarasuite.com', desktop: true });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      results: [],
      markdown: '# Desktop',
      html: '<p>Desktop</p>',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    expect(configService.isLocalSidecarAllowed()).toBe(true);
    expect(configService.getLocalSerpUrl()).toBe('http://localhost:3001');
    await localSerpService.search('desktop query');
    await patchrightClient.scrape('https://example.com');

    const urls = fetchUrls(fetchMock);
    expect(urls.some((url) => url.startsWith('http://localhost:3001/serp'))).toBe(true);
    expect(urls.some((url) => url.startsWith('http://localhost:3001/scrape'))).toBe(true);
  });

  it('uses an explicit sidecar URL on hosted web and does not invent a second localhost hop', async () => {
    installBrowser({
      hostname: 'luminarasuite.com',
      storage: { luminara_patchright_url: 'https://crawler.example.test' },
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      results: [{ rank: 1, title: 'Example', url: 'https://example.com', snippet: 'Example snippet' }],
      markdown: '# Remote sidecar',
      html: '<p>Remote sidecar</p>',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    expect(configService.isLocalSidecarAllowed()).toBe(true);
    expect(configService.isLocalSerpEnabled()).toBe(true);
    expect(configService.getPatchrightUrl()).toBe('https://crawler.example.test');
    expect(configService.getLocalSerpUrl()).toBe('https://crawler.example.test');

    await patchrightClient.scrape('https://example.com');
    await localSerpService.search('explicit');

    const urls = fetchUrls(fetchMock);
    expect(loopbackUrls(urls)).toEqual([]);
    expect(urls.some((url) => url.startsWith('https://crawler.example.test/scrape'))).toBe(true);
    expect(urls.some((url) => url.startsWith('https://crawler.example.test/serp'))).toBe(true);
  });

  it('fetches a localhost URL only after the user saved that URL on hosted web', async () => {
    installBrowser({
      hostname: 'luminarasuite.com',
      storage: { luminara_local_serp_url: 'http://localhost:3001' },
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      results: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    expect(configService.isLocalSerpEnabled()).toBe(true);
    await localSerpService.search('saved localhost');

    expect(fetchUrls(fetchMock)).toEqual(['http://localhost:3001/serp']);
  });

  it('honors an explicit off toggle on localhost without disabling the scraper default', () => {
    installBrowser({
      hostname: 'localhost',
      storage: { luminara_local_serp_enabled: 'false' },
    });
    expect(configService.isLocalSidecarAllowed()).toBe(true);
    expect(configService.isLocalSerpEnabled()).toBe(false);
    expect(configService.getPatchrightUrl()).toBe('http://localhost:3001');
  });
});
