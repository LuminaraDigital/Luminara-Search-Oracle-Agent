import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LearnPage from '../components/marketing/LearnPage';
import { MarketingFooter } from '../components/marketing/MarketingFooter';
import { AppView } from '../types';
import { resolveAppView } from '../utils/marketingRoutes';
import { MARKETING_SHELL_BY_PATH, marketingPageForPath } from '../services/marketing/pageMeta';
import { PUBLIC_APP_VIEWS } from '../services/auth/useAppAuth';
import {
  LEARN_ARTICLES,
  LEARN_AUTHOR_NAME,
  LEARN_AUTHOR_ORG,
  LEARN_INDEX,
  LEARN_PATH,
  learnPageForPath,
  learnWordCount,
} from '../services/marketing/learnPages';
import { LLMS_TXT, ROBOTS_TXT, SITEMAP_XML } from '../worker/crawlDocuments';
import { injectMarketingMeta } from '../worker/marketingShell';

type JsonLdNode = {
  '@type': string;
  '@id'?: string;
  name?: string;
  headline?: string;
  datePublished?: string;
  dateModified?: string;
  mainEntity?: unknown[];
  itemListElement?: { position?: number; name?: string }[];
  author?: { '@id'?: string };
};

const graphNodes = (path: string) => MARKETING_SHELL_BY_PATH[path].jsonLd['@graph'] as JsonLdNode[];

describe('knowledge hub (/learn)', () => {
  it('routes the index and every article, and rejects an unknown slug', () => {
    expect(resolveAppView(LEARN_PATH, '')).toBe(AppView.LEARN);
    expect(learnPageForPath(`${LEARN_PATH}/`)).toEqual({ article: null });
    for (const article of LEARN_ARTICLES) {
      expect(resolveAppView(article.path, ''), article.path).toBe(AppView.LEARN);
      expect(learnPageForPath(`${article.path}/`)?.article).toBe(article);
    }
    expect(resolveAppView('/learn/not-a-guide', '')).toBe(AppView.NOT_FOUND);
    expect(learnPageForPath('/learn/not-a-guide')).toBeNull();
    expect(learnPageForPath('/Learn')).toBeNull();
    expect(marketingPageForPath('/learn/not-a-guide')).toBeNull();
    expect(PUBLIC_APP_VIEWS.has(AppView.LEARN)).toBe(true);
  });

  it('publishes Article, Person, BreadcrumbList, and FAQPage only where the FAQ is on the page', () => {
    const indexNodes = graphNodes(LEARN_PATH);
    expect(indexNodes.find((node) => node['@type'] === 'Article')).toBeUndefined();
    expect(indexNodes.find((node) => node['@type'] === 'FAQPage')).toBeUndefined();
    expect(indexNodes.find((node) => node['@type'] === 'ItemList')?.itemListElement).toHaveLength(LEARN_ARTICLES.length);
    expect(indexNodes.find((node) => node['@type'] === 'BreadcrumbList')?.itemListElement).toHaveLength(2);

    for (const article of LEARN_ARTICLES) {
      const nodes = graphNodes(article.path);
      const written = nodes.find((node) => node['@type'] === 'Article');
      const person = nodes.find((node) => node['@type'] === 'Person');
      const crumbs = nodes.find((node) => node['@type'] === 'BreadcrumbList');
      const faq = nodes.find((node) => node['@type'] === 'FAQPage');
      expect(written?.headline, article.path).toBe(article.h1);
      expect(written?.datePublished, article.path).toBe(article.published);
      expect(written?.dateModified, article.path).toBe(article.updated);
      expect(written?.author?.['@id']).toBe(person?.['@id']);
      expect(person?.name).toBe(LEARN_AUTHOR_NAME);
      expect(crumbs?.itemListElement).toHaveLength(3);
      expect(faq?.['@id']).toBe(`https://www.luminarasuite.com${article.path}#faq`);
      expect(faq?.mainEntity).toHaveLength(article.faq.length);
    }
  });

  it('keeps each article in the word range, with dates, author, and no dashes', () => {
    const dated = `Published 15 November 2026`;
    for (const article of LEARN_ARTICLES) {
      const words = learnWordCount(article);
      expect(words, article.path).toBeGreaterThanOrEqual(900);
      expect(words, article.path).toBeLessThanOrEqual(1500);
      expect(article.description.length, article.path).toBeGreaterThanOrEqual(120);
      expect(article.description.length, article.path).toBeLessThanOrEqual(155);
      const copy = JSON.stringify(article);
      expect(copy, article.path).not.toMatch(/[\u2013\u2014]/);
      const body = MARKETING_SHELL_BY_PATH[article.path].crawlerBody;
      expect(body).toContain(dated);
      expect(body).toContain(`Updated ${dated.replace('Published ', '')}`);
      expect(body).toContain(`${LEARN_AUTHOR_NAME}, ${LEARN_AUTHOR_ORG}`);
      for (const item of article.faq) expect(body).toContain(item.question);
      expect(SITEMAP_XML).toContain(`<loc>https://www.luminarasuite.com${article.path}</loc><lastmod>${article.updated}</lastmod>`);
      const html = injectMarketingMeta(readFileSync('index.html', 'utf8'), MARKETING_SHELL_BY_PATH[article.path]);
      expect(html, article.path).toContain(`<link rel="canonical" href="https://www.luminarasuite.com${article.path}">`);
      expect(LLMS_TXT).toContain(`https://www.luminarasuite.com${article.path}`);
    }
    const indexHtml = injectMarketingMeta(readFileSync('index.html', 'utf8'), MARKETING_SHELL_BY_PATH[LEARN_PATH]);
    expect(indexHtml).toContain(`<link rel="canonical" href="https://www.luminarasuite.com${LEARN_PATH}">`);
    expect(SITEMAP_XML).toContain(`<loc>https://www.luminarasuite.com${LEARN_PATH}</loc>`);
    expect(LLMS_TXT).toContain(`https://www.luminarasuite.com${LEARN_PATH}`);
    expect(ROBOTS_TXT).toContain('Allow: /learn/');
    expect(MARKETING_SHELL_BY_PATH[LEARN_PATH].title.endsWith(' | Luminara Suite')).toBe(true);
  });

  it('renders the index, an article, the author, and a related guide on the tools that need one', () => {
    const index = renderToStaticMarkup(createElement(LearnPage, { article: null, onFullAudit: () => {} }));
    expect(index).toContain(LEARN_INDEX.h1);
    expect(index).toContain(LEARN_AUTHOR_NAME);
    expect(index).toContain('LUMINARA DIGITAL PTY LTD');
    expect(index).toContain('ABN 90 693 125 281');
    for (const article of LEARN_ARTICLES) expect(index).toContain(`href="${article.path}"`);

    const article = LEARN_ARTICLES[0];
    const html = renderToStaticMarkup(createElement(LearnPage, { article, onFullAudit: () => {} }));
    expect(html).toContain(`Published 15 November 2026`);
    expect(html).toContain('Updated 15 November 2026');
    expect(html).toContain(`${LEARN_AUTHOR_NAME}, ${LEARN_AUTHOR_ORG}`);
    expect(html).toContain(article.faq[0].question);
    expect(html).toContain('id="learn-domain"');

    const footer = renderToStaticMarkup(createElement(MarketingFooter));
    expect(footer).toContain('href="/learn"');
  });
});
