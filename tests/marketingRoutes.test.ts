import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AppView } from '../types';
import {
  marketingViewFromHash,
  marketingViewFromPathname,
  auditReceiptIdFromLocation,
  pathForMarketingView,
  receiptIdFromLocation,
  resolveAppView,
  urlForView,
} from '../utils/marketingRoutes';
import { DASHBOARD_TAB_TITLE, MARKETING_SHELL_BY_PATH, instantAuditTabTitle, marketingShellKey } from '../services/marketing/pageMeta';
import { resolveCanonicalHref, resolveDocumentTitle, resolveRobotsDirective } from '../services/marketing/documentMeta';
import { injectMarketingMeta } from '../worker/marketingShell';
import { CHECKOUT_TERM_LINE, listPriceSummary } from '../components/paywall/planCopy';
import { PAID_PLAN_PRICES } from '../components/paywall/planPrices';
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
    expect(resolveAppView('/verify/audit', '')).toBe(AppView.VERIFY_AUDIT_RECEIPT);
    expect(resolveAppView('/verify/audit/sar_abc', '')).toBe(AppView.VERIFY_AUDIT_RECEIPT);
    expect(auditReceiptIdFromLocation('/verify/audit/sar_abc', '')).toBe('sar_abc');
    expect(auditReceiptIdFromLocation('/verify/audit', '')).toBe('');
    expect(resolveAppView(`/verify/${digest}`, '')).toBe(AppView.VERIFY_ATTESTATION);
    expect(resolveAppView('/', `#verify/${digest}`)).toBe(AppView.VERIFY_ATTESTATION);
    expect(receiptIdFromLocation(`/verify/r/${id}`, '')).toBe(id);
    expect(receiptIdFromLocation('/', `#verify/r/${id}`)).toBe(id);
    expect(receiptIdFromLocation(`/verify/${digest}`, '')).toBe('');
    expect(receiptIdFromLocation('/verify/r/%E0%A4%A', '')).toBe('');
  });
});

describe('tab titles', () => {
  it('uses Topic | Luminara Suite, unique, under 60 characters', () => {
    expect(resolveDocumentTitle('/compare/profound', AppView.WHY_US)).toBe('Luminara vs Profound | Luminara Suite');
    expect(resolveDocumentTitle('/compare/ahrefs', AppView.WHY_US)).toBe('Luminara vs Ahrefs | Luminara Suite');
    expect(resolveDocumentTitle('/compare/otterly', AppView.WHY_US)).toBe('Luminara vs Otterly | Luminara Suite');
    expect(resolveDocumentTitle('/compare/peec', AppView.WHY_US)).toBe('Luminara vs Peec | Luminara Suite');
    expect(resolveDocumentTitle('/why', AppView.WHY_US)).toBe('Why Luminara | Luminara Suite');
    expect(resolveDocumentTitle('/dashboard', AppView.DASHBOARD)).toBe('Dashboard | Luminara Suite');
    expect(resolveDocumentTitle('/', AppView.DASHBOARD)).toBe('Dashboard | Luminara Suite');
    expect(resolveDocumentTitle('/labs', AppView.ECOSYSTEM_HUB)).toBe('Labs | Luminara Suite');
    expect(resolveDocumentTitle('/audit/example.com', AppView.INSTANT_AUDIT)).toBe('Instant Audit: example.com | Luminara Suite');
    expect(resolveDocumentTitle('/audit/https://shop.example/pricing', AppView.INSTANT_AUDIT)).toBe('Instant Audit: shop.example | Luminara Suite');
    const exact = instantAuditTabTitle('a'.repeat(28));
    expect(exact).toBe(`Instant Audit: ${'a'.repeat(28)} | Luminara Suite`);
    expect(exact.length).toBe(60);
    const shortened = `Instant Audit: ${'a'.repeat(25)}... | Luminara Suite`;
    expect(instantAuditTabTitle('a'.repeat(80))).toBe(shortened);
    expect(resolveDocumentTitle(`/audit/${'a'.repeat(80)}`, AppView.INSTANT_AUDIT)).toBe(shortened);

    const titles = [
      ...Object.values(MARKETING_SHELL_BY_PATH).map((page) => page.title),
      DASHBOARD_TAB_TITLE,
      instantAuditTabTitle('example.com'),
      instantAuditTabTitle(undefined),
      'Windows app | Luminara Suite',
      'MCP server | Luminara Suite',
    ];
    for (const title of titles) {
      expect(title.length, title).toBeLessThanOrEqual(60);
      expect(title.endsWith(' | Luminara Suite'), title).toBe(true);
    }
    expect(new Set(titles).size).toBe(titles.length);
    expect(readFileSync('public/desktop/index.html', 'utf8')).toContain('<title>Windows app | Luminara Suite</title>');
    expect(readFileSync('public/docs/mcp.html', 'utf8')).toContain('<title>MCP server | Luminara Suite</title>');
    const shell = readFileSync('index.html', 'utf8');
    expect(shell).not.toContain('var known');
    expect(shell).toContain('html.lx-skip-splash #boot-splash { display: none; }');
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
    expect(LLMS_TXT).toContain(PAID_PLAN_PRICES.starter.starsLabel);
    expect(LLMS_TXT).toContain(PAID_PLAN_PRICES.growth.starsLabel);
    expect(LLMS_TXT).toContain(PAID_PLAN_PRICES.agency.starsLabel);
    expect(LLMS_TXT).toContain(CHECKOUT_TERM_LINE);
    expect(LLMS_TXT).toContain('not_measured');
    expect(LLMS_TXT).toContain('/docs/what-is-aeo.html#honesty');
    expect(LLMS_TXT).toContain('https://www.luminarasuite.com/sitemap.xml');
    expect(LLMS_TXT).toContain('/share/teaser/');
    expect(LLMS_TXT).not.toContain('\u2014');
  });

  it('serves the shared USD list prices and Stars checkout in llms.txt', () => {
    const usdCheckoutPrice = /\/mo\b|per month/i;
    expect(LLMS_TXT).toContain(listPriceSummary());
    expect(LLMS_TXT).toContain('Pro / Agency: list price A$541 (US$349)');
    expect(LLMS_TXT).toContain('10 client workspaces');
    expect(LLMS_TXT).not.toContain('saved in this browser');
    expect(LLMS_TXT).not.toMatch(/team seats/i);
    expect(LLMS_TXT).not.toMatch(usdCheckoutPrice);
    expect(LLMS_TXT).not.toContain('luminaradigital.io');
    expect(LLMS_TXT).toContain('https://luminara.digital/');
    expect(LLMS_TXT).toContain('https://luminara.digital/services/');
    expect(readFileSync('public/llms.txt', 'utf8')).toBe(LLMS_TXT);
    for (const path of ['/compare/profound', '/compare/ahrefs', '/compare/otterly', '/compare/peec']) {
      const body = MARKETING_SHELL_BY_PATH[path].crawlerBody;
      expect(body, path).not.toMatch(/US\$\s?\d|\$\s?\d|\/mo\b|per month/i);
    }
    const profound = MARKETING_SHELL_BY_PATH['/compare/profound'].crawlerBody;
    expect(profound).toContain('2,500 / 7,500 / 18,000');
    expect(profound).toContain('30-day Telegram Stars plans');
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
    expect(marketingShellKey('/labs')).toBe('/labs');
    expect(marketingShellKey('/lab')).toBe('/labs');
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

describe('pricing schema and route canonicals', () => {
  it('does not publish a USD offer that the page does not sell', () => {
    for (const path of ['/', '/pricing', '/labs'] as const) {
      const graph = MARKETING_SHELL_BY_PATH[path].jsonLd['@graph'] as Array<Record<string, unknown>>;
      const software = graph.find((node) => node['@type'] === 'SoftwareApplication');
      expect(software?.offers, path).toBeUndefined();
      expect(JSON.stringify(MARKETING_SHELL_BY_PATH[path].jsonLd), path).not.toMatch(/"price"|"lowPrice"|"highPrice"|"priceCurrency"/);
    }
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/"price"\s*:/);
  });

  it('gives /labs a self canonical and noindexes per-domain audits', () => {
    expect(resolveCanonicalHref('/labs', AppView.ECOSYSTEM_HUB)).toBe('https://www.luminarasuite.com/labs');
    expect(resolveRobotsDirective('/labs', AppView.ECOSYSTEM_HUB)).toBeNull();
    expect(resolveCanonicalHref('/audit/example.com', AppView.INSTANT_AUDIT)).toBe('https://www.luminarasuite.com/audit/example.com');
    expect(resolveRobotsDirective('/audit/example.com', AppView.INSTANT_AUDIT)).toBe('noindex, nofollow');
    expect(resolveCanonicalHref('/geo/example.com', AppView.INSTANT_AUDIT)).toBe('https://www.luminarasuite.com/geo/example.com');
    expect(resolveRobotsDirective('/geo/example.com', AppView.INSTANT_AUDIT)).toBe('noindex, nofollow');
    expect(resolveCanonicalHref('/pricing', AppView.PRICING)).toBe('https://www.luminarasuite.com/pricing');
    expect(resolveCanonicalHref('/', AppView.LANDING)).toBe('https://www.luminarasuite.com/');
    expect(resolveRobotsDirective('/', AppView.LANDING)).toBeNull();
    expect(resolveRobotsDirective('/dashboard', AppView.DASHBOARD)).toBeNull();
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


