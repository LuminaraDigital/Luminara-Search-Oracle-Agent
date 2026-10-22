import { describe, expect, it } from 'vitest';
import { BLOCKED_CHECK } from '../services/audit/llmCrawlerReadiness';
import { evaluateRealEstateChecks, formatRealEstateChecks } from '../services/audit/realEstateChecks';
import { auditHistoryService } from '../services/audit/auditHistoryService';
import { formatAuDate } from '../utils/formatAuDate';

const localBusiness = (phone: string) => JSON.stringify({
  '@type': 'RealEstateAgent',
  name: 'Ray White Richmond',
  telephone: phone,
  address: { streetAddress: '1 Bridge Road', addressLocality: 'Richmond', addressRegion: 'VIC', postalCode: '3121' },
  sameAs: ['https://maps.google.com/?cid=123'],
});

describe('real estate checks', () => {
  it('does not call a blocked fetch measured or missing', () => {
    const checks = evaluateRealEstateChecks([{
      url: 'https://raywhite.com.au',
      httpStatus: 403,
      title: 'Just a moment...',
      rawTextSnippet: 'Checking your browser',
      schemasFound: [],
    }]);
    expect(checks).toHaveLength(6);
    for (const check of checks) {
      expect(check.status).toBe('not_measured');
      expect(check.detail).toBe(BLOCKED_CHECK);
      expect(check.detail.startsWith('Measured')).toBe(false);
    }
  });

  it('cites the schema, matching NAP, agent page, area page, map link, and rating', () => {
    const checks = evaluateRealEstateChecks([
      {
        url: 'https://raywhite.com.au/',
        schemasFound: [{ type: 'RealEstateAgent', rawJson: localBusiness('03 9421 1111') }],
        outboundLinks: ['https://raywhite.com.au/team/jane-smith', 'https://raywhite.com.au/suburbs/richmond'],
      },
      {
        url: 'https://raywhite.com.au/contact',
        schemasFound: [{ type: 'RealEstateAgent', rawJson: localBusiness('+61 3 9421 1111') }],
      },
      {
        url: 'https://raywhite.com.au/reviews',
        schemasFound: [{ type: 'AggregateRating', rawJson: JSON.stringify({ '@type': 'AggregateRating', ratingValue: '4.8', reviewCount: '120' }) }],
      },
    ]);
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    expect(byId.schema.status).toBe('measured');
    expect(byId.schema.detail).toContain('RealEstateAgent');
    expect(byId.nap.status).toBe('measured');
    expect(byId.nap.detail).toContain('match');
    expect(byId.agent_pages.detail).toContain('/team/jane-smith');
    expect(byId.area_pages.detail).toContain('/suburbs/richmond');
    expect(byId.gbp.detail).toContain('maps.google.com');
    expect(byId.reviews.detail).toContain('AggregateRating');
    expect(formatRealEstateChecks(checks)).toContain('## Real estate checks');
    expect(formatRealEstateChecks(checks)).not.toContain('Fill this in');
  });

  it('reports a phone difference and leaves a single NAP uncompared', () => {
    const differ = evaluateRealEstateChecks([
      { url: 'https://a.example/', schemasFound: [{ type: 'LocalBusiness', rawJson: localBusiness('03 9000 1111') }] },
      { url: 'https://a.example/office', schemasFound: [{ type: 'LocalBusiness', rawJson: localBusiness('03 9000 2222') }] },
    ]);
    const nap = differ.find((check) => check.id === 'nap');
    expect(nap?.status).toBe('measured');
    expect(nap?.detail).toContain('03 9000 1111');
    expect(nap?.detail).toContain('03 9000 2222');

    const one = evaluateRealEstateChecks([
      { url: 'https://a.example/', schemasFound: [{ type: 'LocalBusiness', rawJson: localBusiness('03 9000 1111') }] },
    ]);
    expect(one.find((check) => check.id === 'nap')?.status).toBe('not_measured');
  });
});

describe('saved audits and Australian dates', () => {
  it('keeps a long report for reopen and formats 5 Jan 2026', () => {
    auditHistoryService.clear();
    const text = 'A'.repeat(5000);
    const saved = auditHistoryService.record({ domain: 'https://www.raywhite.com.au/richmond', focus: 'AEO', reportText: text });
    expect(saved.reportExcerpt.length).toBe(5000);
    expect(auditHistoryService.get(saved.id)?.domain).toBe('raywhite.com.au');
    expect(formatAuDate('2026-01-05T00:00:00Z')).toBe('5 Jan 2026');
  });
});
