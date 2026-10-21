/**
 * Shrink Instant Audit evidence before the Groq write.
 * Target is under 5,000 input tokens (prompt plus system), so one call
 * has room inside the 8,000 token-per-minute on-demand cap.
 * Measured header lines stay. Extra page prose and search rows do not.
 */
import { estimateTokens } from '../oracle/contextCompactorService';

export const AUDIT_WRITE_INPUT_TOKEN_BUDGET = 5000;

const KEEP_LINE =
  /^(--- PAGE |\[PAGE |\[SITEWIDE|\[LIVE |Title:|Description:|H1:|Schemas:|Word count:|\[PAGE TITLE\]|\[META |\[CANONICAL|\[STRUCTURED|\[HEADING|\[DISTILLED|Root:|Mode:|Pages:|#{1,3} )/i;
const FACT_LINE = /not measured|citation rate|word count:|schemas:/i;

function dedupeLines(text: string): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const key = line.trim();
    if (!key) {
      kept.push(line);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  return kept.join('\n');
}

function trimPage(page: string, bodyChars: number): string {
  const kept: string[] = [];
  let body = 0;
  for (const line of page.split('\n')) {
    if (KEEP_LINE.test(line) || FACT_LINE.test(line)) {
      kept.push(line);
      continue;
    }
    if (body >= bodyChars) continue;
    const room = bodyChars - body;
    const next = line.length > room ? line.slice(0, room) : line;
    kept.push(next);
    body += next.length;
  }
  return kept.join('\n');
}

function compactPages(text: string, bodyChars: number, maxPages: number): string {
  const splitAt = text.search(/--- PAGE /);
  const preamble = splitAt > 0 ? text.slice(0, splitAt) : '';
  const rest = splitAt >= 0 ? text.slice(splitAt) : text;
  const pages = (splitAt >= 0 ? rest.split(/(?=--- PAGE )/).filter((part) => part.trim()) : [rest]).slice(
    0,
    maxPages,
  );
  return dedupeLines([preamble, ...pages.map((page) => trimPage(page, bodyChars))].filter(Boolean).join('\n'));
}

function shortenExcerpt(row: string, excerptChars: number): string {
  if (excerptChars <= 0) return row.replace(/\n?Excerpt:[\s\S]*$/i, '\n');
  return row.replace(/Excerpt:\s*([\s\S]*)$/i, (_full, excerpt: string) => {
    const flat = excerpt.replace(/\s+/g, ' ').trim();
    const cut = flat.length > excerptChars ? `${flat.slice(0, excerptChars)} [...]` : flat;
    return `Excerpt: ${cut}\n`;
  });
}

function compactSearch(text: string, maxRows: number, excerptChars: number): string {
  const rulesAt = text.indexOf('GROUNDING RULES:');
  const rules = rulesAt >= 0 ? text.slice(rulesAt) : '';
  const body = rulesAt >= 0 ? text.slice(0, rulesAt) : text;
  const pieces = body.split(/(?=\[Source \d+\])/);
  const rows = pieces.slice(1, 1 + maxRows).map((row) => shortenExcerpt(row, excerptChars));
  return dedupeLines([pieces[0] || '', ...rows, rules].filter(Boolean).join('\n'));
}

function compactEmpirical(text: string, maxRows: number): string {
  let rows = 0;
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    if (/^\s*- /.test(line)) {
      rows += 1;
      if (rows > maxRows) continue;
    }
    kept.push(line);
  }
  return dedupeLines(kept.join('\n'));
}

function replaceFence(prompt: string, label: string, map: (inner: string) => string): string {
  const begin = `<<<UNTRUSTED_${label}_BEGIN>>>`;
  const end = `<<<UNTRUSTED_${label}_END>>>`;
  const start = prompt.indexOf(begin);
  const finish = prompt.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0) return prompt;
  const innerStart = start + begin.length;
  return prompt.slice(0, innerStart) + map(prompt.slice(innerStart, finish)) + prompt.slice(finish);
}

type Pass = { body: number; pages: number; rows: number; excerpt: number; empirical: number };

const PASSES: Pass[] = [
  { body: 500, pages: 2, rows: 5, excerpt: 160, empirical: 5 },
  { body: 240, pages: 2, rows: 4, excerpt: 80, empirical: 3 },
];

function applyPass(user: string, pass: Pass): string {
  let text = replaceFence(user, 'SCRAPED_PAGE', (inner) => compactPages(inner, pass.body, pass.pages));
  text = replaceFence(text, 'SEARCH_GROUNDING', (inner) => compactSearch(inner, pass.rows, pass.excerpt));
  text = replaceFence(text, 'EMPIRICAL', (inner) => compactEmpirical(inner, pass.empirical));
  return text;
}

/** Compact scraped page text, search rows, and empirical bullets. Returns the prompt sent to the model. */
export function fitAuditWritePrompt(
  user: string,
  system: string,
): { text: string; beforeTokens: number; afterTokens: number } {
  const beforeTokens = estimateTokens(user) + estimateTokens(system);
  let text = user;
  let afterTokens = beforeTokens;
  for (const pass of PASSES) {
    text = applyPass(user, pass);
    afterTokens = estimateTokens(text) + estimateTokens(system);
    if (afterTokens <= AUDIT_WRITE_INPUT_TOKEN_BUDGET) break;
  }
  return { text, beforeTokens, afterTokens };
}
