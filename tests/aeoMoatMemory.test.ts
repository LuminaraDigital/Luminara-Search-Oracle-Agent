import { describe, it, expect, beforeEach } from 'vitest';
import { auditHistoryService } from '../services/audit/auditHistoryService';
import { auditQueryService } from '../services/audit/auditQueryService';
import { auditDiffService } from '../services/audit/auditDiffService';
import { injectCompetitorWikiLinks, extractWikiLinks, splitWikiParts } from '../services/audit/wikiLinkService';
import { entitlementsFor, normalizePlanId } from '../services/plans/planEntitlements';
import { agencyWorkspaceService } from '../services/workspace/agencyWorkspaceService';
import { competitorWatchlistService } from '../services/competitors/competitorWatchlistService';

beforeEach(() => {
  auditHistoryService.clear();
  agencyWorkspaceService.list().forEach((c) => agencyWorkspaceService.delete(c.id));
  competitorWatchlistService.list().forEach((w) => competitorWatchlistService.remove(w.id));
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('plan entitlements', () => {
  it('maps pro to agency and exposes domain caps', () => {
    expect(normalizePlanId('pro')).toBe('agency');
    expect(entitlementsFor('agency').domainLimit).toBe(25);
    expect(entitlementsFor('agency').agencyClientLimit).toBe(10);
    expect(entitlementsFor('free').sentinelLimit).toBe(0);
    expect(entitlementsFor('growth').scheduledReaudit).toBe('weekly');
  });
});

describe('audit history + query + wiki', () => {
  it('records audits and runs score queries', () => {
    auditHistoryService.record({
      domain: 'https://www.acme.test/path',
      focus: 'AEO',
      reportText: '# AEO Performance Brief\nHealth Score: 42 / 100\nSchema gaps: 3\n[[Rival Co]] beats you.',
      citationRatePercent: 20,
      dnaCompetitors: ['Rival Co'],
      planId: 'growth',
      measuredAt: Date.now() - 40 * 86400_000,
    });
    auditHistoryService.record({
      domain: 'acme.test',
      focus: 'AEO',
      reportText: '# AEO Performance Brief\nHealth Score: 71 / 100\nSchema gaps: 1\n[[Rival Co]] still present.',
      citationRatePercent: 55,
      dnaCompetitors: ['Rival Co'],
      planId: 'growth',
      measuredAt: Date.now(),
    });

    const listed = auditHistoryService.list({ domain: 'acme.test' });
    expect(listed.length).toBe(2);

    const low = auditQueryService.run('audits where score < 60');
    expect(low.ok).toBe(true);
    expect(low.count).toBe(1);
    expect(low.matches[0].healthScore).toBe(42);

    const rival = auditQueryService.run('audits where competitor = Rival');
    expect(rival.ok).toBe(true);
    expect(rival.count).toBeGreaterThanOrEqual(1);

    const diff = auditDiffService.diffSince('acme.test');
    expect(diff.after?.healthScore).toBe(71);
    expect(diff.before?.healthScore).toBe(42);
    expect(diff.narrative.length).toBeGreaterThan(10);
  });

  it('injects and splits wiki competitor links', () => {
    const text = injectCompetitorWikiLinks('Acme competes with Rival Co in AI Overviews.', ['Rival Co']);
    expect(text).toContain('[[Rival Co]]');
    expect(extractWikiLinks(text)).toEqual(['Rival Co']);
    const parts = splitWikiParts('See [[Rival Co]] today');
    expect(parts.some((p) => p.type === 'wiki' && p.value === 'Rival Co')).toBe(true);
  });
});

describe('agency + watchlist gates', () => {
  it('blocks agency clients on free and allows on agency plan', () => {
    const denied = agencyWorkspaceService.create('Client A', { planId: 'free' });
    expect('error' in denied).toBe(true);

    const ok = agencyWorkspaceService.create('Client B', { planId: 'agency' });
    expect('error' in ok).toBe(false);
    if (!('error' in ok)) {
      expect(ok.name).toBe('Client B');
      agencyWorkspaceService.setActive(ok.id);
      expect(agencyWorkspaceService.getActiveClientId()).toBe(ok.id);
    }
  });

  it('tracks competitor citation deltas across audits', () => {
    competitorWatchlistService.add('Rival Co', 'brand.test', { planId: 'growth' });
    auditHistoryService.record({
      domain: 'brand.test',
      focus: 'SEO',
      reportText: 'Health Score 50 / 100\n[[Rival Co]] dominates.',
      dnaCompetitors: ['Rival Co'],
      measuredAt: Date.now() - 1000,
    });
    auditHistoryService.record({
      domain: 'brand.test',
      focus: 'SEO',
      reportText: 'Health Score 60 / 100\nNo rival this time.',
      dnaCompetitors: ['Rival Co'],
      measuredAt: Date.now(),
    });
    const alerts = competitorWatchlistService.evaluate('brand.test');
    expect(alerts.some((a) => a.change === 'lost' && a.competitorName === 'Rival Co')).toBe(true);
  });
});
