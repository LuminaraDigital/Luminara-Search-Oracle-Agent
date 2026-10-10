import { describe, it, expect, beforeEach } from 'vitest';
import {
  competitorWatchlistService,
  isValidCompetitorName,
} from '../services/competitors/competitorWatchlistService';
import { auditHistoryService } from '../services/audit/auditHistoryService';

describe('Competitor validation & GAINED alerts', () => {
  beforeEach(() => {
    auditHistoryService.clear();
    try {
      localStorage.clear();
    } catch {}
  });

  it('rejects placeholder and bracketed competitor names', () => {
    expect(isValidCompetitorName('[Competitor A]')).toBe(false);
    expect(isValidCompetitorName('[Competitor B]')).toBe(false);
    expect(isValidCompetitorName('Competitor A')).toBe(false);
    expect(isValidCompetitorName('Brand X')).toBe(false);
    expect(isValidCompetitorName('[Acme]')).toBe(false);
    expect(isValidCompetitorName('placeholder')).toBe(false);
    expect(isValidCompetitorName('unknown')).toBe(false);
    expect(isValidCompetitorName('none')).toBe(false);
    expect(isValidCompetitorName('n/a')).toBe(false);
    expect(isValidCompetitorName('')).toBe(false);
    expect(isValidCompetitorName('a')).toBe(false);

    expect(isValidCompetitorName('Stripe')).toBe(true);
    expect(isValidCompetitorName('Adyen.com')).toBe(true);
    expect(isValidCompetitorName('SearchPilot')).toBe(true);
  });

  it('blocks adding placeholder competitors through service', () => {
    const res = competitorWatchlistService.add('[Competitor A]', 'example.com');
    expect('error' in res).toBe(true);
  });

  it('emits GAINED alert only after competitor appears in >= 2 real audits', () => {
    competitorWatchlistService.add('ValidRival', 'brand.test', { planId: 'growth' });

    // Audit 1: No mention
    auditHistoryService.record({
      domain: 'brand.test',
      focus: 'SEO',
      reportText: 'First audit. No competitors cited.',
      dnaCompetitors: ['ValidRival'],
      measuredAt: Date.now() - 2000,
    });

    // Audit 2: First mention of ValidRival (seen in 1 audit total)
    auditHistoryService.record({
      domain: 'brand.test',
      focus: 'SEO',
      reportText: 'Second audit. [[ValidRival]] is mentioned.',
      dnaCompetitors: ['ValidRival'],
      measuredAt: Date.now() - 1000,
    });

    // When evaluated across 2 audits where it only appeared in the 2nd (total = 1),
    // GAINED alert must NOT be emitted yet (needs >= 2 audits confirming presence).
    const alerts1 = competitorWatchlistService.evaluate('brand.test');
    expect(alerts1.some((a) => a.change === 'gained')).toBe(false);

    // Audit 3: Second confirmation of ValidRival (total = 2 audits)
    auditHistoryService.record({
      domain: 'brand.test',
      focus: 'SEO',
      reportText: 'Third audit. [[ValidRival]] mentioned again.',
      dnaCompetitors: ['ValidRival'],
      measuredAt: Date.now(),
    });

    // In this delta (between audit 2 and 3), ValidRival was mentioned in both, so no state change from !was to is.
    // Now let's test: competitor was in audit 1, absent in audit 2, and regained in audit 3:
    auditHistoryService.clear();
    competitorWatchlistService.add('ComebackKid', 'comeback.test', { planId: 'growth' });

    // Audit 1: mentioned (count = 1)
    auditHistoryService.record({
      domain: 'comeback.test',
      focus: 'SEO',
      reportText: 'Initial audit. [[ComebackKid]] is active.',
      dnaCompetitors: ['ComebackKid'],
      measuredAt: Date.now() - 3000,
    });

    // Audit 2: dropped out
    auditHistoryService.record({
      domain: 'comeback.test',
      focus: 'SEO',
      reportText: 'Intermediate audit. No competitors cited.',
      dnaCompetitors: ['ComebackKid'],
      measuredAt: Date.now() - 2000,
    });

    const lostAlerts = competitorWatchlistService.evaluate('comeback.test');
    expect(lostAlerts.some((a) => a.change === 'lost')).toBe(true);

    // Audit 3: reappeared (total mention count across all audits is now 2!)
    auditHistoryService.record({
      domain: 'comeback.test',
      focus: 'SEO',
      reportText: 'Latest audit. [[ComebackKid]] reappeared strongly.',
      dnaCompetitors: ['ComebackKid'],
      measuredAt: Date.now() - 1000,
    });

    const gainedAlerts = competitorWatchlistService.evaluate('comeback.test');
    expect(gainedAlerts.some((a) => a.change === 'gained')).toBe(true);
  });
});
