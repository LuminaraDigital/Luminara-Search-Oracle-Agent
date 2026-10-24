/**
 * Turns audit markdown into the blocks the report page and the PDF both read.
 * A missing or broken score stays "Not measured". This module does not invent one.
 */
import { marked, type Token, type Tokens } from 'marked';
import type { BoardFinding } from './findingBoardService';
import { formatAuDate } from '../../utils/formatAuDate';
import { stripUntrustedFences } from '../../utils/untrustedContent';
import { healthChecklist, measuredCheckLine, parseMeasuredCheckLine, siteChecksRan } from '../agentCore/auditEvidenceGate';
import { organizationJsonLd } from './fixPackCopy';
import { customerSentenceOk, optionalCustomerSentence, plainCustomerReport, type AuditTextScope } from './reportColumnGate';

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
export function parseAuditReport(markdown: string, scope?: AuditTextScope): AuditReportDoc {
  const cleaned = plainCustomerReport(markdown || '', scope);
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
    tokens = marked.lexer(cleaned, { gfm: true });
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

function findingIds(findings: readonly { id?: string }[]): { id: string }[] {
  const rows: { id: string }[] = [];
  for (const finding of findings) {
    if (typeof finding.id === 'string' && finding.id.length > 0) rows.push({ id: finding.id });
  }
  return rows;
}

/**
 * The score the page and the PDF print.
 * When the four site checks ran, this is the same checklist sentence as the brief.
 * A card sentence is next. The report text is the last fallback.
 */
export function reportScore(
  markdown: string,
  measured: boolean,
  findings: readonly { id?: string }[] = [],
  citationRateKnown?: boolean,
  checkLine?: string,
): string {
  const rows = findingIds(findings);
  if (siteChecksRan(null, rows)) {
    const options = typeof citationRateKnown === 'boolean' ? { citationRateKnown } : undefined;
    return measuredCheckLine(healthChecklist(rows, options));
  }
  const fromCard = checkLine ? parseMeasuredCheckLine(checkLine) : null;
  if (fromCard) return measuredCheckLine(fromCard);
  return scoreLine(markdown, measured);
}

/** The only score the page may print. A partial checklist stays visible. A clean pass needs measured=true. */
export function scoreLine(markdown: string, measured: boolean): string {
  const counts = parseMeasuredCheckLine(markdown);
  if (!counts) return 'Not measured';
  const olderOnly = !/\b\d+ of \d+ checks passed\b/i.test(markdown) && !/\bnot measured\b/i.test(markdown);
  if (olderOnly && !measured) return 'Not measured';
  if (counts.failed === 0 && counts.unmeasured === 0 && !measured) return 'Not measured';
  return measuredCheckLine(counts);
}

export function recheckLabel(from = Date.now()): string {
  const when = formatAuDate(from + 14 * 24 * 60 * 60 * 1000);
  return when ? `Recheck on ${when}.` : 'Recheck in 14 days.';
}

const UNSUPPORTED_FINDING = 'Not measured. The evidence check did not support this finding.';

export function isDowngradedFinding(finding: { id?: string; description?: string }): boolean {
  if (typeof finding.id === 'string' && finding.id.endsWith('-unmeasured')) return true;
  return finding.description?.trim() === UNSUPPORTED_FINDING;
}

type RankedFinding = {
  id?: string;
  description?: string;
  severity?: string;
  status?: string;
};

/** The open fix the report calls "Your next fix". Critical before high, then medium, then low. */
export function pickPrimaryFinding<T extends RankedFinding>(findings: readonly T[]): T | null {
  const eligible = findings.filter((finding) => !isDowngradedFinding(finding));
  if (!eligible.length) return null;
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const open = eligible.filter((finding) => finding.status === 'open' || finding.status === 'in_progress');
  const pool = open.length ? open : eligible;
  return [...pool].sort(
    (a, b) => (rank[a.severity || ''] ?? 9) - (rank[b.severity || ''] ?? 9),
  )[0] ?? null;
}

type MoveFinding = RankedFinding & {
  title?: string;
  domain?: string;
};

const ONE_MOVE = /one move/i;

function sectionBounds(lines: string[], test: RegExp): { start: number; end: number } | null {
  const start = lines.findIndex((line) => /^#{1,3}\s+/.test(line.trim()) && test.test(line.trim()));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s+/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  return { start, end };
}

type MoveKind = 'identity' | 'hsts' | 'csp' | 'security' | 'other';

function fenceKind(code: string): MoveKind {
  const text = code.toLowerCase();
  if (text.includes('strict-transport-security') || /\bhsts\b/.test(text)) return 'hsts';
  if (text.includes('content-security-policy')) return 'csp';
  if (text.includes('security.txt')) return 'security';
  if (text.includes('@type') || text.includes('schema.org') || text.includes('ld+json')) return 'identity';
  return 'other';
}

function proseKind(text: string): MoveKind {
  const line = text.toLowerCase();
  if (line.includes('business identity tag') || line.includes('structured data') || line.includes('json-ld') || line.includes('schema.org')) return 'identity';
  if (line.includes('(hsts)') || line.includes('strict-transport') || line.includes('secure version of your site')) return 'hsts';
  if (line.includes('(csp)') || line.includes('content-security') || line.includes('scripts your site can load')) return 'csp';
  if (line.includes('security.txt') || line.includes('security contact file')) return 'security';
  return 'other';
}

function howToKnow(sentence: string): string {
  const kind = proseKind(sentence);
  if (kind === 'identity') return 'How to know it worked: the page source includes a business identity tag that names the organization.';
  if (kind === 'hsts') return 'How to know it worked: a browser reload stays on the secure version of the site (HSTS).';
  if (kind === 'csp') return 'How to know it worked: the response tells the browser which scripts the site can load (CSP).';
  if (kind === 'security') return 'How to know it worked: the public security contact file opens in a browser (security.txt).';
  return `How to know it worked: this item is no longer open. ${sentence}`;
}

/** Fix titles. The model title is only used when the check id is not in this table. */
const CHECK_TITLE: Record<string, string> = {
  'finding-schema-org': 'Add a business identity tag',
  'finding-schema-org-partial': 'Add a business identity tag',
  'finding-thin-content': 'Write fuller answers on thin pages',
  'finding-zero-citations': 'Say plainly what you offer',
  'finding-deprecated-howto': 'Remove the HowTo markup',
};

/** Plain phrases for the verdict, in the same order as the failed checks. */
const CHECK_PHRASE: Record<string, string> = {
  'finding-schema-org': 'A business identity tag is missing',
  'finding-schema-org-partial': 'The business identity tag is incomplete',
  'finding-thin-content': 'This page is too short',
  'finding-zero-citations': 'None of the web results name the brand',
  'finding-deprecated-howto': 'The page still uses HowTo markup',
};

export function checkFixTitle(id: string | undefined, title: string): string {
  const mapped = id ? CHECK_TITLE[id] : undefined;
  if (mapped) return mapped;
  const scrubbed = plainCustomerReport(title).replace(/\s+/g, ' ').trim();
  return scrubbed || 'Not measured.';
}

function howToKnowFor(finding: MoveFinding, sentence: string): string {
  if (finding.id === 'finding-schema-org' || finding.id === 'finding-schema-org-partial') {
    return 'How to know it worked: the page source includes a business identity tag that names the organization.';
  }
  if (finding.id === 'finding-thin-content') return 'How to know it worked: the short page is at least 250 words.';
  if (finding.id === 'finding-zero-citations') return 'How to know it worked: a web result for the brand name states what you offer.';
  if (finding.id === 'finding-deprecated-howto') return 'How to know it worked: the page source no longer includes a HowTo tag.';
  return howToKnow(sentence);
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function topFailed(findings: readonly MoveFinding[]): MoveFinding[] {
  const eligible = findings.filter((finding) => finding.id && CHECK_PHRASE[finding.id] && !isDowngradedFinding(finding));
  const open = eligible.filter((finding) => !finding.status || finding.status === 'open' || finding.status === 'in_progress');
  const pool = open.length ? open : eligible;
  return [...pool].sort((a, b) => (SEVERITY_RANK[a.severity || ''] ?? 9) - (SEVERITY_RANK[b.severity || ''] ?? 9)).slice(0, 3);
}

/** Drops a one-move code block that is about a different fix than the prose. */
function dropMismatchedSnippet(markdown: string): string {
  const lines = markdown.split('\n');
  const bounds = sectionBounds(lines, ONE_MOVE);
  if (!bounds) return markdown;
  const body = lines.slice(bounds.start + 1, bounds.end);
  let fence = false;
  const prose: string[] = [];
  const kept: string[] = [];
  let fenceBuf: string[] = [];
  const flush = () => {
    const code = fenceBuf.join('\n');
    const kind = fenceKind(code);
    const move = proseKind(prose.join('\n'));
    if (kind === 'other' || kind === move) kept.push(...fenceBuf);
  };
  for (const line of body) {
    if (line.trim().startsWith('```')) {
      if (!fence) {
        fence = true;
        fenceBuf = [line];
      } else {
        fenceBuf.push(line);
        flush();
        fence = false;
        fenceBuf = [];
      }
      continue;
    }
    if (fence) fenceBuf.push(line);
    else {
      prose.push(line);
      kept.push(line);
    }
  }
  if (fence) kept.push(...fenceBuf);
  return [...lines.slice(0, bounds.start + 1), ...kept, ...lines.slice(bounds.end)].join('\n');
}

function moveBody(finding: MoveFinding, domain?: string): string {
  const title = checkFixTitle(finding.id, finding.title || '');
  const sentence = /[.!?]$/.test(title) ? title : `${title}.`;
  const kind = finding.id === 'finding-schema-org' || finding.id === 'finding-schema-org-partial' ? 'identity' : proseKind(`${finding.id || ''} ${sentence}`);
  const host = (domain || finding.domain || '').trim();
  const snip = kind === 'identity'
    ? `\n\n\`\`\`json\n${organizationJsonLd(host || 'example.com')}\n\`\`\``
    : '';
  return `${sentence}\n\n${howToKnowFor(finding, sentence)}${snip}\n`;
}

/**
 * One move, the how-to-know line, and the snippet come from the top finding.
 * With no findings, model text stays and a snippet about a different fix is dropped.
 */
export function alignOneMove(markdown: string, findings: readonly MoveFinding[] = [], domain?: string): string {
  const primary = pickPrimaryFinding(findings);
  if (!primary) return dropMismatchedSnippet(markdown);
  const lines = markdown.split('\n');
  const bounds = sectionBounds(lines, ONE_MOVE);
  if (!bounds) return markdown;
  const body = moveBody(primary, domain).trimEnd();
  return [...lines.slice(0, bounds.start + 1), '', body, '', ...lines.slice(bounds.end)].join('\n');
}

const PLAIN_VERDICT = /plain verdict/i;

function namesAudit(sentence: string, scope?: AuditTextScope): boolean {
  const text = sentence.toLowerCase();
  const domain = (scope?.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const brand = (scope?.brand || '').trim().toLowerCase();
  if (domain && text.includes(domain)) return true;
  if (brand.length >= 3 && text.includes(brand)) return true;
  return false;
}

type VerdictOptions = { scope?: AuditTextScope; citationLine?: string | null };

/**
 * Reachability, then the top failed checks, then one consequence.
 * A model sentence is kept only when it names this audit and passes the strict check.
 * A citation sentence is appended only when the caller built it from mentionCounts.
 */
export function plainVerdictText(
  findings: readonly MoveFinding[],
  modelText = '',
  options: VerdictOptions = {},
): string {
  const phrases = topFailed(findings).map((finding) => (finding.id ? CHECK_PHRASE[finding.id] : '')).filter(Boolean);
  const extra = optionalCustomerSentence(modelText);
  const keepExtra = extra && namesAudit(extra, options.scope) && customerSentenceOk(extra) ? extra : '';
  const citation = options.citationLine?.trim() || '';
  if (!phrases.length) return keepExtra;
  const consequence = phrases.length === 1
    ? 'This gap can lower trust and citation odds.'
    : 'These gaps can lower trust and citation odds.';
  const core = `The page is reachable. ${phrases.join('. ')}. ${consequence}`;
  const tail = [keepExtra, citation].filter((part) => part && !core.toLowerCase().includes(part.replace(/[.!?]$/, '').toLowerCase()));
  return tail.length ? `${core} ${tail.join(' ')}` : core;
}

/** Replaces the plain-verdict section when the failed checks are known. Other sections stay. */
export function alignPlainVerdict(
  markdown: string,
  findings: readonly MoveFinding[] = [],
  options: VerdictOptions = {},
): string {
  const lines = markdown.split('\n');
  const bounds = sectionBounds(lines, PLAIN_VERDICT);
  if (!bounds) return markdown;
  const body = plainVerdictText(findings, lines.slice(bounds.start + 1, bounds.end).join('\n'), options);
  if (!body) return markdown;
  return [...lines.slice(0, bounds.start + 1), '', body, '', ...lines.slice(bounds.end)].join('\n');
}

function dropUnnamedLead(markdown: string, scope: AuditTextScope): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^#\s+/.test(line.trim()) && !/^##/.test(line.trim()));
  if (start < 0) return markdown;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,3}\s+/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  const kept = lines.slice(start, end).filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^\**\s*Date:/i.test(trimmed)) return true;
    return namesAudit(trimmed, scope);
  });
  return [...lines.slice(0, start), ...kept, ...lines.slice(end)].join('\n');
}

function auditHost(domain: string): string {
  return domain.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
}

/** First line of the audit prompt. The fallback keeps this prefix and drops the tail. */
export function auditSubjectLead(domain: string, url: string, brand?: string): string {
  const host = auditHost(domain || url);
  const name = brand && !/playbook|methodology/i.test(brand) ? `${brand} (${host})` : host;
  return `The only business in this audit is ${name}. The page URL is ${url}. Rules below are not the business and are not the report title.`;
}

function replaceH1(markdown: string, title: string): string {
  const lines = markdown.split('\n');
  const heading = `# ${title}`;
  const index = lines.findIndex((line) => /^#\s+/.test(line.trim()) && !/^##/.test(line.trim()));
  if (index < 0) return [heading, '', ...lines].join('\n');
  lines[index] = heading;
  return lines.join('\n');
}

function upsertDate(markdown: string, when: number | Date, mode: string): string {
  const stamp = formatAuDate(when);
  if (!stamp) return markdown;
  const row = `**Date:** ${stamp} · **Mode:** ${mode}`;
  const lines = markdown.split('\n').filter((line) => !/^\**\s*Date:/i.test(line.trim()));
  const index = lines.findIndex((line) => /^#\s+/.test(line.trim()) && !/^##/.test(line.trim()));
  if (index < 0) return [row, '', ...lines].join('\n');
  lines.splice(index + 1, 0, '', row);
  return lines.join('\n');
}

function replaceSectionBody(markdown: string, test: RegExp, heading: string, body: string): string {
  const lines = markdown.split('\n');
  const bounds = sectionBounds(lines, test);
  const block = ['', body.trimEnd(), ''];
  if (!bounds) return [...lines, '', heading, ...block].join('\n');
  return [...lines.slice(0, bounds.start), lines[bounds.start], ...block, ...lines.slice(bounds.end)].join('\n');
}

function dropSection(markdown: string, test: RegExp): string {
  const lines = markdown.split('\n');
  const bounds = sectionBounds(lines, test);
  if (!bounds) return markdown;
  return [...lines.slice(0, bounds.start), ...lines.slice(bounds.end)].join('\n');
}

function priorityWord(severity?: string): string {
  if (severity === 'critical') return 'Critical';
  if (severity === 'high') return 'High';
  if (severity === 'medium') return 'Medium';
  if (severity === 'low') return 'Low';
  return 'Not measured';
}

function fixTable(findings: readonly MoveFinding[]): string {
  const rows = findings
    .filter((finding) => finding.id && CHECK_PHRASE[finding.id] && !isDowngradedFinding(finding))
    .sort((a, b) => (SEVERITY_RANK[a.severity || ''] ?? 9) - (SEVERITY_RANK[b.severity || ''] ?? 9));
  if (!rows.length) return 'Not measured.';
  const lines = ['| Task | Plain issue | Priority |', '| --- | --- | --- |'];
  for (const finding of rows) {
    lines.push(`| ${checkFixTitle(finding.id, finding.title || '')} | ${CHECK_PHRASE[finding.id || '']} | ${priorityWord(finding.severity)} |`);
  }
  return lines.join('\n');
}

export type GroundEvidence = { query: string; intent?: string; brandCited?: boolean; competitorsCited?: string[] };

function radarQueries(markdown: string): string[] {
  const doc = parseAuditReport(markdown);
  const section = doc.sections.find((item) => /visibility radar/i.test(item.title));
  const table = section?.blocks.find((block) => block.kind === 'table');
  if (!table || table.kind !== 'table') return [];
  const queryCol = table.headers.findIndex((header) => /query/i.test(header));
  const index = queryCol >= 0 ? queryCol : 0;
  return table.rows.map((row) => row[index] || '').filter(Boolean);
}

function radarTable(evidence: readonly GroundEvidence[]): string {
  const lines = [
    '| Query | Intent | Brand Cited (Yes/No) | Key Competitors | Citation Status (Cited/Not Cited/Not Measured) |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const row of evidence) {
    const intent = row.intent ? `${row.intent.charAt(0).toUpperCase()}${row.intent.slice(1)}` : 'Not measured';
    const rivals = (row.competitorsCited || []).map((name) => name.trim()).filter(Boolean).join(', ') || 'None';
    lines.push(`| ${row.query.replace(/\|/g, ' ')} | ${intent} | ${row.brandCited ? 'Yes' : 'No'} | ${rivals} | ${row.brandCited ? 'Cited' : 'Not Cited'} |`);
  }
  return lines.join('\n');
}

function groundRadar(markdown: string, scope: AuditTextScope, evidence?: readonly GroundEvidence[]): string {
  const queries = radarQueries(markdown);
  if (queries.some((query) => namesAudit(query, scope))) return markdown;
  if (!queries.length && !(evidence && evidence.length)) return markdown;
  const body = evidence && evidence.length ? radarTable(evidence) : 'Not measured.';
  return replaceSectionBody(markdown, /visibility radar/i, '## AI & Search Visibility Radar', body);
}

export type GroundFacts = {
  domain?: string;
  brand?: string;
  findings?: readonly MoveFinding[];
  evidence?: readonly GroundEvidence[];
  citationLine?: string | null;
  auditedAt?: number | Date;
  mode?: string;
};

/**
 * Title, date, verdict, fix list, radar and sources come from the audited URL and the measured rows.
 * Model prose stays only inside the verdict, and only when it names this audit.
 */
export function groundCustomerReport(markdown: string, facts: GroundFacts): string {
  const host = auditHost(facts.domain || '');
  const fallback = markdown.match(/Answered by a fallback model:[^\n]*/);
  let text = markdown
    .split('\n')
    .filter((line) => !/fog clearing/i.test(line))
    .join('\n');
  if (fallback) text = text.replace(fallback[0], '');
  if (!host) return fallback ? `${text.trim()}\n\n${fallback[0]}` : text;
  const scope: AuditTextScope = { domain: host, brand: facts.brand };
  const findings = facts.findings || [];
  const options: VerdictOptions = { scope, citationLine: facts.citationLine };
  text = replaceH1(text, `Luminara: Web search check for ${host}`);
  text = upsertDate(text, facts.auditedAt ?? Date.now(), facts.mode || 'Instant Audit');
  text = alignOneMove(text, findings, host);
  text = alignPlainVerdict(text, findings, options);
  if (topFailed(findings).length && !sectionBounds(text.split('\n'), PLAIN_VERDICT)) {
    text = replaceSectionBody(text, PLAIN_VERDICT, '## 2. Plain verdict', plainVerdictText(findings, '', options));
  }
  if (topFailed(findings).length) text = dropUnnamedLead(text, scope);
  if (findings.some((finding) => finding.id && CHECK_PHRASE[finding.id])) {
    text = replaceSectionBody(text, /fix list/i, '## 3. Fix list', fixTable(findings));
  }
  text = groundRadar(text, scope, facts.evidence);
  text = dropSection(text, /\bsources\b/i);
  const trimmed = text.replace(/\n{3,}/g, '\n\n').trim();
  return fallback ? `${trimmed}\n\n${fallback[0]}` : trimmed;
}

/** Phrases from unsupported finding ids, used to keep them out of the model fix list. */
export function unsupportedClaimNeedles(findings: readonly { id?: string; description?: string }[]): string[] {
  const needles = new Set<string>();
  for (const finding of findings) {
    if (!isDowngradedFinding(finding)) continue;
    const phrase = (finding.id || '')
      .replace(/-unmeasured$/, '')
      .replace(/^finding-/, '')
      .replace(/-/g, ' ')
      .trim()
      .toLowerCase();
    if (phrase.length >= 4) needles.add(phrase);
  }
  return [...needles];
}

/** Drops fix-list and one-move lines that restate a finding the evidence check did not support. */
export function stripUnsupportedFixClaims(
  markdown: string,
  findings: readonly { id?: string; description?: string }[],
): string {
  const needles = unsupportedClaimNeedles(findings);
  if (!needles.length || !markdown) return markdown;
  let guarded = false;
  let fence = false;
  const kept: string[] = [];
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      fence = !fence;
      kept.push(line);
      continue;
    }
    if (!fence && /^#{1,3}\s+/.test(trimmed)) {
      const heading = trimmed.replace(/^#+\s*/, '').toLowerCase();
      guarded = heading.includes('fix list') || heading.includes('one move');
      kept.push(line);
      continue;
    }
    if (guarded && !fence && needles.some((needle) => line.toLowerCase().includes(needle))) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

/** The 4-check score is the only pass count. A second "N of M" tally reads as a different result. */
export function showFixTally(score: string): boolean {
  return !/^(?:Passed )?\d+ of \d+/.test(score);
}

export const SAVED_AUDIT_CHECK_COPY = 'Checking saved audits for this account.';

export function fixProgress(findings: ReadonlyArray<{ id?: string; status: string }>): { done: number; total: number; label: string } {
  const fixes = findings.filter((finding) => !isDowngradedFinding(finding));
  const total = fixes.length;
  const done = fixes.filter((finding) => finding.status === 'done').length;
  return { done, total, label: total === 0 ? 'No fixes on this audit' : `${done} of ${total} fixes done` };
}

/** Titles of checks the evidence review could not support. Null when every finding stays a fix. */
export function unmeasuredNote(findings: ReadonlyArray<{ id?: string; title?: string }>): string | null {
  const titles = findings
    .filter((finding) => isDowngradedFinding(finding))
    .map((finding) => (finding.title || '').trim())
    .filter(Boolean);
  if (!titles.length) return null;
  return `Not measured: ${titles.join('; ')}.`;
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
  checks?: { passed: number; failed: number; total: number } | null;
}): string {
  if (!input.before) return 'No earlier audit of this site is saved.';
  const health = input.metrics.find((metric) => metric.key === 'healthScore');
  if (!health || health.before == null || health.after == null || health.delta == null) {
    const checks = input.checks;
    if (checks && checks.total > 0 && (checks.passed > 0 || checks.failed > 0)) {
      return 'This run measured the site checks above. There is no earlier checklist to compare.';
    }
    return 'Health was not measured on both audits, so there is no change to show.';
  }
  if (health.delta === 0) return `Health is unchanged since the last audit (${health.before}).`;
  const word = health.delta > 0 ? 'up' : 'down';
  return `Health is ${word} ${Math.abs(health.delta)} since the last audit (${health.before} to ${health.after}).`;
}

function findingsMarkdown(findings: ReadonlyArray<Pick<BoardFinding, 'title' | 'severity' | 'description' | 'evidence'> & { id?: string }>): string {
  const note = unmeasuredNote(findings);
  const fixes = findings.filter((finding) => !isDowngradedFinding(finding));
  const blocks = fixes.map((finding) => {
    const why = findingWhy(finding);
    return `### ${finding.title}\n\nSeverity: ${finding.severity}\n\nWhy it matters for buyers and vendors: ${why}\n\nHow to fix: ${findingFix(finding, why)}`;
  });
  const fixSection = blocks.length ? `## Fixes\n\n${blocks.join('\n\n')}\n` : '';
  const noteSection = note ? `${note}\n` : '';
  return `${fixSection}${noteSection}`;
}

/** Same words the page shows, in the order the PDF already knows how to print. */
export function withReportLead(
  markdown: string,
  measured: boolean,
  findings: ReadonlyArray<Pick<BoardFinding, 'title' | 'severity' | 'description' | 'evidence'> & { id?: string }> = [],
): string {
  const source = alignPlainVerdict(alignOneMove(plainCustomerReport(stripUntrustedFences(markdown)), findings), findings);
  const doc = parseAuditReport(source);
  const score = reportScore(`${source}\n${doc.verdict}`, measured, findings);
  const verdict = doc.verdict || 'Not measured.';
  const lead = [`# ${doc.title}`, '', `Score: ${score}`, '', verdict, ''].join('\n');
  const fixes = findingsMarkdown(findings);
  return `${lead}\n${fixes}${source.trim()}\n`;
}
