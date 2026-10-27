import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPageHead, servedHomepageHead } from '../worker/pageHead';
import { handleProbeCrawlRoute, readHomepage } from '../worker/probeCrawlRoute';
import { loadCrawlerSnapshot } from '../worker/llmCrawlerRoute';
import { resolvesToPublicAddress } from '../worker/security';
import {
  checkHostFromPath,
  checkPathForHost,
  snippetChecks,
  type HomepageHead,
} from '../services/marketing/homepageSnippet';
import { marketingPageForPath } from '../services/marketing/pageMeta';
import { resolveDocumentTitle, resolveRobotsDirective } from '../services/marketing/documentMeta';
import { resolveAppView } from '../utils/marketingRoutes';
import { HomepageSnippetResult } from '../components/marketing/HomepageSnippetResult';
import { AppView } from '../types';
import type { Env } from '../worker/env';

/** DNS answers by host; anything else is served by `page`. Unknown hosts get NXDOMAIN. */
const DNS: Record<string, string> = {
  'agency.com.au': '104.21.8.8',
  'www.agency.com.au': '104.21.8.9',
  'other-site.com': '104.21.8.10',
  'internal-site.com': '10.0.0.5',
  'luminarasuite.com': '104.21.8.11',
};

function fakeNet(page: (url: string) => Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) {
      const name = new URL(url).searchParams.get('name') || '';
      const ip = DNS[name];
      if (url.includes('type=AAAA') || !ip) return Response.json({ Status: ip ? 0 : 3, Answer: [] });
      return Response.json({ Status: 0, Answer: [{ type: 1, data: ip }] });
    }
    return page(url);
  });
}

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

const GOOD_PAGE = `<!doctype html><html><head>
<title>Smith &amp; Co | Hawthorn real estate</title>
<meta content="Sell your Hawthorn home with a local agent." name="description">
<meta property='og:image' content='https://agency.com.au/og.png'>
<link rel="alternate canonical" href="https://agency.com.au/">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"RealEstateAgent"},{"@type":["WebSite","Thing"]}]}</script>
<script type="application/ld+json">{ not json </script>
</head><body><h1>Sell with <em>Smith</em></h1></body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readPageHead', () => {
  it('reads the head fields an owner sees in search', () => {
    expect(readPageHead(GOOD_PAGE)).toEqual({
      title: 'Smith & Co | Hawthorn real estate',
      description: 'Sell your Hawthorn home with a local agent.',
      canonical: 'https://agency.com.au/',
      h1: 'Sell with Smith',
      ogImage: true,
      jsonLdTypes: ['RealEstateAgent', 'WebSite', 'Thing'],
      noindex: false,
    });
  });

  it('reports missing fields as missing, never guessed', () => {
    expect(readPageHead('<html><body>Hello</body></html>')).toEqual({
      title: null,
      description: null,
      canonical: null,
      h1: null,
      ogImage: false,
      jsonLdTypes: [],
      noindex: false,
    });
  });

  it('sees a robots noindex in either meta tag', () => {
    expect(readPageHead('<meta name="robots" content="noindex, follow">').noindex).toBe(true);
    expect(readPageHead('<meta name="googlebot" content="none">').noindex).toBe(true);
    expect(readPageHead('<meta name="robots" content="index, follow">').noindex).toBe(false);
  });
});

describe('readHomepage', () => {
  it('returns head fields only, after a redirect to another public host', async () => {
    const net = fakeNet((url) =>
      url === 'https://agency.com.au/'
        ? new Response(null, { status: 301, headers: { location: 'https://www.agency.com.au/' } })
        : html(GOOD_PAGE),
    );
    const read = await readHomepage('https://agency.com.au/', net as unknown as typeof fetch);
    expect(read.pageReason).toBeNull();
    expect(read.page?.finalUrl).toBe('https://www.agency.com.au/');
    expect(read.page?.title).toBe('Smith & Co | Hawthorn real estate');
    expect(JSON.stringify(read)).not.toContain('<');
    const sent = net.mock.calls.find((call) => String(call[0]) === 'https://agency.com.au/')?.[1] as RequestInit;
    expect(new Headers(sent.headers).get('user-agent')).toMatch(/^LuminaraProbe\/1\.0/);
    expect(sent.redirect).toBe('manual');
    expect(sent.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a redirect to a private address or a non-default port', async () => {
    for (const location of ['https://internal-site.com/', 'https://www.agency.com.au:8443/']) {
      const net = fakeNet((url) =>
        url === 'https://agency.com.au/' ? new Response(null, { status: 302, headers: { location } }) : html(GOOD_PAGE),
      );
      const read = await readHomepage('https://agency.com.au/', net as unknown as typeof fetch);
      expect(read, location).toEqual({ page: null, pageReason: 'unreachable' });
      expect(net.mock.calls.some((call) => String(call[0]).startsWith(location)), location).toBe(false);
    }
  });

  it('gives one coarse reason for each page it cannot read', async () => {
    const cases: Array<[Response, string]> = [
      [new Response('nope', { status: 403 }), 'blocked'],
      [html('<title>Just a moment...</title><div id="cf-challenge"></div>'), 'blocked'],
      [new Response('boom', { status: 500, headers: { 'content-type': 'text/html' } }), 'http_error'],
      [new Response('%PDF-1.7', { status: 200, headers: { 'content-type': 'application/pdf' } }), 'not_html'],
    ];
    for (const [response, reason] of cases) {
      const net = fakeNet(() => response);
      expect(await readHomepage('https://agency.com.au/', net as unknown as typeof fetch)).toEqual({ page: null, pageReason: reason });
    }
    const unknown = fakeNet(() => html(GOOD_PAGE));
    expect(await readHomepage('https://no-such-host.com.au/', unknown as unknown as typeof fetch)).toEqual({
      page: null,
      pageReason: 'unreachable',
    });
  });

  it('reads at most 256 KB, and takes noindex from the X-Robots-Tag header', async () => {
    const late = `<html><head><meta name="description" content="early"></head><body>${'x'.repeat(300_000)}<title>Too late</title></body></html>`;
    const net = fakeNet(() => html(late, { 'x-robots-tag': 'noindex' }));
    const read = await readHomepage('https://agency.com.au/', net as unknown as typeof fetch);
    expect(read.page?.description).toBe('early');
    expect(read.page?.title).toBeNull();
    expect(read.page?.noindex).toBe(true);
  });
});

describe('fetch guard hardening', () => {
  it('gives every DNS lookup a timeout and fails closed when the resolver errors', async () => {
    const signals: unknown[] = [];
    const doh = vi.fn(async (_url: string, init?: RequestInit) => {
      signals.push(init?.signal);
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    expect(await resolvesToPublicAddress('agency.com.au', doh)).toBe(false);
    expect(signals).toHaveLength(2);
    for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a non-default port and does not follow a same-site redirect to one', async () => {
    const net = fakeNet((url) =>
      url === 'https://agency.com.au/robots.txt'
        ? new Response(null, { status: 301, headers: { location: 'https://www.agency.com.au:8080/robots.txt' } })
        : new Response('', { status: 404 }),
    );
    const snapshot = await loadCrawlerSnapshot('https://agency.com.au', net as unknown as typeof fetch);
    expect(snapshot.ok && snapshot.snapshot.robotsHttpStatus).toBe(301);
    expect(snapshot.ok && snapshot.snapshot.robotsTxt).toBeNull();
    expect(net.mock.calls.some((call) => String(call[0]).includes(':8080'))).toBe(false);

    expect(await loadCrawlerSnapshot('agency.com.au:8080', net as unknown as typeof fetch)).toMatchObject({
      ok: false,
      code: 'UNSAFE_URL',
    });
  });
});

describe('probe-crawl route with the homepage read', () => {
  it('returns the head fields beside the crawl files', async () => {
    vi.stubGlobal('fetch', fakeNet((url) => (url.endsWith('/') ? html(GOOD_PAGE) : new Response('', { status: 404 }))));
    const res = await handleProbeCrawlRoute(
      new Request('https://www.luminarasuite.com/api/visibility/probe-crawl?url=agency.com.au'),
      {} as Env,
    );
    const body = (await res.json()) as { page: HomepageHead; pageReason: null; crawl: { llmsPresent: boolean } };
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=120');
    expect(body.pageReason).toBeNull();
    expect(body.page.title).toBe('Smith & Co | Hawthorn real estate');
    expect(body.page.jsonLdTypes).toContain('RealEstateAgent');
    expect(body.crawl.llmsPresent).toBe(false);
  });

  it("reads this Worker's own homepage from what it serves, without fetching it", async () => {
    const net = fakeNet(() => new Response('error code: 522', { status: 522 }));
    vi.stubGlobal('fetch', net);
    const res = await handleProbeCrawlRoute(
      new Request('https://www.luminarasuite.com/api/visibility/probe-crawl?url=luminarasuite.com'),
      {} as Env,
    );
    const body = (await res.json()) as { page: HomepageHead };
    expect(body.page).toEqual(servedHomepageHead('www.luminarasuite.com', 'luminarasuite.com'));
    expect(body.page.title).toContain('Luminara Suite');
    expect(body.page.noindex).toBe(false);
    expect(net.mock.calls.some((call) => /^https:\/\/(www\.)?luminarasuite\.com\/$/.test(String(call[0])))).toBe(false);
    expect(servedHomepageHead('staging.luminarasuite.com', 'staging.luminarasuite.com')?.noindex).toBe(true);
    expect(servedHomepageHead('www.luminarasuite.com', 'agency.com.au')).toBeNull();
  });
});

describe('/check/<host> share links', () => {
  it('opens the landing for a public host and Not Found for anything else', () => {
    expect(checkHostFromPath('/check/Agency.com.au/')).toBe('agency.com.au');
    expect(checkPathForHost('agency.com.au')).toBe('/check/agency.com.au');
    expect(resolveAppView('/check/agency.com.au', '')).toBe(AppView.LANDING);
    for (const bad of ['/check/localhost', '/check/10.0.0.1', '/check/printer.local', '/check/%E0%A4%A', '/check/a/b']) {
      expect(checkHostFromPath(bad), bad).toBeNull();
      expect(resolveAppView(bad, ''), bad).toBe(AppView.NOT_FOUND);
    }
  });

  it('serves a noindex shell that names the host, on the Worker and in the browser', () => {
    const shell = marketingPageForPath('/check/agency.com.au');
    expect(shell?.robots).toBe('noindex, nofollow');
    expect(shell?.title).toBe('Free check: agency.com.au | Luminara Suite');
    expect(shell?.crawlerBody).toContain('agency.com.au');
    expect(resolveRobotsDirective('/check/agency.com.au', AppView.LANDING)).toBe('noindex, nofollow');
    expect(resolveDocumentTitle('/check/agency.com.au', AppView.LANDING)).toBe(shell?.title);
    expect(resolveRobotsDirective('/', AppView.LANDING)).toBeNull();
  });
});

describe('HomepageSnippetResult', () => {
  const page: HomepageHead = {
    status: 200,
    finalUrl: 'https://www.agency.com.au/',
    title: 'Smith & Co | Hawthorn real estate agents',
    description: null,
    canonical: null,
    h1: null,
    ogImage: false,
    jsonLdTypes: [],
    noindex: false,
  };

  it('shows the snippet as read from the page, with a free fix for each gap', () => {
    const html = renderToStaticMarkup(createElement(HomepageSnippetResult, { page, pageReason: null, llmsPresent: false }));
    expect(html).toContain('Read from your homepage');
    expect(html).toContain('Google can rewrite titles and snippets');
    expect(html).toContain('Smith &amp; Co | Hawthorn real estate agents');
    expect(html).toContain('href="/free-tools/serp-preview"');
    expect(html).toContain('href="/free-tools/schema-generator"');
    expect(html).toContain('href="/free-tools/llms-txt-generator"');
    expect(html).not.toMatch(/Google[^.]{0,40}Measured/);
  });

  it('says plainly when the homepage could not be read', () => {
    const html = renderToStaticMarkup(createElement(HomepageSnippetResult, { page: null, pageReason: 'blocked', llmsPresent: true }));
    expect(html).toContain('Your site blocked our check, so the homepage was not read.');
    expect(html).toContain('Not measured');
    expect(html).not.toContain('Read from your homepage');
  });
});

describe('snippetChecks', () => {
  const head: HomepageHead = {
    status: 200,
    finalUrl: 'https://agency.com.au/',
    title: 'Smith & Co | Hawthorn real estate agents',
    description: 'Sell your Hawthorn home with a local agent who knows the street and the buyers.',
    canonical: null,
    h1: null,
    ogImage: false,
    jsonLdTypes: ['RealEstateAgent'],
    noindex: false,
  };

  it('passes a complete head and links each gap to the tool that fixes it', () => {
    expect(snippetChecks(head, true).every((check) => check.state === 'ok')).toBe(true);
    const gaps = snippetChecks({ ...head, title: null, description: null, jsonLdTypes: [], noindex: true }, false);
    expect(gaps[0]).toMatchObject({ id: 'noindex', state: 'warn' });
    expect(Object.fromEntries(gaps.map((check) => [check.id, check.fixPath]))).toEqual({
      noindex: undefined,
      title: '/free-tools/serp-preview',
      description: '/free-tools/serp-preview',
      schema: '/free-tools/schema-generator',
      llms: '/free-tools/llms-txt-generator',
    });
  });
});
