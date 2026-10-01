/**
 * Stable failure codes for public teasers.
 * Mint these instead of raw provider error strings.
 */

export const TEASER_FAILURE_COPY = {
  page_fetch_empty: 'Page fetch returned no usable text or schema.',
  search_empty: 'Search sample was empty or the search provider did not respond.',
  provider_failed: 'A provider call failed. The public teaser omits the raw error.',
  crawler_llms_missing: 'llms.txt was missing or not reachable.',
  crawler_bots_blocked: 'robots.txt blocks one or more named AI crawlers.',
} as const;

export type TeaserFailureCode = keyof typeof TEASER_FAILURE_COPY;

const CODES = new Set<string>(Object.keys(TEASER_FAILURE_COPY));

export function isTeaserFailureCode(value: string): value is TeaserFailureCode {
  return CODES.has(value);
}

export function teaserFailureCodes(input: {
  scrapedPageCount: number;
  serpCount: number;
  hadProviderError: boolean;
  crawlerChecks?: Array<{ id: string; status: string }>;
}): TeaserFailureCode[] {
  const codes: TeaserFailureCode[] = [];
  if (input.scrapedPageCount === 0) codes.push('page_fetch_empty');
  if (input.serpCount === 0) codes.push('search_empty');
  if (input.hadProviderError) codes.push('provider_failed');
  for (const check of input.crawlerChecks || []) {
    if (check.status !== 'fail') continue;
    if (check.id === 'llms_txt') codes.push('crawler_llms_missing');
    if (check.id === 'ai_bot_directives') codes.push('crawler_bots_blocked');
  }
  return codes;
}

export function teaserFailureLine(code: TeaserFailureCode): string {
  return TEASER_FAILURE_COPY[code];
}
