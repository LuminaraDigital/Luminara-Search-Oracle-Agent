import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuestScoutSummaryPanel } from '../components/audit/GuestScoutSummaryPanel';
import { ActionableFixList } from '../components/retention/ActionableFixList';
import { buildGuestScoutSummary } from '../services/audit/guestScoutSummary';
import { remediationArchitectAgent } from '../services/agentCore/agents/remediationArchitectAgent';
import type { LlmCrawlerCheck } from '../services/audit/llmCrawlerReadiness';

const passed: LlmCrawlerCheck[] = [
  { id: 'llms_txt', label: 'llms.txt', status: 'pass', detail: 'llms.txt is present.' },
  { id: 'ai_bot_directives', label: 'AI crawler directives', status: 'pass', detail: 'Named bots are not blocked.' },
];

describe('evidence-gated starter fixes', () => {
  it('does not invent robots or llms work when measured findings are empty', () => {
    const html = renderToStaticMarkup(createElement(ActionableFixList, {
      domain: 'example.com',
      findings: [],
      crawlerChecks: passed,
    }));
    expect(html).toContain('No starter fixes');
    expect(html).not.toContain('Allow AI crawlers');
    expect(html).not.toContain('Deploy /llms.txt');
  });

  it('keeps a failed schema fix and drops passed crawler files', () => {
    const html = renderToStaticMarkup(createElement(ActionableFixList, {
      domain: 'example.com',
      findings: [{ id: 'finding-schema-org', title: 'Add Organization markup' }],
      crawlerChecks: passed,
    }));
    expect(html).toContain('Add Organization markup');
    expect(html).not.toContain('Allow AI crawlers');
    expect(html).not.toContain('llms.txt');
  });

  it('writes a real llms.txt from the page title and drops a comment-only snippet', () => {
    const named = renderToStaticMarkup(createElement(ActionableFixList, {
      domain: 'example.com',
      pageTitle: 'Example Domain',
      pageDescription: 'This domain is for use in examples.',
      findings: [{ id: 'llms-txt', title: 'The AI guide file (llms.txt) was missing or could not be read.' }],
    }));
    expect(named).toContain('# Example Domain');
    expect(named).toContain('This domain is for use in examples.');
    expect(named).toContain('https://example.com');
    expect(named).not.toContain('// Remediation for');
    expect(named).toContain('0 of 1 fixes done');

    const blank = renderToStaticMarkup(createElement(ActionableFixList, {
      domain: 'example.com',
      findings: [{
        id: 'llms-txt',
        title: 'The AI guide file (llms.txt) was missing.',
        remediationSnippet: '// Remediation for The AI guide file (llms.txt) was missing.\n// Apply to example.com',
      }],
    }));
    expect(blank).not.toContain('// Remediation for');
    expect(blank).not.toContain('<pre');
  });

  it('does not recommend passed crawler files on the scout summary', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'measured',
      citationRatePercent: 1,
      shareOfVoiceScore: 1,
      healthScore: 80,
      healthChecks: { passed: 3, total: 4 },
      scrapedPageCount: 1,
      serpCount: 2,
      findings: [{ title: 'Add Organization markup' }],
      hostedRail: 'signed_in_hosted',
      llmCrawler: { checks: passed },
    });
    const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary }));
    expect(html).toContain('llms.txt');
    expect(html).toContain('>pass<');
    expect(html).toContain('No starter fixes');
    expect(html).not.toContain('Allow AI crawlers');
    expect(html).not.toContain('Deploy /llms.txt');
  });
});

describe('remediation patches follow crawler status', () => {
  it('drafts llms.txt only when that check failed, and never a default robots patch', async () => {
    const passedMessages: string[] = [];
    const passedPatches = await remediationArchitectAgent.execute(
      'https://example.com',
      [],
      null,
      (event) => { passedMessages.push(event.message); },
      null,
      passed,
    );
    expect(passedPatches.map((patch) => patch.filename)).not.toContain('llms.txt');
    expect(passedPatches.some((patch) => patch.targetType === 'robots_txt' || /robots/i.test(patch.filename))).toBe(false);
    expect(passedMessages.join('\n')).not.toMatch(/production-ready|production-grade/i);

    const failed = await remediationArchitectAgent.execute(
      'https://example.com',
      [],
      null,
      () => {},
      null,
      [{ id: 'llms_txt', status: 'fail' }, { id: 'ai_bot_directives', status: 'fail' }],
    );
    expect(failed.map((patch) => patch.filename)).toContain('llms.txt');
    expect(failed.some((patch) => patch.targetType === 'robots_txt')).toBe(false);
    expect(failed.map((patch) => patch.explanation).join('\n')).toMatch(/Verify/);
  });
});
