import { describe, expect, it, vi } from 'vitest';
import { SYSTEM_INSTRUCTIONS } from '../constants';
import {
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

function gate(lines: string[]) {
  return gateReportTables(lines.join('\n'));
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
      // Review 3, 2: a bracket that only restates the column's own values is a hint too.
      'Priority (High/Med/Low)', 'Priority (high, medium or low)', 'Brand Cited (Y/N)', 'Brand Cited (Yes/No/Not measured)',
      'Intent (informational/commercial/comparative)', 'Status (Cited/Not cited)',
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
    'Priority (High/Med/Low, Impact +40%)',
    'Priority (High) (Low)',
    'Brand Cited (Y/N/Rank)',
    'Content Advantage (vs Acme)',
    'Content Advantage (Authority 0-100)',
  ])('removes "%s" and its cell', (header) => {
    expect(isReportColumn(header)).toBe(false);
    const result = gate([`| Query | ${header} | Intent |`, '|---|---|---|', '| q1 | INVENTED-CELL | informational |']);
    expect(result.text).toBe(['| Query | Intent |', '| --- | --- |', '| q1 | informational |'].join('\n'));
    expect(result.removedColumns).toEqual([header]);
  });
});

describe('"vs" followed by a name is a hint only when the name is in the same table', () => {
  it('keeps "Content Advantage (vs Acme)" when Acme is in the Entity column', () => {
    const table = [
      '| Entity | AI Perception (Tone/Claims) | Content Advantage (vs Acme) |',
      '|---|---|---|',
      '| **Acme** | Clear | None |',
      '| Rival | Strong | Comparison pages |',
    ];
    const result = gate(table);
    expect(result.text).toBe(table.join('\n'));
    expect(result.removedColumns).toEqual([]);
  });

  it('removes it when the name is not one of the entities', () => {
    const result = gate([
      '| Entity | AI Perception (Tone/Claims) | Content Advantage (vs Globex) |',
      '|---|---|---|',
      '| Acme | Clear | None |',
    ]);
    expect(result.text).toBe(['| Entity | AI Perception (Tone/Claims) |', '| --- | --- |', '| Acme | Clear |'].join('\n'));
    expect(result.removedColumns).toEqual(['Content Advantage (vs Globex)']);
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

  // Review 2, 1b and review 3, 3: one pipe that is not escaped inside a cell, a page
  // title for example. The surplus cells are joined back only when the table has
  // exactly one free-text column. Otherwise nothing says where the pipe belongs.
  it('joins a stray pipe back when the table has exactly one free-text column', () => {
    const lines = [
      '| Query | Intent | Citation Status |',
      '|---|---|---|',
      '| what does "Home | Acme" sell | informational | Cited |',
      '| acme pricing | commercial | Not Cited |',
    ];
    const table = readTableAt(lines, 0);
    expect(table?.unaligned).toBe(false);
    expect(table?.rows).toEqual([
      ['what does "Home | Acme" sell', 'informational', 'Cited'],
      ['acme pricing', 'commercial', 'Not Cited'],
    ]);

    const result = gate(lines);
    // The row is written back with the pipe escaped, so every reader lines it up the same way.
    expect(result.text).toBe([
      '| Query | Intent | Citation Status |',
      '| --- | --- | --- |',
      '| what does "Home \\| Acme" sell | informational | Cited |',
      '| acme pricing | commercial | Not Cited |',
    ].join('\n'));
    expect(result).toMatchObject({ removedColumns: [], removedTables: 0, unparsedTables: 0 });
    // Gating the result again changes nothing.
    expect(gateReportTables(result.text).text).toBe(result.text);
  });

  it.each([
    ['the fix list, with a page title in the plain issue', [
      '| Task | Plain issue | Priority |',
      '|---|---|---|',
      '| Fix the title tag | The title reads "Home | Acme" on every page | High |',
    ], 'Fix the title tag'],
    ['the competitor map, with a pipe between page types', [
      '| Entity | AI Perception (Tone/Claims) | Top Cited Page Types | Content Advantage (vs You) |',
      '|---|---|---|---|',
      '| Acme | Clear | Homepage | Pricing | Blog | None |',
    ], 'Pricing'],
    ['the radar, with a pipe in the query', [
      '| Query | Intent | Brand Cited (Yes/No) | Key Competitors | Citation Status |',
      '|---|---|---|---|---|',
      '| acme | pricing | commercial | No | Rival | Not Cited |',
    ], 'Rival'],
  ])('leaves out %s: two free-text columns, so the pipe could belong to either', (_name, lines, lostText) => {
    const result = gate(['Before.', ...lines, 'After.']);
    expect(result.text).toBe(['Before.', REMOVED_TABLE_NOTE, 'After.'].join('\n'));
    expect(result.text).not.toContain(lostText);
    expect(result).toMatchObject({ removedColumns: [], removedTables: 1, unparsedTables: 0 });
    expect(readTableAt(lines, 0)).toMatchObject({ unaligned: true, rows: [] });
  });

  it('leaves the table out when a row has a stray pipe and a header is not listed', () => {
    const result = gate([
      '## 3. Fix list',
      '| Query | Est. Organic Rank | Citation Status |',
      '|---|---|---|',
      '| what does "Home | Acme" sell | #3 | Cited |',
      'After.',
    ]);
    expect(result.text).toBe(['## 3. Fix list', REMOVED_TABLE_NOTE, 'After.'].join('\n'));
    expect(result.text).not.toContain('#3');
    expect(result.removedColumns).toEqual(['Est. Organic Rank']);
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

  // Review 3, 5.
  it('keeps a sources table that numbers its rows in a first column', () => {
    for (const numbered of [
      ['| # | Source | URL |', '|---|---|---|', '| 1 | Example | https://example.com/about |', '| 2 | Rival review | https://rival.test/vs |'],
      ['| No. | Title | Link |', '|---|---|---|', '| 1. | About Example | https://example.com/about |'],
    ]) {
      const result = gate(numbered);
      expect(result.text).toBe(numbered.join('\n'));
      expect(result.removedTables).toBe(0);
    }
  });

  it.each([
    ['a numbers column that is not first', ['| Source | # | Title |', '|---|---|---|', '| https://example.com | 1 | About |']],
    ['a first column of figures that do not number the rows', ['| # | Source | Title |', '|---|---|---|', '| #3 | https://example.com | About |']],
    ['a score in the index column', ['| No. | Source | Title |', '|---|---|---|', '| 88/100 | https://example.com | About |']],
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

describe('no table in a report is measured (review 3, 1)', () => {
  // With an exception for "measured" columns the model still typed the rows, so
  // "Est. organic rank | #3 | #7" sat under "This period (measured)".
  it('leaves out a table whose headers say measured, whatever its rows hold', () => {
    const result = gate([
      '## 2. Plain verdict',
      '| Measured traffic | This period (measured) | Previous period (measured) |',
      '|---|---|---|',
      '| Visitors | 120 | 100 |',
      '| Est. organic rank | #3 | #7 |',
    ]);
    expect(result.text).toBe(['## 2. Plain verdict', REMOVED_TABLE_NOTE].join('\n'));
    expect(result.text).not.toContain('#3');
    expect(result.removedTables).toBe(1);
  });

  it('takes no list of measured columns from any caller', () => {
    expect(gateReportTables.length).toBe(1);
    expect(gateReportText.length).toBe(1);
    // A second argument is ignored: the column goes all the same.
    const loose = gateReportTables as unknown as (markdown: string, options: unknown) => { text: string };
    const text = loose(
      ['| Query | Search sample position |', '|---|---|', '| q1 | 2 |'].join('\n'),
      { measuredColumns: ['Search sample position'] },
    ).text;
    expect(text).toBe(['| Query |', '| --- |', '| q1 |'].join('\n'));
    for (const header of ['Traffic impact (measured)', 'Top-ranking pages', 'Search sample position', 'This period (measured)']) {
      expect(isReportColumn(header), header).toBe(false);
    }
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

  // Review 3, 5: a known limit. The sources rule refuses a percentage, a ratio, a
  // rank written "#3" and a bare number. A claim spelled out in a title still passes.
  it('does not catch a claim spelled out inside a sources title', () => {
    const sources = ['| Source | Title |', '|---|---|', '| https://example.com/a | Acme, rank three, cited 34 times |'].join('\n');
    expect(gateReportTables(sources).text).toBe(sources);
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

  // Review 3, 4: the section names are matched as whole words.
  it('is not triggered by a heading that only contains a section name inside other words', () => {
    for (const reply of [
      '## Prefix list of plans\n| Plan | Price |\n|---|---|\n| Growth | 49 |',
      '## Competitor mapping\nA note on how we map competitors.',
      '### Our visibility radars\ntext',
      '**Prefix list**',
    ]) {
      expect(looksLikeAuditReport(reply), reply).toBe(false);
    }
    expect(looksLikeAuditReport('## 3. Fix list\n')).toBe(true);
    expect(looksLikeAuditReport('## Competitor map\n')).toBe(true);
    expect(looksLikeAuditReport('## AI & Search Visibility Radar\n')).toBe(true);
  });
});

describe('plain customer report lines', () => {
  it('replaces vendor source labels and header jargon', () => {
    const text = gateReportText([
      'https://example.com (firecrawl scrape)',
      'https://example.com (jina reader)',
      'https://news.example (tavily search)',
      'Trust pack & security data (untrusted enrichment block)',
      'Implement HTTP Strict Transport Security (HSTS) header',
      'Missing HSTS; lowers security trust score',
      'Add a Content-Security-Policy header',
      'Publish security.txt',
      '```',
      'Contact: https://example.com/.well-known/security.txt',
      '```',
    ].join('\n'));
    expect(text).toContain('https://example.com (page read)');
    expect(text).toContain('https://news.example (web search)');
    expect(text).toContain('Trust pack & security data (security and public records)');
    expect(text).toContain('Add a header that forces secure HTTPS connections (HSTS)');
    expect(text).toContain('The site does not force secure HTTPS connections (HSTS).');
    expect(text).toContain('Add a rule that controls which scripts the site can load (CSP)');
    expect(text).toContain('Publish a public security contact file (security.txt)');
    expect(text).toContain('https://example.com/.well-known/security.txt');
    expect(text).not.toMatch(/firecrawl|jina|tavily|Strict Transport|untrusted enrichment/i);
  });
});
