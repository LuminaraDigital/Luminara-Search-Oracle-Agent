import { describe, expect, it, vi } from 'vitest';
import { SYSTEM_INSTRUCTIONS } from '../constants';
import {
  REMOVED_TABLE_NOTE,
  REPORT_TABLES,
  gateReportTables,
  gateReportText,
  isReportColumn,
  looksLikeAuditReport,
  readTableAt,
  splitTableRow,
} from '../services/audit/reportColumnGate';

const TWELVE = [
  'Task', 'Plain issue', 'Priority',
  'Query', 'Intent', 'Brand Cited (Yes/No)', 'Key Competitors', 'Citation Status (Cited/Not Cited/Not Measured)',
  'Entity', 'AI Perception (Tone/Claims)', 'Top Cited Page Types', 'Content Advantage (vs You)',
];

/** Header cells of every table the gate can read in a text. */
function tableHeaders(markdown: string): string[] {
  const lines = markdown.split('\n');
  const headers: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const table = readTableAt(lines, i);
    if (table && table !== 'unparsed') {
      headers.push(...table.headers);
      i = table.end - 1;
    }
  }
  return headers;
}

function gate(lines: string[], options?: Parameters<typeof gateReportTables>[1]) {
  return gateReportTables(lines.join('\n'), options);
}

describe('the report has twelve columns and the templates print them from one list', () => {
  it('lists the twelve columns of the three report tables', () => {
    expect(Object.values(REPORT_TABLES).flat()).toEqual(TWELVE);
  });

  it('prints only those twelve as table headers in the chat system template', () => {
    expect(tableHeaders(SYSTEM_INSTRUCTIONS)).toEqual(TWELVE);
  });

  it('keeps each of the twelve, with or without its hint, emphasis or case', () => {
    for (const header of [...TWELVE, 'Brand Cited', '**Citation Status**', 'citation status', 'AI Perception', 'Content Advantage']) {
      expect(isReportColumn(header), header).toBe(true);
    }
  });

  it('keeps the five earlier spellings of the same columns, for stored chat audits', () => {
    for (const header of ['Competitors', 'Status', 'Brand', 'How AI talks about them', 'Pages that win citations']) {
      expect(isReportColumn(header), header).toBe(true);
    }
  });
});

describe('a column that is not one of the twelve is removed', () => {
  // Every header here passed the first gate, which only knew five names to refuse.
  it.each([
    'Expected Impact', 'Impact', 'Est. Organic Rank', 'Organic rank', 'Rich Results', 'AI Overview Status',
    'AI Overview', 'Trust Signal Strength (Low/Med/High)', 'Trust signals',
    'Rankings', 'Est. Position', 'Expected Lift', 'Trust Score',
    'Posición orgánica', 'Classement estimé', 'Geschätzter Rang', '推定順位',
    'Traffic impact (measured)', 'Top-ranking pages', 'Search sample position', '',
  ])('removes the column "%s" and its cell', (header) => {
    const result = gate([
      `| Query | ${header} | Intent |`,
      '|---|---|---|',
      '| what is example.com | INVENTED-CELL | informational |',
    ]);
    expect(isReportColumn(header)).toBe(false);
    expect(result.text).toBe([
      '| Query | Intent |',
      '| --- | --- |',
      '| what is example.com | informational |',
    ].join('\n'));
    expect(result.removedColumns).toEqual([header]);
  });

  it('removes a whole table that has no listed column, such as a Metric and Value table', () => {
    const result = gate([
      '## 2. Plain verdict',
      '| Metric | Value |',
      '|---|---|',
      '| Organic rank | 3 |',
      '| Trust score | 88/100 |',
      'After.',
    ]);
    expect(result.text).toBe(['## 2. Plain verdict', REMOVED_TABLE_NOTE, 'After.'].join('\n'));
    expect(result.removedTables).toBe(1);
    expect(result.text).not.toContain('88');
  });

  it('reads an alignment row written with colons and single dashes', () => {
    const result = gate([
      '| Query | Est. Position | Intent |',
      '|:-|:-:|-:|',
      '| q1 | 3 | commercial |',
    ]);
    expect(result.text).toBe(['| Query | Intent |', '| --- | --- |', '| q1 | commercial |'].join('\n'));
  });

  it('reads a table written without outer pipes', () => {
    const result = gate([
      'Query | Est. Position | Intent',
      '---|---|---',
      'q1 | 3 | commercial',
      '',
      'After.',
    ]);
    expect(result.text).toBe(['| Query | Intent |', '| --- | --- |', '| q1 | commercial |', '', 'After.'].join('\n'));
  });

  it('reads an HTML table', () => {
    const result = gate([
      '<table>',
      '  <tr><th>Query</th><th>Est. Position</th><th>Intent</th></tr>',
      '  <tr><td>q1</td><td>3</td><td>commercial</td></tr>',
      '</table>',
    ]);
    expect(result.text).toBe(['| Query | Intent |', '| --- | --- |', '| q1 | commercial |'].join('\n'));
    expect(result.removedColumns).toEqual(['Est. Position']);
  });

  it('gates a table inside a code fence and a table after a fence that never closes', () => {
    const closed = gate(['```markdown', '| Query | Est. Organic Rank |', '|---|---|', '| q | 1 |', '```']);
    expect(closed.text).toBe(['```markdown', '| Query |', '| --- |', '| q |', '```'].join('\n'));

    const unbalanced = gate([
      '```json',
      '{ "@type": "Organization" }',
      '',
      '## AI & Search Visibility Radar',
      '| Query | Est. Organic Rank |',
      '|---|---|',
      '| q | 1 |',
    ]);
    expect(unbalanced.text).not.toContain('Est. Organic Rank');
    expect(unbalanced.text).toContain('{ "@type": "Organization" }');
    expect(unbalanced.text).toContain('| q |');
  });

  it('does not let a header call itself measured', () => {
    for (const header of ['Organic rank (measured)', 'Rank (MEASURED by code)', 'Impact [measured]']) {
      expect(isReportColumn(header), header).toBe(false);
    }
  });
});

describe('a column the calling code filled from evidence stays', () => {
  // These three were deleted by the first gate because their names contain "impact" or "rank".
  it.each([
    'Traffic impact (measured)',
    'Top-ranking pages',
    'Search sample position',
  ])('keeps "%s" when code passes it as measured, and removes it otherwise', (header) => {
    const table = [`| Query | ${header} |`, '|---|---|', '| q1 | from evidence |'];

    const marked = gate(table, { measuredColumns: [header] });
    expect(marked.text).toBe(table.join('\n'));
    expect(marked.removedColumns).toEqual([]);

    const unmarked = gate(table);
    expect(unmarked.text).toBe(['| Query |', '| --- |', '| q1 |'].join('\n'));
    expect(unmarked.removedColumns).toEqual([header]);
  });

  it('keeps only the marked column, not another one beside it', () => {
    const result = gate(
      ['| Query | Search sample position | Est. Organic Rank |', '|---|---|---|', '| q1 | 2 | 7 |'],
      { measuredColumns: ['Search sample position'] },
    );
    expect(result.text).toBe(['| Query | Search sample position |', '| --- | --- |', '| q1 | 2 |'].join('\n'));
  });
});

describe('cells stay under their own header', () => {
  it('keeps an escaped pipe inside its cell', () => {
    expect(splitTableRow('| a \\| b | c |')).toEqual(['a \\| b', 'c']);
    const result = gate([
      '| Query | Est. Organic Rank | Key Competitors | Citation Status |',
      '|---|---|---|---|',
      '| q1 | 7 | Rival A \\| Rival B | Cited |',
    ]);
    expect(result.text).toBe([
      '| Query | Key Competitors | Citation Status |',
      '| --- | --- | --- |',
      '| q1 | Rival A \\| Rival B | Cited |',
    ].join('\n'));
  });

  it('pads a short row and keeps the cells it has in place', () => {
    const result = gate(['| Query | Est. Position | Intent |', '|---|---|---|', '| q1 | 3 |']);
    expect(result.text).toBe(['| Query | Intent |', '| --- | --- |', '| q1 |  |'].join('\n'));
  });

  it('returns a table with only listed columns unchanged, byte for byte', () => {
    const clean = [
      '# Report',
      '',
      '| Task | Plain issue | Priority |',
      '|------|:-----------:|---------:|',
      '| Add schema | Missing   | High |',
      '',
      'Budget impact: not measured.',
      'A | B',
      '---',
      '| a lone line that starts with a pipe',
    ].join('\n');
    const result = gateReportTables(clean);
    expect(result.text).toBe(clean);
    expect(result).toMatchObject({ removedColumns: [], removedTables: 0, unparsedTables: 0 });
    expect(gateReportTables('').text).toBe('');
  });
});

describe('a table the gate cannot line up is left as written and counted', () => {
  it.each([
    ['a row with more cells than headers', ['| Query | Est. Organic Rank |', '|---|---|', '| q1 | 3 | extra | cells |']],
    ['an alignment row with a different cell count', ['| Query | Est. Organic Rank | Intent |', '|---|---|', '| q1 | 3 | x |']],
    ['an HTML table with merged cells', ['<table><tr><th colspan="2">Query</th></tr><tr><td>q</td><td>3</td></tr></table>']],
    ['an HTML table that never closes', ['<table>', '<tr><th>Est. Position</th></tr>']],
  ])('%s', (_name, lines) => {
    const result = gate(lines);
    expect(result.text).toBe(lines.join('\n'));
    expect(result.unparsedTables).toBe(1);
    expect(result.removedColumns).toEqual([]);
  });

  it('logs when it leaves a table as written', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gateReportText(['| Query | Rank |', '|---|---|', '| q | 3 | extra |'].join('\n'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('1 table(s) left as written');
    warn.mockClear();
    gateReportText(['| Query | Rank |', '|---|---|', '| q | 3 |'].join('\n'));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('what the gate does not cover', () => {
  // Stated so nobody reads the gate as a check on prose. See the PR for SW0a-7.
  it('does not read prose: a sentence with a made-up rank is left as written', () => {
    const prose = 'Your organic rank is 3 and the expected lift is 40%.';
    expect(gateReportTables(prose).text).toBe(prose);
  });

  it('does not check the value inside a kept cell', () => {
    const table = ['| Task | Priority |', '|---|---|', '| Add schema | Rank 3, +40% |'].join('\n');
    expect(gateReportTables(table).text).toBe(table);
  });
});

describe('which chat replies count as an audit', () => {
  it('needs a top heading and an audit section name, in any case', () => {
    expect(looksLikeAuditReport('# Luminara: Will AI mention Acme?\n\n## 4. Visibility radar\n')).toBe(true);
    expect(looksLikeAuditReport('# Report\n\n## Competitor Reality Map\n')).toBe(true);
    expect(looksLikeAuditReport('# Report\n\n## 3. Fix list\n')).toBe(true);
    expect(looksLikeAuditReport('# Luminara Diagnostic Scan\n\ntext')).toBe(true);
    expect(looksLikeAuditReport('## 4. Visibility radar\nno top heading')).toBe(false);
    expect(looksLikeAuditReport('# A note\n\n| Plan | Price |\n|---|---|\n| Growth | 49 |')).toBe(false);
    // A sentence that mentions a section name does not make a reply an audit.
    expect(looksLikeAuditReport('# Pricing\n\nYour fix list is in the last audit.\n\n| Plan | Price |\n|---|---|\n| Growth | 49 |')).toBe(false);
  });
});
