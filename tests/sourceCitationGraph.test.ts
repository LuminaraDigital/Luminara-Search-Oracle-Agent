import { describe, it, expect } from 'vitest';
import { buildSourceCitationGraph } from '../services/visibility/sourceCitationGraphService';
import type { EmpiricalCitationSummary } from '../services/audit/empiricalCitationService';

describe('sourceCitationGraphService', () => {
  it('links brand, queries, cites, and competitors', () => {
    const empirical: EmpiricalCitationSummary = {
      targetDomain: 'acme.io',
      brandName: 'Acme',
      totalQueriesTested: 1,
      queriesCitedCount: 1,
      citationRatePercent: 100,
      topCitedCompetitor: 'Beta',
      entityClarityScore: 80,
      lastAudited: Date.now(),
      evidenceList: [
        {
          id: 'e1',
          query: 'best acme tools',
          intent: 'commercial',
          targetDomain: 'acme.io',
          brandCited: true,
          brandRank: 1,
          citedUrl: 'https://acme.io/docs',
          snippet: 'Acme docs',
          competitorsCited: ['Beta'],
          citationConfidence: 90,
          timestamp: Date.now(),
        },
      ],
    };

    const graph = buildSourceCitationGraph({
      domain: 'acme.io',
      sources: [{ uri: 'https://news.example/story', title: 'News' }],
      empirical,
    });

    expect(graph.nodes.some((n) => n.kind === 'brand')).toBe(true);
    expect(graph.nodes.some((n) => n.kind === 'query')).toBe(true);
    expect(graph.nodes.some((n) => n.kind === 'competitor')).toBe(true);
    expect(graph.nodes.some((n) => n.kind === 'external')).toBe(true);
    expect(graph.edges.some((e) => e.rel === 'cites')).toBe(true);
    expect(graph.stats.brandCites).toBe(1);
  });
});
