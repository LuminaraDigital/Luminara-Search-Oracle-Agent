import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  brandOverlapScore,
  detectSameAsConflict,
  citationIntegrityService,
} from '../services/audit/citationIntegrityService';
import type { EmpiricalCitationSummary } from '../services/audit/empiricalCitationService';

describe('citationIntegrityService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('scores brand token overlap', () => {
    expect(brandOverlapScore('Acme Dental Clinic', 'acme dental offers whitening')).toBeGreaterThanOrEqual(60);
    expect(brandOverlapScore('Acme Dental', 'unrelated competitor text')).toBe(0);
  });

  it('detects sameAs wikipedia conflict when path tokens mismatch brand', () => {
    expect(
      detectSameAsConflict('Acme Dental', 'acmedental.com', [
        'https://en.wikipedia.org/wiki/Totally_Unrelated_Corp',
      ])
    ).toBe(true);
    expect(
      detectSameAsConflict('Google', 'google.com', [
        'https://en.wikipedia.org/wiki/Google',
      ])
    ).toBe(false);
  });

  it('computes integrityScore with live/dead citations', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('dead.example')) {
        return { ok: false, status: 404 } as Response;
      }
      return { ok: true, status: 200 } as Response;
    });

    const summary: EmpiricalCitationSummary = {
      targetDomain: 'acme.com',
      brandName: 'Acme',
      citationRatePercent: 50,
      queriesCitedCount: 1,
      totalQueriesTested: 2,
      entityClarityScore: 70,
      topCitedCompetitor: 'Rival Co',
      lastAudited: Date.now(),
      evidenceList: [
        {
          id: '1',
          query: 'what is acme',
          intent: 'informational',
          brandCited: true,
          brandRank: 1,
          competitorsCited: [],
          snippet: 'Acme is a leading provider',
          citedUrl: 'https://live.example/page',
          citationConfidence: 80,
        },
        {
          id: '2',
          query: 'best acme alternative',
          intent: 'comparative',
          brandCited: false,
          competitorsCited: ['Rival Co'],
          snippet: 'Rival Co wins here',
          citedUrl: 'https://dead.example/gone',
          citationConfidence: 40,
        },
      ],
    };

    const result = await citationIntegrityService.evaluate(summary, {
      brandName: 'Acme',
      domain: 'acme.com',
    });

    expect(result.deadCitationCount).toBe(1);
    expect(result.integrityScore).toBeGreaterThanOrEqual(0);
    expect(result.integrityScore).toBeLessThanOrEqual(100);
    expect(result.details).toHaveLength(2);
    expect(['low', 'medium', 'high']).toContain(result.spoofRisk);
  });
});
