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
      { passed: 2, total: 4, unmeasured: 1 },
      null,
      [],
      [],
      null,
      noop,
    );
    expect(brief).toContain('passed 2 of 4; 1 not measured');
    expect(brief).not.toContain('critical gap');
    const line = measuredCheckLine({ passed: 4, total: 4, unmeasured: 0 });
    expect(scoreLine(line, true)).toBe('Passed 4 of 4; 0 not measured');
    expect(measuredChecks(line, true)).toEqual({ passed: 4, total: 4 });
    expect(measuredChecks(measuredCheckLine({ passed: 3, total: 4, unmeasured: 1 }), true)).toBeNull();
  });
});
