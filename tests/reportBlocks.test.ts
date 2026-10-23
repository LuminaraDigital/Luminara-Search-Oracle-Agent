import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditReportArticle } from '../components/audit/AuditReportArticle';
import type { BoardFinding } from '../services/audit/findingBoardService';
import { FINDINGS_BOARD_KEY, listLocalFindings, setFindingStatusLocal } from '../services/audit/findingBoardService';
import {
  fixProgress,
  parseAuditReport,
  progressSince,
  recheckLabel,
  scoreLine,
  stripUnsupportedFixClaims,
  withReportLead,
} from '../services/audit/reportBlocks';
import { formatAuDate } from '../utils/formatAuDate';

const SAMPLE = `# Ray White

The site checks were not measured.

## What to fix

- Add the agency name
- Keep the phone number

### Detail

A [suburb page](https://raywhite.com.au/richmond) helps.

\`\`\`json
{ "name": "Ray White" }
\`\`\`

| Check | Result |
| --- | --- |
| Homepage | Not measured |

**Not measured** stays visible.
`;

function finding(partial: Partial<BoardFinding> & Pick<BoardFinding, 'id' | 'title'>): BoardFinding {
  return {
    domain: 'raywhite.com.au',
    stableKey: partial.id,
    category: 'content_quality',
    severity: 'high',
    description: 'The homepage title does not name the agency.',
    status: 'open',
    evidence: { howWeKnowItFailed: 'The fetched title did not include the agency name.' },
    ...partial,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('audit report markdown', () => {
  it('maps headings, lists, code, tables, and links, and drops the markers', () => {
    const doc = parseAuditReport(SAMPLE);
    expect(doc.title).toBe('Ray White');
    expect(doc.verdict).toBe('The site checks were not measured.');
    expect(doc.sections.map((section) => section.title)).toEqual(['Ray White', 'What to fix']);
    const fix = doc.sections[1];
    const list = fix.blocks.find((block) => block.kind === 'list');
    expect(list && list.kind === 'list' ? list.items.map((item) => item.map((part) => part.text).join('')) : []).toEqual([
      'Add the agency name',
      'Keep the phone number',
    ]);
    const code = fix.blocks.find((block) => block.kind === 'code');
    expect(code && code.kind === 'code' ? code.text : '').toContain('{ "name": "Ray White" }');
    const table = fix.blocks.find((block) => block.kind === 'table');
    expect(table && table.kind === 'table' ? table.rows : []).toEqual([['Homepage', 'Not measured']]);
    expect(doc.links).toEqual([{ text: 'suburb page', href: 'https://raywhite.com.au/richmond' }]);
    expect(JSON.stringify(doc)).not.toContain('**');
    expect(JSON.stringify(doc)).not.toContain('```');
  });

  it('keeps reading malformed markdown and does not invent a score', () => {
    const doc = parseAuditReport('## Broken\n\n**oops\n\n| only one\n');
    expect(doc.sections[0].title).toBe('Broken');
    expect(doc.verdict).toContain('oops');
    expect(doc.verdict).not.toContain('**');
    expect(() => parseAuditReport('```\nnever closed')).not.toThrow();
    expect(parseAuditReport('```\nnever closed').sections.some((section) => section.blocks.some((block) => block.kind === 'code' && block.text.includes('never closed')))).toBe(true);

    expect(scoreLine('passed 3 of 4 checks', false)).toBe('Not measured');
    expect(scoreLine('passed 3 of 4 checks', true)).toBe('Passed 3 of 4 checks');
    expect(scoreLine('passed 2 of 4; 1 not measured', false)).toBe('Passed 2 of 4; 1 not measured');
    expect(scoreLine('passed 4 of 4; 0 not measured', true)).toBe('Passed 4 of 4; 0 not measured');
    expect(scoreLine('passed 4 of 4; 0 not measured', false)).toBe('Not measured');
    expect(scoreLine('Health Score: 90', true)).toBe('Not measured');
    expect(scoreLine('passed 9 of 4 checks', true)).toBe('Not measured');
  });

  it('dates the recheck 14 days ahead and only shows a saved health change', () => {
    const from = new Date(2026, 0, 8).getTime();
    expect(recheckLabel(from)).toBe(`Recheck on ${formatAuDate(new Date(2026, 0, 22))}.`);
    expect(progressSince({ before: null, metrics: [] })).toBe('No earlier audit of this site is saved.');
    expect(progressSince({
      before: { id: 'earlier' },
      metrics: [{ key: 'healthScore', before: null, after: null, delta: null }],
    })).toBe('Health was not measured on both audits, so there is no change to show.');
    expect(progressSince({
      before: { id: 'earlier' },
      metrics: [{ key: 'healthScore', before: 70, after: 85, delta: 15 }],
    })).toBe('Health is up 15 since the last audit (70 to 85).');
    expect(fixProgress([
      { status: 'done' },
      { status: 'done' },
      { status: 'open' },
      { status: 'open' },
      { status: 'in_progress' },
    ]).label).toBe('2 of 5 fixes done');
  });

  it('puts the same score and fix on the PDF text', () => {
    const pdf = withReportLead(SAMPLE, false, [finding({ id: 'org', title: 'Add the agency name' })]);
    expect(pdf.startsWith('# Ray White\n\nScore: Not measured\n')).toBe(true);
    expect(pdf).toContain('Why it matters for buyers and vendors: The fetched title did not include the agency name.');
    expect(pdf).toContain('How to fix: The homepage title does not name the agency.');
    expect(pdf).not.toContain('Health Score:');
  });

  it('lists a downgraded finding under Not measured and keeps it out of the fix cards', () => {
    const findings = [
      finding({ id: 'org', title: 'Add the agency name' }),
      finding({
        id: 'finding-schema-org-unmeasured',
        title: 'Organization markup',
        description: 'Not measured. The evidence check did not support this finding.',
      }),
    ];
    const pdf = withReportLead('passed 2 of 4; 1 not measured', true, findings);
    expect(pdf).toContain('Score: Passed 2 of 4; 1 not measured');
    expect(pdf).toContain('How to fix: The homepage title does not name the agency.');
    expect(pdf).toContain('Not measured: Organization markup.');
    expect(pdf).not.toContain('### Organization markup');
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown: 'passed 2 of 4; 1 not measured',
      measured: true,
      findings,
      domain: 'raywhite.com.au',
      showActions: false,
    }));
    expect(html).toContain('Passed 2 of 4; 1 not measured');
    expect(html).toContain('Not measured: Organization markup.');
    expect(html.match(/Mark done/g)).toHaveLength(1);
    const stripped = stripUnsupportedFixClaims(
      [
        '## 1. One move this week',
        '',
        'Add Organization markup.',
        '',
        '## 3. Fix list',
        '',
        '| Task | Plain issue |',
        '| --- | --- |',
        '| Add Organization JSON-LD | No schema |',
        '| Thin Content Detected on Critical Landing Page(s) | Short pages |',
        '',
        '## 6. Budget notes',
        '',
        'Budget impact: Not measured.',
      ].join('\n'),
      [{ id: 'finding-thin-content-unmeasured' }],
    );
    expect(stripped).toContain('Add Organization JSON-LD');
    expect(stripped).toContain('Add Organization markup.');
    expect(stripped).toContain('Budget impact: Not measured.');
    expect(stripped).not.toContain('Thin Content');
    expect(html).not.toContain('evidence check did not support');
  });
});

describe('audit report page', () => {
  it('renders the score, the next fix, and the source without a raw marker', () => {
    const findings = [
      finding({ id: 'org', title: 'Add the agency name', severity: 'critical' }),
      finding({ id: 'phone', title: 'Publish the office phone', severity: 'medium', description: 'No telephone was in the schema.', evidence: { howWeKnowItFailed: 'Not measured.' } }),
    ];
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown: SAMPLE,
      measured: false,
      findings,
      domain: 'raywhite.com.au',
      sources: [{ uri: 'https://raywhite.com.au/richmond', title: 'Richmond office' }],
      showActions: false,
    }));
    expect(html).toContain('Not measured');
    expect(html).toContain('The site checks were not measured.');
    expect(html).toContain('Your next fix');
    expect(html).toContain('Why it matters for buyers and vendors');
    expect(html).toContain('0 of 2 fixes done');
    expect(html).toContain('Mark done');
    expect(html).toContain('>Copy<');
    expect(html).toContain('https://raywhite.com.au/richmond');
    expect(html).toContain('Richmond office');
    expect(html).not.toContain('**');
    expect(html).not.toContain('```');
    expect(html).toContain('No earlier audit of this site is saved.');
  });

  it('stores a done tick on the findings board without calling the network', () => {
    const local = new Map<string, string>();
    const session = new Map<string, string>();
    const store = (bag: Map<string, string>) => ({
      getItem: (key: string) => bag.get(key) ?? null,
      setItem: (key: string, value: string) => { bag.set(key, value); },
      removeItem: (key: string) => { bag.delete(key); },
    });
    vi.stubGlobal('localStorage', store(local));
    vi.stubGlobal('sessionStorage', store(session));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const rows = [finding({ id: 'org', title: 'Add the agency name' })];
    const saved = setFindingStatusLocal('https://www.raywhite.com.au', rows, 'org', 'done');
    expect(saved[0].status).toBe('done');
    expect(listLocalFindings('raywhite.com.au')[0].status).toBe('done');
    expect(local.get(FINDINGS_BOARD_KEY)).toContain('"status":"done"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
