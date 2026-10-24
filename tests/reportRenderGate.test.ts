import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import MessageList, { chatMessageText } from '../components/MessageList';
import * as markdownUtils from '../utils/markdown';
import { AgentMissionControl } from '../components/audit/AgentMissionControl';
import { CompetitorMap, competitorProgressFromReport, competitorProgressMessage, renderedCompetitorCounts } from '../components/audit/CompetitorMap';
import { ShipActionGate } from '../components/audit/ShipActionGate';
import { MindshareRadarCard } from '../components/visibility/MindshareRadarCard';
import { EmpiricalEvidenceDrawer } from '../components/audit/EmpiricalEvidenceDrawer';
import { ReportDisplay, sampledMentionsLabel } from '../components/audit/ReportDisplay';
import { VisibilityRadar, readBrandCited, readCitationStatus } from '../components/audit/VisibilityRadar';
import type { TrafficImpact } from '../services/analytics/trafficInsightsService';
import type { EmpiricalCitationSummary } from '../services/audit/empiricalCitationService';
import { writeShipCommitment } from '../services/audit/shipCommitmentService';
import { REMOVED_TABLE_NOTE, REPORT_TABLES } from '../services/audit/reportColumnGate';
import { generateGenUISystemPrompt } from '../services/genui/promptGenerator';
import { LUMINARA_GENUI_REGISTRY, gatedTableArgs } from '../services/genui/registry';
import { buildAuditDossierHtml } from '../services/reports/portableDossierService';
import { buildShareOfVoice } from '../services/visibility/shareOfVoiceService';
import type { Message } from '../types';

/** A report as the product wrote and stored it before the gate existed. */
const STORED_REPORT = [
  '# Luminara: Will AI mention Example?',
  '',
  '## 3. Fix list',
  '| Task | Plain issue | Expected Impact | Priority |',
  '|------|-------------|-----------------|----------|',
  '| Add Organization schema | AI cannot tell who you are | +40% citations | High |',
  '',
  '## AI & Search Visibility Radar',
  '| Query | Intent | Brand Cited (Yes/No) | Key Competitors | Est. Organic Rank | Rich Results | AI Overview Status | Citation Status (Cited/Not Cited/Not Measured) |',
  '|---|---|---|---|---|---|---|---|',
  '| what is example.com | informational | Yes | none measured | Position 3 | FAQ snippet | Active | Cited |',
  '',
  '## Competitor Reality Map',
  '| Entity | AI Perception (Tone/Claims) | Top Cited Page Types | Content Advantage (vs You) | Trust Signal Strength (Low/Med/High) |',
  '|---|---|---|---|---|',
  '| Example | Clear | Homepage | None | Medium-High |',
].join('\n');

/** What the first gate let through, and what the cards drew from it. */
const INVENTED = [
  'Expected Impact', '+40% citations', 'Organic rank', 'Est. Organic Rank', 'Position 3', 'Rich Results', 'FAQ snippet',
  'AI Overview Status', 'AI Overview active', 'AI engine status', 'Traditional SERP', 'Trust Signal Strength', 'Medium-High',
  'Radar score', 'Blended authority',
];

function expectNoInvented(html: string): void {
  for (const text of INVENTED) expect(html, text).not.toContain(text);
  expect(html).not.toMatch(/\d+\s*\/\s*100/);
}

function modelMessage(content: string): Message {
  return { id: 'm1', role: 'model', content } as Message;
}

describe('a stored report is gated where it is rendered', () => {
  it('the report screen, with the props the shared report view passes', () => {
    const html = renderToStaticMarkup(createElement(ReportDisplay, {
      markdownText: STORED_REPORT,
      targetDomain: 'example.com',
      hideAgencyActions: true,
    }));
    expectNoInvented(html);
    expect(html).toContain('what is example.com');
    expect(html).toContain('AI cannot tell who you are');
    expect(html).toContain('Citation status:');
  });

  it('the shared report view renders through the report screen', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components', 'audit', 'SharedReportView.tsx'), 'utf8');
    expect(src).toContain('<ReportDisplay');
    expect(src).toContain('markdownText={payload.markdownText}');
  });

  it('a chat audit sent to the report screen, once the report is unlocked', () => {
    writeShipCommitment('unknown', STORED_REPORT, { actionId: 'schema', label: 'Add Organization schema', committedAt: 1 });
    const html = renderToStaticMarkup(createElement(MessageList, { messages: [modelMessage(STORED_REPORT)] }));
    expect(html).toContain('what is example.com');
    expectNoInvented(html);
  });

  it('a chat audit written with the old chat template, shown as plain markdown', () => {
    const chatAudit = [
      '# Luminara: Will AI mention Example?',
      '',
      '## 4. Visibility radar',
      '| Query | Intent | Brand cited | Competitors | Organic rank | AI Overview | Status |',
      '|-------|--------|-------------|-------------|--------------|-------------|--------|',
      '| what is example.com | informational | Yes | none measured | Position 3 | Active | Cited |',
      '',
      '## 5. Competitor map',
      '| Brand | How AI talks about them | Pages that win citations | Trust signals |',
      '|-------|-------------------------|--------------------------|---------------|',
      '| Example | Clear | Homepage | Medium-High |',
    ].join('\n');
    // The markdown renderer needs a browser to sanitize, so read the text it is handed.
    const render = vi.spyOn(markdownUtils, 'renderMarkdown');
    renderToStaticMarkup(createElement(MessageList, { messages: [modelMessage(chatAudit)] }));
    expect(render).toHaveBeenCalledTimes(1);
    const shown = String(render.mock.calls[0][0]);
    render.mockRestore();
    expect(shown).toContain('what is example.com');
    expect(shown).toContain('How AI talks about them');
    for (const text of ['Organic rank', 'AI Overview', 'Position 3', 'Trust signals', 'Medium-High']) {
      expect(shown, text).not.toContain(text);
    }
  });

  it('leaves a chat reply that is not an audit as written', () => {
    const reply = ['Here are the plans.', '', '| Plan | Price |', '|---|---|', '| Growth | 49 |'].join('\n');
    const render = vi.spyOn(markdownUtils, 'renderMarkdown');
    renderToStaticMarkup(createElement(MessageList, { messages: [modelMessage(reply)] }));
    expect(render).toHaveBeenCalledWith(reply);
    render.mockRestore();
  });

  it('gates the text a chat audit is copied or rewritten from, and never a user message', () => {
    const copied = chatMessageText({ role: 'model', content: STORED_REPORT });
    for (const text of ['Expected Impact', 'Est. Organic Rank', 'Position 3', 'Trust Signal Strength', 'Medium-High']) {
      expect(copied, text).not.toContain(text);
    }
    expect(copied).toContain('| what is example.com | informational | Yes | none measured | Cited |');
    expect(chatMessageText({ role: 'user', content: STORED_REPORT })).toBe(STORED_REPORT);
  });

  it('the dossier download', () => {
    const html = buildAuditDossierHtml({ domain: 'example.com', markdownText: STORED_REPORT, generatedAt: 1760000000000 });
    for (const text of ['Expected Impact', '+40% citations', 'Est. Organic Rank', 'Position 3', 'Rich Results', 'AI Overview Status', 'Trust Signal Strength', 'Medium-High']) {
      expect(html, text).not.toContain(text);
    }
    expect(html).toContain('what is example.com');
  });

  // Review 2, 4: a chat audit with no top heading used to show ungated.
  it('a chat audit that has a section heading and no top heading', () => {
    const reply = ['## Visibility radar', '| Query | Organic rank | Status |', '|---|---|---|', '| what is example.com | Position 3 | Cited |'].join('\n');
    const shown = chatMessageText({ role: 'model', content: reply });
    expect(shown).toContain('| what is example.com | Cited |');
    expect(shown).not.toContain('Organic rank');
    expect(shown).not.toContain('Position 3');
  });
});

describe('a page title with a pipe in it does not break the table or let a column through', () => {
  // "Home | Acme" is a common title tag, and the pipe is not escaped.
  const section = (headers: string, cells: string) => [
    '# Luminara: Will AI mention Example?',
    '',
    '## 3. Fix list',
    headers,
    headers.replace(/[^|]+/g, '---'),
    cells,
  ].join('\n');
  const tableCells = (html: string) =>
    [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1].replace(/<[^>]*>/g, '').replace(/&quot;/g, '"'));

  it('renders as a table, with the pipe in its cell, when the table has one free-text column', () => {
    const html = renderToStaticMarkup(createElement(ReportDisplay, {
      markdownText: section('| Task | Priority |', '| Rewrite the title "Home | Acme" | High |'),
      hideAgencyActions: true,
    }));
    expect(tableCells(html)).toEqual(['Rewrite the title "Home | Acme"', 'High']);
    expect((html.match(/<th[ >]/g) || []).length).toBe(2);
    // Not printed as raw pipe rows.
    expect(html).not.toContain('| Rewrite the title');
  });

  // Review 3, 3: with two free-text columns the pipe could belong to either, and
  // joining it into the last one put text under the wrong header.
  it('is left out, with the note, when the table has two free-text columns', () => {
    const html = renderToStaticMarkup(createElement(ReportDisplay, {
      markdownText: section('| Task | Plain issue | Priority |', '| Rewrite the title | It reads "Home | Acme" everywhere | High |'),
      hideAgencyActions: true,
    }));
    expect(html).toContain(REMOVED_TABLE_NOTE);
    expect(tableCells(html)).toEqual([]);
    expect(html).not.toContain('Rewrite the title');
  });

  it('is left out, with the note, when the table also has a column that is not listed', () => {
    const html = renderToStaticMarkup(createElement(ReportDisplay, {
      markdownText: section(
        '| Task | Expected Impact | Priority |',
        '| Rewrite the title "Home | Acme" | +40% citations | High |',
      ),
      hideAgencyActions: true,
    }));
    expect(html).toContain(REMOVED_TABLE_NOTE);
    for (const text of ['Expected Impact', '+40% citations', 'Rewrite the title']) {
      expect(html, text).not.toContain(text);
    }
  });
});

describe('measured traffic comes from the analytics data, never from the report text (review 3, 1)', () => {
  // The model writes every row of a table in the report. With analytics on, a row
  // such as "Est. organic rank | #3 | #7" used to stay under "This period (measured)".
  const report = [
    '# Luminara: Will AI mention Example?',
    '',
    '## 2. Plain verdict',
    '| Measured traffic | This period (measured) | Previous period (measured) |',
    '|---|---|---|',
    '| Visitors | 987 | 654 |',
    '| Est. organic rank | #3 | #7 |',
  ].join('\n');
  const metric = (current: number) => ({ current, previous: 100, changePct: null });
  const referrals = { total: 7, previousTotal: 4, changePct: null, bySource: [] };
  const ready = {
    status: 'ready',
    domain: 'example.com',
    period: { startAt: 1, endAt: 2, days: 30 },
    visitors: metric(432),
    pageviews: metric(555),
    visits: metric(444),
    aiAssistantReferrals: referrals,
    searchReferrals: referrals,
    topReferrers: [],
    topPages: [],
    fetchedAt: 1,
  } as unknown as TrafficImpact;

  it('leaves a model-written "measured" table out of the report screen, with analytics on or off', () => {
    for (const trafficImpact of [ready, undefined, { status: 'not_configured', domain: 'example.com' } as unknown as TrafficImpact]) {
      const html = renderToStaticMarkup(createElement(ReportDisplay, { markdownText: report, hideAgencyActions: true, trafficImpact }));
      expect(html).toContain(REMOVED_TABLE_NOTE);
      for (const text of ['This period (measured)', 'Est. organic rank', '#3', '#7', '987', '654']) {
        expect(html, text).not.toContain(text);
      }
    }
  });

  it('still draws the measured figures in the tracking card, from the analytics data', () => {
    const html = renderToStaticMarkup(createElement(ReportDisplay, { markdownText: report, hideAgencyActions: true, trafficImpact: ready }));
    expect(html).toContain('Is it working? Last 30 days');
    expect(html).toContain('Measured on your own site');
    expect(html).toContain('Visitors');
    expect(html).toMatch(/>432</);
  });

  it('leaves it out of the dossier too, and the dossier builder takes no list of measured columns', () => {
    const dossier = buildAuditDossierHtml({
      domain: 'example.com',
      markdownText: report,
      generatedAt: 1760000000000,
      measuredColumns: ['Measured traffic', 'This period (measured)', 'Previous period (measured)'],
    } as unknown as Parameters<typeof buildAuditDossierHtml>[0]);
    expect(dossier).toContain(REMOVED_TABLE_NOTE);
    for (const text of ['| Visitors | 987 | 654 |', 'Est. organic rank', '| #3 |', 'This period (measured)']) {
      expect(dossier, text).not.toContain(text);
    }
  });
});

describe('the evidence button gives the two counts, not a percentage (review 2, 7)', () => {
  const summary = {
    targetDomain: 'example.com',
    brandName: 'Example',
    totalQueriesTested: 3,
    queriesCitedCount: 2,
    citationRatePercent: 67,
    topCitedCompetitor: null,
    evidenceList: [
      { id: 'a', query: 'what is example', intent: 'informational', targetDomain: 'example.com', brandCited: true, brandRank: 1, citedUrl: null, snippet: '', competitorsCited: [], citationConfidence: 1, timestamp: 1 },
      { id: 'b', query: 'best example', intent: 'commercial', targetDomain: 'example.com', brandCited: true, brandRank: 2, citedUrl: null, snippet: '', competitorsCited: [], citationConfidence: 1, timestamp: 1 },
      { id: 'c', query: 'example vs other', intent: 'comparative', targetDomain: 'example.com', brandCited: false, brandRank: null, citedUrl: null, snippet: '', competitorsCited: [], citationConfidence: 1, timestamp: 1 },
    ],
    entityClarityScore: null,
    lastAudited: 1,
    measurementStatus: 'measured',
  } as EmpiricalCitationSummary;

  const radar = [
    '# Report',
    '',
    '## AI & Search Visibility Radar',
    '| Query | Intent | Brand Cited (Yes/No) | Key Competitors | Citation Status (Cited/Not Cited/Not Measured) |',
    '| --- | --- | --- | --- | --- |',
    '| what is example | informational | Not measured |  | Not measured |',
    '| best example | commercial | Not measured |  | Not measured |',
    '| example vs other | comparative | Not measured |  | Not measured |',
  ].join('\n');

  it('reads "mentioned in N of M queries" from the radar rows', () => {
    expect(sampledMentionsLabel(summary)).toBe('mentioned in 2 of 3 queries');
    const html = renderToStaticMarkup(createElement(ReportDisplay, { markdownText: radar, empiricalSummary: summary }));
    expect(html).toContain('Preview evidence (mentioned in 2 of 3 queries)');
    expect(html).toContain('mentioned in 2 of 3 queries');
    expect(html).toContain('>Cited<');
    expect(html).toContain('>Not cited<');
    expect(html).not.toContain('67%');
    expect(html).not.toMatch(/evidence \(\d+%\)/i);
  });

  it('does not claim mentions when the radar was not measured', () => {
    const html = renderToStaticMarkup(createElement(ReportDisplay, {
      markdownText: radar.replaceAll('what is example', 'unrelated query').replace('best example', 'another query').replace('example vs other', 'third query'),
      empiricalSummary: summary,
    }));
    expect(html).toContain('Preview evidence (not measured)');
    expect(html).toContain('Citation status:');
    expect(html).not.toContain('mentioned in 2 of 3');
  });

  it('uses the search-row count when that is the measurement the scout prints', () => {
    const counted = {
      ...summary,
      webResultsMentioned: 5,
      webResultsTotal: 9,
    };
    expect(sampledMentionsLabel(counted)).toBe('mentioned in 5 of 9 web results');
    const html = renderToStaticMarkup(createElement(ReportDisplay, { markdownText: radar, empiricalSummary: counted }));
    expect(html).toContain('Preview evidence (mentioned in 5 of 9 web results)');
    expect(html).toContain('cited in 2 of 3 queries');
    expect(html).not.toContain('mentioned in 3 of 3');
    expect(html).not.toContain('sampled queries');
  });

  it('says "not measured" when the summary holds no usable count', () => {
    for (const bad of [
      undefined,
      { ...summary, measurementStatus: 'not_measured' },
      { ...summary, evidenceList: [] },
      { ...summary, evidenceList: [], totalQueriesTested: 0 },
      { ...summary, evidenceList: [], queriesCitedCount: 5 },
    ] as Array<EmpiricalCitationSummary | undefined>) {
      expect(sampledMentionsLabel(bad)).toBeNull();
    }
    const html = renderToStaticMarkup(createElement(ReportDisplay, {
      markdownText: '# Report',
      empiricalSummary: { ...summary, totalQueriesTested: 0 },
    }));
    expect(html).toContain('Preview evidence (not measured)');
  });

  it('prints the counts in the evidence drawer', () => {
    const html = renderToStaticMarkup(createElement(EmpiricalEvidenceDrawer, { isOpen: true, onClose: () => {}, summary }));
    expect(html).toContain('Brand mentions');
    expect(html).toContain('2 of 3');
    expect(html).toContain('sampled queries whose results name the brand');
    expect(html).not.toContain('67%');
    expect(html).not.toContain('Citation Rate');
  });
});

describe('the visibility card shows what the table says and no score', () => {
  const headers = [...REPORT_TABLES.visibilityRadar];

  it('prints "Not measured" for a cell that gives no reading', () => {
    for (const cell of ['not measured', 'Not verified', '', 'n/a', 'unknown']) {
      expect(readBrandCited(cell), cell).toBe('not_measured');
      const html = renderToStaticMarkup(createElement(VisibilityRadar, {
        headers,
        rows: [['what is example.com', 'informational', cell, '', '']],
      }));
      expect(html).toContain('Not measured');
      expect(html).not.toContain('Opportunity gap');
      expect(html).not.toContain('Cited (estimated)');
      expect(html).not.toContain('Traditional SERP');
      expect(html).not.toContain('>None<');
    }
    expect(readBrandCited('Yes')).toBe('yes');
    expect(readBrandCited('**No**')).toBe('no');
    expect(readBrandCited('Not cited')).toBe('no');
  });

  it('works out no score from the cells', () => {
    const html = renderToStaticMarkup(createElement(VisibilityRadar, {
      headers,
      rows: [
        ['q1', 'informational', 'Yes', 'Rival', 'Cited (2 of 5)'],
        ['q2', 'commercial', 'No', 'Rival', '40'],
      ],
    }));
    for (const text of ['Blended authority', 'Radar score', '25/100', '25%', '40%', '/100', 'not_measured', '(2 of 5)', '>40<']) {
      expect(html, text).not.toContain(text);
    }
  });

  // Review 2, 5: the status cell used to be printed as written.
  it('prints only the reading of the status cell, not what else the cell says', () => {
    expect(readCitationStatus('Cited, rank #3, AI Overview active')).toBe('cited');
    expect(readCitationStatus('**Not Cited** (rank 14)')).toBe('not_cited');
    for (const cell of ['Not Measured', 'not verified', '', 'Rank #3', 'Probably cited', '88/100']) {
      expect(readCitationStatus(cell), cell).toBe('not_measured');
    }
    const html = renderToStaticMarkup(createElement(VisibilityRadar, {
      headers,
      rows: [
        ['q1', 'informational', 'Yes', 'Rival', 'Cited, rank #3, AI Overview active'],
        ['q2', 'commercial', 'No', 'Rival', 'Not Cited (rank 14)'],
        ['q3', 'comparative', 'No', 'Rival', 'Rank #3'],
      ],
    }));
    for (const text of ['rank #3', 'Rank #3', 'AI Overview active', 'rank 14', '#3']) {
      expect(html, text).not.toContain(text);
    }
    expect(html).toMatch(/>Cited</);
    expect(html).toMatch(/>Not cited</);
    expect(html).toMatch(/>Not measured</);
  });

  it('does not read a cell under the wrong header when the table is missing a column', () => {
    // Only two of the five columns are left. The status must not show as the intent.
    const html = renderToStaticMarkup(createElement(VisibilityRadar, {
      headers: ['Query', 'Citation Status'],
      rows: [['what is example.com', 'Cited']],
    }));
    expect(html).toContain('what is example.com');
    expect((html.match(/Cited/g) || []).length).toBe(1);
    expect(html).not.toContain('General');
    // Status is Cited, so the search ran. An empty rival cell is None.
    // Brand quoted has no column, so that one stays Not measured.
    expect(html).toContain('>None<');
    expect((html.match(/Not measured/g) || []).length).toBe(1);
  });

  it('has no rank or AI Overview cell, whatever headers it is given', () => {
    const html = renderToStaticMarkup(createElement(VisibilityRadar, {
      headers: ['Query', 'Intent', 'Brand cited', 'Competitors', 'Organic rank', 'AI Overview', 'Status'],
      rows: [['q', 'informational', 'Yes', 'Rival', 'Position 3', 'Active', 'Cited']],
    }));
    for (const text of ['Organic rank', 'Position 3', 'AI engine status', 'AI Overview active', 'Traditional SERP']) {
      expect(html, text).not.toContain(text);
    }
    expect(html).toContain('Cited');
  });
});

describe('the competitor card fills no gap with made-up wording', () => {
  it('prints "Not measured" for a missing cell and has no trust signal block', () => {
    const html = renderToStaticMarkup(createElement(CompetitorMap, {
      headers: [...REPORT_TABLES.competitorMap, 'Trust Signal Strength (Low/Med/High)'],
      rows: [['Example', '', '', '', 'High'], ['Rival']],
    }));
    expect(html).toContain('Example');
    expect(html).toContain('Not measured');
    for (const text of ['Homepage, Case Studies', 'Case Studies', 'Neutral visibility', 'None identified', 'Market Entity', 'Trust Signal Strength']) {
      expect(html, text).not.toContain(text);
    }
    expect(html).not.toMatch(/>\s*(medium|high)\s*</i);
  });

  it('omits invented [[Competitor 1]] rows and keeps a named rival', () => {
    const html = renderToStaticMarkup(createElement(CompetitorMap, {
      headers: [...REPORT_TABLES.competitorMap],
      rows: [
        ['Luminara Digital', 'Agency', 'Homepage', 'Own site'],
        ['[[Competitor 1]]', 'Invented tone', 'Blog', 'Fake advantage'],
        ['Competitor 2', 'Also invented', 'Docs', 'None'],
      ],
    }));
    expect(html).toContain('Luminara Digital');
    expect(html).not.toContain('Competitor 1');
    expect(html).not.toContain('Competitor 2');
    expect(html).not.toContain('Invented tone');
  });

  it('shows a rival name without wiki brackets', () => {
    const html = renderToStaticMarkup(createElement(CompetitorMap, {
      headers: [...REPORT_TABLES.competitorMap],
      rows: [
        ['Example', 'Thin', 'Homepage', 'Own site'],
        ['[[IANA]]', 'Reference', 'Docs', 'Registry'],
        ['[[Wikipedia]]', 'Encyclopedia', 'Article', 'Coverage'],
      ],
    }));
    expect(html).toContain('IANA');
    expect(html).toContain('Wikipedia');
    expect(html).not.toContain('[[IANA]]');
    expect(html).not.toContain('[[Wikipedia]]');
    expect(html).not.toContain('[[');
  });

  it('gives the strategist card the same rival and gap counts the map draws', () => {
    const headers = [...REPORT_TABLES.competitorMap];
    const rows = [
      ['example.com', 'Not measured', 'Not measured', 'Not measured'],
      ['(no verified rivals in this niche)', 'Not measured', 'Not measured', 'Not measured'],
      ['iana.org', 'Registry', 'Docs', 'Not measured'],
      ['Wikipedia', 'Encyclopedia', 'Article', 'Coverage'],
    ];
    const map = renderToStaticMarkup(createElement(CompetitorMap, { headers, rows }));
    expect(map).toContain('iana.org');
    expect(map).toContain('Wikipedia');
    expect(map).not.toContain('no verified rivals');
    expect(renderedCompetitorCounts(headers, rows)).toEqual({ rivals: 2, gaps: 1 });

    const table = (body: string[][]) => [
      '## Competitor Reality Map',
      '',
      `| ${headers.join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...body.map((row) => `| ${row.join(' | ')} |`),
    ].join('\n');
    const counted = table(rows);
    expect(competitorProgressFromReport(counted)).toBe('Identified 2 key competitors and mapped 1 keyword gap.');
    expect(renderedCompetitorCounts(headers, rows)).toEqual({ rivals: 2, gaps: 1 });
    const noneRows = [
      ['example.com', 'Not measured', 'Not measured', 'Not measured'],
      ['(no verified rivals in this niche)', 'Not measured', 'Not measured', 'Not measured'],
    ];
    const none = table(noneRows);
    const fallbackNone = none.replace('## Competitor Reality Map', '## 5. Competitor map');
    expect(competitorProgressFromReport(none)).toBe('No competitors found in this search sample.');
    expect(competitorProgressFromReport(fallbackNone)).toBe(competitorProgressMessage(0, 0));
    expect(renderedCompetitorCounts(headers, noneRows)).toEqual({ rivals: 0, gaps: 0 });

    const card = (markdown: string) => renderToStaticMarkup(createElement(AgentMissionControl, {
      events: [{
        id: 'c',
        timestamp: 1,
        agentRole: 'competitor_strategist',
        agentName: 'Competitor Strategist',
        phase: 'strategy_complete',
        message: 'Identified 4 key competitors and mapped 2 keyword gaps.',
        status: 'completed',
      }],
      isComplete: true,
      measurementStatus: 'measured',
      reportMarkdown: markdown,
    }));
    const withRivals = card(counted);
    expect(withRivals).toContain('Identified 2 key competitors and mapped 1 keyword gap.');
    expect(withRivals).not.toContain('4 key competitors');
    expect(withRivals).not.toContain('2 keyword gaps');
    const withNone = card(none);
    expect(withNone).toContain('No competitors found in this search sample.');
    expect(withNone).not.toContain('4 key competitors');
    expect(withNone).not.toContain('keyword gap');
    expect(card(fallbackNone)).toContain('No competitors found in this search sample.');
    expect(withRivals).not.toContain('No competitors found');

    const featureEvidence = {
      id: 'f',
      query: 'what is example.com',
      intent: 'informational' as const,
      targetDomain: 'example.com',
      brandCited: true,
      brandRank: 1,
      citedUrl: 'https://example.com',
      snippet: 'The page lists feature and API benchmarks.',
      competitorsCited: [] as string[],
      citationConfidence: 80,
      timestamp: 1,
    };
    const named = (markdown: string) => renderToStaticMarkup(createElement(MindshareRadarCard, {
      domain: 'example.com',
      evidence: [featureEvidence],
      radarRows: [{ query: 'what is example.com', competitors: 'packetpushers.net', status: 'cited' }],
      reportMarkdown: markdown,
    }));
    const ship = (markdown: string) => renderToStaticMarkup(createElement(ShipActionGate, {
      domain: 'example.com',
      markdownText: markdown,
      hasEvidence: true,
      sourceCount: 4,
      onCommitted: () => undefined,
    }));
    for (const markdown of [none, fallbackNone]) {
      const who = named(markdown);
      const next = ship(markdown);
      expect(who).toContain('No competitors found in this search sample.');
      expect(who).not.toContain('feature parity');
      expect(who).not.toContain('Clear feature parity');
      expect(who).not.toContain('Key Citation Driver');
      expect(who).not.toContain('packetpushers.net');
      expect(who).not.toContain('Rivals named');
      expect(next).not.toContain('Close one citation gap');
      expect(next).not.toContain('rivals already win');
      expect(who).not.toContain('\u2014');
      expect(next).not.toContain('\u2014');
    }
    expect(named(counted)).toContain('feature parity');
    expect(named(counted)).toContain('packetpushers.net');
    expect(ship(counted)).toContain('Close one citation gap');
    expect(ship(counted)).toContain('rivals already win');
  });
});

describe('the chat cards take the same columns as the report', () => {
  it('uses the report columns as the default headers', () => {
    const radar = gatedTableArgs([[['q', 'informational', 'Yes', 'Rival', 'Cited']]], [...REPORT_TABLES.visibilityRadar]);
    expect(radar.headers).toEqual([...REPORT_TABLES.visibilityRadar]);
    expect(radar.rows).toEqual([['q', 'informational', 'Yes', 'Rival', 'Cited']]);
  });

  it('drops a column the model adds and a row it cannot line up', () => {
    const args = [
      [
        ['q1', 'informational', 'Yes', 'Rival', 'Position 3', 'Active', 'Cited'],
        ['q2', 'Yes', 90],
      ],
      ['Query', 'Intent', 'Brand cited', 'Competitors', 'Organic rank', 'AI Overview', 'Status'],
    ];
    const gated = gatedTableArgs(args, [...REPORT_TABLES.visibilityRadar]);
    expect(gated.headers).toEqual(['Query', 'Intent', 'Brand cited', 'Competitors', 'Status']);
    expect(gated.rows).toEqual([['q1', 'informational', 'Yes', 'Rival', 'Cited']]);

    const adapted = (LUMINARA_GENUI_REGISTRY.VisibilityRadar as { adapter: (node: unknown, args: unknown[]) => unknown })
      .adapter({}, args);
    expect(adapted).toEqual(gated);
  });

  it('takes share of voice numbers only from the code that counted them', () => {
    const adapter = (LUMINARA_GENUI_REGISTRY.ShareOfVoiceCard as {
      adapter: (node: unknown, args: unknown[]) => { summary: unknown };
    }).adapter;

    // What a chat model can write: a name with percentages, or a whole summary object.
    expect(adapter({}, ['Example', [['Example', 65], ['Rival', 35]]]).summary).toBeNull();
    expect(adapter({}, [{
      targetDomain: 'example.com',
      brandName: 'Example',
      measuredAt: 1,
      totalPrompts: 3,
      slices: [{ label: 'Example', kind: 'brand', mentionCount: 3 }],
      method: 'observed',
    }]).summary).toBeNull();

    const counted = buildShareOfVoice({
      targetDomain: 'example.com',
      brandName: 'Example',
      totalQueriesTested: 1,
      queriesCitedCount: 1,
      citationRatePercent: 100,
      topCitedCompetitor: null,
      entityClarityScore: null,
      lastAudited: 1,
      evidenceList: [{
        id: '1', query: 'what is example', intent: 'informational', targetDomain: 'example.com', brandCited: true,
        brandRank: 1, citedUrl: 'https://example.com', snippet: 'Example', competitorsCited: [], citationConfidence: 90, timestamp: 1,
      }],
    });
    expect(adapter({}, [counted]).summary).toBe(counted);
    // A copy of a counted summary is not the counted summary.
    expect(adapter({}, [JSON.parse(JSON.stringify(counted))]).summary).toBeNull();
  });

  it('does not offer the share of voice card to the model', () => {
    expect(generateGenUISystemPrompt()).not.toContain('ShareOfVoiceCard');
  });
});
