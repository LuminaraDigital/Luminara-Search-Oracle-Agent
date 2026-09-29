import { describe, expect, it } from 'vitest';
import { computeRadarAverage, parseRadarItemScore } from '../components/audit/VisibilityRadar';

describe('VisibilityRadar honesty', () => {
  it('averages measured trailing scores', () => {
    expect(
      computeRadarAverage([
        ['q1', 'i', 'yes', 'r', '1', 'x', 'no', '40'],
        ['q2', 'i', 'no', 'r', '2', 'x', 'yes', '60'],
      ]),
    ).toBe(50);
  });

  it('returns null instead of inventing a default score', () => {
    expect(computeRadarAverage([['q', 'i', 'yes', 'r', '-', 'x', 'no', 'n/a']])).toBeNull();
    expect(computeRadarAverage([])).toBeNull();
  });

  it('does not invent per-row scores', () => {
    expect(parseRadarItemScore(undefined)).toBeNull();
    expect(parseRadarItemScore('')).toBeNull();
    expect(parseRadarItemScore('n/a')).toBeNull();
    expect(parseRadarItemScore('72%')).toBe(72);
  });
});
