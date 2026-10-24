import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditReportArticle } from '../components/audit/AuditReportArticle';
import { CompetitorMap } from '../components/audit/CompetitorMap';
import { GuestScoutSummaryPanel } from '../components/audit/GuestScoutSummaryPanel';
import { ReportDisplay } from '../components/audit/ReportDisplay';
import type { BoardFinding } from '../services/audit/findingBoardService';
import { buildGuestScoutSummary, unmeasuredScoutSummary } from '../services/audit/guestScoutSummary';
import { alignPlainVerdict, auditSubjectLead, groundCustomerReport, parseAuditReport, plainVerdictText } from '../services/audit/reportBlocks';
import { radarRowCaption, verdictCitationLine } from '../components/audit/VisibilityRadar';
import { playbookContext, selectAuditPlaybooks } from '../services/skills/seoPlaybooks';
import { trimToBudget } from '../worker/workersAiFallback';
import { gateReportText, proseIssues, REPORT_TABLES } from '../services/audit/reportColumnGate';
import { citationView, mentionCounts, mentionLabel } from '../components/audit/VisibilityRadar';

const LIVE_258 = 'The page is reachable over HTTPS but lacks HSTS and CSP, which lowers security trust. no business identity tag is present, so entity signals are weak. Brand appears in web-search snippets, giving a baseline citation chance.';
const LIVE_257 = 'The page is very short and has no business identity tag, so search engines see little value. Security headers and a basic Add a business identity tag are missing, which can lower trust and citation odds. Fixing these gaps this week will reduce visibility risk.';
const LIVE_256 = 'The site is reachable but shows very thin content and no structured data.Security headers (HSTS, CSP) and a public security contact file are missing.These gaps lower the odds that AI systems will cite the brand in answers.';
const LIVE_253 = 'The homepage is very thin (133 words) and lacks any schema.Security headers (HSTS, CSP) and a public a public security contact file (security.txt) file are missing, which hurts trust.Search-sample shows the brand is cited in all three tested queries, but without structured data the citation signal is weak and could be lost as the site grows.';

const TEMPLATE = 'The page is reachable. A business identity tag is missing. This page is too short. These gaps can lower trust and citation odds.';

function finding(partial: Partial<BoardFinding> & Pick<BoardFinding, 'id' | 'title'>): BoardFinding {
  return {
    domain: 'example.com',
    stableKey: partial.id,
    category: 'schema',
    severity: 'high',
    description: 'Tags on the page: none.',
    status: 'open',
    ...partial,
  };
}

const findings = [
  finding({ id: 'finding-schema-org', title: 'Add a business identity tag on https://example.com', severity: 'critical' }),
  finding({ id: 'finding-thin-content', title: 'This page is too short', description: 'https://example.com (133 words) has fewer than 250 words.' }),
];

function report(verdict: string, fixRows: string): string {
  return [
    '# Example',
    '',
    '## 1. One move this week',
    '',
    'Add an HTTP Strict-Transport-Security header so browsers always load the HTTPS version.',
    '',
    '## 2. Plain verdict',
    '',
    verdict,
    '',
    '## 3. Fix list',
    '',
    '| Task | Plain issue | Priority |',
    '| --- | --- | --- |',
    fixRows,
    '',
    '## AI & Search Visibility Radar',
    '| Query | Intent | Brand Cited (Yes/No) | Key Competitors | Citation Status (Cited/Not Cited/Not Measured) |',
    '| --- | --- | --- | --- | --- |',
    '| Example Domain | informational | Yes | None | Cited |',
    '| best Example Domain alternative reviews | commercial | Yes | None | Cited |',
    '| what is example.com | informational | Yes | None | Cited |',
    '',
    '## Competitor Reality Map',
    '| Entity | AI Perception (Tone/Claims) | Top Cited Page Types | Content Advantage (vs You) |',
    '| --- | --- | --- | --- | --- |',
    '| example.com | Not measured | Not measured | Not measured |',
    '| - | - | - | - |',
    '',
    '## 6. Budget notes',
    '',
    'Budget impact: Not measured without client ad spend or conversion data',
  ].join('\n');
}

function verdictText(markdown: string): string {
  const doc = parseAuditReport(alignPlainVerdict(markdown, findings));
  const section = doc.sections.find((item) => /plain verdict/i.test(item.title));
  return section?.blocks.filter((block) => block.kind === 'paragraph').map((block) => block.kind === 'paragraph' ? block.text : '').join(' ') || '';
}

describe('deterministic plain verdict', () => {
  it('builds the live #258 verdict from the failed checks and drops the model sentences that fail the check', () => {
    const before = LIVE_258;
    const after = plainVerdictText(findings, before);
    expect(after).toBe(TEMPLATE);
    expect(after).not.toContain('Brand appears');
    expect(after).not.toContain('lacks HSTS');
    expect(after).not.toContain('entity signals');
    expect(after).not.toMatch(/\.\s+no\b/);
    expect(proseIssues(after)).toEqual([]);
    expect(gateReportText(after)).toBe(after);
  });

  it('replays each live verdict, fix line, one move, and budget line through the report', () => {
    const cases = [
      { name: '258', verdict: LIVE_258, fixes: '| Make browsers always use the secure version of your site (HSTS) | Site does not force secure HTTPS connections | High |' },
      { name: '257', verdict: LIVE_257, fixes: '| Publish aa public security contact file (security.txt)file | No public security contact | High |' },
      { name: '256', verdict: LIVE_256, fixes: '| Add a business identity tag markup | No entity data | Medium |' },
      { name: '253', verdict: LIVE_253, fixes: '| Publish a public a public security contact file (security.txt) file | No public contact | Critical |' },
    ];
    for (const item of cases) {
      const raw = report(item.verdict, item.fixes);
      const shown = verdictText(raw);
      expect(shown, item.name).toContain(TEMPLATE);
      expect(shown, item.name).not.toContain('lacks HSTS');
      expect(shown, item.name).not.toContain('entity signals');
      expect(shown, item.name).not.toContain('(security.txt)file');
      expect(shown, item.name).not.toContain('a public a public');
      expect(proseIssues(shown), item.name).toEqual([]);
      expect(gateReportText(shown), item.name).toBe(shown);
      const html = renderToStaticMarkup(createElement(AuditReportArticle, {
        markdown: raw,
        measured: true,
        findings,
        domain: 'example.com',
        clientName: 'Example',
        showActions: false,
      }));
      expect(html, item.name).toContain('Add a business identity tag.');
      expect(html, item.name).toContain('How to know it worked: the page source includes a business identity tag that names the organization.');
      expect(html, item.name).toContain('Write fuller answers on thin pages');
      expect(html, item.name).toContain('No rivals found in this search sample.');
      expect(html, item.name).toContain('cited in 3 of 3 queries');
      expect(html, item.name).not.toContain('Strict-Transport-Security');
      expect(html, item.name).not.toMatch(/\.\s+no\b/);
      const scrubbed = gateReportText(item.verdict);
      expect(gateReportText(scrubbed), item.name).toBe(scrubbed);
      expect(proseIssues(scrubbed).filter((issue) => issue.startsWith('bare')), item.name).toEqual([]);
      expect(scrubbed, item.name).not.toMatch(/\.\s+no\b/);
    }
  });

  it('glosses bare HSTS and CSP and capitalises the live sentence without dropping its first word', () => {
    const once = gateReportText(LIVE_258);
    expect(once).toContain("doesn't force the secure version of the site (HSTS)");
    expect(once).toContain("doesn't control which scripts can load (CSP)");
    expect(once).toContain('No business identity tag is present');
    expect(once.startsWith('The page')).toBe(true);
    expect(once).not.toContain('lacks HSTS');
    expect(proseIssues(once).filter((issue) => issue === 'lowercase start' || issue === 'lowercase sentence' || issue.startsWith('bare'))).toEqual([]);
  });
});

describe('mention counts share one function', () => {
  it('labels 3 of 3 radar rows as queries and 7 of 9 search rows as web results', () => {
    const counts = mentionCounts({
      radarRows: [{ status: 'cited' }, { status: 'cited' }, { status: 'cited' }],
      webResultsMentioned: 7,
      webResultsTotal: 9,
    });
    expect(counts.queries && mentionLabel(counts.queries, 'queries')).toBe('mentioned in 3 of 3 queries');
    expect(counts.webResults && mentionLabel(counts.webResults, 'web results')).toBe('mentioned in 7 of 9 web results');
    const markdown = report(LIVE_258, '| Add a business identity tag | None | High |');
    const summary = {
      targetDomain: 'example.com',
      brandName: 'Example',
      totalQueriesTested: 2,
      queriesCitedCount: 2,
      citationRatePercent: null,
      topCitedCompetitor: null,
      evidenceList: [
        { id: 'a', query: 'Example Domain', intent: 'informational', targetDomain: 'example.com', brandCited: true, brandRank: 1, citedUrl: null, snippet: '', competitorsCited: [], citationConfidence: 1, timestamp: 1 },
        { id: 'b', query: 'what is example.com', intent: 'informational', targetDomain: 'example.com', brandCited: true, brandRank: 1, citedUrl: null, snippet: '', competitorsCited: [], citationConfidence: 1, timestamp: 1 },
      ],
      entityClarityScore: null,
      lastAudited: 1,
      measurementStatus: 'measured',
      webResultsMentioned: 7,
      webResultsTotal: 9,
    };
    const view = citationView(gateReportText(markdown), summary);
    expect(view.label).toBe('mentioned in 7 of 9 web results');
    const html = renderToStaticMarkup(createElement(ReportDisplay, { markdownText: markdown, empiricalSummary: summary }));
    expect(html).toContain('Preview evidence (mentioned in 7 of 9 web results)');
    expect(html).toContain('cited in 3 of 3 queries');
    expect(html).not.toContain('2 of 2');
    expect(html).not.toContain('sampled queries');
  });
});

describe('summary card and empty rivals', () => {
  it('renders the summary card when the brief is missing, with Not measured for the empty fields', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'measured',
      citationRatePercent: null,
      shareOfVoiceScore: null,
      healthScore: null,
      scrapedPageCount: 1,
      serpCount: 0,
      findings: [],
      hostedRail: 'signed_in_hosted',
    });
    const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary }));
    for (const label of ['What This Means', 'Citation rate', 'Page health', 'What AI tools can read']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Not measured');
    const fallback = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary: unmeasuredScoutSummary('example.com') }));
    for (const label of ['What This Means', 'Citation rate', 'Page health', 'What AI tools can read', 'Not measured']) {
      expect(fallback).toContain(label);
    }
    const view = readFileSync('components/audit/InstantAuditView.tsx', 'utf8');
    expect(view).toContain('const summaryForCard = scoutSummary ?? (report ? unmeasuredScoutSummary(url) : null)');
    expect(view).toContain('summary={summaryForCard}');
  });

  it('hides a rival row of dashes and says none were found', () => {
    const html = renderToStaticMarkup(createElement(CompetitorMap, {
      headers: [...REPORT_TABLES.competitorMap],
      rows: [
        ['example.com', 'Not measured', 'Not measured', 'Not measured'],
        ['-', '-', '-', '-'],
      ],
    }));
    expect(html).toContain('example.com');
    expect(html).toContain('No rivals found in this search sample.');
    expect(html).not.toContain('>"-"<');
    expect(html).not.toContain('>-<');
  });
});

const LIVE_259A = 'The page is very thin and lacks any business identity tag. Security headers and a public security contact are missing. No AI-search citations are measured, so visibility is uncertain. Fixing security and adding basic business identity tag will reduce risk and improve AI citation odds.';
const LIVE_259B = 'SEO METHODOLOGY PLAYBOOKS appears to be a resource for SEO best practices, but its visibility in search results is limited. The website is not well-represented in search engine results, and its content is not easily discoverable.';

const RADAR_259A = [
  '| Query | Intent | Brand Cited (Yes/No) | Key Competitors | Citation Status (Cited/Not Cited/Not Measured) |',
  '| --- | --- | --- | --- | --- |',
  '| Example Domain | informational | Not measured | None | Not measured |',
  '| best Example Domain alternative reviews | commercial | Yes | None | Cited |',
  '| what is example.com | informational | Yes | None | Cited |',
].join('\n');

describe('live runs 259 A and B', () => {
  it('owns the #259 A verdict, the issue column, and the radar header', () => {
    const citation = verdictCitationLine({
      radarRows: [{ status: 'not_measured' }, { status: 'cited' }, { status: 'cited' }],
      webResultsMentioned: 8,
      webResultsTotal: 9,
    });
    expect(citation).toBe('The brand is mentioned in 8 of 9 web results.');
    expect(radarRowCaption([{ status: 'not_measured' }, { status: 'cited' }, { status: 'cited' }])).toBe('cited in 2 of 3 queries, 1 not measured');
    const shown = groundCustomerReport(
      ['# Example', '', '## 2. Plain verdict', '', LIVE_259A, '', '## 3. Fix list', '', '| Task | Plain issue | Priority |', '| --- | --- | --- |', '| Add a business identity tag | No entity markup for disambiguation (AI citation aid) | Medium |', '', '## AI & Search Visibility Radar', '', RADAR_259A].join('\n'),
      {
        domain: 'example.com',
        brand: 'Example Domain',
        findings,
        citationLine: citation,
        auditedAt: Date.parse('2026-10-24T13:24:00Z'),
      },
    );
    expect(shown).toContain('The page is reachable. A business identity tag is missing. This page is too short. These gaps can lower trust and citation odds.');
    expect(shown).toContain('The brand is mentioned in 8 of 9 web results.');
    expect(shown).not.toContain('No AI-search citations');
    expect(shown).not.toContain('adding basic business identity tag');
    expect(shown).toContain('| Add a business identity tag | A business identity tag is missing | Critical |');
    expect(shown).toContain('| Write fuller answers on thin pages | This page is too short | High |');
    expect(shown).not.toContain('disambiguation');
    expect(shown).toContain('Date:');
    expect(shown).toContain('25 Oct 2026');
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown: shown,
      measured: true,
      findings,
      domain: 'example.com',
      clientName: 'Example Domain',
      auditedAt: Date.parse('2026-10-24T13:24:00Z'),
      showActions: false,
    }));
    expect(html).toContain('cited in 2 of 3 queries, 1 not measured');
    expect(html).not.toContain('mentioned in 2 of 2');
    expect(proseIssues(shown.slice(shown.indexOf('The page is reachable')))).toEqual([]);
  });

  it('drops a fallback report about the methodology playbooks and keeps example.com', () => {
    const wrong = [
      '# Luminara: Web search check for SEO METHODOLOGY PLAYBOOKS',
      '',
      'Luminara · fog clearing complete · ship the one move',
      '',
      '**Date:** 24 Oct 2026 · **Mode:** Instant Audit',
      '',
      '## 1. One move this week',
      '',
      'Optimize the playbook.',
      '',
      '## 2. Plain verdict',
      '',
      LIVE_259B,
      '',
      '## 3. Fix list',
      '',
      '| Task | Plain issue | Priority |',
      '| --- | --- | --- |',
      '| Optimize meta title and description | Limited search engine visibility | High |',
      '',
      '## 4. Visibility radar',
      '',
      '| Query | Intent | Brand Cited (Yes/No) | Key Competitors | Citation Status (Cited/Not Cited/Not Measured) |',
      '| --- | --- | --- | --- | --- |',
      '| SEO methodology | informational | Not measured | None | Not measured |',
      '| SEO best practices | informational | Not measured | None | Not measured |',
      '',
      '## 7. Sources',
      '',
      'No live sources. All unmeasured signals labeled accordingly.',
      '',
      'Answered by a fallback model: @cf/meta/llama-3.1-8b-instruct-fast',
    ].join('\n');
    const shown = groundCustomerReport(wrong, {
      domain: 'example.com',
      brand: 'Example Domain',
      findings,
      evidence: [
        { query: 'best Example Domain alternative reviews', intent: 'commercial', brandCited: true },
        { query: 'what is example.com', intent: 'informational', brandCited: true },
      ],
      citationLine: 'The brand is mentioned in 8 of 9 web results.',
      auditedAt: Date.parse('2026-10-24T13:24:00Z'),
    });
    expect(shown).toContain('Luminara: Web search check for example.com');
    expect(shown).not.toContain('SEO METHODOLOGY PLAYBOOKS');
    expect(shown).not.toContain('fog clearing');
    expect(shown).not.toContain('No live sources');
    expect(shown).not.toContain('SEO methodology');
    expect(shown).toContain('what is example.com');
    expect(shown).toContain('25 Oct 2026');
    expect(shown).toContain('The page is reachable.');
    expect(shown).toContain('Answered by a fallback model: @cf/meta/llama-3.1-8b-instruct-fast');
    expect(shown).not.toContain('24 Oct 2026');
  });

  it('keeps the audited URL when the fallback cuts the prompt to its budget', () => {
    const lead = auditSubjectLead('example.com', 'https://example.com');
    const prompt = `${lead}\n${playbookContext(selectAuditPlaybooks('AEO'), 4500)}\n${'Write the report for a different subject. '.repeat(300)}`;
    const cut = trimToBudget(prompt, 8000);
    expect(cut.startsWith(lead)).toBe(true);
    expect(cut).toContain('https://example.com');
    expect(cut).not.toContain('[SEO METHODOLOGY PLAYBOOKS]');
  });
});
