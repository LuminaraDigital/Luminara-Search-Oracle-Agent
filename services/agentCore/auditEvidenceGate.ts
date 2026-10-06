/**
 * Honesty gate for Instant Audit numeric scores.
 * Batch 1a blocked invented scores after hosted 401/403.
 * This gate also blocks them when page text is Jina-only, search is empty,
 * or search rows are SAMPLE / why-SAMPLE fixtures.
 * A health score is allowed only when a live scrape and live search rows are both present.
 */

import type { ScrapedPageEvidence, SerpEvidenceItem } from './types';

export type LivePageSource = NonNullable<ScrapedPageEvidence['source']>;

const LIVE_PAGE_SOURCES = new Set<LivePageSource>(['patchright', 'firecrawl', 'direct']);

export type HealthScoreBlockReason = 'auth' | 'jina' | 'jina_search' | 'no_page' | 'search' | 'none';

export function pageHasObservableBody(page: Pick<ScrapedPageEvidence, 'wordCount' | 'schemasFound' | 'rawTextSnippet'>): boolean {
  return page.wordCount > 0 || page.schemasFound.length > 0 || (page.rawTextSnippet || '').trim().length > 0;
}

/**
 * Jina Reader markdown is not a DOM scrape: missing JSON-LD on that text is not a measured gap.
 * Omitted source stays eligible so callers that already built a live page are unchanged.
 */
export function pageSupportsHealthScore(page: ScrapedPageEvidence): boolean {
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

export function unmeasuredHealthMessage(reason: HealthScoreBlockReason): string {
  switch (reason) {
    case 'auth':
      return 'Compliance audit finished. Health score not measured: live data unavailable after a provider authentication failure.';
    case 'jina':
      return 'Compliance audit finished. Health score not measured: page text is Jina-only and cannot support a health score.';
    case 'jina_search':
      return 'Compliance audit finished. Health score not measured: page evidence is Jina-only and search evidence is empty or a sample.';
    case 'search':
      return 'Compliance audit finished. Health score not measured: search evidence is empty or a sample.';
    case 'no_page':
      return 'Compliance audit finished. Health score not measured: no page evidence.';
    default:
      return 'Compliance audit finished. Health score not measured: no page or search evidence.';
  }
}
