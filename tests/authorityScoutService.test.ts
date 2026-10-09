import { describe, it, expect } from 'vitest';
import { scoutAuthoritySources } from '../services/visibility/authorityScoutService';
import type { EmpiricalEvidence } from '../services/audit/empiricalCitationService';

describe('authorityScoutService', () => {
  it('identifies and ranks third-party citation hubs and untapped targets', () => {
    const evidence: EmpiricalEvidence[] = [
      {
        id: '1',
        query: 'best crm tools',
        intent: 'commercial',
        targetDomain: 'mybrand.com',
        brandCited: false,
        brandRank: null,
        citedUrl: 'https://reddit.com/r/saas/comments/crm_comparison',
        snippet: 'Reddit discussion comparing tools.',
        competitorsCited: [],
        citationConfidence: 90,
        timestamp: Date.now(),
      },
      {
        id: '2',
        query: 'crm tools for small business',
        intent: 'commercial',
        targetDomain: 'mybrand.com',
        brandCited: false,
        brandRank: null,
        citedUrl: 'https://reddit.com/r/startups/best_crm',
        snippet: 'Another reddit recommendation.',
        competitorsCited: [],
        citationConfidence: 90,
        timestamp: Date.now(),
      },
      {
        id: '3',
        query: 'crm api docs',
        intent: 'informational',
        targetDomain: 'mybrand.com',
        brandCited: true,
        brandRank: 1,
        citedUrl: 'https://github.com/mybrand/crm-sdk',
        snippet: 'Official github repo of mybrand.',
        competitorsCited: [],
        citationConfidence: 95,
        timestamp: Date.now(),
      },
    ];

    const scout = scoutAuthoritySources({
      targetDomain: 'mybrand.com',
      evidence,
    });

    expect(scout.targetDomain).toBe('mybrand.com');
    expect(scout.totalQueriesAnalyzed).toBe(3);
    expect(scout.sources.length).toBeGreaterThan(0);

    const redditHub = scout.sources.find((s) => s.domain === 'reddit.com');
    expect(redditHub).toBeDefined();
    expect(redditHub?.category).toBe('community');
    expect(redditHub?.brandPresent).toBe(false);
    expect(redditHub?.leverageScore).toBe('high');

    const githubHub = scout.sources.find((s) => s.domain === 'github.com');
    expect(githubHub).toBeDefined();
    expect(githubHub?.brandPresent).toBe(true);

    expect(scout.topUntappedHub?.domain).toBe('reddit.com');
  });
});
