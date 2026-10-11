/**
 * Report column gate.
 *
 * A model writes the audit report. The report has three tables with twelve columns
 * between them (REPORT_TABLES). The prompt templates print their table headers from
 * this file, and the gate keeps a table column only when its header is one of those
 * twelve. Every other column is removed with its cells. There is no exception for a
 * column that calls itself measured: the model writes every row of a report table,
 * so no table in a report is measured. Figures the code measured are drawn by the
 * code, outside the report text.
 *
 * Whole tables:
 * - A table with no listed column is left out, and one line says so.
 * - A sources table (links and titles, no figures) is kept as written.
 * - A table inside a closed code fence is code, and is left alone.
 * - A table with a row that has more cells than headers is left out, unless the
 *   table has exactly one free-text column for the stray pipe to belong to.
 *   It is never passed through as written.
 *
 * The gate runs when a report is generated and again wherever one is rendered, so a
 * stored report gets the same treatment.
 *
 * What it does not do: it cannot check the value inside a kept cell, and it does not
 * read prose.
 *
 * Pure string functions so the rule is unit-testable.
 * Invariant: no em dashes (U+2014) in copy or comments. Use '-', ':', or '.'.
 */

/** The report's own tables. Prompt templates and the gate both read this. */
export const REPORT_TABLES = {
  fixList: ['Task', 'Plain issue', 'Priority'],
  visibilityRadar: [
    'Query',
    'Intent',
    'Brand Cited (Yes/No)',
    'Key Competitors',
    'Citation Status (Cited/Not Cited/Not Measured)',
  ],
  competitorMap: [
    'Entity',
    'AI Perception (Tone/Claims)',
    'Top Cited Page Types',
    'Content Advantage (vs You)',
  ],
} as const;

export type ReportTableName = keyof typeof REPORT_TABLES;

/** The header row of one report table, as the prompt templates print it. */
export function reportTableHeader(table: ReportTableName): string {
  return `| ${REPORT_TABLES[table].join(' | ')} |`;
}

/** The alignment row that goes under reportTableHeader. */
export function reportTableSeparator(table: ReportTableName): string {
  return `|${REPORT_TABLES[table].map(() => '---').join('|')}|`;
}

/** Shown where a table was left out. */
export const REMOVED_TABLE_NOTE = 'A table was left out because its column names were not recognised.';

/**
 * How the chat template spelled five of the same twelve columns before it printed
 * its headers from REPORT_TABLES. Kept so a stored chat audit keeps those columns.
 */
const EARLIER_SPELLINGS = ['Competitors', 'Status', 'Brand', 'How AI talks about them', 'Pages that win citations'];

/** Columns whose cells are free text. Only these can hold a pipe that was not escaped. */
const FREE_TEXT_COLUMNS = [
  'Task', 'Plain issue', 'Query', 'Key Competitors', 'Entity', 'AI Perception (Tone/Claims)',
  'Top Cited Page Types', 'Content Advantage (vs You)',
  'Competitors', 'Brand', 'How AI talks about them', 'Pages that win citations',
];

/**
 * The values a closed column takes. A bracket that only restates them is a hint,
 * as in "Priority (High/Med/Low)" or "Brand Cited (Y/N)". Written without spaces.
 */
const COLUMN_VALUES: Record<string, readonly string[]> = {
  priority: ['high', 'med', 'medium', 'low'],
  intent: ['informational', 'commercial', 'comparative', 'navigational', 'transactional'],
  'brand cited': ['yes', 'no', 'y', 'n', 'notmeasured', 'notverified'],
  'citation status': ['cited', 'notcited', 'notmeasured', 'notverified'],
  status: ['cited', 'notcited', 'notmeasured', 'notverified'],
};

/** Headers of a sources table. */
const SOURCE_LINK_HEADERS = ['url', 'link', 'source', 'sources', 'reference', 'references'];
const SOURCE_TEXT_HEADERS = ['title', 'page title', 'site', 'publisher'];
/** A sources table may start with a column that numbers its rows. */
const SOURCE_INDEX_HEADERS = ['#', 'no', 'no.', 'nr', 'nr.'];

function plainLower(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** A header split into its name and the text of each bracket after it. */
function headerParts(header: string): { base: string; hints: string[] } {
  const plain = plainLower(header);
  return {
    base: plain.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(),
    hints: [...plain.matchAll(/\(([^)]*)\)/g)].map((match) => match[1].replace(/\s+/g, ' ').trim()),
  };
}

const squeeze = (text: string): string => text.replace(/\s+/g, '');

/** Each listed column name, with the hint the template prints for it, if any. */
const LISTED_COLUMNS = new Map<string, string | null>();
for (const header of [...Object.values(REPORT_TABLES).flat(), ...EARLIER_SPELLINGS]) {
  const { base, hints } = headerParts(header);
  LISTED_COLUMNS.set(base, hints[0] ?? LISTED_COLUMNS.get(base) ?? null);
}
const FREE_TEXT_BASES = new Set(FREE_TEXT_COLUMNS.map((header) => headerParts(header).base));

/**
 * True when a bracket after a listed column name is only a hint. Three kinds pass:
 * the hint the template prints for that column; a list of the column's own values;
 * and, for the content advantage column, "vs" followed by "you" or by a name from
 * the same table's Entity column. Any other bracket makes the header a different
 * column, so "Priority (Expected Impact)" is not "Priority".
 */
function hintFits(base: string, hint: string, entities: readonly string[]): boolean {
  const template = LISTED_COLUMNS.get(base);
  if (template && squeeze(template) === squeeze(hint)) return true;
  const values = COLUMN_VALUES[base];
  if (values) {
    const words = hint.split(/[/,|]| or /).map(squeeze).filter(Boolean);
    if (words.length > 0 && words.every((word) => values.includes(word))) return true;
  }
  if (base === 'content advantage') {
    const versus = hint.match(/^(?:vs\.?|versus) (.+)$/);
    if (versus) return versus[1] === 'you' || entities.includes(versus[1]);
  }
  return false;
}

/**
 * True when a column with this header may stay in a report table.
 * entities are the names in the same table's Entity column, lower case. They are
 * read only for the "vs <name>" hint.
 */
export function isReportColumn(header: string, entities: readonly string[] = []): boolean {
  const { base, hints } = headerParts(header);
  if (!LISTED_COLUMNS.has(base)) return false;
  if (hints.length === 0) return true;
  return hints.length === 1 && hintFits(base, hints[0], entities);
}

/**
 * Splits one table row on pipes. A pipe written as \| stays inside its cell, and
 * comes back as a plain pipe.
 */
export function splitTableRow(line: string): string[] {
  const body = line.trim();
  const cells: string[] = [];
  let cell = '';
  let endedOnDelimiter = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      cell += '|';
      i++;
      endedOnDelimiter = false;
      continue;
    }
    if (ch === '|') {
      cells.push(cell);
      cell = '';
      endedOnDelimiter = true;
      continue;
    }
    cell += ch;
    endedOnDelimiter = false;
  }
  if (!endedOnDelimiter) cells.push(cell);
  if (body.startsWith('|')) cells.shift();
  return cells.map((piece) => piece.trim());
}

/** One table row as Markdown. A pipe inside a cell is written as \| so it stays there. */
function tableLine(cells: readonly string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`;
}

function hasCellPipe(line: string): boolean {
  return line.replace(/\\\|/g, '').includes('|');
}

function isAlignmentRow(line: string | undefined): line is string {
  if (typeof line !== 'string' || !line.includes('-')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function isFenceLine(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

/** 1 when the first header numbers the rows of a sources table, else 0. */
function sourcesIndexWidth(bases: readonly string[]): number {
  return bases.length > 1 && SOURCE_INDEX_HEADERS.includes(bases[0]) ? 1 : 0;
}

function isSourcesHeaderSet(headers: readonly string[]): boolean {
  const parts = headers.map(headerParts);
  if (parts.some((part) => part.hints.length > 0)) return false;
  const bases = parts.map((part) => part.base);
  const body = bases.slice(sourcesIndexWidth(bases));
  return body.length > 0 &&
    body.every((base) => SOURCE_LINK_HEADERS.includes(base) || SOURCE_TEXT_HEADERS.includes(base)) &&
    body.some((base) => SOURCE_LINK_HEADERS.includes(base));
}

const LINK = /\[[^\]]*\]\((?:https?:\/\/)[^)\s]+\)|https?:\/\/[^\s)|]+/gi;
/** A percentage, a ratio, a rank such as #3, or a cell that is only a number. */
const FIGURE = /\d\s*%|\d\s*\/\s*\d|#\s*\d|^\W*\d[\d.,]*\W*$/;

export interface ParsedReportTable {
  headers: string[];
  /** For each header, whether its column may stay in a report table. */
  listed: boolean[];
  /** Every row has exactly headers.length cells. Short rows are padded with ''. */
  rows: string[][];
  /** Index of the first line after the table. */
  end: number;
  /** A row had a stray pipe and its cells were joined back. The table has to be rewritten. */
  joined: boolean;
  /**
   * A row had more cells than headers and nothing says which cell the stray pipe
   * belongs to. rows is empty, and the caller leaves the table out.
   */
  unaligned: boolean;
}

/**
 * A sources table: links and titles, no figures. Defined narrowly.
 * Every header is a link or a title column, at least one is a link column, every
 * row holds a link, and no cell holds a percentage, a ratio, a rank or a bare number
 * once its links are taken out. A first column that numbers the rows is allowed,
 * and holds whole numbers only.
 */
export function isSourcesTable(table: Pick<ParsedReportTable, 'headers' | 'rows' | 'unaligned'>): boolean {
  if (table.unaligned || table.rows.length === 0 || !isSourcesHeaderSet(table.headers)) return false;
  const indexWidth = sourcesIndexWidth(table.headers.map((header) => headerParts(header).base));
  return table.rows.every((row) => {
    if (indexWidth === 1 && !/^\d+\.?$/.test(row[0])) return false;
    const cells = row.slice(indexWidth);
    const hasLink = cells.some((cell) => cell.search(LINK) >= 0);
    const hasFigure = cells.some((cell) => FIGURE.test(cell.replace(LINK, ' ').replace(/[*_`[\]()]/g, ' ').trim()));
    return hasLink && !hasFigure;
  });
}

/**
 * Reads a Markdown table that starts at lines[start], or returns null when there is
 * none there.
 *
 * A row with more cells than headers has a pipe that was not escaped, a page title
 * such as "Home | Acme" for example. The surplus cells are joined back only when
 * every header is listed and the table has exactly one free-text column: then the
 * pipe can only belong there. With two or more free-text columns nothing says which
 * one it belongs to, and with an unlisted header nothing says which cell is which,
 * so the table comes back as unaligned and the caller leaves it out.
 */
export function readTableAt(lines: readonly string[], start: number): ParsedReportTable | null {
  const headerLine = lines[start];
  const alignmentLine = lines[start + 1];
  if (typeof headerLine !== 'string' || !hasCellPipe(headerLine) || isFenceLine(headerLine)) return null;
  // The row under the header must carry a pipe. "A | B" over a plain "---" is a
  // heading with a rule under it, not a table.
  if (!isAlignmentRow(alignmentLine) || !alignmentLine.includes('|')) return null;

  let end = start + 2;
  while (end < lines.length && lines[end].trim() !== '' && hasCellPipe(lines[end]) && !isFenceLine(lines[end])) end++;

  const headers = splitTableRow(headerLine);
  const width = headers.length;
  const bases = headers.map((header) => headerParts(header).base);
  const split = lines.slice(start + 2, end).map(splitTableRow);

  const entityColumn = bases.findIndex((base) => base === 'entity' || base === 'brand');
  const entities = entityColumn < 0 ? [] : split.map((cells) => plainLower(cells[entityColumn] || '')).filter(Boolean);
  const listed = headers.map((header) => isReportColumn(header, entities));

  const sources = isSourcesHeaderSet(headers);
  const freeText = bases
    .map((base, index) => ((sources ? SOURCE_TEXT_HEADERS.includes(base) : FREE_TEXT_BASES.has(base)) ? index : -1))
    .filter((index) => index >= 0);
  const target = (sources || listed.every(Boolean)) && freeText.length === 1 ? freeText[0] : -1;

  const rows: string[][] = [];
  let joined = false;
  for (let cells of split) {
    if (cells.length > width) {
      if (target < 0) return { headers, listed, rows: [], end, joined: false, unaligned: true };
      const surplus = cells.length - width;
      cells = [
        ...cells.slice(0, target),
        cells.slice(target, target + surplus + 1).join(' | '),
        ...cells.slice(target + surplus + 1),
      ];
      joined = true;
    }
    while (cells.length < width) cells.push('');
    rows.push(cells);
  }
  return { headers, listed, rows, end, joined, unaligned: false };
}

function plainCell(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function htmlRows(html: string): string[][] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => plainCell(cell[1])),
  );
}

/** Turns one HTML table into Markdown table lines, or null when it cannot be lined up. */
function htmlTableToMarkdown(html: string): string[] | null {
  if (/\b(colspan|rowspan)\s*=/i.test(html)) return null;
  if ((html.match(/<table\b/gi) || []).length !== 1) return null;
  const rows = htmlRows(html);
  if (rows.length === 0 || rows[0].length === 0) return null;
  const width = rows[0].length;
  if (rows.some((row) => row.length !== width)) return null;
  return [tableLine(rows[0]), tableLine(rows[0].map(() => '---')), ...rows.slice(1).map(tableLine)];
}

/**
 * Marks the lines inside a code fence that is opened and closed. A fence is a line
 * that starts with three backticks, which is what the report screen treats as one.
 * A fence that never closes fences nothing: the text after it is gated as usual.
 */
function closedFenceLines(lines: readonly string[]): boolean[] {
  const fenced = lines.map(() => false);
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('```')) {
      i++;
      continue;
    }
    let close = -1;
    for (let k = i + 1; k < lines.length; k++) {
      if (lines[k].startsWith('```')) {
        close = k;
        break;
      }
    }
    if (close < 0) {
      i++;
      continue;
    }
    for (let k = i; k <= close; k++) fenced[k] = true;
    i = close + 1;
  }
  return fenced;
}

export interface ReportGateResult {
  text: string;
  /** Header text of each column that was removed. */
  removedColumns: string[];
  /** Tables left out whole. */
  removedTables: number;
  /**
   * HTML tables left exactly as written: their cells could not be lined up, and
   * every header that could be read is a listed one.
   */
  unparsedTables: number;
}

/**
 * Gates every table in a report. See the file header for the rule.
 * A table with only listed columns and no stray pipe comes back unchanged.
 */
export function gateReportTables(markdown: string): ReportGateResult {
  const lines = markdown.split('\n');
  const fenced = closedFenceLines(lines);
  const out: string[] = [];
  const removedColumns: string[] = [];
  let removedTables = 0;
  let unparsedTables = 0;

  const leaveOut = (unlistedHeaders: readonly string[]): void => {
    removedColumns.push(...unlistedHeaders);
    removedTables++;
    out.push(REMOVED_TABLE_NOTE);
  };

  const emitGated = (table: ParsedReportTable, original: readonly string[]): void => {
    const unlisted = table.headers.filter((_, index) => !table.listed[index]);
    const rewritten = () => [tableLine(table.headers), tableLine(table.headers.map(() => '---')), ...table.rows.map(tableLine)];
    if (isSourcesTable(table)) {
      out.push(...(table.joined ? rewritten() : original));
      return;
    }
    if (table.unaligned || unlisted.length === table.headers.length) {
      leaveOut(unlisted);
      return;
    }
    if (unlisted.length === 0) {
      out.push(...(table.joined ? rewritten() : original));
      return;
    }
    removedColumns.push(...unlisted);
    const kept = (cells: readonly string[]) => tableLine(cells.filter((_, index) => table.listed[index]));
    out.push(kept(table.headers), kept(table.headers.map(() => '---')), ...table.rows.map(kept));
  };

  let i = 0;
  while (i < lines.length) {
    if (fenced[i]) {
      out.push(lines[i]);
      i++;
      continue;
    }

    // An HTML table starts a line. "<table" in the middle of a sentence is prose.
    if (/^\s*<table\b/i.test(lines[i])) {
      let close = i;
      while (close < lines.length && !fenced[close] && !/<\/table>/i.test(lines[close])) close++;
      if (close >= lines.length || fenced[close]) {
        // No closing tag: not a table block. The lines after it are gated one by one.
        out.push(lines[i]);
        i++;
        continue;
      }
      const cut = lines[close].toLowerCase().indexOf('</table>') + '</table>'.length;
      const html = [...lines.slice(i, close), lines[close].slice(0, cut)].join('\n');
      const tail = lines[close].slice(cut);
      const asMarkdown = htmlTableToMarkdown(html);
      const parsed = asMarkdown ? readTableAt(asMarkdown, 0) : null;
      if (asMarkdown && parsed) {
        emitGated(parsed, asMarkdown);
      } else {
        // Merged cells or a nested table. Kept as written only when every header
        // that can be read is a listed one. Otherwise it is left out.
        const headers = htmlRows(html)[0] || [];
        const unlisted = headers.filter((header) => !isReportColumn(header));
        if (headers.length > 0 && unlisted.length === 0) {
          unparsedTables++;
          out.push(html);
        } else {
          leaveOut(unlisted);
        }
      }
      if (tail.trim()) out.push(tail);
      i = close + 1;
      continue;
    }

    const table = readTableAt(lines, i);
    if (table === null) {
      out.push(lines[i]);
      i++;
      continue;
    }
    emitGated(table, lines.slice(i, table.end));
    i = table.end;
  }

  return { text: out.join('\n'), removedColumns, removedTables, unparsedTables };
}

const AUDIT_SECTION = '\\b(?:visibility radar|competitor reality map|competitor map|fix list|strategic intelligence report|diagnostic scan)\\b';
const AUDIT_HEADING = new RegExp(
  `^(?:#{1,6} +.*${AUDIT_SECTION}|\\*\\*[^*\\n]*${AUDIT_SECTION}[^*\\n]*\\*\\*:?\\s*$)`,
  'im',
);

/**
 * True for a chat reply that is an audit: it has a heading at any level, or a line
 * that is one bold phrase, that names one of the audit's sections as whole words.
 * No top heading is needed. The chat renderer gates these before it shows, copies or
 * rewrites them. A reply that only mentions a section name in a sentence is not one,
 * and neither is a heading such as "Prefix list" or "Competitor mapping".
 */
export function looksLikeAuditReport(text: string): boolean {
  return AUDIT_HEADING.test(text);
}

/**
 * The gated report text. Logs once when a table was left as written, so a report
 * that slipped past the gate can be found.
 */
export function gateReportText(markdown: string): string {
  const result = gateReportTables(markdown || '');
  if (result.unparsedTables > 0) {
    console.warn(`[report gate] ${result.unparsedTables} table(s) left as written: the cells could not be lined up under the headers.`);
  }
  return result.text;
}
