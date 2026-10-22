/**
 * Turns audit markdown into the blocks the report page and the PDF both read.
 * A missing or broken score stays "Not measured". This module does not invent one.
 */
import { marked, type Token, type Tokens } from 'marked';
import type { BoardFinding } from './findingBoardService';
import { formatAuDate } from '../../utils/formatAuDate';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type ReportBlock =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'paragraph'; text: string; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'quote'; text: string };

export type ReportSection = { id: string; title: string; blocks: ReportBlock[] };

export type AuditReportDoc = {
  title: string;
  verdict: string;
  sections: ReportSection[];
  links: Array<{ text: string; href: string }>;
};

function cleanPlain(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/(^|\s)\*(\S(?:.*?\S)?)\*(?=\s|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(text: string, used: Set<string>): string {
  const base = cleanPlain(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

function tokenText(token: Token): string {
  if ('tokens' in token && token.tokens?.length) return inlineText(token.tokens);
  if ('text' in token && typeof token.text === 'string') return cleanPlain(token.text);
  return '';
}

function inlineText(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  return tokens.map((token) => tokenText(token)).join('');
}

function inlinesOf(tokens: Token[] | undefined, links: AuditReportDoc['links']): Inline[] {
  if (!tokens?.length) return [];
  const out: Inline[] = [];
  for (const token of tokens) {
    if (token.type === 'strong') {
      out.push({ kind: 'strong', text: tokenText(token) });
    } else if (token.type === 'em') {
      out.push({ kind: 'em', text: tokenText(token) });
    } else if (token.type === 'codespan') {
      out.push({ kind: 'code', text: token.text });
    } else if (token.type === 'link') {
      const link = token as Tokens.Link;
      const text = link.tokens?.length ? inlineText(link.tokens) : cleanPlain(link.text);
      if (link.href) links.push({ text: text || link.href, href: link.href });
      out.push({ kind: 'link', text: text || link.href, href: link.href });
    } else if (token.type === 'text' && 'tokens' in token && token.tokens?.length) {
      out.push(...inlinesOf(token.tokens, links));
    } else if ('text' in token && typeof token.text === 'string' && token.text) {
      const text = token.text.replace(/\*\*|__/g, '');
      if (text) out.push({ kind: 'text', text });
    }
  }
  return out;
}

function cellText(cell: { text: string; tokens?: Token[] }): string {
  return cell.tokens?.length ? inlineText(cell.tokens) : cleanPlain(cell.text);
}

/** Reads markdown the audit already wrote. Malformed input does not throw. */
export function parseAuditReport(markdown: string): AuditReportDoc {
  const links: AuditReportDoc['links'] = [];
  const used = new Set<string>();
  let title = 'Audit report';
  let verdict = '';
  const sections: ReportSection[] = [];
  let current: ReportSection = { id: 'overview', title: 'Overview', blocks: [] };

  const push = () => {
    if (current.blocks.length) sections.push(current);
  };

  let tokens: Token[] = [];
  try {
    tokens = marked.lexer(markdown || '', { gfm: true });
  } catch {
    tokens = [];
  }

  for (const token of tokens) {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading;
      const text = cleanPlain(heading.text);
      const id = slug(text || 'section', used);
      if (heading.depth === 1 && title === 'Audit report') title = text || title;
      if (heading.depth <= 2) {
        push();
        current = { id, title: text || 'Section', blocks: [] };
      } else {
        current.blocks.push({ kind: 'heading', level: heading.depth, text, id });
      }
      continue;
    }
    if (token.type === 'paragraph') {
      const paragraph = token as Tokens.Paragraph;
      const items = inlinesOf(paragraph.tokens, links);
      const text = cleanPlain(paragraph.text);
      if (!verdict && text) verdict = text;
      current.blocks.push({ kind: 'paragraph', text, inlines: items.length ? items : [{ kind: 'text', text }] });
      continue;
    }
    if (token.type === 'list') {
      const list = token as Tokens.List;
      current.blocks.push({
        kind: 'list',
        ordered: list.ordered,
        items: list.items.map((item) => {
          const nested = item.tokens?.filter((part) => part.type !== 'list') || [];
          const row = inlinesOf(nested.flatMap((part) => ('tokens' in part && part.tokens ? part.tokens : [part])), links);
          return row.length ? row : [{ kind: 'text', text: cleanPlain(item.text) }];
        }),
      });
      continue;
    }
    if (token.type === 'code') {
      current.blocks.push({ kind: 'code', text: token.text });
      continue;
    }
    if (token.type === 'table') {
      const table = token as Tokens.Table;
      current.blocks.push({
        kind: 'table',
        headers: table.header.map(cellText),
        rows: table.rows.map((row) => row.map(cellText)),
      });
      continue;
    }
    if (token.type === 'blockquote') {
      const text = cleanPlain(token.text);
      if (!verdict && text) verdict = text;
      current.blocks.push({ kind: 'quote', text });
    }
  }
  push();
  if (!sections.length) {
    sections.push({ id: 'overview', title: 'Overview', blocks: verdict ? [{ kind: 'paragraph', text: verdict, inlines: [{ kind: 'text', text: verdict }] }] : [] });
  }
  return { title, verdict, sections, links };
}

/** The only score the page may print. Unmeasured runs stay "Not measured" even if the prose contains a count. */
export function scoreLine(markdown: string, measured: boolean): string {
  if (!measured) return 'Not measured';
  const match = markdown.match(/\bpassed (\d+) of (\d+) checks\b/i);
  if (!match) return 'Not measured';
  const passed = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isInteger(passed) || !Number.isInteger(total) || total < 1 || passed < 0 || passed > total) {
    return 'Not measured';
  }
  return `Passed ${passed} of ${total} checks`;
}

export function recheckLabel(from = Date.now()): string {
  const when = formatAuDate(from + 14 * 24 * 60 * 60 * 1000);
  return when ? `Recheck on ${when}.` : 'Recheck in 14 days.';
}

export function fixProgress(findings: ReadonlyArray<{ status: string }>): { done: number; total: number; label: string } {
  const total = findings.length;
  const done = findings.filter((finding) => finding.status === 'done').length;
  return { done, total, label: total === 0 ? 'No fixes on this audit' : `${done} of ${total} fixes done` };
}

export function findingWhy(finding: Pick<BoardFinding, 'description' | 'evidence'>): string {
  const evidence = finding.evidence;
  if (evidence && typeof evidence === 'object' && 'howWeKnowItFailed' in evidence) {
    const line = evidence.howWeKnowItFailed;
    if (typeof line === 'string' && line.trim()) return line.trim();
  }
  return finding.description.trim() || 'Not measured.';
}

export function findingFix(finding: Pick<BoardFinding, 'title' | 'description'>, why: string): string {
  const description = finding.description.trim();
  if (description && description !== why) return description;
  return finding.title.trim() || 'Not measured.';
}

export function progressSince(input: {
  before: unknown;
  metrics: ReadonlyArray<{ key: string; before: number | null; after: number | null; delta: number | null }>;
}): string {
  if (!input.before) return 'No earlier audit of this site is saved.';
  const health = input.metrics.find((metric) => metric.key === 'healthScore');
  if (!health || health.before == null || health.after == null || health.delta == null) {
    return 'Health was not measured on both audits, so there is no change to show.';
  }
  if (health.delta === 0) return `Health is unchanged since the last audit (${health.before}).`;
  const word = health.delta > 0 ? 'up' : 'down';
  return `Health is ${word} ${Math.abs(health.delta)} since the last audit (${health.before} to ${health.after}).`;
}

function findingsMarkdown(findings: ReadonlyArray<Pick<BoardFinding, 'title' | 'severity' | 'description' | 'evidence'>>): string {
  if (!findings.length) return '';
  const blocks = findings.map((finding) => {
    const why = findingWhy(finding);
    return `### ${finding.title}\n\nSeverity: ${finding.severity}\n\nWhy it matters for buyers and vendors: ${why}\n\nHow to fix: ${findingFix(finding, why)}`;
  });
  return `## Fixes\n\n${blocks.join('\n\n')}\n`;
}

/** Same words the page shows, in the order the PDF already knows how to print. */
export function withReportLead(
  markdown: string,
  measured: boolean,
  findings: ReadonlyArray<Pick<BoardFinding, 'title' | 'severity' | 'description' | 'evidence'>> = [],
): string {
  const doc = parseAuditReport(markdown);
  const score = scoreLine(`${markdown}\n${doc.verdict}`, measured);
  const verdict = doc.verdict || 'Not measured.';
  const lead = [`# ${doc.title}`, '', `Score: ${score}`, '', verdict, ''].join('\n');
  const fixes = findingsMarkdown(findings);
  return `${lead}\n${fixes}${markdown.trim()}\n`;
}
