import { describe, expect, it } from 'vitest';
import { guardUnmeasuredClaims } from '../services/audit/unmeasuredClaimGuard';
import { EVIDENCE_LABEL_INSTRUCTION } from '../services/audit/evidencePromptLabels';

describe('unmeasured claim guard', () => {
  it('strips a third-party rating that the evidence does not contain', () => {
    const text = guardUnmeasuredClaims('Trustpilot lists 3.6/5. Add Organization schema.', {});
    expect(text).not.toMatch(/3\.6/);
    expect(text).not.toMatch(/Trustpilot/i);
    expect(text).toContain('Add Organization schema.');
  });

  it('keeps a measured citation rate and a number that appears in the evidence', () => {
    const text = guardUnmeasuredClaims(
      'The citation rate is 89%. The page says 12% off. Technical health is fine.',
      { citationRatePercent: 89, evidenceText: 'banner: 12% off this week' },
    );
    expect(text).toContain('89%');
    expect(text).not.toContain('89% (unverified)');
    expect(text).toContain('12%');
    expect(text).not.toContain('12% (unverified)');
    expect(text).toContain('Technical health');
  });

  it('marks a percentage that was not measured and was not in the evidence', () => {
    const text = guardUnmeasuredClaims('Visibility rose 40% this month.', { citationRatePercent: 89 });
    expect(text).toContain('40% (unverified)');
    expect(text).not.toContain('89%');
  });

  it('tells the audit model not to state unsupported ratings', () => {
    expect(EVIDENCE_LABEL_INSTRUCTION).toContain('Never state a rating, review count, or statistic that is not in the evidence above.');
    expect(EVIDENCE_LABEL_INSTRUCTION).not.toContain('\n');
  });
});
