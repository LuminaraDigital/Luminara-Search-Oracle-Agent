import { describe, it, expect, beforeEach } from 'vitest';
import {
  visibilityHistoryService,
  recordVisibilitySnapshot,
  getVisibilityTrend,
  clearVisibilityHistory,
} from '../services/visibility/visibilityHistoryService';

describe('visibilityHistoryService', () => {
  beforeEach(() => {
    clearVisibilityHistory();
  });

  it('records snapshots and computes deltas', () => {
    recordVisibilitySnapshot({
      domain: 'https://www.example.com/path',
      focus: 'AEO',
      citationRatePercent: 20,
      measuredAt: 1_000_000,
      shareOfVoice: {
        targetDomain: 'example.com',
        brandName: 'Example',
        measuredAt: 1_000_000,
        totalPrompts: 3,
        mentionCoveragePercent: 20,
        citationCoveragePercent: 20,
        brandCitationSharePercent: 25,
        slices: [],
        formula: 'x',
        method: 'observed',
      },
    });
    recordVisibilitySnapshot({
      domain: 'example.com',
      focus: 'AEO',
      citationRatePercent: 50,
      measuredAt: 2_000_000,
      shareOfVoice: {
        targetDomain: 'example.com',
        brandName: 'Example',
        measuredAt: 2_000_000,
        totalPrompts: 3,
        mentionCoveragePercent: 50,
        citationCoveragePercent: 50,
        brandCitationSharePercent: 40,
        slices: [],
        formula: 'x',
        method: 'observed',
      },
    });

    const trend = getVisibilityTrend('example.com');
    expect(trend.points).toHaveLength(2);
    expect(trend.deltaCitationRate).toBe(30);
    expect(trend.deltaShareOfVoice).toBe(15);
    expect(visibilityHistoryService.listAll().every((p) => p.domain === 'example.com')).toBe(true);
  });
});
