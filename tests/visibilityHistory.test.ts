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

  it('records snapshots and works out no change between them', () => {
    recordVisibilitySnapshot({
      domain: 'https://www.example.com/path',
      focus: 'AEO',
      citationRatePercent: 20,
      measuredAt: 1_000_000,
      shareOfVoice: {
        targetDomain: 'example.com',
        brandName: 'Example',
        measuredAt: 1_000_000,
        totalPrompts: 5,
        slices: [{ label: 'Example', kind: 'brand', mentionCount: 1 }],
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
        totalPrompts: 4,
        slices: [{ label: 'Example', kind: 'brand', mentionCount: 2 }],
      },
    });

    const trend = getVisibilityTrend('example.com');
    expect(trend.points).toHaveLength(2);
    // Brand mentions are kept as two counts per audit. No change between audits is worked out.
    expect(trend.points.map((p) => [p.brandMentionCount, p.promptCount])).toEqual([[1, 5], [2, 4]]);
    expect(Object.keys(trend).sort()).toEqual(['domain', 'points']);
    expect(visibilityHistoryService.listAll().every((p) => p.domain === 'example.com')).toBe(true);
  });

  it('stores no count when the audit had none', () => {
    recordVisibilitySnapshot({ domain: 'example.com', focus: 'AEO', citationRatePercent: 20, measuredAt: 1_000_000 });
    const [point] = getVisibilityTrend('example.com').points;
    expect(point.brandMentionCount).toBeNull();
    expect(point.promptCount).toBe(0);
  });
});
