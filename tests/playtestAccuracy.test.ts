import { describe, expect, it, beforeEach } from 'vitest';
import { playbookAuditorAgent } from '../services/agentCore/agents/playbookAuditorAgent';
import type { ScrapedPageEvidence, SerpEvidenceItem } from '../services/agentCore/types';
import { BLOCKED_CHECK, evaluateLlmCrawlerReadiness } from '../services/audit/llmCrawlerReadiness';
import { auditDiffService } from '../services/audit/auditDiffService';
import { auditHistoryService } from '../services/audit/auditHistoryService';

function page(partial: Partial<ScrapedPageEvidence> = {}): ScrapedPageEvidence {
  return {
    url: 'https://raywhite.com.au',
    title: 'Ray White',
    h1s: ['Ray White'],
    schemasFound: [],
    wordCount: 400,
    rawTextSnippet: 'Ray White lists homes for sale in Melbourne.',
    source: 'direct',
    ...partial,
  };
}

function serp(): SerpEvidenceItem {
  return {
    query: 'ray white richmond',
    engine: 'tavily',
    title: 'Other agency',
    url: 'https://example.com/other',
    snippet: 'A different agency.',
    brandMentioned: true,
  };
}

describe('blocked checks stay not measured', () => {
  it('does not call a challenge page a missing Organization', async () => {
    const result = await playbookAuditorAgent.execute(
      'AEO',
      [page({
        httpStatus: 403,
        title: 'Just a moment...',
        rawTextSnippet: 'Checking your browser before accessing the site.',
        wordCount: 40,
      })],
      [serp()],
      null,
      () => {},
    );
    expect(result.healthScore).toBeNull();
    expect(result.findings.some((finding) => finding.id === 'finding-schema-org')).toBe(false);
  });

  it('labels a blocked robots.txt fetch and leaves it out of a pass', () => {
    const report = evaluateLlmCrawlerReadiness({
      robotsTxt: null,
      robotsHttpStatus: 403,
      llmsTxt: null,
      llmsHttpStatus: 429,
      aiTxt: null,
      aiHttpStatus: 403,
    });
    for (const check of report.checks) {
      if (check.id === 'llms_structure' || check.id === 'cite_paths') {
        expect(check.status).toBe('not_measured');
        continue;
      }
      expect(check.detail).toBe(BLOCKED_CHECK);
      expect(check.status).toBe('not_measured');
    }
  });
});

describe('brand memory compares one domain', () => {
  beforeEach(() => auditHistoryService.clear());

  it('uses the real gap and ignores a different domain', () => {
    const now = Date.now();
    auditHistoryService.record({
      domain: 'other.test',
      focus: 'AEO',
      reportText: 'Health Score: 10 / 100',
      measuredAt: now - 2 * 86_400_000,
    });
    auditHistoryService.record({
      domain: 'raywhite.com.au',
      focus: 'AEO',
      reportText: 'Health Score: 40 / 100',
      measuredAt: now - 3 * 86_400_000,
    });
    auditHistoryService.record({
      domain: 'https://www.raywhite.com.au/richmond',
      focus: 'AEO',
      reportText: 'Health Score: 55 / 100',
      measuredAt: now,
    });
    const diff = auditDiffService.diffSince('raywhite.com.au');
    expect(diff.domain).toBe('raywhite.com.au');
    expect(diff.before?.healthScore).toBe(40);
    expect(diff.after?.healthScore).toBe(55);
    expect(diff.gapMs).toBeGreaterThan(2 * 86_400_000);
    expect(diff.narrative).toContain('raywhite.com.au');
    expect(diff.narrative).toContain('3 days earlier');
    expect(diff.narrative).not.toContain('other.test');
  });
});
