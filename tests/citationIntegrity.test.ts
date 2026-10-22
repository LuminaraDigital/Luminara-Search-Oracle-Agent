import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  brandOverlapScore,
  detectSameAsConflict,
  citationIntegrityService,
  isUnmeasuredReviewUrl,
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

  it('leaves cited links unchecked instead of fetching them from the browser', async () => {
    const fetchImpl = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
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

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.deadCitationCount).toBe(0);
    expect(result.details.map((detail) => detail.alive)).toEqual([null, null]);
    expect(result.details.map((detail) => detail.notes)).toEqual(['Link not checked', 'Link not checked']);
    expect(result.integrityScore).toBeGreaterThanOrEqual(0);
    expect(result.integrityScore).toBeLessThanOrEqual(100);
    expect(['low', 'medium', 'high']).toContain(result.spoofRisk);
  });

  it('does not fetch Trustpilot or score it as a dead citation', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return { ok: true, status: 200 } as Response;
    });
    const summary: EmpiricalCitationSummary = {
      targetDomain: 'movida.com.au',
      brandName: 'MoVida',
      citationRatePercent: 33,
      queriesCitedCount: 1,
      totalQueriesTested: 3,
      entityClarityScore: 40,
      topCitedCompetitor: null,
      lastAudited: Date.now(),
      evidenceList: [
        {
          id: '1',
          query: 'movida reviews',
          intent: 'commercial',
          brandCited: true,
          brandRank: 2,
          competitorsCited: [],
          snippet: 'MoVida restaurant',
          citedUrl: 'https://www.trustpilot.com/review/movida.com.au',
          citationConfidence: 50,
        },
        {
          id: '2',
          query: 'movida melbourne',
          intent: 'informational',
          brandCited: true,
          brandRank: 1,
          competitorsCited: [],
          snippet: 'MoVida official',
          citedUrl: 'https://www.movida.com.au/',
          citationConfidence: 80,
        },
      ],
    };
    expect(isUnmeasuredReviewUrl('https://www.trustpilot.com/review/movida.com.au')).toBe(true);
    const result = await citationIntegrityService.evaluate(summary, {
      brandName: 'MoVida',
      domain: 'movida.com.au',
    });
    expect(urls).toEqual([]);
    expect(result.details.map((detail) => detail.url)).toEqual(['https://www.movida.com.au/']);
    expect(result.details[0]?.notes).toBe('Link not checked');
    expect(result.deadCitationCount).toBe(0);
  });
});
