import { describe, expect, it } from 'vitest';
import {
  BANNED_VENDOR_TERMS,
  hasCitationsWhenClaiming,
  noInventedMetrics,
  notMeasuredHonesty,
  noVendorNames,
  runAllValidators,
  summarizeFindings,
  type ValidatorFinding,
} from '../worker/agentOutputValidators';

describe('noInventedMetrics', () => {
  it('flags a number near a long-form metric term', () => {
    const findings = noInventedMetrics('The domain authority is 45 for this site.');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].validator).toBe('noInventedMetrics');
    expect(findings[0].detail).toContain('domain authority');
    expect(findings[0].excerpt.length).toBeLessThanOrEqual(80);
  });

  it('flags a number with percent suffix near a metric term', () => {
    const findings = noInventedMetrics('Organic traffic grew 12.5% quarter over quarter.');
    expect(findings).toHaveLength(1);
    expect(findings[0].excerpt).toContain('12.5%');
  });

  it('matches DR case-sensitively with word boundaries', () => {
    const hits = noInventedMetrics('DR 62 recorded for the target page.');
    expect(hits).toHaveLength(1);
    expect(hits[0].detail).toContain('DR');
  });

  it('ignores lowercase dr even inside otherwise matching text', () => {
    const findings = noInventedMetrics('The dr of the drive was 99, no metric named.');
    expect(findings).toHaveLength(0);
  });

  it('ignores dr embedded inside words', () => {
    const findings = noInventedMetrics('The dashboard dropped 30 points today.');
    expect(findings).toHaveLength(0);
  });

  it('yields zero findings for a metric term with no number anywhere', () => {
    const findings = noInventedMetrics('visibility score improved over the period');
    expect(findings).toHaveLength(0);
  });

  it('exempts numbers present in evidenceNumbers', () => {
    const text = 'The domain authority is 45 for this site.';
    const findings = noInventedMetrics(text, { evidenceNumbers: [45] });
    expect(findings).toHaveLength(0);
  });

  it('does not exempt numbers absent from evidenceNumbers', () => {
    const text = 'The domain authority is 45 for this site.';
    const findings = noInventedMetrics(text, { evidenceNumbers: [46] });
    expect(findings).toHaveLength(1);
  });

  it('finds nothing on empty string', () => {
    expect(noInventedMetrics('')).toHaveLength(0);
  });
});

describe('hasCitationsWhenClaiming', () => {
  it('warns when attribution phrase has no citation markers', () => {
    const findings = hasCitationsWhenClaiming('According to our analysis, results improved.');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].span.start).toBe(0);
  });

  it('warns for studies show with no citation', () => {
    const findings = hasCitationsWhenClaiming('Studies show outcomes vary by niche.');
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/studies show/i);
  });

  it('passes when a markdown link is present', () => {
    const findings = hasCitationsWhenClaiming(
      'According to [the report](https://example.com/report), outcomes improved.',
    );
    expect(findings).toHaveLength(0);
  });

  it('passes when a bare URL is present', () => {
    const findings = hasCitationsWhenClaiming(
      'Data shows improvement. See https://example.com/data for detail.',
    );
    expect(findings).toHaveLength(0);
  });

  it('passes when a footnote ref is present', () => {
    const findings = hasCitationsWhenClaiming(
      'Research indicates gains across segments [1].',
    );
    expect(findings).toHaveLength(0);
  });

  it('finds nothing when no attribution phrase exists', () => {
    const findings = hasCitationsWhenClaiming('Results improved over the quarter.');
    expect(findings).toHaveLength(0);
  });
});

describe('notMeasuredHonesty', () => {
  it('blocks a metric restated as a number after not_measured', () => {
    const text =
      'visibility score: not_measured ... The visibility score is 72.';
    const findings = notMeasuredHonesty(text);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe('block');
    expect(findings[0].validator).toBe('notMeasuredHonesty');
  });

  it('blocks after not_configured as well', () => {
    const text = 'keyword difficulty: not_configured. Later: keyword difficulty 38.';
    const findings = notMeasuredHonesty(text);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe('block');
  });

  it('does not block when no number follows within the window', () => {
    const text =
      'domain rating: not_measured. The domain rating is pending review and will be published later.';
    const findings = notMeasuredHonesty(text);
    expect(findings).toHaveLength(0);
  });

  it('does not block numeric metrics far outside the 200 char window', () => {
    const padding = 'x'.repeat(250);
    const text = `not_measured ${padding} visibility score is 55.`;
    const findings = notMeasuredHonesty(text);
    expect(findings).toHaveLength(0);
  });

  it('finds nothing when no unmeasured token exists', () => {
    const findings = notMeasuredHonesty('The visibility score is 72.');
    expect(findings).toHaveLength(0);
  });
});

describe('noVendorNames', () => {
  it('flags a banned vendor term case-insensitively', () => {
    const findings = noVendorNames('We compared against OpenFoodFacts data.');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].detail).toContain('OpenFoodFacts');
  });

  it('flags one finding per occurrence', () => {
    const findings = noVendorNames('wger and wger again.');
    expect(findings).toHaveLength(2);
  });

  it('respects word boundaries', () => {
    const findings = noVendorNames('paperclips paperclipper');
    expect(findings).toHaveLength(0);
  });

  it('finds nothing on clean text', () => {
    const findings = noVendorNames('The report covered crawl coverage and indexing.');
    expect(findings).toHaveLength(0);
  });
});

describe('runAllValidators', () => {
  it('returns ok true and zero findings for empty string', () => {
    const result = runAllValidators('');
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('returns ok true for clean text', () => {
    const result = runAllValidators('Coverage improved after the crawl fixes shipped.');
    expect(result.ok).toBe(true);
  });

  it('returns ok false when a block finding exists', () => {
    const text = 'visibility score: not_measured ... The visibility score is 72.';
    const result = runAllValidators(text);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === 'block')).toBe(true);
  });

  it('sorts by span.start then block before warn before info', () => {
    const findings: ValidatorFinding[] = [
      {
        validator: 'a',
        severity: 'info',
        span: { start: 10, end: 12 },
        excerpt: 'x',
        detail: 'i',
      },
      {
        validator: 'b',
        severity: 'warn',
        span: { start: 10, end: 12 },
        excerpt: 'x',
        detail: 'w',
      },
      {
        validator: 'c',
        severity: 'block',
        span: { start: 10, end: 12 },
        excerpt: 'x',
        detail: 'b',
      },
      {
        validator: 'd',
        severity: 'info',
        span: { start: 2, end: 4 },
        excerpt: 'x',
        detail: 'i2',
      },
    ];
    // Force the same set through runAllValidators by constructing text is complex;
    // instead assert the comparator contract via a crafted document.
    const text =
      'xx not_measured visibility score 72 yy according to nothing zz paperclip qq';
    const result = runAllValidators(text);
    for (let k = 1; k < result.findings.length; k++) {
      const prev = result.findings[k - 1];
      const cur = result.findings[k];
      const order = { block: 0, warn: 1, info: 2 } as const;
      const cmp =
        prev.span.start - cur.span.start ||
        order[prev.severity] - order[cur.severity];
      expect(cmp).toBeLessThanOrEqual(0);
    }
    // Sanity: the constructed list above should sort d, c, b, a under the same rule.
    const sorted = [...findings].sort((a, b) => {
      const order = { block: 0, warn: 1, info: 2 } as const;
      return (
        a.span.start - b.span.start || order[a.severity] - order[b.severity]
      );
    });
    expect(sorted.map((f) => f.validator)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('honors evidenceNumbers exemption end to end', () => {
    const text = 'The domain authority is 45 for this site.';
    expect(runAllValidators(text).findings.length).toBeGreaterThan(0);
    const withEvidence = runAllValidators(text, { evidenceNumbers: [45] });
    expect(
      withEvidence.findings.filter((f) => f.validator === 'noInventedMetrics'),
    ).toHaveLength(0);
  });
});

describe('summarizeFindings', () => {
  it('counts severities correctly', () => {
    const mk = (severity: ValidatorFinding['severity']): ValidatorFinding => ({
      validator: 'x',
      severity,
      span: { start: 0, end: 1 },
      excerpt: 'e',
      detail: 'd',
    });
    const summary = summarizeFindings([
      mk('block'),
      mk('block'),
      mk('warn'),
      mk('info'),
      mk('info'),
      mk('info'),
    ]);
    expect(summary).toEqual({ block: 2, warn: 1, info: 3 });
  });

  it('returns zeros for empty input', () => {
    expect(summarizeFindings([])).toEqual({ block: 0, warn: 0, info: 0 });
  });
});

describe('banned terms constant', () => {
  it('exports the exact banned vendor terms', () => {
    expect([...BANNED_VENDOR_TERMS]).toEqual([
      'wger',
      'openfoodfacts',
      'coincompass',
      'paperclip',
      'dataforseo sandbox',
    ]);
  });
});

describe('performance', () => {
  it('processes a 50KB document in under 200ms', () => {
    const sentence =
      'According to internal review the visibility score is 72 and domain authority rose to 45. ';
    const doc = sentence.repeat(Math.ceil(50000 / sentence.length));
    expect(doc.length).toBeGreaterThanOrEqual(50000);
    const t0 = Date.now();
    const result = runAllValidators(doc);
    const delta = Date.now() - t0;
    expect(delta).toBeLessThan(200);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
