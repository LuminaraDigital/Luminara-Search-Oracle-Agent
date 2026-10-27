import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPageHead, robotsSaysNoindex } from '../worker/pageHead';
import { handleProbeCrawlRoute, readHomepage, summarizeProbeCrawl } from '../worker/probeCrawlRoute';
import { loadCrawlerSnapshot } from '../worker/llmCrawlerRoute';
import { resolvesToPublicAddress } from '../worker/security';
import { injectMarketingMeta } from '../worker/marketingShell';
import {
  checkHostFromPath,
  checkPathForHost,
  snippetChecks,
  type HomepageHead,
} from '../services/marketing/homepageSnippet';
import { marketingPageForPath } from '../services/marketing/pageMeta';
import { resolveDocumentTitle, resolveRobotsDirective } from '../services/marketing/documentMeta';
import { isPathDeepLink, resolveAppView, urlForView } from '../utils/marketingRoutes';
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

const pageUrls = (net: ReturnType<typeof fakeNet>) =>
  net.mock.calls.map((call) => String(call[0])).filter((url) => !url.startsWith('https://cloudflare-dns.com/'));

/** A WordPress-style head: numeric entities, a commented-out noindex, and an SVG title in the body. */
const GOOD_PAGE = `<!doctype html><html><head>
<!-- <meta name="robots" content="noindex"> -->
<title>Smith &amp; Co &#8211; Hawthorn real estate</title>
<meta content="Sell your Hawthorn home with a local agent." name="description">
<meta name="robots" content="index, follow, max-image-preview:none">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"RealEstateAgent"},{"@type":["WebSite","Thing"]}]}</script>
<script type="application/ld+json">{ not json </script>
</head><body><svg><title>Menu</title></svg><h1>Sell with Smith</h1></body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readPageHead', () => {
  it('reads the head fields an owner sees in search', () => {
    expect(readPageHead(GOOD_PAGE)).toEqual({
      title: 'Smith & Co – Hawthorn real estate',
      description: 'Sell your Hawthorn home with a local agent.',
      jsonLdTypes: ['RealEstateAgent', 'WebSite', 'Thing'],
      noindex: false,
    });
  });

  it('reports missing fields as missing, never guessed', () => {
    expect(readPageHead('<html><body>Hello</body></html>')).toEqual({
      title: null,
      description: null,
      jsonLdTypes: [],
      noindex: false,
    });
    // An SVG title outside the head never stands in for the page title.
    expect(readPageHead('<html><head></head><body><svg><title>Menu</title></svg></body></html>').title).toBeNull();
    // Google does not use og:description as the meta description.
    expect(readPageHead('<head><meta property="og:description" content="Social only"></head>').description).toBeNull();
  });

  it('handles real-world markup without false readings', () => {
    expect(readPageHead('<HEAD><TITLE>First</TITLE><TITLE>Second</TITLE><META NAME=description CONTENT=Plain></HEAD>')).toMatchObject({
      title: 'First',
      description: 'Plain',
    });
    expect(readPageHead('<head><meta data-name="description" content="no"><title>&amp;lt;b&amp;gt;</title></head>')).toMatchObject({
      description: null,
      title: '&lt;b&gt;',
    });
    // One decoding pass: a numeric "&" never starts a second entity.
    expect(readPageHead('<title>&#x26;#60;b&#38;amp;</title>').title).toBe('&#60;b&amp;');
    // Empty comments close where HTML closes them, and <body> ends a head with no </head>.
    expect(readPageHead('<!--><title>After empty comment</title>').title).toBe('After empty comment');
    expect(readPageHead('<html><head><meta name="description" content="d"><body><svg><title>Menu</title></svg>')).toMatchObject({
      title: null,
      description: 'd',
    });
    // A description tag too long to match whole is still read, so it is judged too long, not missing.
    const long = readPageHead(`<head><meta name="description" content="${'Long. '.repeat(400)}"></head>`).description;
    expect(long?.length).toBe(300);
  });

  it('finds business types nested inside other entities', () => {
    const nested = '<script type="application/ld+json">{"@type":"WebSite","publisher":{"@type":"RealEstateAgent","address":{"@type":"PostalAddress"}}}</script>';
    expect(readPageHead(nested).jsonLdTypes).toEqual(['WebSite', 'RealEstateAgent', 'PostalAddress']);
  });

  it('matches robots directives as whole tokens, for every crawler or Googlebot', () => {
    expect(robotsSaysNoindex('noindex, follow')).toBe(true);
    expect(robotsSaysNoindex('NONE')).toBe(true);
    expect(robotsSaysNoindex('googlebot: noindex')).toBe(true);
    expect(robotsSaysNoindex('googlebot: nofollow, noindex')).toBe(true);
    expect(robotsSaysNoindex('index, follow, max-image-preview:none')).toBe(false);
    expect(robotsSaysNoindex('otherbot: noindex')).toBe(false);
    expect(robotsSaysNoindex('noindexing-is-not-a-directive')).toBe(false);
    expect(readPageHead('<head><meta name="googlebot" content="noindex"></head>').noindex).toBe(true);
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
    expect(read.page?.title).toBe('Smith & Co – Hawthorn real estate');
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
      expect(pageUrls(net).some((url) => url.startsWith(location)), location).toBe(false);
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

  it('treats a bot wall as blocked, never as the owner noindexing their site', async () => {
    const walls = [
      html('<html><head><meta name="robots" content="noindex,nofollow"></head><body><script src="/_Incapsula_Resource?x"></script></body></html>'),
      html('<html><head><meta name="robots" content="noindex"></head><body>Please wait</body></html>'),
    ];
    for (const wall of walls) {
      const net = fakeNet(() => wall);
      expect(await readHomepage('https://agency.com.au/', net as unknown as typeof fetch)).toEqual({ page: null, pageReason: 'blocked' });
    }
    // A normal page that only loads a bot-protection script is still read.
    const protectedPage = html('<html><head><title>Smith &amp; Co agents</title><script src="https://js.datadome.co/tags.js"></script></head></html>');
    const read = await readHomepage('https://agency.com.au/', fakeNet(() => protectedPage) as unknown as typeof fetch);
    expect(read.page?.title).toBe('Smith & Co agents');
  });

  it('reads at most 256 KB, and takes noindex from an X-Robots-Tag that applies to Google', async () => {
    const late = `<html><head><meta name="description" content="early"></head><body>${'x'.repeat(300_000)}<title>Too late</title></body></html>`;
    const read = await readHomepage('https://agency.com.au/', fakeNet(() => html(late, { 'x-robots-tag': 'noindex' })) as unknown as typeof fetch);
    expect(read.page?.description).toBe('early');
    expect(read.page?.title).toBeNull();
    expect(read.page?.noindex).toBe(true);
    const other = await readHomepage(
      'https://agency.com.au/',
      fakeNet(() => html(GOOD_PAGE, { 'x-robots-tag': 'otherbot: noindex' })) as unknown as typeof fetch,
    );
    expect(other.page?.noindex).toBe(false);
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

  it('fails closed when either DNS lookup fails, even if the other is public', async () => {
    const answer = (type: string, status: number, ok = true) =>
      vi.fn(async (url: string) => {
        if (url.includes(`type=${type}`)) return ok ? Response.json({ Status: status, Answer: [] }) : new Response('', { status: 502 });
        return Response.json({ Status: 0, Answer: [{ type: 28, data: '2606:4700::1' }] });
      });
    expect(await resolvesToPublicAddress('agency.com.au', answer('A', 2))).toBe(false);
    expect(await resolvesToPublicAddress('agency.com.au', answer('A', 0, false))).toBe(false);
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
  const probe = (url: string, env: Partial<Env> = {}) =>
    handleProbeCrawlRoute(
      new Request(`https://www.luminarasuite.com/api/visibility/probe-crawl?url=${encodeURIComponent(url)}`),
      env as Env,
    );

  it('returns the head fields beside the crawl files, with a read time', async () => {
    vi.stubGlobal('fetch', fakeNet((url) => (url.endsWith('/') ? html(GOOD_PAGE) : new Response('', { status: 404 }))));
    const res = await probe('agency.com.au');
    const body = (await res.json()) as { page: HomepageHead; pageReason: null; checkedAt: string };
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=120');
    expect(body.pageReason).toBeNull();
    expect(body.page.title).toBe('Smith & Co – Hawthorn real estate');
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
  });

  it('rejects a port before reading anything', async () => {
    const net = fakeNet(() => html(GOOD_PAGE));
    vi.stubGlobal('fetch', net);
    const res = await probe('agency.com.au:8080');
    expect(res.status).toBe(400);
    expect(net).not.toHaveBeenCalled();
  });

  it('reads every file from the one host it reports, whatever the URL parsers make of the input', async () => {
    const net = fakeNet((url) => (url.endsWith('/') ? html(GOOD_PAGE) : new Response('', { status: 404 })));
    vi.stubGlobal('fetch', net);
    const body = (await (await probe('other-site.com\\@agency.com.au')).json()) as { host: string };
    const hosts = new Set(pageUrls(net).map((url) => new URL(url).hostname));
    expect([...hosts]).toEqual([body.host]);
  });

  it("parses this Worker's own homepage from the page it serves, without fetching it", async () => {
    const net = fakeNet(() => new Response('error code: 522', { status: 522 }));
    vi.stubGlobal('fetch', net);
    const indexHtml = readFileSync('index.html', 'utf8');
    const ASSETS = { fetch: vi.fn(async () => html(indexHtml)) } as unknown as Env['ASSETS'];
    const body = (await (await probe('luminarasuite.com', { ASSETS })).json()) as { page: HomepageHead };
    expect(body.page.finalUrl).toBe('https://www.luminarasuite.com/');
    expect(body.page.title).toBe(marketingPageForPath('/')?.title);
    expect(body.page.description).toBe(marketingPageForPath('/')?.description.slice(0, 300));
    expect(body.page.jsonLdTypes).toContain('Organization');
    expect(body.page.noindex).toBe(false);
    expect(pageUrls(net).some((url) => /^https:\/\/(www\.)?luminarasuite\.com\/$/.test(url))).toBe(false);
  });

  it('caches a good read per host, never a failed one, and serves a hit with settable headers', async () => {
    const store = new Map<string, Response>();
    vi.stubGlobal('caches', {
      default: {
        match: async (req: Request) => {
          const hit = store.get(req.url)?.clone();
          // workerd hands back immutable headers on a cache hit.
          if (hit) Object.defineProperty(hit.headers, 'set', { value: () => { throw new TypeError('immutable'); } });
          return hit;
        },
        put: async (req: Request, res: Response) => void store.set(req.url, res),
      },
    });
    const net = fakeNet((url) => (url.endsWith('/') ? html(GOOD_PAGE) : new Response('', { status: 404 })));
    vi.stubGlobal('fetch', net);
    await probe('agency.com.au');
    const calls = net.mock.calls.length;
    const hit = await probe('https://agency.com.au/some/path');
    expect(net.mock.calls.length).toBe(calls);
    expect(() => hit.headers.set('access-control-allow-origin', 'https://www.luminarasuite.com')).not.toThrow();
    expect(store.size).toBe(1);

    // A site that turned the check away is reused briefly; an unreachable one is never cached.
    vi.stubGlobal('fetch', fakeNet((url) => (url.endsWith('/') ? new Response('down', { status: 503 }) : new Response('', { status: 404 }))));
    const walled = await probe('other-site.com');
    expect(walled.headers.get('cache-control')).toBe('public, max-age=30');
    expect(store.size).toBe(2);
    vi.stubGlobal('fetch', fakeNet((url) => {
      if (url.endsWith('/')) throw new TypeError('connection reset');
      return new Response('', { status: 404 });
    }));
    const unreachable = await probe('www.agency.com.au');
    expect(((await unreachable.json()) as { pageReason: string }).pageReason).toBe('unreachable');
    expect(unreachable.headers.get('cache-control')).toBe('no-store');
    expect(store.size).toBe(2);
  });

  it('reports a trailing-dot host as the same site', async () => {
    vi.stubGlobal('fetch', fakeNet((url) => (url.endsWith('/') ? html(GOOD_PAGE) : new Response('', { status: 404 }))));
    expect(((await (await probe('agency.com.au.')).json()) as { host: string }).host).toBe('agency.com.au');
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

  it('serves a noindex shell built from the validated host, on the Worker and in the browser', () => {
    const shell = marketingPageForPath("/check/$'ZZTEXT%40agency.com.au");
    expect(shell?.path).toBe('/check/agency.com.au');
    expect(shell?.robots).toBe('noindex, nofollow');
    expect(shell?.title).toBe('Free check: agency.com.au | Luminara Suite');
    expect(resolveRobotsDirective('/check/agency.com.au', AppView.LANDING)).toBe('noindex, nofollow');
    expect(resolveDocumentTitle('/check/agency.com.au', AppView.LANDING)).toBe(shell?.title);
  });

  it('does not stick to the next view: the path is cleared and its meta is not reused', () => {
    expect(isPathDeepLink('/check/agency.com.au')).toBe(true);
    expect(urlForView(AppView.INSTANT_AUDIT, { clearPathDeepLink: true })).toBe('/#instant_audit');
    expect(resolveDocumentTitle('/check/agency.com.au', AppView.INSTANT_AUDIT)).not.toContain('Free check');
    expect(resolveRobotsDirective('/check/agency.com.au', AppView.INSTANT_AUDIT)).not.toBe('noindex, nofollow');
  });

  it('never reads "$" in a page value as a replacement pattern', () => {
    const doc = '<html><head><title>x</title><link rel="canonical" href="/"></head><body><div id="root"></div></body></html>';
    const out = injectMarketingMeta(doc, { ...marketingPageForPath('/check/agency.com.au')!, title: "A $' and $& B" });
    expect(out.match(/<\/html>/g)).toHaveLength(1);
    expect(out).toContain("<title>A $' and $&amp; B</title>");
  });
});

describe('HomepageSnippetResult', () => {
  const page: HomepageHead = {
    finalUrl: 'https://www.agency.com.au/',
    title: 'Smith & Co | Hawthorn real estate agents',
    description: null,
    jsonLdTypes: [],
    noindex: false,
  };

  it('labels page facts Measured with a read time, and the Google preview Estimated', () => {
    const html = renderToStaticMarkup(
      createElement(HomepageSnippetResult, { page, pageReason: null, checkedAt: '2026-10-28T03:41:00Z' }),
    );
    expect(html).toMatch(/Measured · read from your homepage at \d/);
    expect(html).toContain('Estimated preview');
    expect(html).toContain('We did not check Google.');
    expect(html).toContain('Smith &amp; Co | Hawthorn real estate agents');
    expect(html).toContain('(No description. Google picks text from the page.)');
    expect(html).toContain('aria-label="Write the fix (free): description"');
    expect(html).toContain('href="/free-tools/schema-generator"');
    expect(html).not.toMatch(/Google[^.]{0,40}Measured/);
  });

  it('says plainly, without alarm, when the homepage could not be read', () => {
    const html = renderToStaticMarkup(createElement(HomepageSnippetResult, { page: null, pageReason: 'blocked' }));
    expect(html).toContain('Not measured.');
    expect(html).toContain('does not tell us whether Google can read it');
    expect(html).not.toContain('read from your homepage');
  });
});

describe('snippetChecks', () => {
  const head: HomepageHead = {
    finalUrl: 'https://agency.com.au/',
    title: 'Smith & Co | Hawthorn real estate agents',
    description: 'Sell your Hawthorn home with a local agent who knows the street and the buyers.',
    jsonLdTypes: ['RealEstateAgent'],
    noindex: false,
  };

  it('passes a complete head and links each gap to the tool that writes the fix', () => {
    const checks = snippetChecks(head);
    expect(checks.every((check) => check.state === 'ok')).toBe(true);
    expect(checks.find((check) => check.id === 'title')?.text).toBe('40 characters. Should fit.');
    const gaps = snippetChecks({ ...head, title: null, description: null, jsonLdTypes: [], noindex: true });
    expect(gaps[0]).toMatchObject({ id: 'noindex', state: 'warn' });
    expect(Object.fromEntries(gaps.map((check) => [check.id, check.fixPath]))).toEqual({
      noindex: undefined,
      title: '/free-tools/serp-preview',
      description: '/free-tools/serp-preview',
      schema: '/free-tools/schema-generator',
    });
    expect(gaps.find((check) => check.id === 'title')?.text).toBe('No title tag in the homepage HTML. Google will write its own.');
  });

  it('flags a short title and a schema with no local business type', () => {
    const checks = snippetChecks({ ...head, title: 'Home', jsonLdTypes: ['WebSite', 'Organization'] });
    expect(checks.find((check) => check.id === 'title')).toMatchObject({ state: 'warn', text: 'Short. Say what you do and where.' });
    expect(checks.find((check) => check.id === 'schema')).toMatchObject({ state: 'warn', fixPath: '/free-tools/schema-generator' });
    // Any LocalBusiness subtype counts.
    expect(snippetChecks({ ...head, jsonLdTypes: ['WebSite', 'LegalService'] }).find((check) => check.id === 'schema')?.state).toBe('ok');
  });

  it('judges the description for the device the preview shows', () => {
    const description = 'An independent agency selling and leasing homes in Hawthorn, Kew and Camberwell, with suburb guides and recent sales.';
    expect(snippetChecks({ ...head, description }, 'desktop').find((check) => check.id === 'description')?.state).toBe('ok');
    expect(snippetChecks({ ...head, description }, 'mobile').find((check) => check.id === 'description')?.state).toBe('fix');
  });
});

describe('honest edges of the free check', () => {
  it('reports a failed crawl-file fetch as Not measured, not missing', () => {
    const crawl = summarizeProbeCrawl('agency.com.au', {
      robotsTxt: null,
      robotsHttpStatus: null,
      llmsTxt: '',
      llmsHttpStatus: 404,
    });
    expect(crawl.status).toBe('not_measured');
    expect(crawl.note).toContain('robots.txt: Not measured');
    expect(crawl.note).toContain('llms.txt missing');
  });
});

describe('security review fixes', () => {
  it('parses a hostile 256 KB page in linear time', () => {
    const size = 256_000;
    const payloads = [
      `<title>${'<'.repeat(size)}</title>`,
      `<meta name="description" content="${'<'.repeat(size)}">`,
      `<head><title>${'x'.repeat(size)}`,
      `<meta ${'a'.repeat(size)}`,
      `<!--${'-'.repeat(size)}`,
      '<!--'.repeat(size / 4),
      '<meta content="'.repeat(size / 16),
      '<title>'.repeat(size / 7),
    ];
    for (const page of payloads) {
      const started = performance.now();
      readPageHead(page);
      // The quadratic version took seconds on these inputs; linear parsing takes a few milliseconds.
      expect(performance.now() - started, page.slice(0, 20)).toBeLessThan(500);
    }
  });
});
