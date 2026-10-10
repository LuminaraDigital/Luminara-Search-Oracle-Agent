import { describe, expect, it, vi } from 'vitest';
import { SYSTEM_INSTRUCTIONS } from '../constants';
import {
  MEASURED_TRAFFIC_COLUMNS,
  REMOVED_TABLE_NOTE,
  REPORT_TABLES,
  gateReportTables,
  gateReportText,
  isReportColumn,
  isSourcesTable,
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
    if (table) {
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
    for (const header of [
      ...TWELVE, 'Brand Cited', '**Citation Status**', 'citation status', 'AI Perception', 'Content Advantage',
      'Brand Cited (Yes / No)', 'Citation Status (Cited / Not Cited / Not Measured)', 'content advantage (vs you)',
    ]) {
      expect(isReportColumn(header), header).toBe(true);
    }
  });

  it('keeps the five earlier spellings of the same columns, for stored chat audits', () => {
    for (const header of ['Competitors', 'Status', 'Brand', 'How AI talks about them', 'Pages that win citations']) {
      expect(isReportColumn(header), header).toBe(true);
    }
  });
});

describe('a bracket is accepted only when it is the hint the template prints for that column', () => {
  // The gate used to drop any bracketed text before it looked the header up.
  it.each([
    'Priority (Expected Impact)',
    'Status (Est. Organic Rank)',
    'Entity (Authority 0-100)',
    'Brand Cited (Rank #3)',
    'Citation Status (Cited/Not Cited/Not Measured) (Est. Rank)',
    'Key Competitors (Trust Score)',
    'Task (Yes/No)',
  ])('removes "%s" and its cell', (header) => {
    expect(isReportColumn(header)).toBe(false);
    const result = gate([`| Query | ${header} | Intent |`, '|---|---|---|', '| q1 | INVENTED-CELL | informational |']);
    expect(result.text).toBe(['| Query | Intent |', '| --- | --- |', '| q1 | informational |'].join('\n'));
    expect(result.removedColumns).toEqual([header]);
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

  it('leaves out a whole table that has no listed column, such as a Metric and Value table, and says so', () => {
    const result = gate([
      '## 2. Plain verdict',
      '| Metric | Value |',
      '|---|---|',
      '| Organic rank | 3 |',
      '| Trust score | 88/100 |',
      'After.',
    ]);
    expect(REMOVED_TABLE_NOTE).toBe('A table was left out because its column names were not recognised.');
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

  it('reads a table whose alignment row has the wrong number of cells', () => {
    const result = gate(['| Query | Est. Organic Rank | Intent |', '|---|---|', '| q1 | 3 | x |']);
    expect(result.text).toBe(['| Query | Intent |', '| --- | --- |', '| q1 | x |'].join('\n'));
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
      '</table> Text after the table.',
    ]);
    expect(result.text).toBe(['| Query | Intent |', '| --- | --- |', '| q1 | commercial |', ' Text after the table.'].join('\n'));
    expect(result.removedColumns).toEqual(['Est. Position']);
  });

  it('does not let a header call itself measured', () => {
    for (const header of ['Organic rank (measured)', 'Rank (MEASURED by code)', 'Impact [measured]', 'This period (measured)']) {
      expect(isReportColumn(header), header).toBe(false);
    }
  });
});

describe('nothing passes because it was "left as written"', () => {
  // Review 2, 1a: "<table" in a sentence used to open a block that ran to the next
  // "</table>" and came back ungated.
  it('gates a table that sits between a sentence with "<table" in it and a later "</table>"', () => {
    const result = gate([
      'Wrap the pricing grid in a <table class="plans"> element so crawlers can read it.',
      '',
      '## AI & Search Visibility Radar',
      '| Query | Intent | Est. Organic Rank | Citation Status |',
      '|---|---|---|---|',
      '| what is example.com | informational | #3 | Cited |',
      '',
      'Close it with </table> at the end.',
    ]);
    expect(result.text).not.toContain('Est. Organic Rank');
    expect(result.text).not.toContain('#3');
    expect(result.text).toContain('| what is example.com | informational | Cited |');
    expect(result.text).toContain('Wrap the pricing grid in a <table class="plans"> element so crawlers can read it.');
    expect(result.text).toContain('Close it with </table> at the end.');
    expect(result.removedColumns).toEqual(['Est. Organic Rank']);
  });

  it('gates the lines after an HTML table tag that never closes', () => {
    const result = gate([
      '<table>',
      '<tr><th>Est. Position</th></tr>',
      '',
      '| Query | Est. Organic Rank |',
      '|---|---|',
      '| q1 | #3 |',
    ]);
    expect(result.text).toContain('| q1 |');
    expect(result.text).not.toContain('Est. Organic Rank');
    expect(result.text).not.toContain('#3');
  });

  // Review 2, 1b: one pipe that is not escaped inside a cell, a page title for
  // example, used to make the whole table "unparsed" and pass it through.
  const titleRow = '| Fix the title tag | The title reads "Home | Acme" on every page | High |';

  it('joins a stray pipe back into the free-text cell when every header is listed', () => {
    const lines = ['| Task | Plain issue | Priority |', '|---|---|---|', titleRow, '| Add schema | Missing | Med |'];
    const table = readTableAt(lines, 0);
    expect(table?.unaligned).toBe(false);
    expect(table?.rows).toEqual([
      ['Fix the title tag', 'The title reads "Home | Acme" on every page', 'High'],
      ['Add schema', 'Missing', 'Med'],
    ]);

    const result = gate(lines);
    // The row is written back with the pipe escaped, so every reader lines it up the same way.
    expect(result.text).toBe([
      '| Task | Plain issue | Priority |',
      '| --- | --- | --- |',
      '| Fix the title tag | The title reads "Home \\| Acme" on every page | High |',
      '| Add schema | Missing | Med |',
    ].join('\n'));
    expect(result).toMatchObject({ removedColumns: [], removedTables: 0, unparsedTables: 0 });
    // Gating the result again changes nothing.
    expect(gateReportTables(result.text).text).toBe(result.text);
  });

  it('leaves the table out when a row has a stray pipe and a header is not listed', () => {
    const result = gate([
      '## 3. Fix list',
      '| Task | Plain issue | Expected Impact | Priority |',
      '|---|---|---|---|',
      '| Fix the title tag | The title reads "Home | Acme" on every page | +40% citations | High |',
      'After.',
    ]);
    expect(result.text).toBe(['## 3. Fix list', REMOVED_TABLE_NOTE, 'After.'].join('\n'));
    expect(result.text).not.toContain('+40% citations');
    expect(result.removedColumns).toEqual(['Expected Impact']);
    expect(result.removedTables).toBe(1);
    expect(result.unparsedTables).toBe(0);
  });

  it('leaves out an HTML table it cannot line up when a header is not listed, and keeps one whose headers all are', () => {
    const merged = gate(['<table><tr><th colspan="2">Query</th><th>Est. Position</th></tr><tr><td>q</td><td>x</td><td>3</td></tr></table>']);
    expect(merged.text).toBe(REMOVED_TABLE_NOTE);
    expect(merged.removedColumns).toEqual(['Est. Position']);

    const listed = ['<table><tr><th colspan="2">Query</th></tr><tr><td>q</td><td>more</td></tr></table>'];
    const kept = gate(listed);
    expect(kept.text).toBe(listed.join('\n'));
    expect(kept.unparsedTables).toBe(1);
  });

  it('logs when it leaves a table as written', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gateReportText('<table><tr><th colspan="2">Query</th></tr><tr><td>q</td><td>more</td></tr></table>');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('1 table(s) left as written');
    warn.mockClear();
    gateReportText(['| Query | Rank |', '|---|---|', '| q | 3 |'].join('\n'));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('what the gate keeps on purpose', () => {
  it('leaves a closed code fence alone, and gates what follows a fence that never closes', () => {
    const closed = ['```markdown', '| Query | Est. Organic Rank |', '|---|---|', '| q | 1 |', '```', 'After.'];
    expect(gate(closed).text).toBe(closed.join('\n'));

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

  it('keeps a sources table: links and titles, no figures', () => {
    const sources = [
      '## 7. Sources',
      '| Source | Title |',
      '|---|---|',
      '| https://example.com/about | About Example |',
      '| [Rival review](https://rival.test/vs) | Top 10 widget tools compared |',
      '| https://news.example/what | "Home | Example News" |',
    ];
    const result = gate(sources);
    expect(result.removedTables).toBe(0);
    expect(result.text).toContain('| https://example.com/about | About Example |');
    expect(result.text).toContain('Top 10 widget tools compared');
    expect(result.text).toContain('"Home \\| Example News"');
    expect(isSourcesTable(readTableAt(sources, 1)!)).toBe(true);

    // With no stray pipe it comes back byte for byte.
    const plain = sources.slice(0, 5);
    expect(gate(plain).text).toBe(plain.join('\n'));
  });

  it.each([
    ['a numbers column', ['| # | Source | Title |', '|---|---|---|', '| 1 | https://example.com | About |']],
    ['a rank column', ['| Source | Title | Rank |', '|---|---|---|', '| https://example.com | About | 3 |']],
    ['a percentage in a cell', ['| Source | Title |', '|---|---|', '| https://example.com | Cited in 40% of answers |']],
    ['a rank in a cell', ['| Source | Title |', '|---|---|', '| https://example.com | Ranks #3 for widgets |']],
    ['a row with no link', ['| Source | Title |', '|---|---|', '| Example blog | About |']],
    ['no link column', ['| Title | Publisher |', '|---|---|', '| About https://example.com | Example |']],
  ])('does not take a table with %s for a sources table', (_name, lines) => {
    const result = gate(lines);
    expect(result.text).toBe(REMOVED_TABLE_NOTE);
    expect(result.removedTables).toBe(1);
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

  it('keeps the measured traffic table only when the caller holds measured traffic', () => {
    const traffic = [
      `| ${MEASURED_TRAFFIC_COLUMNS.join(' | ')} |`,
      '|---|---|---|',
      '| Visitors | 120 | 100 |',
      '| Visits from AI assistants | 7 | 4 |',
    ];
    expect(gate(traffic, { measuredColumns: MEASURED_TRAFFIC_COLUMNS }).text).toBe(traffic.join('\n'));
    const without = gate(traffic);
    expect(without.text).toBe(REMOVED_TABLE_NOTE);
    expect(without.text).not.toContain('120');
  });
});

describe('cells stay under their own header', () => {
  it('keeps an escaped pipe inside its cell', () => {
    expect(splitTableRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
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
  it('needs only a heading that names an audit section, at any level', () => {
    expect(looksLikeAuditReport('# Luminara: Will AI mention Acme?\n\n## 4. Visibility radar\n')).toBe(true);
    expect(looksLikeAuditReport('# Report\n\n## Competitor Reality Map\n')).toBe(true);
    expect(looksLikeAuditReport('# Luminara Diagnostic Scan\n\ntext')).toBe(true);
    // Review 2, 4: no top heading is needed.
    expect(looksLikeAuditReport('## Visibility radar\n| Query | Organic rank |\n|---|---|\n| q | 3 |')).toBe(true);
    expect(looksLikeAuditReport('#### Fix list\n')).toBe(true);
    expect(looksLikeAuditReport('**Visibility radar**\n| Query | Organic rank |')).toBe(true);
  });

  it('is not triggered by a reply that only mentions a section name', () => {
    expect(looksLikeAuditReport('# A note\n\n| Plan | Price |\n|---|---|\n| Growth | 49 |')).toBe(false);
    expect(looksLikeAuditReport('# Pricing\n\nYour fix list is in the last audit.\n\n| Plan | Price |\n|---|---|\n| Growth | 49 |')).toBe(false);
    expect(looksLikeAuditReport('**Note:** see the fix list above.')).toBe(false);
  });
});
