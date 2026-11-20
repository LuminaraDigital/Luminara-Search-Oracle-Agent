import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MARKETING_SHELL_BY_PATH } from '../services/marketing/pageMeta';
import { SITEMAP_XML } from '../worker/crawlDocuments';
import { injectMarketingMeta } from '../worker/marketingShell';
import { TERMS_HTML } from '../worker/termsPolicy';

const SHELL = readFileSync('index.html', 'utf8');
const BOILERPLATE = 'For independent real estate agencies in Australia, Oceania and South-East Asia';

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function metaContent(html: string, kind: 'name' | 'property', key: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!new RegExp(`\\b${kind}=["']${key}["']`, 'i').test(tag)) continue;
    const content = tag.match(/\bcontent=["']([^"']*)["']/i);
    return content ? decodeEntities(content[1]) : null;
  }
  return null;
}

function pageHtml(path: string): string {
  if (path === '/terms') return TERMS_HTML;
  if (path === '/docs/mcp.html' || path === '/docs/what-is-aeo.html') return readFileSync(`public${path}`, 'utf8');
  if (path === '/desktop') return readFileSync('public/desktop/index.html', 'utf8');
  const page = MARKETING_SHELL_BY_PATH[path];
  if (!page) throw new Error(`no marketing shell for ${path}`);
  return injectMarketingMeta(SHELL, page);
}

describe('sitemap meta', () => {
  const urls = [...SITEMAP_XML.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]);

  it('gives every sitemap URL a W3C lastmod', () => {
    expect(urls.length).toBeGreaterThan(0);
    const dates = urls.map((block) => {
      const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
      const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
      expect(loc, block).toBeTruthy();
      expect(lastmod, loc).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      return lastmod;
    });
    expect(new Set(dates).size).toBeGreaterThan(1);
  });

  it('keeps indexable page descriptions unique, in range, and free of dashes', () => {
    const seen = new Map<string, string>();
    for (const block of urls) {
      const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? '';
      const path = new URL(loc).pathname;
      if (path.endsWith('.txt')) continue;
      const html = pageHtml(path);
      const description = metaContent(html, 'name', 'description');
      expect(description, path).toBeTruthy();
      const text = description ?? '';
      expect(text.length, `${path}: ${text}`).toBeGreaterThanOrEqual(120);
      const max = path === '/learn' || path.startsWith('/learn/') ? 155 : 160;
      expect(text.length, `${path}: ${text}`).toBeLessThanOrEqual(max);
      expect(text, path).not.toMatch(/[\u2013\u2014]/);
      expect(text.startsWith(BOILERPLATE), path).toBe(false);
      const prior = seen.get(text);
      expect(prior, `${path} repeats ${prior}`).toBeUndefined();
      seen.set(text, path);
      const og = metaContent(html, 'property', 'og:description');
      const twitter = metaContent(html, 'name', 'twitter:description');
      if (og) expect(og, path).toBe(text);
      if (twitter) expect(twitter, path).toBe(text);
    }
    expect(seen.size).toBeGreaterThan(20);
    const learnPaths = [...seen.values()].filter((path) => path === '/learn' || path.startsWith('/learn/'));
    expect(learnPaths).toHaveLength(10);
  });
});
