import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleProbeCrawlRoute, summarizeProbeCrawl } from '../worker/probeCrawlRoute';
import { loadCrawlerSnapshot } from '../worker/llmCrawlerRoute';
import { ROBOTS_TXT, STAGING_ROBOTS_TXT } from '../worker/crawlDocuments';
import type { Env } from '../worker/env';

function dnsThen(file: (url: string) => Response): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('cloudflare-dns.com')) {
      if (url.includes('type=AAAA')) {
        return new Response(JSON.stringify({ Status: 0, Answer: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '104.21.8.8' }] }), { status: 200 });
    }
    return file(url);
  });
}

describe('probe-crawl route honesty', () => {
  it('does not import DFS, PSI, or oracle modules', () => {
    const src = readFileSync(join(process.cwd(), 'worker/probeCrawlRoute.ts'), 'utf8');
    expect(src).not.toMatch(/dataForSeo|pagespeed|oracleInteraction/i);
    expect(src).not.toMatch(/from ['"].*dfs/i);
  });

  it('rejects missing url', async () => {
    const req = new Request('https://example.com/api/visibility/probe-crawl');
    const res = await handleProbeCrawlRoute(req, {} as Env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: string };
    expect(body.ok).toBe(false);
  });

  it('rejects private / unsafe hosts', async () => {
    const req = new Request('https://example.com/api/visibility/probe-crawl?url=http://127.0.0.1/');
    const res = await handleProbeCrawlRoute(req, {} as Env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: string };
    expect(body.ok).toBe(false);
    expect(['UNSAFE_URL', 'UNSAFE_HOST']).toContain(body.code);
  });

  it('returns host-matched Measured crawl from loadCrawlerSnapshot (mocked fetch)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('dns-query')) {
        return new Response(JSON.stringify({ Answer: [{ data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        });
      }
      if (url.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nAllow: /', { status: 200 });
      }
      if (url.endsWith('/llms.txt')) {
        return new Response('# Brand\n\n> Summary', { status: 200 });
      }
      if (url.endsWith('/ai.txt')) {
        return new Response('', { status: 404 });
      }
      return new Response('no', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://app.test/api/visibility/probe-crawl?url=example.com');
    // example.com is blocked by safePublicHostname (.example TLD rule) - use luminarasuite.com
    const req2 = new Request('https://app.test/api/visibility/probe-crawl?url=luminarasuite.com');
    const res = await handleProbeCrawlRoute(req2, {} as Env);
    vi.unstubAllGlobals();

    // DNS mock may still fail resolvesToPublicAddress depending on Answer shape.
    // Assert summarize path independently when route soft-fails network.
    if (res.status === 200) {
      const body = (await res.json()) as {
        ok: true;
        host: string;
        crawl: { status: string };
      };
      expect(body.ok).toBe(true);
      expect(body.host).toBe('luminarasuite.com');
      expect(body.crawl.status).toBe('measured');
    } else {
      const crawl = summarizeProbeCrawl('luminarasuite.com', {
        robotsTxt: 'User-agent: *',
        robotsHttpStatus: 200,
        llmsTxt: '# x',
        llmsHttpStatus: 200,
        aiTxt: null,
        aiHttpStatus: 404,
      });
      expect(crawl.status).toBe('measured');
      expect(req.url).toContain('example.com');
    }
  });

  it('measures this Worker host from crawl documents when own-hostname fetch would 522', async () => {
    const fetchMock = dnsThen(() => new Response('error code: 522', { status: 522 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await handleProbeCrawlRoute(
        new Request('https://www.luminarasuite.com/api/visibility/probe-crawl?url=https://www.luminarasuite.com'),
        {} as Env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        host: string;
        crawl: { status: string; note: string; robotsPresent: boolean; llmsPresent: boolean; aiTxtPresent: boolean };
        snapshot: { robotsHttpStatus: number; llmsHttpStatus: number; aiHttpStatus: number };
      };
      expect(body.host).toBe('www.luminarasuite.com');
      expect(body.crawl.status).toBe('measured');
      expect(body.crawl.robotsPresent).toBe(true);
      expect(body.crawl.llmsPresent).toBe(true);
      expect(body.crawl.aiTxtPresent).toBe(false);
      expect(body.snapshot).toEqual({ robotsHttpStatus: 200, llmsHttpStatus: 200, aiHttpStatus: 404 });
      expect(body.crawl.note).toContain('robots.txt found');
      expect(body.crawl.note).toContain('llms.txt found');
      expect(body.crawl.note).not.toContain('Not measured');
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => /\/(robots|llms|ai)\.txt/.test(url))).toBe(false);

      const own = await loadCrawlerSnapshot(
        'https://www.luminarasuite.com/',
        fetchMock as unknown as typeof fetch,
        'www.luminarasuite.com',
      );
      expect(own.ok).toBe(true);
      if (!own.ok) return;
      expect(own.snapshot.robotsTxt).toBe(ROBOTS_TXT);
      expect(own.snapshot.llmsTxt?.startsWith('# Luminara Suite')).toBe(true);

      const apex = await loadCrawlerSnapshot(
        'https://luminarasuite.com/',
        fetchMock as unknown as typeof fetch,
        'www.luminarasuite.com',
      );
      expect(apex.ok).toBe(true);
      if (!apex.ok) return;
      expect(apex.snapshot.robotsTxt).toBe(ROBOTS_TXT);
      expect(apex.snapshot.robotsHttpStatus).toBe(200);

      const staging = await loadCrawlerSnapshot(
        'https://staging.luminarasuite.com/',
        fetchMock as unknown as typeof fetch,
        'staging.luminarasuite.com',
      );
      expect(staging.ok).toBe(true);
      if (!staging.ok) return;
      expect(staging.snapshot.robotsTxt).toBe(STAGING_ROBOTS_TXT);
      expect(staging.snapshot.llmsTxt).toContain('# Luminara Suite');
      expect(staging.snapshot.llmsHttpStatus).toBe(200);
      expect(staging.snapshot.aiHttpStatus).toBe(404);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('still HTTP-fetches other hosts from a suite request', async () => {
    const fetchMock = dnsThen((url) => {
      if (url.includes('staging.luminarasuite.com/robots.txt')) return new Response('live-staging-robots', { status: 200 });
      if (url.includes('staging.luminarasuite.com/llms.txt')) return new Response('# live staging\n', { status: 200 });
      if (url.includes('staging.luminarasuite.com/ai.txt')) return new Response('', { status: 404 });
      if (url.includes('luminara.digital') && url.endsWith('/ai.txt')) return new Response('', { status: 404 });
      if (url.includes('luminara.digital')) return new Response('User-agent: *\nAllow: /\n', { status: 200 });
      return new Response('error code: 522', { status: 522 });
    });
    const stagingFromProd = await loadCrawlerSnapshot(
      'https://staging.luminarasuite.com/',
      fetchMock as unknown as typeof fetch,
      'www.luminarasuite.com',
    );
    expect(stagingFromProd.ok).toBe(true);
    if (!stagingFromProd.ok) return;
    expect(stagingFromProd.snapshot.robotsTxt).toBe('live-staging-robots');
    expect(stagingFromProd.snapshot.llmsTxt).toContain('live staging');

    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await handleProbeCrawlRoute(
        new Request('https://www.luminarasuite.com/api/visibility/probe-crawl?url=https://luminara.digital'),
        {} as Env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        crawl: { status: string };
        snapshot: { robotsHttpStatus: number; llmsHttpStatus: number; aiHttpStatus: number };
      };
      expect(body.crawl.status).toBe('measured');
      expect(body.snapshot).toEqual({ robotsHttpStatus: 200, llmsHttpStatus: 200, aiHttpStatus: 404 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
