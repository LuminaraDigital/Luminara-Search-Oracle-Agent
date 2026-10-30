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

import { stripUntrustedFences } from '../../utils/untrustedContent';

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
const PAGE_READ_SOURCE = /\((?:firecrawl|jina|patchright|exa)(?:\s+[a-z][a-z ]{0,24})?\)/gi;
const WEB_SEARCH_SOURCE = /\((?:tavily|groq)(?:\s+[a-z][a-z ]{0,24})?\)/gi;
const HSTS_TITLE = 'Make browsers always use the secure version of your site (HSTS)';
const CSP_TITLE = 'Control which scripts your site can load (CSP)';
const SECURITY_FILE = 'a public security contact file (security.txt)';
const IDENTITY_NOUN = 'business identity tag';
const IDENTITY_ACTION = 'Add a business identity tag';

export type SourceReadKind = 'page read' | 'web search';

function hostOf(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Page on the audited host is a page read. Every other URL is a web search result. */
export function sourceReadKind(uri: string, domain?: string): SourceReadKind {
  const target = hostOf(domain || '');
  const host = hostOf(uri);
  if (target && host === target) return 'page read';
  return 'web search';
}

/** URL, then title, then (page read) or (web search). A title that only repeats the URL is left off. */
export function customerSourceLine(uri: string, title: string, kind: SourceReadKind): string {
  const cleanUri = uri.trim();
  const cleanTitle = title
    .replace(/\s*\((?:page read|web search|target domain)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleanTitle || cleanTitle === cleanUri) return `${cleanUri} (${kind})`;
  return `${cleanUri} ${cleanTitle} (${kind})`;
}

/** Keep the article the match already had. A bare term stays a bare noun. */
function nounWithArticle(match: string, noun: string): string {
  const lead = match.match(/^\s*(a|an|the)\b/i);
  if (!lead) return noun;
  return lead[1].toLowerCase() === 'the' ? `the ${noun}` : `a ${noun}`;
}

function collapseRepeated(line: string): string {
  let next = line
    .replace(/\)(?=[A-Za-z])/g, ') ')
    .replace(/\baa\s+/gi, 'a ')
    .replace(/\ba\s+an\b/gi, 'a')
    .replace(/\ban\s+a\b/gi, 'a')
    .replace(/\bthe\s+a\b/gi, 'a')
    .replace(/\ba\s+a\b/gi, 'a');
  const phrase = /\b([A-Za-z]+(?:\s+[A-Za-z]+){0,5})\s+\1\b/gi;
  for (let pass = 0; pass < 4; pass += 1) {
    const collapsed = next.replace(phrase, '$1');
    if (collapsed === next) break;
    next = collapsed;
  }
  return next.replace(/file \(security\.txt\)(?:\s+file\b)+/gi, 'file (security.txt)');
}

/** A dot that belongs to a number, a version, or a host, not the end of a sentence. */
function keepTightDot(full: string, dot: number): boolean {
  const before = full.slice(0, dot);
  const after = full.slice(dot + 1);
  if (/\d$/.test(before) && /^\d/.test(after)) return true;
  const tail = before.match(/\S*$/)?.[0] || '';
  if (/^www$/i.test(tail)) return true;
  if (/https?:\/\/\S*$/i.test(tail) && !/^[A-Z][a-z]/.test(after)) return true;
  return false;
}

/** One pair of brackets per term. A second copy of the same pair is dropped. */
function unwrapDoubleParens(line: string): string {
  return line
    .replace(/\(\(([^)]+)\)\)/g, '($1)')
    .replace(/\(([^)]+)\)\s+\(\1\)/gi, '($1)');
}

function spaceAfterStop(line: string): string {
  return line.replace(/([.!?])(?=[A-Z])/g, (match, stop: string, offset: number, full: string) => {
    if (stop === '.' && keepTightDot(full, offset)) return match;
    return `${stop} `;
  });
}

/** No check measures this. A sentence saying a file or header lifts AI citation trust is dropped. */
function dropInventedTrustClaim(line: string): string {
  if (!/\btrust signals?\b/i.test(line) || /^\s*(?:\||[-*]\s)/.test(line)) return line;
  return line
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !(/\btrust signals?\b/i.test(sentence) && /\b(?:AI|citation)\b/.test(sentence)))
    .join(' ');
}

const HSTS_GLOSS = "doesn't force the secure version of the site (HSTS)";
const CSP_GLOSS = "doesn't control which scripts can load (CSP)";

/** Bare HSTS and CSP become the one allowed parenthetical. A term already inside (HSTS) or (CSP) stays. */
function glossSecurity(line: string): string {
  return line
    .replace(/\bSecurity headers\s*\(\s*HSTS\s*,\s*CSP\s*\)/gi, `The site ${HSTS_GLOSS} and ${CSP_GLOSS}`)
    .replace(/\(\s*HSTS\s*,\s*CSP\s*\)/gi, `${HSTS_GLOSS} and ${CSP_GLOSS}`)
    .replace(/\blacks\s+HSTS\s+and\s+CSP\b/gi, `${HSTS_GLOSS} and ${CSP_GLOSS}`)
    .replace(/(?<!\()\bHSTS\b(?!\))/gi, HSTS_GLOSS)
    .replace(/(?<!\()\bCSP\b(?!\))/gi, CSP_GLOSS);
}

/** A dot glued to a real word, not a host, a file suffix, or a decimal. */
function gluedWord(full: string, dot: number): boolean {
  if (keepTightDot(full, dot)) return false;
  const word = full.slice(dot + 1).match(/^[a-z][a-z']*/)?.[0] || '';
  if (!word) return false;
  if (word.includes("'")) return true;
  if (/^(?:no|the|a|an|this|these|it|and|but)$/.test(word)) return true;
  return word.length >= 8;
}

/**
 * Space after a stop, then a capital. A host, a URL, and a decimal keep their dot.
 * This capitalises in place. It does not drop the word that was there.
 */
function finishSentences(line: string): string {
  const opened = line.replace(/([.!?])(?=[a-z])/g, (match, stop: string, offset: number, full: string) => {
    if (!gluedWord(full, offset)) return match;
    return `${stop} `;
  });
  const spaced = spaceAfterStop(opened);
  return spaced.replace(/(^|[.!?]\s+)([a-z])/g, (match, lead: string, letter: string, offset: number, full: string) => {
    if (lead.startsWith('.') && keepTightDot(full, offset)) return match;
    const rest = full.slice(offset + lead.length);
    if (/^https?:\/\//i.test(rest) || /^www\./i.test(rest)) return match;
    return `${lead}${letter.toUpperCase()}`;
  });
}

function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const stop = clean[i];
    if (stop !== '.' && stop !== '!' && stop !== '?') continue;
    if (clean[i + 1] && clean[i + 1] !== ' ') continue;
    if (stop === '.' && keepTightDot(clean, i)) continue;
    const sentence = clean.slice(start, i + 1).trim();
    if (sentence) out.push(sentence);
    start = i + 1;
    while (clean[start] === ' ') start += 1;
    i = start - 1;
  }
  const tail = clean.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

const DENIES_MENTIONS = /\blimited visibility\b|\b(?:no|zero|without|not|limited)\b[^.]{0,60}\b(?:mention|mentions|citation|citations|cited)\b/i;
const CLAIMS_MENTIONS = /\bmentioned\b|\bcited in\b|\b(?:is|are|was|were)\s+cited\b|\bappears in\b/i;

/** The measured "mentioned in N of M" count, or null when this run did not count. */
export function mentionedCount(citationLine: string | null | undefined): number | null {
  const match = citationLine?.match(/\b(?:mentioned|cited) in (\d+) of \d+/i);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isInteger(count) ? count : null;
}

/**
 * A model sentence has to agree with the measured mention count.
 * Above zero, a claim of no or limited mentions is dropped. At zero, a claim of mentions is dropped.
 */
export function mentionSentenceOk(sentence: string, mentioned: number | null): boolean {
  if (mentioned == null) return true;
  if (mentioned > 0) return !DENIES_MENTIONS.test(sentence);
  return !CLAIMS_MENTIONS.test(sentence);
}

/** Drops every model sentence that contradicts the measured mention count. Headings, tables, and code stay. */
export function withoutContradictorySentences(markdown: string, mentioned: number | null): string {
  if (mentioned == null || !markdown) return markdown;
  let fence = false;
  return markdown.split('\n').map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      fence = !fence;
      return line;
    }
    if (fence || !trimmed || /^#{1,6}\s/.test(trimmed) || trimmed.startsWith('|')) return line;
    const sentences = splitSentences(trimmed);
    const kept = sentences.filter((sentence) => mentionSentenceOk(sentence, mentioned));
    if (kept.length === sentences.length) return line;
    if (!kept.length) return '';
    return `${line.match(/^\s*/)?.[0] ?? ''}${kept.join(' ')}`;
  }).join('\n');
}

/** Sentences from one line that name a measured query or a check. The rest are dropped. */
export function sentencesCiting(text: string, anchors: readonly string[]): string {
  if (!anchors.length) return '';
  const kept = splitSentences(text).filter((sentence) => {
    const hay = sentence.toLowerCase();
    return anchors.some((anchor) => hay.includes(anchor));
  });
  return kept.join(' ');
}

const BARE_JARGON = /\b(HSTS|CSP|JSON-?LD|SERP|DOM)\b/gi;

/** Issues a customer sentence must not have. An empty list means the text can be shown. */
export function proseIssues(text: string): string[] {
  const issues: string[] = [];
  if (text.includes('\u2014')) issues.push('em dash');
  if (/\)[A-Za-z]/.test(text)) issues.push('glued paren');
  if (/\b([A-Za-z]+)\s+\1\b/i.test(text)) issues.push('doubled word');
  if (/\b(a|an|the)\s+\1\b/i.test(text)) issues.push('doubled article');
  const trimmed = text.trim();
  if (trimmed && /^[a-z]/.test(trimmed)) issues.push('lowercase start');
  if (/[.!?]\s+[a-z]/.test(trimmed)) issues.push('lowercase sentence');
  for (const found of trimmed.matchAll(BARE_JARGON)) {
    const word = found[1].toUpperCase();
    const at = found.index ?? 0;
    const allowed = (word === 'HSTS' || word === 'CSP') && trimmed[at - 1] === '(' && trimmed[at + found[1].length] === ')';
    if (!allowed) issues.push(`bare ${word}`);
  }
  return issues;
}

export type AuditTextScope = { domain?: string; brand?: string };

/** True when a search result names the audited domain or brand. With no scope, the row stays. */
export function sourceMentionsAudit(uri: string, title: string, scope?: AuditTextScope): boolean {
  const domain = (scope?.domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  const brand = (scope?.brand || '').trim();
  if (!domain && brand.length < 3) return true;
  const hay = `${uri} ${title}`;
  const host = hostOf(uri);
  if (domain && (host === domain || host.endsWith(`.${domain}`) || hay.toLowerCase().includes(domain))) return true;
  if (brand.length >= 3) {
    const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(hay)) return true;
  }
  return false;
}

function scrubCustomerLine(line: string): string {
  const normalized = line
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/\[\[([^[\]]+)\]\]/g, '$1');
  const next = normalized
    // After "Verify" the term names the header, so neither the title nor the gloss reads as a sentence.
    .replace(/\b(Verify|verify)\s+[`*]*(?:the\s+)?[`*]*HSTS[`*]*(?:\s+header)?/g, '$1 the header that forces the secure version of the site (HSTS)')
    .replace(/\b(Verify|verify)\s+[`*]*(?:the\s+)?[`*]*CSP[`*]*(?:\s+header)?/g, '$1 the header that controls which scripts can load (CSP)')
    .replace(/\b(?:Implement|Add(?: an)?)\s+(?:an?\s+)?HTTP Strict[-\s]+Transport[-\s]+Security(?:\s*\(HSTS\))?(?:\s+header)?\b/gi, HSTS_TITLE)
    .replace(/\b(?:(?:a|an|the)\s+)?(?:Add(?: an?)?\s+)?HSTS header\b/gi, HSTS_TITLE)
    .replace(/HTTP Strict[-\s]+Transport[-\s]+Security(?:\s*\(HSTS\))?/gi, HSTS_TITLE)
    .replace(/Add a header that forces secure HTTPS connections \(HSTS\)/gi, HSTS_TITLE)
    .replace(/\ba header that forces secure HTTPS connections \(HSTS\)/gi, HSTS_TITLE)
    .replace(/Missing HSTS;?\s*lowers security trust score\.?/gi, 'The site does not force secure HTTPS connections (HSTS).')
    .replace(/\bMissing HSTS\b/gi, 'Does not force secure HTTPS connections (HSTS)')
    .replace(/\b(?:Implement|Add|Publish)\s+(?:a\s+)?Content-Security-Policy(?:\s+header)?\b/gi, CSP_TITLE)
    .replace(/\b(?:(?:a|an|the)\s+)?(?:Add(?: a)?\s+)?CSP header\b/gi, CSP_TITLE)
    .replace(/Add a rule that controls which scripts the site can load \(CSP\)/gi, CSP_TITLE)
    .replace(/\ba rule that controls which scripts the site can load \(CSP\)/gi, CSP_TITLE)
    .replace(/Content-Security-Policy(?: header)?|Content Security Policy(?: \(CSP\))?/gi, CSP_TITLE)
    .replace(/\b(?:Insert|Add|Implement|Publish|Ship)(?:\s+(?:a|an|the|basic))*\s+(?:Organization|organisation)\s+(?:JSON-?LD|markup|schema)(?:\s+block)?(?:\s+(?:file|header|markup|tag)\b)?/gi, IDENTITY_ACTION)
    .replace(/\b(?:Insert|Add|Implement|Publish|Ship)(?:\s+(?:a|an|the|basic))*\s+JSON-?LD(?:\s+block)?(?:\s+(?:file|header|markup|tag)\b)?/gi, IDENTITY_ACTION)
    .replace(/\bno\s+structured\s+data\b/gi, `no ${IDENTITY_NOUN}`)
    .replace(/\bstructured\s+data\b/gi, IDENTITY_NOUN)
    .replace(/\bSchema\.org\b/gi, IDENTITY_NOUN)
    .replace(/\bShip\s+schema\s*\/\s*(?:a\s+)?business identity tag\b/gi, IDENTITY_ACTION)
    .replace(/\bAdd or fix\s+(?:a\s+)?business identity tag\b[^.]*/gi, IDENTITY_ACTION)
    .replace(/(?:\b(?:a|an|the)\s+)?(?:Organization|organisation)\s+(?:markup|schema)(?:\s+(?:file|header|markup|tag)\b)?/gi, (match) => nounWithArticle(match, IDENTITY_NOUN))
    .replace(/(?:\b(?:a|an|the)\s+)?(?:Organization\s+)?JSON-?LD(?:\s+block)?(?:\s+(?:file|header|markup|tag)\b)?/gi, (match) => nounWithArticle(match, IDENTITY_NOUN))
    .replace(/\btag\s+markup\b/gi, 'tag')
    .replace(/[ \t]+markup\s*$/gim, '')
    .replace(/(?:\b(?:a|an|the)\s+)?(?:a public\s+)?(?<![:\w./(-])security\.txt(?:file)?\b(?:\s+(?:file|header|markup|tag)\b)?/gi, SECURITY_FILE)
    .replace(PAGE_READ_SOURCE, '(page read)')
    .replace(WEB_SEARCH_SOURCE, '(web search)')
    .replace(/\(untrusted enrichment block\)/gi, '(security and public records)')
    .replace(/\buntrusted enrichment block\b/gi, 'security and public records');
  return finishSentences(unwrapDoubleParens(collapseRepeated(glossSecurity(dropInventedTrustClaim(next)))));
}

function modelSourceLine(line: string): string {
  const match = line.match(/https?:\/\/[^\s<>)\]]+/i);
  if (!match) return line;
  const uri = match[0].replace(/[.,;]+$/, '');
  const trimmed = line.trim();
  const kind: SourceReadKind = /\(page read\)\s*$/i.test(trimmed) || /^([-*]\s+)?page read\b/i.test(trimmed)
    ? 'page read'
    : 'web search';
  let title = line.replace(uri, ' ');
  title = title
    .replace(/\((?:page read|web search)\)/gi, ' ')
    .replace(/\b(?:page read|web search)\s*:?/gi, ' ')
    .replace(/title\s*[“"']([^”"']+)[”"']/gi, '$1')
    .replace(/[“”"']/g, '')
    .replace(/,?\s*\d[\d,.]*\s*words?\b/gi, ' ')
    .replace(/[()*]/g, ' ')
    .replace(/^[\s:,.-]+|[\s:,.-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const lead = line.match(/^\s*(?:[-*]\s+)?/);
  return `${lead ? lead[0] : ''}${customerSourceLine(uri, title, kind)}`;
}

function sourceList(line: string, scope?: AuditTextScope): string {
  const urls = [...line.matchAll(/https?:\/\/[^\s<>)\]]+/gi)];
  if (!urls.length) return scrubCustomerLine(line);
  if (urls.length === 1) {
    const uri = urls[0][0].replace(/[.,;]+$/, '');
    const text = modelSourceLine(scrubCustomerLine(line)).replace(/^\s*[-*]\s+/, '').trim();
    if (!sourceMentionsAudit(uri, text, scope)) return '';
    return `- ${text}`;
  }
  const items: string[] = [];
  let cursor = 0;
  for (let i = 0; i < urls.length; i += 1) {
    const uri = urls[i][0].replace(/[.,;]+$/, '');
    const at = urls[i].index ?? 0;
    const before = line.slice(cursor, at);
    const afterStart = at + urls[i][0].length;
    const afterEnd = i + 1 < urls.length ? (urls[i + 1].index ?? line.length) : line.length;
    const chunk = `${uri} ${before} ${line.slice(afterStart, afterEnd)}`;
    const text = modelSourceLine(scrubCustomerLine(chunk)).replace(/^\s*[-*]\s+/, '').trim();
    cursor = afterEnd;
    if (!sourceMentionsAudit(uri, text, scope)) continue;
    items.push(`- ${text}`);
  }
  return items.join('\n');
}

/** Customer report lines. Code blocks stay as written. Vendor names and header jargon do not. */
export function plainCustomerReport(markdown: string, scope: AuditTextScope = {}): string {
  let fence = false;
  let sources = false;
  return markdown.split('\n').map((line) => {
    if (line.trim().startsWith('```')) {
      fence = !fence;
      return line;
    }
    if (fence) return line;
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      sources = /\bsources\b/i.test(trimmed);
      return scrubCustomerLine(line);
    }
    if (sources && !trimmed.startsWith('|') && /https?:\/\//i.test(line)) return sourceList(line, scope);
    return scrubCustomerLine(line);
  }).join('\n');
}

export function gateReportText(markdown: string, scope: AuditTextScope = {}): string {
  const result = gateReportTables(markdown || '');
  if (result.unparsedTables > 0) {
    console.warn(`[report gate] ${result.unparsedTables} table(s) left as written: the cells could not be lined up under the headers.`);
  }
  return plainCustomerReport(stripUntrustedFences(result.text), scope);
}
