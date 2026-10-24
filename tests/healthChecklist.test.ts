import { describe, expect, it } from 'vitest';
import { healthChecklist, measuredCheckLine } from '../services/agentCore/auditEvidenceGate';
import { executiveTranslatorAgent } from '../services/agentCore/agents/executiveTranslatorAgent';
import { reviewedHealth } from '../services/audit/jevVerifier';
import { scoreLine } from '../services/audit/reportBlocks';
import { measuredChecks } from '../services/share/winShare';

const noop = () => {};

describe('unmeasured page-health checks', () => {
  it('counts a downgraded check and an unknown citation rate as not measured', () => {
    expect(healthChecklist([
      { id: 'finding-schema-org-unmeasured' },
      { id: 'finding-thin-content' },
    ])).toEqual({ total: 4, failed: 1, unmeasured: 1, passed: 2 });
    expect(healthChecklist([], { citationRateKnown: false })).toEqual({
      total: 4,
      failed: 0,
      unmeasured: 1,
      passed: 3,
    });
    expect(reviewedHealth(73, [{ id: 'finding-schema-org-unmeasured' }], true)).toBeNull();
    expect(reviewedHealth(73, [{ id: 'finding-schema-org' }], true)).toBe(73);
  });

  it('prints the unmeasured count and withholds a clear result', async () => {
    const brief = await executiveTranslatorAgent.execute(
      'https://example.com',
      { passed: 2, total: 4, failed: 1, unmeasured: 1 },
      null,
      [],
      [],
      null,
      noop,
    );
    expect(brief).toContain('2 of 4 checks passed, 1 failed, 1 not measured');
    expect(brief).toContain('1 check failed. 1 check was not measured.');
    expect(brief).not.toContain('this run made');
    expect(brief).not.toContain('critical gap');
    const line = measuredCheckLine({ passed: 4, total: 4, unmeasured: 0 });
    expect(line).toBe('4 of 4 checks passed');
    expect(scoreLine(line, true)).toBe('4 of 4 checks passed');
    expect(measuredChecks(line, true)).toEqual({ passed: 4, total: 4 });
    expect(measuredChecks(measuredCheckLine({ passed: 2, total: 4, failed: 1, unmeasured: 1 }), true)).toBeNull();
  });

  it('says 2 of 4 checks passed, 2 failed on the brief, the score, and the share check', async () => {
    const failed = { passed: 2, total: 4, failed: 2, unmeasured: 0 };
    const line = measuredCheckLine(failed);
    expect(line).toBe('2 of 4 checks passed, 2 failed');
    expect(line).not.toContain('not measured');
    const brief = await executiveTranslatorAgent.execute(
      'https://example.com',
      failed,
      { mentioned: 7, total: 9 },
      [
        { id: 'finding-schema-org', category: 'schema', severity: 'high', title: 'Add a business identity tag', description: 'd', evidenceSource: 'e', howWeKnowItFailed: 'No Organization tag.', leadingIndicator: 'l', criticVerified: true, criticConfidence: 0.9 },
        { id: 'finding-thin-content', category: 'content_quality', severity: 'high', title: 'This page is too short', description: 'd', evidenceSource: 'e', howWeKnowItFailed: '133 words.', leadingIndicator: 'l', criticVerified: true, criticConfidence: 0.9 },
      ],
      [],
      null,
      noop,
    );
    expect(brief).toContain('2 of 4 checks passed, 2 failed');
    expect(brief).toContain('mentioned in 7 of 9 web results');
    expect(brief).not.toContain('not measured this run');
    expect(brief).not.toContain('There are no steps to list for this run.');
    expect(brief).toContain('#### 2 steps for the checks that failed:');
    expect(brief).toContain('**The takeaway:** 2 checks failed.');
    expect(scoreLine(line, true)).toBe('2 of 4 checks passed, 2 failed');
    expect(measuredChecks(line, true)).toEqual({ passed: 2, total: 4 });

    const untouched = measuredCheckLine({ passed: 2, total: 4, failed: 0, unmeasured: 2 });
    expect(untouched).toBe('2 of 4 checks passed, 2 not measured');
    expect(untouched).not.toContain('failed');
    const mixed = measuredCheckLine({ passed: 1, total: 4, failed: 2, unmeasured: 1 });
    expect(mixed).toBe('1 of 4 checks passed, 2 failed, 1 not measured');
  });
});
