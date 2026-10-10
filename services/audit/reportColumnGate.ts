/**
 * Report column gate.
 *
 * A model writes the audit report. The report has three tables with twelve columns
 * between them (REPORT_TABLES). The prompt templates print their table headers from
 * this file, and the gate keeps a table column only when its header is one of those
 * twelve, or when the calling code names it as a column it filled from evidence it
 * holds (measuredColumns). Every other column is removed with its cells.
 *
 * Whole tables:
 * - A table with no listed column is left out, and one line says so.
 * - A sources table (links and titles, no figures) is kept as written.
 * - A table inside a closed code fence is code, and is left alone.
 * - A table whose rows cannot be lined up under its headers is left out too when any
 *   of its headers is not listed. It is never passed through as written.
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

/**
 * The one extra table a report may carry: figures from the site's own analytics.
 * The report prompt offers these headers, and the report call passes them to the gate
 * as measuredColumns, only in a run where that analytics block was fetched.
 */
export const MEASURED_TRAFFIC_COLUMNS = ['Measured traffic', 'This period (measured)', 'Previous period (measured)'] as const;

/** Shown where a table was left out. */
export const REMOVED_TABLE_NOTE = 'A table was left out because its column names were not recognised.';

/**
 * How the chat template spelled five of the same twelve columns before it printed
 * its headers from REPORT_TABLES. Kept so a stored chat audit keeps those columns.
 */
const EARLIER_SPELLINGS = ['Competitors', 'Status', 'Brand', 'How AI talks about them', 'Pages that win citations'];

/** Columns whose cells are free text, so a stray pipe in a row most likely sits in one of them. */
const FREE_TEXT_COLUMNS = [
  'Task', 'Plain issue', 'Query', 'Key Competitors', 'Entity', 'AI Perception (Tone/Claims)',
  'Top Cited Page Types', 'Content Advantage (vs You)',
  'Competitors', 'Brand', 'How AI talks about them', 'Pages that win citations',
];

/** Headers of a sources table. Link columns first. */
const SOURCE_LINK_HEADERS = ['url', 'link', 'source', 'sources', 'reference', 'references'];
const SOURCE_TEXT_HEADERS = ['title', 'page title', 'site', 'publisher'];

/**
 * Lower case, no emphasis marks or HTML tags, one space between words.
 * A bracketed hint stays part of the key, with the spaces inside it removed.
 */
function headerKey(header: string): string {
  return header
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s*\(([^)]*)\)/g, (_match, inner: string) => `(${inner.replace(/\s+/g, '')})`);
}

/**
 * The keys a listed header may have: as the template prints it, hint and all, or
 * with no bracket. Any other bracket makes a different key, so "Priority (Expected
 * Impact)" is not "Priority".
 */
function keysOf(headers: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const header of headers) {
    const full = headerKey(header);
    keys.add(full);
    keys.add(full.replace(/\([^)]*\)/g, '').trim());
  }
  return keys;
}

const LISTED_KEYS = keysOf([...Object.values(REPORT_TABLES).flat(), ...EARLIER_SPELLINGS]);
const FREE_TEXT_KEYS = keysOf(FREE_TEXT_COLUMNS);

export interface ReportGateOptions {
  /**
   * Extra headers the calling code filled from evidence it holds in this run.
   * Only code may pass these. A header that calls itself measured inside the
   * report text is not on this list and is removed like any other.
   */
  measuredColumns?: readonly string[];
}

/** True when a column with this header may stay in a report table. */
export function isReportColumn(header: string, options: ReportGateOptions = {}): boolean {
  const key = headerKey(header);
  if (!key) return false;
  if (LISTED_KEYS.has(key)) return true;
  return (options.measuredColumns || []).some((measured) => headerKey(measured) === key);
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

function isSourcesHeaderSet(headers: readonly string[]): boolean {
  const keys = headers.map(headerKey);
  return keys.length > 0 &&
    keys.every((key) => SOURCE_LINK_HEADERS.includes(key) || SOURCE_TEXT_HEADERS.includes(key)) &&
    keys.some((key) => SOURCE_LINK_HEADERS.includes(key));
}

const LINK = /\[[^\]]*\]\((?:https?:\/\/)[^)\s]+\)|https?:\/\/[^\s)|]+/gi;
/** A percentage, a ratio, a rank such as #3, or a cell that is only a number. */
const FIGURE = /\d\s*%|\d\s*\/\s*\d|#\s*\d|^\W*\d[\d.,]*\W*$/;

export interface ParsedReportTable {
  headers: string[];
  /** Every row has exactly headers.length cells. Short rows are padded with ''. */
  rows: string[][];
  /** Index of the first line after the table. */
  end: number;
  /** A row had a stray pipe and its cells were joined back. The table has to be rewritten. */
  joined: boolean;
  /**
   * A row had more cells than headers and one of the headers is not listed, so
   * nothing says which cell belongs where. rows is empty.
   */
  unaligned: boolean;
}

/**
 * A sources table: links and titles, no figures. Defined narrowly.
 * Every header is a link or a title column, at least one is a link column, every
 * row holds a link, and no cell holds a percentage, a ratio, a rank or a bare number
 * once its links are taken out.
 */
export function isSourcesTable(table: Pick<ParsedReportTable, 'headers' | 'rows' | 'unaligned'>): boolean {
  if (table.unaligned || table.rows.length === 0 || !isSourcesHeaderSet(table.headers)) return false;
  return table.rows.every((row) => {
    const hasLink = row.some((cell) => cell.search(LINK) >= 0);
    const hasFigure = row.some((cell) => FIGURE.test(cell.replace(LINK, ' ').replace(/[*_`[\]()]/g, ' ').trim()));
    return hasLink && !hasFigure;
  });
}

/**
 * Reads a Markdown table that starts at lines[start], or returns null when there is
 * none there.
 *
 * A row with more cells than headers has a pipe that was not escaped, a page title
 * such as "Home | Acme" for example. When every header is listed, the surplus cells
 * are joined back into the last free-text column. When a header is not listed, the
 * table comes back as unaligned and the caller leaves it out.
 */
export function readTableAt(
  lines: readonly string[],
  start: number,
  options: ReportGateOptions = {},
): ParsedReportTable | null {
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
  const placeable = headers.every((header) => isReportColumn(header, options)) || isSourcesHeaderSet(headers);
  const keys = headers.map(headerKey);
  let target = -1;
  keys.forEach((key, index) => {
    if (FREE_TEXT_KEYS.has(key) || SOURCE_TEXT_HEADERS.includes(key)) target = index;
  });
  if (target < 0) target = width - 1;

  const rows: string[][] = [];
  let joined = false;
  for (let k = start + 2; k < end; k++) {
    let cells = splitTableRow(lines[k]);
    if (cells.length > width) {
      if (!placeable) return { headers, rows: [], end, joined: false, unaligned: true };
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
  return { headers, rows, end, joined, unaligned: false };
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
export function gateReportTables(markdown: string, options: ReportGateOptions = {}): ReportGateResult {
  const lines = markdown.split('\n');
  const fenced = closedFenceLines(lines);
  const out: string[] = [];
  const removedColumns: string[] = [];
  let removedTables = 0;
  let unparsedTables = 0;

  const leaveOut = (headers: readonly string[]): void => {
    removedColumns.push(...headers.filter((header) => !isReportColumn(header, options)));
    removedTables++;
    out.push(REMOVED_TABLE_NOTE);
  };

  const emitGated = (table: ParsedReportTable, original: readonly string[]): void => {
    if (table.unaligned) {
      leaveOut(table.headers);
      return;
    }
    const rewritten = () => [tableLine(table.headers), tableLine(table.headers.map(() => '---')), ...table.rows.map(tableLine)];
    if (isSourcesTable(table)) {
      out.push(...(table.joined ? rewritten() : original));
      return;
    }
    const keep = table.headers.map((_, index) => index).filter((index) => isReportColumn(table.headers[index], options));
    if (keep.length === 0) {
      leaveOut(table.headers);
      return;
    }
    if (keep.length === table.headers.length) {
      out.push(...(table.joined ? rewritten() : original));
      return;
    }
    removedColumns.push(...table.headers.filter((_, index) => !keep.includes(index)));
    const kept = (cells: readonly string[]) => tableLine(keep.map((index) => cells[index]));
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
      const parsed = asMarkdown ? readTableAt(asMarkdown, 0, options) : null;
      if (asMarkdown && parsed) {
        emitGated(parsed, asMarkdown);
      } else {
        // Merged cells or a nested table. Kept as written only when every header
        // that can be read is a listed one. Otherwise it is left out.
        const headers = htmlRows(html)[0] || [];
        if (headers.length > 0 && headers.every((header) => isReportColumn(header, options))) {
          unparsedTables++;
          out.push(html);
        } else {
          leaveOut(headers);
        }
      }
      if (tail.trim()) out.push(tail);
      i = close + 1;
      continue;
    }

    const table = readTableAt(lines, i, options);
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

const AUDIT_SECTION = '(?:visibility radar|competitor reality map|competitor map|fix list|strategic intelligence report|diagnostic scan)';
const AUDIT_HEADING = new RegExp(
  `^(?:#{1,6} +.*${AUDIT_SECTION}|\\*\\*[^*\\n]*${AUDIT_SECTION}[^*\\n]*\\*\\*:?\\s*$)`,
  'im',
);

/**
 * True for a chat reply that is an audit: it has a heading at any level, or a line
 * that is one bold phrase, that names one of the audit's sections. No top heading is
 * needed. The chat renderer gates these before it shows, copies or rewrites them.
 * A reply that only mentions a section name in a sentence is not one.
 */
export function looksLikeAuditReport(text: string): boolean {
  return AUDIT_HEADING.test(text);
}

/**
 * The gated report text. Logs once when a table was left as written, so a report
 * that slipped past the gate can be found.
 */
export function gateReportText(markdown: string, options: ReportGateOptions = {}): string {
  const result = gateReportTables(markdown || '', options);
  if (result.unparsedTables > 0) {
    console.warn(`[report gate] ${result.unparsedTables} table(s) left as written: the cells could not be lined up under the headers.`);
  }
  return result.text;
}
