/**
 * Honesty gate for Instant Audit numeric scores.
 * Batch 1a blocked invented scores after hosted 401/403.
 * This gate also blocks them when page text is Jina-only, search is empty,
 * or search rows are SAMPLE / why-SAMPLE fixtures.
 * A health score is allowed only when a live scrape and live search rows are both present.
 */

import type { ScrapedPageEvidence, SerpEvidenceItem } from './types';
import { responseBlocked } from '../audit/llmCrawlerReadiness';

export type LivePageSource = NonNullable<ScrapedPageEvidence['source']>;

const LIVE_PAGE_SOURCES = new Set<LivePageSource>(['patchright', 'firecrawl', 'direct']);

export type HealthScoreBlockReason = 'auth' | 'jina' | 'jina_search' | 'no_page' | 'search' | 'none';

export function pageHasObservableBody(page: Pick<ScrapedPageEvidence, 'wordCount' | 'schemasFound' | 'rawTextSnippet'>): boolean {
  return page.wordCount > 0 || page.schemasFound.length > 0 || (page.rawTextSnippet || '').trim().length > 0;
}

/** 403, 429, or a challenge page. That HTML was not a parse of the site. */
export function pageFetchBlocked(
  page: Pick<ScrapedPageEvidence, 'httpStatus' | 'title' | 'rawTextSnippet'>,
): boolean {
  return responseBlocked(page.httpStatus, `${page.title || ''}\n${page.rawTextSnippet || ''}`);
}

/**
 * Jina Reader markdown is not a DOM scrape: missing JSON-LD on that text is not a measured gap.
 * Omitted source stays eligible so callers that already built a live page are unchanged.
 */
export function pageSupportsHealthScore(page: ScrapedPageEvidence): boolean {
  if (pageFetchBlocked(page)) return false;
  if (!pageHasObservableBody(page)) return false;
  if (!page.source) return true;
  return LIVE_PAGE_SOURCES.has(page.source);
}

/** SAMPLE and why-SAMPLE labels are fixtures, not a live visibility measurement. */
export function isSampleSearchRow(row: Pick<SerpEvidenceItem, 'sample' | 'title' | 'snippet' | 'query' | 'url'>): boolean {
  if (row.sample) return true;
  const blob = [row.title, row.snippet, row.query, row.url].filter(Boolean).join(' ');
  return /\bSAMPLE\b/.test(blob) || /why-sample/i.test(blob);
}

export function liveSearchRows(rows: readonly SerpEvidenceItem[]): SerpEvidenceItem[] {
  return rows.filter((row) => !isSampleSearchRow(row));
}

export function healthScoreBlockReason(input: {
  pages: readonly ScrapedPageEvidence[];
  serp: readonly SerpEvidenceItem[];
  authBlocked: boolean;
}): HealthScoreBlockReason | null {
  if (input.authBlocked) return 'auth';
  const livePages = input.pages.filter(pageSupportsHealthScore);
  const liveSerp = liveSearchRows(input.serp);
  if (livePages.length > 0 && liveSerp.length > 0) return null;
  const jinaOnly = livePages.length === 0 && input.pages.some((page) => page.source === 'jina' && pageHasObservableBody(page));
  const searchMissing = liveSerp.length === 0;
  if (jinaOnly && searchMissing) return 'jina_search';
  if (jinaOnly) return 'jina';
  if (livePages.length === 0 && searchMissing) return 'none';
  if (livePages.length === 0) return 'no_page';
  return 'search';
}

/**
 * The four checks behind the health number, and the points a failed check takes
 * from HEALTH_SCORE_START. The number is a checklist score, not a measurement.
 * A screen or a brief that tells a founder the result prints the count of passed
 * checks from healthChecklist, not the number.
 */
export const HEALTH_SCORE_START = 85;

export const HEALTH_CHECKS = [
  { findingId: 'finding-zero-citations', penalty: 15 },
  { findingId: 'finding-schema-org', penalty: 12 },
  { findingId: 'finding-deprecated-howto', penalty: 5 },
  { findingId: 'finding-thin-content', penalty: 8 },
] as const;

export interface HealthChecklist {
  passed: number;
  failed: number;
  unmeasured: number;
  total: number;
}

function wholeCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

export interface ResolvedCheckCounts {
  passed: number;
  total: number;
  failed: number;
  unmeasured: number;
}

/** A missing `failed` is the gap left after passed and not-measured checks. An explicit 0 stays 0. */
export function resolveCheckCounts(counts: {
  passed: number;
  total: number;
  failed?: number;
  unmeasured?: number;
}): ResolvedCheckCounts {
  const unmeasured = wholeCount(counts.unmeasured);
  const failed = typeof counts.failed === 'number'
    ? wholeCount(counts.failed)
    : wholeCount(counts.total - counts.passed - unmeasured);
  return { passed: counts.passed, total: counts.total, failed, unmeasured };
}

/**
 * The sentence a report and a share check both read.
 * Failed checks say failed. "Not measured" appears only when a check was not measured.
 */
export function measuredCheckLine(counts: {
  passed: number;
  total: number;
  failed?: number;
  unmeasured?: number;
}): string {
  const resolved = resolveCheckCounts(counts);
  const head = `${resolved.passed} of ${resolved.total} checks passed`;
  const tail: string[] = [];
  if (resolved.failed > 0) tail.push(`${resolved.failed} failed`);
  if (resolved.unmeasured > 0) tail.push(`${resolved.unmeasured} not measured`);
  return tail.length ? `${head}, ${tail.join(', ')}` : head;
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

function pairOk(passed: number, total: number): boolean {
  return Number.isInteger(passed) && Number.isInteger(total) && total >= 1 && passed >= 0 && passed <= total;
}

/** Reads the current sentence and the older "passed N of M; U not measured" sentence. */
export function parseMeasuredCheckLine(text: string): ResolvedCheckCounts | null {
  const modern = text.match(/\b(\d+) of (\d+) checks passed(?:, (\d+) failed)?(?:, (\d+) not measured)?\b/i);
  if (modern) {
    const passed = Number(modern[1]);
    const total = Number(modern[2]);
    const failed = modern[3] == null ? 0 : Number(modern[3]);
    const unmeasured = modern[4] == null ? 0 : Number(modern[4]);
    if (!pairOk(passed, total) || !Number.isInteger(failed) || failed < 0 || !Number.isInteger(unmeasured) || unmeasured < 0) return null;
    if (passed + failed + unmeasured > total) return null;
    return { passed, total, failed, unmeasured };
  }
  const legacy = text.match(/\bpassed (\d+) of (\d+); (\d+) not measured\b/i);
  if (legacy) {
    const passed = Number(legacy[1]);
    const total = Number(legacy[2]);
    const unmeasured = Number(legacy[3]);
    if (!pairOk(passed, total) || !Number.isInteger(unmeasured) || unmeasured < 0 || passed + unmeasured > total) return null;
    return { passed, total, failed: total - passed - unmeasured, unmeasured };
  }
  const older = text.match(/\bpassed (\d+) of (\d+) checks\b/i);
  if (!older) return null;
  const passed = Number(older[1]);
  const total = Number(older[2]);
  if (!pairOk(passed, total)) return null;
  return { passed, total, failed: 0, unmeasured: 0 };
}

/**
 * Counts failed and downgraded checks. A renamed `<id>-unmeasured` finding is not a pass.
 * An unknown citation rate makes the citation check unmeasured. Omit the option when the rate was not in play.
 */
export function healthChecklist(
  findings: readonly { id: string }[],
  options?: { citationRateKnown?: boolean },
): HealthChecklist {
  let failed = 0;
  let unmeasured = 0;
  for (const check of HEALTH_CHECKS) {
    const downgraded = findings.some((finding) => finding.id === `${check.findingId}-unmeasured`);
    const citationUnknown = check.findingId === 'finding-zero-citations' && options?.citationRateKnown === false;
    if (downgraded || citationUnknown) {
      unmeasured += 1;
      continue;
    }
    if (findings.some((finding) => finding.id === check.findingId)) failed += 1;
  }
  const total = HEALTH_CHECKS.length;
  return { total, failed, unmeasured, passed: total - failed - unmeasured };
}

/** True when the four checks ran, including a run whose number was dropped after a downgrade. */
export function siteChecksRan(healthScore: number | null, findings: readonly { id: string }[]): boolean {
  if (typeof healthScore === 'number') return true;
  return findings.some((finding) => HEALTH_CHECKS.some((check) => (
    finding.id === check.findingId || finding.id === `${check.findingId}-unmeasured`
  )));
}

/** Same checklist number the auditor stores before any finding is downgraded. */
export function healthScoreFromFindings(findings: readonly { id: string }[]): number {
  const base = HEALTH_CHECKS.reduce(
    (score, check) => (findings.some((finding) => finding.id === check.findingId) ? score - check.penalty : score),
    HEALTH_SCORE_START,
  );
  return Math.max(20, Math.min(100, base));
}

const UNMEASURED_HEALTH_WHY: Record<HealthScoreBlockReason, string> = {
  auth: 'live data unavailable after a provider authentication failure',
  jina: 'page text is a fallback read and cannot support a health score',
  jina_search: 'page evidence is a fallback read and search evidence is empty or a sample',
  search: 'search evidence is empty or a sample',
  no_page: 'no page evidence',
  none: 'no page or search evidence',
};

export function unmeasuredHealthMessage(reason: HealthScoreBlockReason): string {
  return `Compliance checks not measured: ${UNMEASURED_HEALTH_WHY[reason]}.`;
}
