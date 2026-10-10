import { describe, expect, it } from 'vitest';
import {
  citationSupportHeuristic,
  citationSupportWithLlm,
  composeJudgment,
  filterState,
  preParseCandidates,
  runAtomicChecks,
  validateNoul,
  validateScore,
  EvidenceBoundError,
} from '../../services/evidenceBound';

describe('citation + atomic + validate', () => {
  it('supports claim when evidence overlaps', () => {
    const r = citationSupportHeuristic({
      claimText: 'Pricing page mentions Agency plan',
      evidenceSpans: ['Our Agency plan includes API access and priority support.'],
    });
    expect(r.verdict).toBe('supports');
    expect(r.status).toBe('estimated');
  });

  it('LLM citation never returns measured', async () => {
    const r = await citationSupportWithLlm({
      claimText: 'Agency plan includes API',
      evidenceSpans: ['Agency plan includes API access'],
      llm: async () =>
        JSON.stringify({
          choice: 'supports',
          probabilities: { supports: 0.8, contradicts: 0.1, insufficient: 0.1 },
          confidence: 0.7,
        }),
    });
    expect(r.status).not.toBe('measured');
  });

  it('atomic missing fields are not_measured', () => {
    const dims = runAtomicChecks({});
    expect(dims.every((d) => d.status === 'not_measured')).toBe(true);
    expect(composeJudgment(dims).status).toBe('not_measured');
  });

  it('filterState drops unspecified keys', () => {
    expect(filterState({ a: 1, b: 2 }, ['a'])).toEqual({ a: 1 });
    expect(filterState({ page: { url: 'https://x.test', noise: 1 } }, ['page.url'])).toEqual({
      'page.url': 'https://x.test',
    });
  });

  it('validateScore and validateNoul reject garbage', () => {
    expect(() => validateNoul({ noul: 2 })).toThrow(EvidenceBoundError);
    expect(() =>
      validateScore(
        { score: 1, probabilities: { '0': 0.2, '1': 0.2, '2': 0.6 }, confidence: 0.5 },
        ['0', '1', '2'],
      ),
    ).toThrow(EvidenceBoundError);
  });

  it('preParse extracts emails without inventing', () => {
    const c = preParseCandidates('Email a@b.co and also a@b.co again');
    expect(c.filter((x) => x.kind === 'email')).toHaveLength(1);
  });
});
