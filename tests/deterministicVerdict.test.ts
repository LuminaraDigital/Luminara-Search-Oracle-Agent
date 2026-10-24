import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditReportArticle } from '../components/audit/AuditReportArticle';
import { CompetitorMap } from '../components/audit/CompetitorMap';
import { GuestScoutSummaryPanel } from '../components/audit/GuestScoutSummaryPanel';
import { ReportDisplay } from '../components/audit/ReportDisplay';
import { citationView, mentionCounts, mentionLabel, quotedQuery, radarRowCaption, renderedRadarRows, verdictCitationLine, VisibilityRadar } from '../components/audit/VisibilityRadar';
import type { BoardFinding } from '../services/audit/findingBoardService';
import { buildGuestScoutSummary, unmeasuredScoutSummary } from '../services/audit/guestScoutSummary';
import { alignPlainVerdict, auditSubjectLead, groundCustomerReport, parseAuditReport, plainVerdictText } from '../services/audit/reportBlocks';
import { MindshareRadarCard } from '../components/visibility/MindshareRadarCard';
import { playbookContext, selectAuditPlaybooks } from '../services/skills/seoPlaybooks';
import { trimToBudget } from '../worker/workersAiFallback';
import { gateReportText, mentionSentenceOk, proseIssues, REPORT_TABLES } from '../services/audit/reportColumnGate';

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

const LIVE_260_CONTRADICTION = 'Example Domain has limited visibility in web searches, with no direct mentions of the brand.';
const LIVE_260_CITATION = 'The brand is mentioned in 7 of 9 web results.';
const QUOTED_QUERIES = [
  '"Example Domain" example.com',
  '"best Example Domain alternative reviews"',
  '"what is example.com"',
] as const;

function evidenceRow(query: string, competitors: string[] = []): {
  id: string;
  query: string;
  intent: 'informational' | 'commercial';
  targetDomain: string;
  brandCited: boolean;
  brandRank: number;
  citedUrl: null;
  snippet: string;
  competitorsCited: string[];
  citationConfidence: number;
  timestamp: number;
} {
  return {
    id: query,
    query,
    intent: query.includes('best') ? 'commercial' : 'informational',
    targetDomain: 'example.com',
    brandCited: true,
    brandRank: 1,
    citedUrl: null,
    snippet: 'Example Domain is named.',
    competitorsCited: competitors,
    citationConfidence: 1,
    timestamp: 1,
  };
}

describe('live runs 260 A and B', () => {
  const dumpA = readFileSync('tests/fixtures/report260a.txt', 'utf8');
  const dumpB = readFileSync('tests/fixtures/report260b.txt', 'utf8');

  it('keeps the live before strings in the captures', () => {
    expect(dumpA).toContain('""Example Domain" example.com"');
    expect(dumpA).toContain('""best Example Domain alternative reviews""');
    expect(dumpA).toContain('""what is example.com""');
    expect(dumpA).not.toContain('2. Plain verdict');
    expect(dumpA).not.toContain('7. Sources');
    expect(dumpB).toContain(LIVE_260_CONTRADICTION);
    expect(dumpB).toContain(LIVE_260_CITATION);
    expect(dumpB).toContain('"example domain"');
    expect(dumpB).toContain('Not Measured');
    expect(dumpB).not.toContain('2. Plain verdict');
    expect(dumpB).not.toContain('7. Sources');
  });

  it('strips a wrapping quote pair and keeps quotes that belong inside the query', () => {
    expect(quotedQuery('"Example Domain" example.com')).toBe('"Example Domain" example.com');
    expect(quotedQuery('""Example Domain" example.com"')).toBe('"Example Domain" example.com');
    expect(quotedQuery('"best Example Domain alternative reviews"')).toBe('"best Example Domain alternative reviews"');
    expect(quotedQuery('""best Example Domain alternative reviews""')).toBe('"best Example Domain alternative reviews"');
    expect(quotedQuery('"what is example.com"')).toBe('"what is example.com"');
    expect(quotedQuery('what is example.com')).toBe('"what is example.com"');
    const radar = renderToStaticMarkup(createElement(VisibilityRadar, {
      headers: [...REPORT_TABLES.visibilityRadar],
      rows: QUOTED_QUERIES.map((query) => [query, 'informational', 'Yes', 'None', 'Cited']),
    }));
    expect(radar).toContain('&quot;Example Domain&quot; example.com');
    expect(radar).not.toContain('&quot;&quot;');
    expect(radar).toContain('&quot;best Example Domain alternative reviews&quot;');
    expect(radar).toContain('&quot;what is example.com&quot;');
  });

  it('drops a model sentence that contradicts the mention count', () => {
    expect(mentionSentenceOk(LIVE_260_CONTRADICTION, 7)).toBe(false);
    expect(mentionSentenceOk('The brand is mentioned across the web.', 0)).toBe(false);
    expect(mentionSentenceOk('These gaps can lower trust and citation odds.', 7)).toBe(true);
    expect(mentionSentenceOk('These gaps can lower trust and citation odds.', 0)).toBe(true);
    expect(mentionSentenceOk(LIVE_260_CONTRADICTION, null)).toBe(true);
    const after = plainVerdictText(findings, LIVE_260_CONTRADICTION, {
      scope: { domain: 'example.com', brand: 'Example Domain' },
      citationLine: `${LIVE_260_CITATION}`,
    });
    expect(after).toBe(`${TEMPLATE} ${LIVE_260_CITATION}`);
    expect(after).not.toContain('limited visibility');
    expect(after).not.toContain('no direct mentions');
    const none = plainVerdictText(findings, 'Example Domain is mentioned across the open web.', {
      scope: { domain: 'example.com', brand: 'Example Domain' },
      citationLine: 'The brand is mentioned in 0 of 9 web results.',
    });
    expect(none).not.toContain('mentioned across');
    expect(none).toContain('mentioned in 0 of 9 web results');
    expect(proseIssues(after)).toEqual([]);
  });

  it('builds Who gets named from the grounded radar rows and prints Not measured', () => {
    const evidence = [
      evidenceRow('"Example Domain" example.com', ['iana.org', 'Wikipedia']),
      evidenceRow('"best Example Domain alternative reviews"', ['iana.org', 'Stack Overflow']),
      evidenceRow('"what is example.com"', ['Wikipedia', 'PacketPushers']),
    ];
    const raw = [
      '# Example',
      '',
      '## 1. One move this week',
      '',
      'Add a business identity tag.',
      '',
      '## 2. Plain verdict',
      '',
      LIVE_260_CONTRADICTION,
      '',
      '## 3. Fix list',
      '',
      '| Task | Plain issue | Priority |',
      '| --- | --- | --- |',
      '| Add a business identity tag | A business identity tag is missing | Critical |',
      '',
      '## 4. Visibility radar',
      '',
      '| Query | Intent | Brand Cited (Yes/No) | Key Competitors | Citation Status (Cited/Not Cited/Not Measured) |',
      '| --- | --- | --- | --- | --- |',
      '| SEO methodology | informational | Not measured | None | Not measured |',
      '',
      '## 5. Competitor map',
      '',
      '| Entity | AI Perception (Tone/Claims) | Top Cited Page Types | Content Advantage (vs You) |',
      '| --- | --- | --- | --- |',
      '| Example Domain | Not Measured | Not Measured | Not Measured |',
      '',
      '## 6. Budget notes',
      '',
      'Budget impact: Not measured without client ad spend or conversion data.',
      '',
      'Answered by a fallback model: @cf/meta/llama-3.1-8b-instruct-fast',
    ].join('\n');
    const facts = {
      domain: 'example.com',
      brand: 'Example Domain',
      findings,
      evidence,
      citationLine: LIVE_260_CITATION,
      auditedAt: Date.parse('2026-10-24T13:24:00Z'),
    };
    const rows = renderedRadarRows(raw, facts);
    expect(rows.map((row) => row.query)).toEqual([...QUOTED_QUERIES]);
    expect(rows.every((row) => row.status === 'cited')).toBe(true);
    const named = renderToStaticMarkup(createElement(MindshareRadarCard, {
      domain: 'example.com',
      evidence,
      radarRows: rows,
    }));
    expect(named).toContain('Who gets named');
    expect(named).toContain('&quot;Example Domain&quot; example.com');
    expect(named).toContain('&quot;best Example Domain alternative reviews&quot;');
    expect(named).toContain('&quot;what is example.com&quot;');
    expect(named).not.toContain('example domain');
    expect(named).not.toContain('&quot;&quot;');
    expect(named).toContain('Cited');
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown: raw,
      measured: true,
      findings,
      domain: 'example.com',
      clientName: 'Example Domain',
      citationEvidence: evidence,
      citationLine: LIVE_260_CITATION,
      auditedAt: Date.parse('2026-10-24T13:24:00Z'),
      sources: [
        { uri: 'https://example.com', title: 'example.com' },
        { uri: 'https://en.wikipedia.org/wiki/Example.com', title: 'example.com - Wikipedia' },
      ],
      showActions: false,
    }));
    const nav = ['1. One move this week', '2. Plain verdict', '3. Fix list', '4. Visibility radar', '5. Competitor map', '6. Budget notes', '7. Sources'];
    let at = -1;
    for (const title of nav) {
      const next = html.indexOf(title, at + 1);
      expect(next, title).toBeGreaterThan(at);
      at = next;
    }
    expect(html).toContain('2. Plain verdict');
    expect(html).toContain('7. Sources');
    expect(html).not.toContain('>Sources<');
    expect(html).toContain(`${TEMPLATE} ${LIVE_260_CITATION}`);
    expect(html).not.toContain('limited visibility');
    expect(html).not.toContain('no direct mentions');
    expect(html).not.toContain('&quot;&quot;');
    expect(html).toContain('&quot;Example Domain&quot; example.com');
    expect(html).toContain('&quot;what is example.com&quot;');
    expect(html).not.toContain('Not Measured');
    expect(html).toContain('Not measured');
    expect(html).toContain('https://example.com example.com (page read)');
    expect((html.match(/example\.com - Wikipedia/g) || []).length).toBe(1);
    const map = renderToStaticMarkup(createElement(CompetitorMap, {
      headers: [...REPORT_TABLES.competitorMap],
      rows: [['Example Domain', 'Not Measured', 'Not Measured', 'Not Measured']],
    }));
    expect(map).not.toContain('Not Measured');
    expect(map).toContain('Not measured');
  });
});
