import { describe, expect, it, beforeEach } from 'vitest';
import { pageList, playbookAuditorAgent } from '../services/agentCore/agents/playbookAuditorAgent';
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

describe('organization markup already on the page', () => {
  it('does not recommend a critical Organization fix for Organization or ProfessionalService', async () => {
    for (const type of ['Organization', 'ProfessionalService', 'https://schema.org/LocalBusiness']) {
      const result = await playbookAuditorAgent.execute(
        'AEO',
        [page({ schemasFound: [{ type, rawJson: '{"name":"Luminara"}', isValid: true }] })],
        [serp()],
        null,
        () => {},
      );
      expect(result.findings.some((finding) => finding.id === 'finding-schema-org'), type).toBe(false);
    }
  });

  it('does not emit a critical Organization gap when the homepage has ProfessionalService and about has Organization', async () => {
    const result = await playbookAuditorAgent.execute(
      'AEO',
      [
        page({
          url: 'https://luminara.digital',
          schemasFound: [
            { type: 'ProfessionalService', rawJson: '{"name":"Luminara Digital"}', isValid: true },
            { type: 'Person', rawJson: '{}', isValid: true },
            { type: 'FAQPage', rawJson: '{}', isValid: true },
          ],
        }),
        page({
          url: 'https://luminara.digital/about',
          schemasFound: [
            { type: 'Organization', rawJson: '{"name":"Luminara Digital"}', isValid: true },
            { type: 'Person', rawJson: '{}', isValid: true },
          ],
        }),
        page({
          url: 'https://luminara.digital/services',
          schemasFound: [{ type: 'FAQPage', rawJson: '{}', isValid: true }],
        }),
      ],
      [serp()],
      null,
      () => {},
    );
    const text = result.findings.map((finding) => `${finding.id} ${finding.title} ${finding.description} ${finding.howWeKnowItFailed}`).join('\n');
    expect(result.findings.some((finding) => finding.id === 'finding-schema-org')).toBe(false);
    expect(result.findings.some((finding) => finding.severity === 'critical' && /organization/i.test(finding.title))).toBe(false);
    expect(text).not.toMatch(/schema types: none/i);
    expect(text).not.toMatch(/types found: none/i);
    const partial = result.findings.find((finding) => finding.id === 'finding-schema-org-partial');
    expect(partial?.severity).toBe('low');
    expect(partial?.description).toContain('https://luminara.digital/services: faqpage');
    expect(partial?.title).not.toContain('https://luminara.digital/about');
    expect(partial?.description).not.toContain('https://luminara.digital:');
  });

  it('names the pages in the soft Organization finding when several lack it', async () => {
    const org = [{ type: 'Organization', rawJson: '{}', isValid: true }];
    const faq = [{ type: 'FAQPage', rawJson: '{}', isValid: true }];
    const result = await playbookAuditorAgent.execute(
      'AEO',
      [
        page({ url: 'https://luminara.digital', schemasFound: org }),
        page({ url: 'https://luminara.digital/services', schemasFound: faq }),
        page({ url: 'https://luminara.digital/pricing', schemasFound: [] }),
        page({ url: 'https://luminara.digital/faq', schemasFound: faq }),
      ],
      [serp()],
      null,
      () => {},
    );
    const partial = result.findings.find((finding) => finding.id === 'finding-schema-org-partial');
    expect(partial?.title).toBe(
      'Organization markup is not on https://luminara.digital/services, https://luminara.digital/pricing and 1 more page',
    );
    expect(partial?.title).not.toMatch(/measured pages/);
  });

  it('lists one, two, or more pages in a finding title', () => {
    expect(pageList(['https://a.example/x'])).toBe('https://a.example/x');
    expect(pageList(['https://a.example/x', 'https://a.example/y'])).toBe('https://a.example/x and https://a.example/y');
    expect(pageList(['a', 'b', 'c', 'd'])).toBe('a, b and 2 more pages');
  });

  it('still flags a page whose only schema is FAQPage', async () => {
    const result = await playbookAuditorAgent.execute(
      'AEO',
      [page({ schemasFound: [{ type: 'FAQPage', rawJson: '{}', isValid: true }] })],
      [serp()],
      null,
      () => {},
    );
    const finding = result.findings.find((item) => item.id === 'finding-schema-org');
    expect(finding?.description).toContain('schema types: faqpage');
    expect(finding?.description).not.toContain('schema types: none');
  });
});

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
