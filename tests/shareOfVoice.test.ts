import { describe, it, expect } from 'vitest';
import { buildShareOfVoice } from '../services/visibility/shareOfVoiceService';
import type { EmpiricalCitationSummary } from '../services/audit/empiricalCitationService';

const sample = (): EmpiricalCitationSummary => ({
  targetDomain: 'example.com',
  brandName: 'Example',
  totalQueriesTested: 3,
  queriesCitedCount: 1,
  citationRatePercent: 33,
  topCitedCompetitor: 'Rival Co',
  entityClarityScore: 55,
  lastAudited: Date.now(),
  evidenceList: [
    {
      id: '1',
      query: 'what is example',
      intent: 'informational',
      targetDomain: 'example.com',
      brandCited: true,
      brandRank: 1,
      citedUrl: 'https://example.com/about',
      snippet: 'Example is...',
      competitorsCited: [],
      citationConfidence: 95,
      timestamp: Date.now(),
    },
    {
      id: '2',
      query: 'best alternatives',
      intent: 'commercial',
      targetDomain: 'example.com',
      brandCited: false,
      brandRank: null,
      citedUrl: null,
      snippet: 'Not cited',
      competitorsCited: ['Rival Co'],
      citationConfidence: 20,
      timestamp: Date.now(),
    },
    {
      id: '3',
      query: 'example vs rivals',
      intent: 'comparative',
      targetDomain: 'example.com',
      brandCited: false,
      brandRank: null,
      citedUrl: null,
      snippet: 'Not cited',
      competitorsCited: ['Rival Co'],
      citationConfidence: 20,
      timestamp: Date.now(),
    },
  ],
});

describe('shareOfVoiceService', () => {
  it('computes mention and citation coverage from empirical panel', () => {
    const sov = buildShareOfVoice(sample());
    expect(sov.totalPrompts).toBe(3);
    expect(sov.mentionCoveragePercent).toBe(33);
    expect(sov.citationCoveragePercent).toBe(33);
    expect(sov.method).toBe('observed');
    expect(sov.slices.some((s) => s.kind === 'brand')).toBe(true);
    expect(sov.slices.some((s) => s.kind === 'competitor' && s.label === 'Rival Co')).toBe(true);
    const sum = sov.slices.reduce((a, s) => a + s.citationSharePercent, 0);
    expect(sum).toBeGreaterThanOrEqual(99);
    expect(sum).toBeLessThanOrEqual(101);
  });
});
