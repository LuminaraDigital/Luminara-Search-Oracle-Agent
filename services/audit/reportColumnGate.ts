/**
 * Report column gate.
 *
 * A model writes the audit report. No evidence block in the report prompt carries an
 * impact estimate, a search rank, a rich result status, an AI Overview status or a
 * trust signal strength. A table column under one of those headers can only hold
 * values the model made up. The prompt no longer asks for those columns. This gate
 * removes them when the model writes them anyway.
 *
 * Pure string functions so the rule is unit-testable.
 * Invariant: no em dashes (U+2014) in copy or comments. Use '-', ':', or '.'.
 */

/** Header cells no evidence row can fill today. Matched without regard to case. */
const UNMEASURED_REPORT_COLUMNS: readonly RegExp[] = [
  /\bimpact\b/i,
  /\brank(?:ing)?\b/i,
  /\brich results?\b/i,
  /\bai overviews?\b/i,
  /\btrust signals?\b/i,
];

export function isUnmeasuredReportColumn(header: string): boolean {
  const plain = header.replace(/[*_`]/g, '').trim();
  return UNMEASURED_REPORT_COLUMNS.some((pattern) => pattern.test(plain));
}

function isTableLine(line: string | undefined): line is string {
  return typeof line === 'string' && line.trimStart().startsWith('|');
}

function splitTableRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map((cell) => cell.trim());
}

/**
 * Removes every unmeasured column from the Markdown tables in a report.
 * Tables with no such column, and text inside code fences, come back unchanged.
 * A table left with no column is dropped.
 */
export function stripUnmeasuredReportColumns(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    const separator = lines[i + 1];
    if (inFence || !isTableLine(line) || !isTableLine(separator) || !separator.includes('---')) {
      out.push(line);
      i++;
      continue;
    }
    let end = i + 2;
    while (end < lines.length && isTableLine(lines[end])) end++;
    const headers = splitTableRow(line);
    const keep = headers
      .map((_, index) => index)
      .filter((index) => !isUnmeasuredReportColumn(headers[index]));
    if (keep.length === headers.length) {
      for (let k = i; k < end; k++) out.push(lines[k]);
    } else if (keep.length > 0) {
      for (let k = i; k < end; k++) {
        const cells = splitTableRow(lines[k]);
        out.push(`| ${keep.map((index) => cells[index] ?? '').join(' | ')} |`);
      }
    }
    i = end;
  }
  return out.join('\n');
}
