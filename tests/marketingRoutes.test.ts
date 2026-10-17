import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AppView } from '../types';
import {
  marketingViewFromHash,
  marketingViewFromPathname,
  pathForMarketingView,
  receiptIdFromLocation,
  resolveAppView,
  urlForView,
} from '../utils/marketingRoutes';
import { marketingShellKey, MARKETING_SHELL_BY_PATH } from '../services/marketing/pageMeta';
import { injectMarketingMeta } from '../worker/marketingShell';
import { LLMS_TXT, ROBOTS_TXT, SITEMAP_XML } from '../worker/crawlDocuments';

describe('marketingRoutes', () => {
  it('maps canonical paths to views', () => {
    expect(marketingViewFromPathname('/')).toBe(AppView.LANDING);
    expect(marketingViewFromPathname('/pricing')).toBe(AppView.PRICING);
    expect(marketingViewFromPathname('/how-it-works')).toBe(AppView.INFRASTRUCTURE);
    expect(marketingViewFromPathname('/ai')).toBe(AppView.INTELLIGENCE);
    expect(marketingViewFromPathname('/why')).toBe(AppView.WHY_US);
  });

  it('accepts aliases', () => {
    expect(marketingViewFromPathname('/how')).toBe(AppView.INFRASTRUCTURE);
    expect(marketingViewFromPathname('/how/')).toBe(AppView.INFRASTRUCTURE);
    expect(marketingViewFromPathname('/infrastructure')).toBe(AppView.INFRASTRUCTURE);
    expect(marketingViewFromPathname('/why-us')).toBe(AppView.WHY_US);
    expect(marketingViewFromPathname('/compare/profound')).toBe(AppView.WHY_US);
    expect(marketingViewFromPathname('/compare/ahrefs')).toBe(AppView.WHY_US);
    expect(marketingViewFromPathname('/compare/otterly')).toBe(AppView.WHY_US);
    expect(marketingViewFromPathname('/compare/peec')).toBe(AppView.WHY_US);
  });

  it('maps legacy hashes', () => {
    expect(marketingViewFromHash('#pricing')).toBe(AppView.PRICING);
    expect(marketingViewFromHash('WHY_US')).toBe(AppView.WHY_US);
  });

  it('emits path URLs for marketing and clears pathname when leaving', () => {
    expect(pathForMarketingView(AppView.PRICING)).toBe('/pricing');
    expect(urlForView(AppView.PRICING)).toBe('/pricing');
    expect(urlForView(AppView.INSTANT_AUDIT)).toBe('#instant_audit');
    expect(urlForView(AppView.INSTANT_AUDIT, { leaveMarketingPath: true })).toBe('/#instant_audit');
  });

  it('resolveAppView prefers product hashes on / before landing pathname', () => {
    expect(resolveAppView('/', '#instant_audit')).toBe(AppView.INSTANT_AUDIT);
    expect(resolveAppView('/', '')).toBe(AppView.LANDING);
    expect(resolveAppView('/pricing', '')).toBe(AppView.PRICING);
    expect(resolveAppView('/', '#pricing')).toBe(AppView.PRICING);
    expect(resolveAppView('/', '#settings')).toBe(null);
    expect(resolveAppView('/random-made-up-page', '')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/smb', '')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/launchpad', '')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/dashboard', '')).toBe(AppView.DASHBOARD);
    expect(resolveAppView('/verify', '')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/trust', '')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/trust-center', '')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/smb-launchpad', '')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/audit', '')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/geo', '')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/seo', '')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/aeo', '')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/', '#launchpad')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/', '#trust_center')).toBe(AppView.TRUST_CENTER);
  });

  it('routes /verify/r/<id> to the receipt view without breaking /verify/<digest>', () => {
    const id = 'rcpt_0123456789abcdef01234567';
    const digest = 'ab'.repeat(32);
    expect(resolveAppView(`/verify/r/${id}`, '')).toBe(AppView.VERIFY_RECEIPT);
    expect(resolveAppView(`/verify/r/${id}/`, '')).toBe(AppView.VERIFY_RECEIPT);
    expect(resolveAppView('/', `#verify/r/${id}`)).toBe(AppView.VERIFY_RECEIPT);
    expect(resolveAppView(`/verify/${digest}`, '')).toBe(AppView.VERIFY_ATTESTATION);
    expect(resolveAppView('/', `#verify/${digest}`)).toBe(AppView.VERIFY_ATTESTATION);
    expect(receiptIdFromLocation(`/verify/r/${id}`, '')).toBe(id);
    expect(receiptIdFromLocation('/', `#verify/r/${id}`)).toBe(id);
    expect(receiptIdFromLocation(`/verify/${digest}`, '')).toBe('');
    expect(receiptIdFromLocation('/verify/r/%E0%A4%A', '')).toBe('');
  });
});

describe('marketing crawl documents', () => {
  it('robots.txt allows marketing and points at sitemap', () => {
    expect(ROBOTS_TXT).toContain('Sitemap: https://www.luminarasuite.com/sitemap.xml');
    expect(ROBOTS_TXT).toContain('Allow: /pricing');
    expect(ROBOTS_TXT).toContain('Allow: /share/');
    expect(ROBOTS_TXT).toContain('Disallow: /api/');
    expect(ROBOTS_TXT).not.toContain('Disallow: /share/');
  });

  it('sitemap lists canonical marketing URLs', () => {
    expect(SITEMAP_XML).toContain('https://www.luminarasuite.com/how-it-works');
    expect(SITEMAP_XML).toContain('https://www.luminarasuite.com/llms.txt');
    expect(SITEMAP_XML).toContain('https://www.luminarasuite.com/docs/what-is-aeo.html');
    expect(SITEMAP_XML).toContain('http://www.sitemaps.org/schemas/sitemap/0.9');
  });

  it('llms.txt lists product, honesty, pricing, MCP, and the Mini App', () => {
    expect(LLMS_TXT).toContain('/docs/mcp.html');
    expect(LLMS_TXT).toContain('https://luminarasuite.com/api/mcp');
    expect(LLMS_TXT).toContain('https://t.me/LuminaraSuiteBot/app');
    expect(LLMS_TXT).toContain('US$49');
    expect(LLMS_TXT).toContain('US$149');
    expect(LLMS_TXT).toContain('US$349');
    expect(LLMS_TXT).toContain('not_measured');
    expect(LLMS_TXT).toContain('/docs/what-is-aeo.html#honesty');
    expect(LLMS_TXT).toContain('https://www.luminarasuite.com/sitemap.xml');
    expect(LLMS_TXT).toContain('/share/teaser/');
    expect(LLMS_TXT).not.toContain('\u2014');
  });

  it('robots.txt names AI crawlers, allows teaser cards, and keeps share URLs fetchable for unfurls', () => {
    expect(ROBOTS_TXT).toContain('User-agent: GPTBot');
    expect(ROBOTS_TXT).toContain('User-agent: ClaudeBot');
    expect(ROBOTS_TXT).toContain('User-agent: PerplexityBot');
    expect(ROBOTS_TXT).toContain('User-agent: Google-Extended');
    expect(ROBOTS_TXT).toContain('Allow: /docs/what-is-aeo.html');
    expect(ROBOTS_TXT).toContain('Allow: /share/teaser/');
    // Share pages are unlisted and served noindex (worker/marketingShell.ts); robots must not block unfurlers.
    expect(ROBOTS_TXT).not.toContain('Disallow: /share/');
    expect(ROBOTS_TXT).toContain('Disallow: /api/');
  });

  it('public crawl files match the Worker constants', () => {
    expect(readFileSync('public/robots.txt', 'utf8')).toBe(ROBOTS_TXT);
    expect(readFileSync('public/llms.txt', 'utf8')).toBe(LLMS_TXT);
    expect(readFileSync('public/sitemap.xml', 'utf8')).toBe(SITEMAP_XML);
  });
});

describe('marketing shell injection', () => {
  it('rewrites title and injects JSON-LD', () => {
    const shell = `<!DOCTYPE html><html><head>
  <title>Old</title>
  <meta name="description" content="old">
  <meta property="og:title" content="old">
  <meta property="og:description" content="old">
  <meta property="og:url" content="https://www.luminarasuite.com/">
  <meta property="og:image" content="https://www.luminarasuite.com/icon-512.png">
</head><body></body></html>`;
    const page = MARKETING_SHELL_BY_PATH['/pricing'];
    const out = injectMarketingMeta(shell, page);
    expect(out).toContain('<title>Pricing | Luminara Suite</title>');
    expect(out).toContain('rel="canonical" href="https://www.luminarasuite.com/pricing"');
    expect(out).toContain('application/ld+json');
    expect(out).toContain('SoftwareApplication');
    expect(out).toContain('luminara-crawler-body');
    expect(out).toContain('Growth');
    expect(out).toContain('MCP');
    expect(page.description).toMatch(/Growth/i);
    expect(page.crawlerBody).toMatch(/Starter:[\s\S]*No MCP/);
  });

  it('resolves shell keys for aliases and comparisons', () => {
    expect(marketingShellKey('/how')).toBe('/how-it-works');
    expect(marketingShellKey('/how/')).toBe('/how-it-works');
    expect(marketingShellKey('/infrastructure')).toBe('/how-it-works');
    expect(marketingShellKey('/pricing/')).toBe('/pricing');
    expect(marketingShellKey('/compare/profound')).toBe('/compare/profound');
    expect(marketingShellKey('/compare/ahrefs/')).toBe('/compare/ahrefs');
  });

  it('de-duplicates existing JSON-LD script blocks', () => {
    const shellWithStaticJsonLd = `<!DOCTYPE html><html><head>
  <title>Old</title>
  <script type="application/ld+json" id="luminara-marketing-jsonld">{"@context":"https://schema.org","@type":"Old"}</script>
</head><body></body></html>`;
    const page = MARKETING_SHELL_BY_PATH['/'];
    const out = injectMarketingMeta(shellWithStaticJsonLd, page);
    const matches = out.match(/application\/ld\+json/g);
    expect(matches).toHaveLength(1);
    expect(out).toContain('SoftwareApplication');
  });
});

describe('maybeServeReceiptHtml', () => {
  it('serves rich HTML with OG tags and noindex for receipts', async () => {
    const { maybeServeReceiptHtml } = await import('../worker/marketingShell');
    const { createSqliteD1 } = await import('./helpers/sqliteD1');
    const db = createSqliteD1();
    const assets = {
      fetch: async () =>
        new Response(
          '<!DOCTYPE html><html><head><title>Old</title><meta property="og:title" content="Old"></head><body></body></html>',
          {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        ),
    } as unknown as Fetcher;

    await db
      .prepare(
        `INSERT INTO trust_receipts (id, account_id, subject_kind, subject_id, claim, level, payload_json, signature, kid, visibility, created_at)
         VALUES (?, ?, 'domain', ?, 'domain_control', 'worker_verified', ?, 'sig', 'kid_test', 'public', ?)`,
      )
      .bind(
        'rcpt_test_123',
        'acct_1',
        'example.com',
        JSON.stringify({ id: 'rcpt_test_123', subject: { id: 'example.com' } }),
        new Date().toISOString(),
      )
      .run();

    const req = new Request('https://www.luminarasuite.com/verify/r/rcpt_test_123', {
      headers: { accept: 'text/html' },
    });
    const res = await maybeServeReceiptHtml(req, { ASSETS: assets, DB: db });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const html = await res!.text();
    expect(html).toContain('Trust Receipt: example.com | Luminara Suite');
    expect(html).toContain('og:title');
    expect(html).toContain('noindex, nofollow');
  });
});


