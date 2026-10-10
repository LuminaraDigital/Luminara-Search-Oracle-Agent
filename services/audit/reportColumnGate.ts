/**
 * Report column gate.
 *
 * A model writes the audit report. The report has three tables with twelve columns
 * between them (REPORT_TABLES). The prompt templates print their table headers from
 * this file, and the gate keeps a table column only when its header is one of those
 * twelve, or when the calling code names it as a column it filled from evidence it
 * holds. Every other column is removed with its cells. A table with no listed
 * column is removed whole.
 *
 * The gate runs when a report is generated and again wherever one is rendered, so a
 * stored report gets the same treatment.
 *
 * What it does not do: it cannot check the value inside a kept cell, and it does not
 * read prose. A table it cannot parse is left exactly as written and counted, never
 * half-edited.
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

/** Shown where a table had no listed column and was removed. */
export const REMOVED_TABLE_NOTE = 'Table removed: its columns are not part of this audit.';

/**
 * How the chat template spelled five of the same twelve columns before it printed
 * its headers from REPORT_TABLES. Kept so a stored chat audit keeps those columns.
 */
const EARLIER_SPELLINGS = ['Competitors', 'Status', 'Brand', 'How AI talks about them', 'Pages that win citations'];

/** Lower case, no emphasis marks, no HTML tags, no hint in brackets. */
function headerKey(header: string): string {
  return header
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const LISTED_KEYS = new Set<string>(
  [...Object.values(REPORT_TABLES).flat(), ...EARLIER_SPELLINGS].map(headerKey),
);

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

/** Splits one table row on pipes. A pipe written as \| stays inside its cell. */
export function splitTableRow(line: string): string[] {
  const body = line.trim();
  const cells: string[] = [];
  let cell = '';
  let endedOnDelimiter = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      cell += '\\|';
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

export interface ParsedReportTable {
  headers: string[];
  /** Every row has exactly headers.length cells. Short rows are padded with ''. */
  rows: string[][];
  /** Index of the first line after the table. */
  end: number;
}

/**
 * Reads a Markdown table that starts at lines[start].
 * Returns null when there is no table there, and 'unparsed' when there is one whose
 * cells cannot be lined up under its headers.
 */
export function readTableAt(lines: readonly string[], start: number): ParsedReportTable | 'unparsed' | null {
  const headerLine = lines[start];
  const alignmentLine = lines[start + 1];
  if (typeof headerLine !== 'string' || !hasCellPipe(headerLine) || isFenceLine(headerLine)) return null;
  // The row under the header must carry a pipe. "A | B" over a plain "---" is a
  // heading with a rule under it, not a table.
  if (!isAlignmentRow(alignmentLine) || !alignmentLine.includes('|')) return null;

  let end = start + 2;
  while (end < lines.length && lines[end].trim() !== '' && hasCellPipe(lines[end]) && !isFenceLine(lines[end])) end++;

  const headers = splitTableRow(headerLine);
  if (splitTableRow(alignmentLine).length !== headers.length) return 'unparsed';
  const rows: string[][] = [];
  for (let k = start + 2; k < end; k++) {
    const cells = splitTableRow(lines[k]);
    if (cells.length > headers.length) return 'unparsed';
    while (cells.length < headers.length) cells.push('');
    rows.push(cells);
  }
  return { headers, rows, end };
}

function plainCell(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\|/g, '\\|');
}

/** Turns one HTML table into Markdown table lines, or null when it cannot be lined up. */
function htmlTableToMarkdown(html: string): string[] | null {
  if (!/^\s*<table\b[\s\S]*<\/table>\s*$/i.test(html)) return null;
  if (/\b(colspan|rowspan)\s*=/i.test(html)) return null;
  if ((html.match(/<table\b/gi) || []).length !== 1) return null;
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => plainCell(cell[1])),
  );
  if (rows.length === 0 || rows[0].length === 0) return null;
  const width = rows[0].length;
  if (rows.some((row) => row.length !== width)) return null;
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(rows[0]), line(rows[0].map(() => '---')), ...rows.slice(1).map(line)];
}

export interface ReportGateResult {
  text: string;
  /** Header text of each column that was removed. */
  removedColumns: string[];
  /** Tables that had no listed column and were removed whole. */
  removedTables: number;
  /** Tables left exactly as written because their cells could not be lined up. */
  unparsedTables: number;
}

/**
 * Gates every table in a report. See the file header for the rule.
 * A table with only listed columns comes back unchanged. A code fence is no shelter:
 * the report renderers do not agree on what a fence is, so a table inside one, or
 * after one that never closes, is gated like any other.
 */
export function gateReportTables(markdown: string, options: ReportGateOptions = {}): ReportGateResult {
  const lines = markdown.split('\n');
  const out: string[] = [];
  const removedColumns: string[] = [];
  let removedTables = 0;
  let unparsedTables = 0;

  const emitGated = (table: ParsedReportTable, original: readonly string[]): void => {
    const keep = table.headers.map((_, index) => index).filter((index) => isReportColumn(table.headers[index], options));
    if (keep.length === table.headers.length) {
      out.push(...original);
      return;
    }
    for (const [index, header] of table.headers.entries()) {
      if (!keep.includes(index)) removedColumns.push(header);
    }
    if (keep.length === 0) {
      removedTables++;
      out.push(REMOVED_TABLE_NOTE);
      return;
    }
    const line = (cells: readonly string[]) => `| ${keep.map((index) => cells[index]).join(' | ')} |`;
    out.push(line(table.headers), line(table.headers.map(() => '---')), ...table.rows.map(line));
  };

  let i = 0;
  while (i < lines.length) {
    if (/<table\b/i.test(lines[i])) {
      let close = i;
      while (close < lines.length && !/<\/table>/i.test(lines[close])) close++;
      const closed = close < lines.length;
      const asMarkdown = closed ? htmlTableToMarkdown(lines.slice(i, close + 1).join('\n')) : null;
      const parsed = asMarkdown ? readTableAt(asMarkdown, 0) : null;
      if (asMarkdown && parsed && parsed !== 'unparsed') {
        emitGated(parsed, asMarkdown);
        i = close + 1;
        continue;
      }
      // No closing tag, merged cells, a nested table or text around the tags:
      // leave the lines as written.
      unparsedTables++;
      const stop = closed ? close + 1 : i + 1;
      out.push(...lines.slice(i, stop));
      i = stop;
      continue;
    }

    const table = readTableAt(lines, i);
    if (table === null) {
      out.push(lines[i]);
      i++;
      continue;
    }
    if (table === 'unparsed') {
      unparsedTables++;
      let end = i + 2;
      while (end < lines.length && lines[end].trim() !== '' && hasCellPipe(lines[end]) && !isFenceLine(lines[end])) end++;
      out.push(...lines.slice(i, end));
      i = end;
      continue;
    }
    emitGated(table, lines.slice(i, table.end));
    i = table.end;
  }

  return { text: out.join('\n'), removedColumns, removedTables, unparsedTables };
}

/**
 * True for a chat reply that is an audit: a top heading, plus a heading that names
 * one of the audit's sections. The chat renderer gates these before it shows, copies
 * or rewrites them. A reply that only mentions a section name in a sentence is not one.
 */
export function looksLikeAuditReport(text: string): boolean {
  return /^# /m.test(text) &&
    /^#{1,4} .*(visibility radar|competitor reality map|competitor map|fix list|strategic intelligence report|diagnostic scan)/im.test(text);
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
