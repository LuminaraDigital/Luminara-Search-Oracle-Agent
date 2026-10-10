import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { ShareOfVoiceCard } from '../components/audit/ShareOfVoiceCard';
import { VisibilityTrendsCard } from '../components/audit/VisibilityTrendsCard';
import { auditDiffService } from '../services/audit/auditDiffService';
import { buildShareOfVoice, isMeasuredShareOfVoice, type ShareOfVoiceSummary } from '../services/visibility/shareOfVoiceService';
import {
  clearVisibilityHistory,
  getVisibilityTrend,
  recordVisibilitySnapshot,
} from '../services/visibility/visibilityHistoryService';
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
      competitorsCited: [],
      citationConfidence: 20,
      timestamp: Date.now(),
    },
  ],
});

/** Every number anywhere inside a value, with the key it sits under. */
function numbersIn(value: unknown, key = ''): Array<[string, number]> {
  if (typeof value === 'number') return [[key, value]];
  if (Array.isArray(value)) return value.flatMap((item) => numbersIn(item, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([childKey, child]) => numbersIn(child, childKey));
  }
  return [];
}

describe('shareOfVoiceService', () => {
  it('counts the rows that name the brand and each competitor, and nothing else', () => {
    const sov = buildShareOfVoice(sample());
    expect(sov.totalPrompts).toBe(3);
    expect(sov.slices).toEqual([
      { label: 'Example', kind: 'brand', mentionCount: 1 },
      { label: 'Rival Co', kind: 'competitor', mentionCount: 1 },
    ]);
  });

  it('carries no percentage, no share and no slice for rows where nobody was named', () => {
    const sov = buildShareOfVoice(sample());
    // The third row names nobody. It is not turned into an "Other" slice.
    expect(sov.slices.map((slice) => slice.kind)).toEqual(['brand', 'competitor']);
    expect(JSON.stringify(sov)).not.toMatch(/percent|share|formula|unattributed|other/i);
    // Every number is the time it was measured, the rows sampled, or a count of those rows.
    for (const [key, value] of numbersIn(sov)) {
      expect(['measuredAt', 'totalPrompts', 'mentionCount'], key).toContain(key);
      if (key === 'mentionCount') {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeLessThanOrEqual(sov.totalPrompts);
      }
    }
  });

  it('counts a competitor once for a row that names it twice', () => {
    const summary = sample();
    summary.evidenceList[1].competitorsCited = ['Rival Co', ' Rival Co ', ''];
    const rival = buildShareOfVoice(summary).slices.find((slice) => slice.label === 'Rival Co');
    expect(rival?.mentionCount).toBe(1);
  });

  it('knows a summary it counted from a copy of one', () => {
    const sov = buildShareOfVoice(sample());
    expect(isMeasuredShareOfVoice(sov)).toBe(true);
    expect(isMeasuredShareOfVoice({ ...sov })).toBe(false);
    expect(isMeasuredShareOfVoice(null)).toBe(false);
  });
});

describe('ShareOfVoiceCard', () => {
  it('prints counts with where they came from, never a percentage', () => {
    const html = renderToStaticMarkup(createElement(ShareOfVoiceCard, { summary: buildShareOfVoice(sample()) }));
    expect(html).toContain('mentioned in 1 of 3 sampled queries');
    expect(html).toContain('search sample');
    expect(html).toContain('Queries sampled');
    expect(html).not.toMatch(/\d+\s*%/);
    expect(html).not.toMatch(/citation share|Mention cov|Citation cov|prompt panel|Observed/i);
    expect(html).not.toContain('unattributed');
    // No bar drawn to a width: a width is a percentage by another name.
    expect(html).not.toContain('style="width');
  });

  it('drops the invented slice and the percentages of a summary stored before this change', () => {
    const stored = {
      targetDomain: 'example.com',
      brandName: 'Example',
      measuredAt: 1,
      totalPrompts: 3,
      mentionCoveragePercent: 33,
      citationCoveragePercent: 33,
      brandCitationSharePercent: 25,
      slices: [
        { label: 'Example', kind: 'brand', mentionCount: 1, citationCount: 1, citationSharePercent: 25, mentionSharePercent: 25 },
        { label: 'Other / unattributed', kind: 'other', mentionCount: 2, citationCount: 2, citationSharePercent: 75, mentionSharePercent: 75 },
      ],
      formula: 'x',
      method: 'observed',
    } as unknown as ShareOfVoiceSummary;
    const html = renderToStaticMarkup(createElement(ShareOfVoiceCard, { summary: stored }));
    expect(html).toContain('mentioned in 1 of 3 sampled queries');
    expect(html).not.toContain('unattributed');
    expect(html).not.toMatch(/\d+\s*%/);
    expect(html).not.toContain('75');
  });

  it('does not render when it has nothing true to show', () => {
    const base = buildShareOfVoice(sample());
    const cases: Array<ShareOfVoiceSummary | null | undefined> = [
      null,
      undefined,
      { ...base, totalPrompts: 0 },
      { ...base, slices: [] },
      { ...base, slices: [{ label: 'Rival Co', kind: 'competitor', mentionCount: 1 }] },
      // A count larger than the rows sampled is not a count of them.
      { ...base, slices: [{ label: 'Example', kind: 'brand', mentionCount: 65 }] },
      buildShareOfVoice({ ...sample(), evidenceList: [] }),
    ];
    for (const summary of cases) {
      expect(renderToStaticMarkup(createElement(ShareOfVoiceCard, { summary }))).toBe('');
    }
  });
});

describe('share of voice over time', () => {
  beforeEach(() => {
    clearVisibilityHistory();
  });

  it('stores the two counts and no change between audits', () => {
    recordVisibilitySnapshot({ domain: 'example.com', focus: 'AEO', citationRatePercent: 33, measuredAt: 1_000_000, shareOfVoice: buildShareOfVoice(sample()) });
    const later = sample();
    later.evidenceList[1].brandCited = true;
    recordVisibilitySnapshot({ domain: 'example.com', focus: 'AEO', citationRatePercent: 67, measuredAt: 2_000_000, shareOfVoice: buildShareOfVoice(later) });

    const trend = getVisibilityTrend('example.com');
    expect(trend.points.map((point) => [point.brandMentionCount, point.promptCount])).toEqual([[1, 3], [2, 3]]);
    expect(Object.keys(trend).some((key) => /share.?of.?voice|sov/i.test(key))).toBe(false);
    for (const point of trend.points) {
      expect(Object.keys(point).filter((key) => /share|coverage/i.test(key))).toEqual([]);
    }
  });

  it('shows the latest counts on the trends card, with no delta and no second line', () => {
    recordVisibilitySnapshot({ domain: 'example.com', focus: 'AEO', citationRatePercent: 33, measuredAt: 1_000_000, shareOfVoice: buildShareOfVoice(sample()) });
    const later = sample();
    later.evidenceList[1].brandCited = true;
    recordVisibilitySnapshot({ domain: 'example.com', focus: 'AEO', citationRatePercent: 67, measuredAt: 2_000_000, shareOfVoice: buildShareOfVoice(later) });

    const html = renderToStaticMarkup(createElement(VisibilityTrendsCard, { domain: 'example.com' }));
    expect(html).toContain('mentioned in 2 of 3 sampled queries');
    expect(html).not.toMatch(/SoV delta|brand SoV|Dashed/);
    expect(html).not.toContain('stroke-dasharray');
  });

  it('leaves the share of voice tile out for a snapshot that has no count', () => {
    recordVisibilitySnapshot({ domain: 'example.com', focus: 'AEO', citationRatePercent: 33, measuredAt: 1_000_000 });
    const html = renderToStaticMarkup(createElement(VisibilityTrendsCard, { domain: 'example.com' }));
    expect(html).not.toMatch(/share of voice/i);
    expect(html).not.toContain('sampled queries');
  });

  it('works out no share of voice change in the audit diff', () => {
    recordVisibilitySnapshot({ domain: 'example.com', focus: 'AEO', citationRatePercent: 33, measuredAt: 1_000_000, shareOfVoice: buildShareOfVoice(sample()) });
    recordVisibilitySnapshot({ domain: 'example.com', focus: 'AEO', citationRatePercent: 67, measuredAt: 2_000_000, shareOfVoice: buildShareOfVoice(sample()) });
    const diff = auditDiffService.diffSince('example.com');
    expect(diff.metrics.map((metric) => metric.key)).toEqual(['healthScore', 'citationRate', 'schemaGaps']);
    expect(JSON.stringify(diff)).not.toMatch(/share of voice|citation share/i);
  });
});
