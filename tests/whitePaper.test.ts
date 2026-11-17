import { existsSync, readFileSync, statSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WhitePaperPage from '../components/marketing/WhitePaperPage';
import WhitePaperStory, { storyIndexAfterKey, storyIndexAfterSwipe } from '../components/marketing/WhitePaperStory';
import { PAID_PLAN_PRICES } from '../components/paywall/planPrices';
import { PUBLIC_APP_VIEWS } from '../services/auth/useAppAuth';
import { canonicalHrefForPage, resolveCanonicalHref } from '../services/marketing/documentMeta';
import { MARKETING_SHELL_BY_PATH, marketingShellKey } from '../services/marketing/pageMeta';
import { WHITE_PAPER_DESCRIPTION, WHITE_PAPER_H1, WHITE_PAPER_PATH, WHITE_PAPER_SECTION_IDS, WHITE_PAPER_SHOTS } from '../services/marketing/whitePaper';
import { whitePaperPdfBytes } from '../services/marketing/whitePaperPdf';
import { uncitedDigitSpans, whitePaperCrawlerHtml } from '../services/marketing/whitePaperPublish';
import { WHITE_PAPER_SECTIONS } from '../services/marketing/whitePaperSections';
import { compareSourceIds, WHITE_PAPER_SOURCES } from '../services/marketing/whitePaperSources';
import { AppView } from '../types';
import { resolveAppView } from '../utils/marketingRoutes';
import { LLMS_TXT, SITEMAP_XML } from '../worker/crawlDocuments';
import { injectMarketingMeta, marketingDocumentForPath } from '../worker/marketingShell';

const COPY_FILES = [
  'services/marketing/whitePaper.ts',
  'services/marketing/whitePaperSections.ts',
  'services/marketing/whitePaperPublish.ts',
  'services/marketing/whitePaperSources.ts',
  'services/marketing/whitePaperPdf.ts',
  'components/marketing/WhitePaperPage.tsx',
  'components/marketing/whitePaperRender.tsx',
  'components/marketing/WhitePaperStory.tsx',
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
    expect(html).toContain(WHITE_PAPER_SHOTS['web-product.png'].src);
    expect(html).toContain('srcSet=');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('What this means for your agency');
    expect(html).toContain('Skip to content');
    expect(html).toContain('lx-claim');
    expect(html).toContain('lx-wp-stack');
    expect(html).not.toContain('min-w-[40rem]');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('>Sign up<');
    expect(html).toContain('Download PDF');
    expect(html).toContain('Story mode');
    expect(html).toContain('href="#src-S3"');
    expect(html).toContain('https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/');
    expect(html).toContain('https://t.me/LuminaraSuiteBot/app');
    expect(html).toContain('https://t.me/LuminaraSuiteBot');
    expect(html).toContain('https://play.google.com/store/apps/details?id=com.luminarasuite.app');
    expect(html).toContain('id="white-paper-domain"');
    expect(html).toContain('does not recommend issuing a token');
    const shell = MARKETING_SHELL_BY_PATH[WHITE_PAPER_PATH].crawlerBody;
    expect(shell).toContain('does not recommend issuing a token');
    expect(shell).toContain(`<h1>${WHITE_PAPER_H1}</h1>`);
    expect(shell).toContain('href="/">Free check');
    expect(shell).toContain('href="/pricing">Sign up');
    expect(shell).not.toContain('GEO-bench');
    const crawler = marketingDocumentForPath('/white-paper')?.crawlerBody ?? '';
    expect(crawler).toBe(whitePaperCrawlerHtml());
    expect(crawler).toContain(`<h1>${WHITE_PAPER_H1}</h1>`);
    expect(html).toContain('methodology.</span>');
    expect(crawler).toContain('Illustrative example, not a measurement');
    expect(crawler).toContain('GEO-bench');
    for (const source of WHITE_PAPER_SOURCES) {
      expect(crawler, source.id).toContain(source.urls[0]);
    }
  });

  it('keeps measurement and the competitive map ahead of the appendix', () => {
    const html = renderToStaticMarkup(createElement(WhitePaperPage, { onFullAudit: () => {} }));
    const at = (id: string) => html.indexOf(`id="${id}"`);
    expect(at('executive-summary')).toBeLessThan(at('how-measurement-works'));
    expect(at('how-measurement-works')).toBeLessThan(at('competitive-map'));
    expect(at('competitive-map')).toBeLessThan(at('appendix'));
    expect(at('appendix')).toBeLessThan(at('stars-payout'));
    expect(at('stars-payout')).toBeLessThan(at('onchain-telegram-adjacency'));
    expect(at('onchain-telegram-adjacency')).toBeLessThan(at('architecture'));
    expect(at('architecture')).toBeLessThan(at('sources'));
    const shots = WHITE_PAPER_SECTIONS.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === 'shots' ? [...block.files] : [])),
    );
    expect(new Set(shots).size).toBe(shots.length);
    expect(shots).toHaveLength(Object.keys(WHITE_PAPER_SHOTS).length);
    expect(readFileSync('services/marketing/whitePaperSections.ts', 'utf8')).toContain('horizon has nearly closed');
    expect(readFileSync('services/marketing/whitePaperSections.ts', 'utf8')).toContain('no measured outcome');
  });

  it('publishes TechArticle JSON-LD, the agency description, and a paper OG image', () => {
    const page = MARKETING_SHELL_BY_PATH[WHITE_PAPER_PATH];
    expect(page.description).toBe(WHITE_PAPER_DESCRIPTION);
    expect(page.description).toContain('independent real estate agencies');
    expect(page.description).toContain('Fact, Estimate, or Speculation');
    expect(page.description.length).toBeGreaterThanOrEqual(120);
    expect(page.description.length).toBeLessThanOrEqual(160);
    const json = JSON.stringify(page.jsonLd);
    expect(json).toContain('"@type":"TechArticle"');
    expect(json).toContain('"datePublished":"2026-11-02"');
    expect(json).toContain('"dateModified":"2026-11-17"');
    expect(json).toContain('LUMINARA DIGITAL PTY LTD');
    expect(json).toContain(WHITE_PAPER_SOURCES[0].urls[0]);
    expect(page.ogImage).toContain('/marketing/white-paper/og.');
    expect(existsSync(`public${page.ogImage?.replace('https://www.luminarasuite.com', '')}`)).toBe(true);
    const shell = readFileSync('index.html', 'utf8');
    const html = injectMarketingMeta(shell, page);
    expect(html).toContain(`property="og:image" content="${page.ogImage}"`);
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain(`name="twitter:description" content="${page.description}"`);
    expect(html).toContain(`name="twitter:image" content="${page.ogImage}"`);
    expect(resolveCanonicalHref('/white-paper', AppView.WHITE_PAPER)).toBe(canonicalHrefForPage(page));
    expect(canonicalHrefForPage(page)).toBe('https://www.luminarasuite.com/white-paper');
    for (const shot of Object.values(WHITE_PAPER_SHOTS)) {
      const file = `public${shot.src}`;
      expect(existsSync(file), shot.src).toBe(true);
      expect(statSync(file).size, shot.src).toBeLessThan(80_000);
    }
  });

  it('exports a text PDF and keeps story mode off the canonical URL', () => {
    const bytes = whitePaperPdfBytes();
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('does not recommend issuing a token');
    expect(text).toContain('Traction: Unknown');
    expect(text).toContain('Market size: Unknown');
    expect(text).toContain('horizon has nearly closed');
    expect(Buffer.from(readFileSync('public/white-paper.pdf')).equals(Buffer.from(bytes))).toBe(true);
    expect(storyIndexAfterKey(0, 'ArrowRight', 14)).toBe(1);
    expect(storyIndexAfterKey(0, 'ArrowLeft', 14)).toBe(0);
    expect(storyIndexAfterKey(4, 'Home', 14)).toBe(0);
    expect(storyIndexAfterKey(4, 'End', 14)).toBe(13);
    expect(storyIndexAfterKey(13, 'ArrowDown', 14)).toBe(13);
    expect(storyIndexAfterSwipe(2, -80, 4, 14)).toBe(3);
    expect(storyIndexAfterSwipe(2, 80, 4, 14)).toBe(1);
    expect(storyIndexAfterSwipe(2, 10, 40, 14)).toBe(2);
    const fade = renderToStaticMarkup(createElement(WhitePaperStory, { reducedMotion: true, initialIndex: 1 }));
    expect(fade).toContain('data-motion="fade"');
    expect(fade).toContain('aria-live="polite"');
    expect(fade).toContain('rel="canonical" href="https://www.luminarasuite.com/white-paper"');
    expect(fade).toContain('id="how-measurement-works"');
    const turn = renderToStaticMarkup(createElement(WhitePaperStory, { reducedMotion: false }));
    expect(turn).toContain('data-motion="turn"');
    expect(readFileSync('components/marketing/whitePaper.css', 'utf8')).toContain('prefers-reduced-motion');
    expect(readFileSync('components/marketing/WhitePaperPage.tsx', 'utf8')).toContain("lazy(() => import('./WhitePaperStory'))");
  });
});
