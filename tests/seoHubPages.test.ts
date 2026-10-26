import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SeoHubPage from '../components/marketing/SeoHubPage';
import { AppView } from '../types';
import { resolveAppView } from '../utils/marketingRoutes';
import { MARKETING_SHELL_BY_PATH, marketingPageForPath } from '../services/marketing/pageMeta';
import { HUB_PAGES, hubPageForPath } from '../services/marketing/seoHubPages';
import { LLMS_TXT, ROBOTS_TXT, SITEMAP_XML } from '../worker/crawlDocuments';

type JsonLdNode = { '@type': string; '@id'?: string; mainEntity?: unknown[]; itemListElement?: unknown[] };

const graphNodes = (path: string) =>
  (MARKETING_SHELL_BY_PATH[path].jsonLd['@graph'] as JsonLdNode[]);

const allCopy = (page: (typeof HUB_PAGES)[number]) => JSON.stringify(page);

describe('SEO hub pages (/compare, /best)', () => {
  it('routes every hub path to the hub view and an unknown slug to Not Found', () => {
    for (const page of HUB_PAGES) {
      expect(resolveAppView(page.path, ''), page.path).toBe(AppView.COMPARE);
      expect(hubPageForPath(`${page.path}/`)).toBe(page);
    }
    expect(resolveAppView('/compare/unknown-tool', '')).toBe(AppView.NOT_FOUND);
    expect(resolveAppView('/best/unknown', '')).toBe(AppView.NOT_FOUND);
    expect(marketingPageForPath('/compare/unknown-tool')).toBeNull();
    // Same case rule as the Worker shell: a mixed-case URL is not a hub page (App renders Not Found).
    expect(hubPageForPath('/Compare/Profound')).toBeNull();
    expect(marketingPageForPath('/Compare/Profound')).toBeNull();
  });

  it('serves a page-scoped FAQPage, and an ItemList on buyer guides', () => {
    for (const page of HUB_PAGES) {
      const nodes = graphNodes(page.path);
      const faq = nodes.find((node) => node['@type'] === 'FAQPage');
      expect(faq?.['@id']).toBe(`https://www.luminarasuite.com${page.path}#faq`);
      expect(faq?.mainEntity).toHaveLength(page.faq.length);
      const list = nodes.find((node) => node['@type'] === 'ItemList');
      if (page.kind === 'best') expect(list?.itemListElement).toHaveLength(page.picks.length);
      else expect(list).toBeUndefined();
    }
  });

  it('keeps the crawler HTML in step with the page data', () => {
    for (const page of HUB_PAGES) {
      const body = MARKETING_SHELL_BY_PATH[page.path].crawlerBody;
      expect(body).toContain(page.verdict);
      for (const item of page.faq) expect(body).toContain(item.question);
      if (page.kind === 'compare') {
        expect(body).toContain(`When to choose ${page.competitor}`);
        for (const row of page.rows) expect(body).toContain(row.them);
      } else {
        expect(body).toContain('How we picked');
        for (const pick of page.picks) expect(body).toContain(pick.bestFor);
      }
    }
  });

  it('lists every hub page in the sitemap and llms.txt and allows /best/', () => {
    for (const page of HUB_PAGES) {
      expect(SITEMAP_XML).toContain(`<loc>https://www.luminarasuite.com${page.path}</loc>`);
      expect(LLMS_TXT).toContain(`https://www.luminarasuite.com${page.path}`);
    }
    expect(ROBOTS_TXT).toContain('Allow: /best/');
  });

  it('keeps the copy honest: short two-sentence verdict, no em dash, no price figures', () => {
    for (const page of HUB_PAGES) {
      const words = page.verdict.split(/\s+/).length;
      expect(words, page.path).toBeLessThanOrEqual(70);
      expect(page.verdict.match(/[.!?](\s|$)/g), page.path).toHaveLength(2);
      expect(allCopy(page)).not.toContain('\u2014');
      expect(allCopy(page), page.path).not.toMatch(/\$\s?\d|\/mo\b|per month/i);
      expect(page.sources.length).toBeGreaterThan(0);
      expect(MARKETING_SHELL_BY_PATH[page.path].title.length, page.path).toBeLessThanOrEqual(60);
    }
  });

  it('renders the verdict, matrix, and choose sections for humans', () => {
    const compare = HUB_PAGES.find((page) => page.kind === 'compare')!;
    const html = renderToStaticMarkup(createElement(SeoHubPage, { page: compare, onTerminal: () => {} }));
    expect(html).toContain('Short answer');
    expect(html).toContain('When to choose Luminara Suite');
    const best = HUB_PAGES.find((page) => page.kind === 'best')!;
    const bestHtml = renderToStaticMarkup(createElement(SeoHubPage, { page: best, onTerminal: () => {} }));
    expect(bestHtml).toContain('Quick picks');
    expect(bestHtml).toContain('How we picked');
  });
});
