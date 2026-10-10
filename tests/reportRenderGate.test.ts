import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import MessageList, { chatMessageText } from '../components/MessageList';
import * as markdownUtils from '../utils/markdown';
import { CompetitorMap } from '../components/audit/CompetitorMap';
import { ReportDisplay } from '../components/audit/ReportDisplay';
import { VisibilityRadar, readBrandCited } from '../components/audit/VisibilityRadar';
import { writeShipCommitment } from '../services/audit/shipCommitmentService';
import { REPORT_TABLES } from '../services/audit/reportColumnGate';
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
    expect(html).toContain('Cited (2 of 5)');
    for (const text of ['Blended authority', 'Radar score', '25/100', '25%', '40%', '/100', 'not_measured']) {
      expect(html, text).not.toContain(text);
    }
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
    // Brand quoted and rivals have no column, so both read "Not measured"
    // (the rivals cell prints it twice: as text and as its hover title).
    expect((html.match(/Not measured/g) || []).length).toBe(3);
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
