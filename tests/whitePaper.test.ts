import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WhitePaperPage from '../components/marketing/WhitePaperPage';
import { PAID_PLAN_PRICES } from '../components/paywall/planPrices';
import { PUBLIC_APP_VIEWS } from '../services/auth/useAppAuth';
import { MARKETING_SHELL_BY_PATH, marketingShellKey } from '../services/marketing/pageMeta';
import { WHITE_PAPER_PATH, WHITE_PAPER_SECTION_IDS, WHITE_PAPER_SHOTS } from '../services/marketing/whitePaper';
import { uncitedDigitSpans, whitePaperCrawlerHtml } from '../services/marketing/whitePaperPublish';
import { compareSourceIds, WHITE_PAPER_SOURCES } from '../services/marketing/whitePaperSources';
import { AppView } from '../types';
import { resolveAppView } from '../utils/marketingRoutes';
import { LLMS_TXT, SITEMAP_XML } from '../worker/crawlDocuments';
import { marketingDocumentForPath } from '../worker/marketingShell';

const COPY_FILES = [
  'services/marketing/whitePaper.ts',
  'services/marketing/whitePaperSections.ts',
  'services/marketing/whitePaperPublish.ts',
  'services/marketing/whitePaperSources.ts',
  'components/marketing/WhitePaperPage.tsx',
];

describe('white paper', () => {
  it('routes /white-paper and lists it for crawlers', () => {
    expect(resolveAppView('/white-paper', '')).toBe(AppView.WHITE_PAPER);
    expect(resolveAppView('/whitepaper', '')).toBe(AppView.WHITE_PAPER);
    expect(PUBLIC_APP_VIEWS.has(AppView.WHITE_PAPER)).toBe(true);
    expect(marketingShellKey('/whitepaper')).toBe(WHITE_PAPER_PATH);
    expect(MARKETING_SHELL_BY_PATH[WHITE_PAPER_PATH].title).toBe('White paper | Luminara Suite');
    expect(SITEMAP_XML).toContain('https://www.luminarasuite.com/white-paper');
    expect(LLMS_TXT).toContain('https://www.luminarasuite.com/white-paper');
  });

  it('keeps every number inside a cited span', () => {
    expect(uncitedDigitSpans()).toEqual([]);
    expect(compareSourceIds('S19', 'S19b')).toBeLessThan(0);
    expect(compareSourceIds('S19b', 'S20')).toBeLessThan(0);
    expect(WHITE_PAPER_SHOTS['web-product.png'].illustrative).toBe(true);
    expect(WHITE_PAPER_SHOTS['web-product.png'].caption).toContain('Illustrative example, not a measurement');
    for (const [file, shot] of Object.entries(WHITE_PAPER_SHOTS)) {
      if (file !== 'web-product.png') expect(shot.illustrative, file).toBe(false);
    }
  });

  it('does not recommend a token or publish traction and security posture', () => {
    const blob = COPY_FILES.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(blob).not.toMatch(/[\u2013\u2014]/);
    expect(blob.toLowerCase()).not.toContain('firestore');
    expect(blob.toLowerCase()).not.toContain('app check');
    expect(blob.toLowerCase()).not.toContain('deny-all');
    expect(blob.toLowerCase()).not.toContain('deny all');
    expect(blob.toLowerCase()).not.toContain('install band');
    expect(blob.toLowerCase()).not.toMatch(/\bdownloads\b/);
    expect(blob.toLowerCase()).not.toMatch(/\brevenue\b/);
    expect(blob.toLowerCase()).not.toMatch(/\bvaluation\b/);
    expect(blob).toContain('does not recommend issuing a token');
    expect(blob.toLowerCase()).not.toMatch(/we recommend (issuing|a token)/);
    expect(blob).toContain('Traction: Unknown');
    expect(blob).toContain('Market size: Unknown');
    expect(blob).toContain(PAID_PLAN_PRICES.starter.audLabel);
    expect(blob).toContain(PAID_PLAN_PRICES.growth.audLabel);
    expect(blob).toContain(PAID_PLAN_PRICES.agency.audLabel);
    expect(blob).toContain(PAID_PLAN_PRICES.starter.starsLabel);
    expect(blob).toContain(PAID_PLAN_PRICES.agency.starsLabel);
  });

  it('renders the outline, source links, illustrative shot, and the domain check', () => {
    const html = renderToStaticMarkup(createElement(WhitePaperPage, { onFullAudit: () => {} }));
    for (const id of WHITE_PAPER_SECTION_IDS) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).toContain('aria-label="White paper sections"');
    expect(html).toContain('Illustrative example, not a measurement');
    expect(html).toContain('/marketing/white-paper/web-product.png');
    expect(html).toContain('href="#src-S3"');
    expect(html).toContain('https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/');
    expect(html).toContain('https://t.me/LuminaraSuiteBot/app');
    expect(html).toContain('https://t.me/LuminaraSuiteBot');
    expect(html).toContain('https://play.google.com/store/apps/details?id=com.luminarasuite.app');
    expect(html).toContain('id="white-paper-domain"');
    expect(html).toContain('does not recommend issuing a token');
    const shell = MARKETING_SHELL_BY_PATH[WHITE_PAPER_PATH].crawlerBody;
    expect(shell).toContain('does not recommend issuing a token');
    expect(shell).not.toContain('GEO-bench');
    const crawler = marketingDocumentForPath('/white-paper')?.crawlerBody ?? '';
    expect(crawler).toBe(whitePaperCrawlerHtml());
    expect(crawler).toContain('Illustrative example, not a measurement');
    expect(crawler).toContain('GEO-bench');
    for (const source of WHITE_PAPER_SOURCES) {
      expect(crawler, source.id).toContain(source.urls[0]);
    }
  });
});
