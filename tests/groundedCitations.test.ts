import { describe, expect, it } from 'vitest';
import {
  GroundedCitationLedger,
  normalizeForVerbatimMatch,
  normalizeSourceUrl,
  quoteAppearsVerbatimInSource,
} from '../services/audit/groundedCitations';
import { groundedCitationsHonesty, runAllValidators } from '../worker/agentOutputValidators';

describe('Grounded Citations Ledger & Verbatim Quote Verifier', () => {
  it('deduplicates canonical URLs across trailing slashes, default ports, and fragments', () => {
    const ledger = new GroundedCitationLedger();
    const id1 = ledger.registerSource('https://example.com:443/docs/seo/?utm=1#intro', {
      title: 'SEO Guide',
      fetchedText: 'Canonical tags consolidate duplicate URLs across crawlers.',
    });
    const id2 = ledger.registerSource('https://example.com/docs/seo?utm=1#other');
    expect(id1).toBe(1);
    expect(id2).toBe(1);
    expect(normalizeSourceUrl('http://example.com:80/a/')).toBe('http://example.com/a');
  });

  it('accepts markdown-normalized verbatim quotes and rejects paraphrased or altered numbers', () => {
    const pageText =
      'Our benchmark study found that [structured FAQ schema](https://example.com/faq) lifted AI citation rate by **47%** across 200 domains.';

    expect(
      quoteAppearsVerbatimInSource(
        'structured FAQ schema lifted AI citation rate by 47% across 200 domains',
        pageText,
      ),
    ).toBe(true);
    expect(
      quoteAppearsVerbatimInSource(
        'structured FAQ schema lifted AI citation rate by 42% across 200 domains',
        pageText,
      ),
    ).toBe(false);
    expect(normalizeForVerbatimMatch('**47%** [rate](https://x.test)')).toBe('47% rate');

    const ledger = new GroundedCitationLedger();
    const id = ledger.registerSource('https://example.com/study', {
      title: 'Benchmark Study',
      fetchedText: pageText,
    });
    expect(ledger.attachQuote(id, 'lifted AI citation rate by 42%').ok).toBe(false);
    expect(ledger.attachQuote(id, 'lifted AI citation rate by 47% across 200 domains').ok).toBe(true);
  });

  it('verifies inline [n] markers, Sources block agreement, ClaimStatus provenance, and validator findings', () => {
    const ledger = new GroundedCitationLedger();
    const s1 = ledger.registerSource('https://example.com/audit', {
      title: 'Audit Report',
      fetchedText: 'Homepage title tag is 58 characters and loads in 1.2 seconds.',
    });
    const s2 = ledger.registerSource('https://example.com/robots', {
      title: 'Robots Txt',
      fetchedText: 'User-agent: GPTBot Allow: /',
    });
    ledger.attachQuote(s1, 'Homepage title tag is 58 characters');

    const sourcesBlock = ledger.renderSourcesBlock({ style: 'evidence', onlyIds: [s1, s2] });
    expect(sourcesBlock).toContain('[1] Audit Report - https://example.com/audit');
    expect(sourcesBlock).toContain('> "Homepage title tag is 58 characters"');

    const cleanDraft = [
      'Homepage title length is within the target window at 58 characters [1].',
      'GPTBot crawling is explicitly permitted in robots directives [2].',
      'Backlink velocity remains [unverified] until link index credentials are connected.',
      '',
      ledger.renderSourcesBlock({ onlyIds: [s1, s2] }),
    ].join('\n');

    const verified = ledger.verifyDraft(cleanDraft, { minCoverage: 1 });
    expect(verified.ok).toBe(true);
    expect(verified.sentences.map((s) => s.status)).toEqual(['measured', 'estimated', 'not_measured']);

    // Require verbatim evidence quotes on all cited sources -> flags [2] since only [1] has a quote.
    const strictQuotes = ledger.verifyDraft(cleanDraft, { requireEvidenceQuotes: true });
    expect(strictQuotes.ok).toBe(false);
    expect(strictQuotes.missingEvidenceIds).toEqual([2]);

    // Hallucinated [9] citation triggers block in groundedCitationsHonesty & runAllValidators.
    const badDraft = [
      'Homepage title length is within the target window at 58 characters [1].',
      'GPTBot crawling is explicitly permitted in robots directives [2].',
      'Competitor traffic doubled last month [9].',
      '',
      ledger.renderSourcesBlock({ onlyIds: [s1, s2] }),
    ].join('\n');
    const findings = groundedCitationsHonesty(badDraft, ledger, { requireEvidenceQuotes: true });
    expect(findings.some((f) => f.severity === 'block' && f.detail.includes('[9]'))).toBe(true);
    expect(findings.some((f) => f.severity === 'warn' && f.detail.includes('[2]'))).toBe(true);

    const allCheck = runAllValidators(badDraft, {
      groundedLedger: ledger,
      requireEvidenceQuotes: true,
      evidenceNumbers: [58],
    });
    expect(allCheck.ok).toBe(false);
  });
});
