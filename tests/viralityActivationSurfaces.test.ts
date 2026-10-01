import { describe, expect, it } from 'vitest';
import { computeNorthStarRate, NORTH_STAR_WINDOW_MS } from '../services/analytics/northStarMetrics';
import { buildFaqPageJsonLd, MARKETING_FAQ } from '../services/marketing/marketingFaqContent';
import { MARKETING_SHELL_BY_PATH } from '../services/marketing/pageMeta';
import { marketingViewFromPathname } from '../utils/marketingRoutes';
import { AppView } from '../types';
import { SITEMAP_XML, ROBOTS_TXT, LLMS_TXT } from '../worker/crawlDocuments';

describe('northStarMetrics', () => {
  it('counts save within 24h of instant_audit_completed', () => {
    const t0 = 1_000_000;
    const result = computeNorthStarRate(
      [
        { type: 'instant_audit_completed', timestamp: t0, accountId: 'a1' },
        { type: 'strategy_saved', timestamp: t0 + 60_000, accountId: 'a1' },
      ],
      t0 + NORTH_STAR_WINDOW_MS,
    );
    expect(result.denominator).toBe(1);
    expect(result.numerator).toBe(1);
    expect(result.rate).toBe(1);
  });

  it('ignores activation outside the 24h window', () => {
    const t0 = 1_000_000;
    const result = computeNorthStarRate(
      [
        { type: 'instant_audit_completed', timestamp: t0, accountId: 'a1' },
        { type: 'strategy_saved', timestamp: t0 + NORTH_STAR_WINDOW_MS + 1, accountId: 'a1' },
      ],
      t0 + NORTH_STAR_WINDOW_MS + 10_000,
    );
    expect(result.denominator).toBe(1);
    expect(result.numerator).toBe(0);
    expect(result.rate).toBe(0);
  });
});

describe('marketing FAQ + crawl surfaces', () => {
  it('builds FAQPage JSON-LD matching FAQ copy length', () => {
    const ld = buildFaqPageJsonLd();
    expect(ld['@type']).toBe('FAQPage');
    expect((ld.mainEntity as unknown[]).length).toBe(MARKETING_FAQ.length);
  });

  it('includes FAQPage on home and methodology shells', () => {
    const homeGraph = MARKETING_SHELL_BY_PATH['/'].jsonLd['@graph'] as Array<{ '@type'?: string }>;
    const methodGraph = MARKETING_SHELL_BY_PATH['/methodology'].jsonLd['@graph'] as Array<{
      '@type'?: string;
    }>;
    expect(homeGraph.some((n) => n['@type'] === 'FAQPage')).toBe(true);
    expect(methodGraph.some((n) => n['@type'] === 'FAQPage')).toBe(true);
  });

  it('routes methodology and sample-report', () => {
    expect(marketingViewFromPathname('/methodology')).toBe(AppView.METHODOLOGY);
    expect(marketingViewFromPathname('/sample-report')).toBe(AppView.SAMPLE_REPORT);
    expect(marketingViewFromPathname('/sample')).toBe(AppView.SAMPLE_REPORT);
  });

  it('lists new surfaces in sitemap, robots, and llms.txt', () => {
    expect(SITEMAP_XML).toContain('/methodology');
    expect(SITEMAP_XML).toContain('/sample-report');
    expect(ROBOTS_TXT).toContain('Allow: /methodology');
    expect(ROBOTS_TXT).toContain('Allow: /sample-report');
    expect(LLMS_TXT).toContain('/methodology');
    expect(LLMS_TXT).toContain('/sample-report');
  });
});
