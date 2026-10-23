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

const LLMS_CHECK_IDS = new Set(['llms_txt', 'site_llms']);
const ROBOTS_CHECK_IDS = new Set(['ai_bot_directives', 'cite_paths', 'site_robots']);

/** True only when that file's measured check failed. A pass or a missing probe is not a fix. */
export function crawlerFixWanted(
  kind: 'llms' | 'robots',
  checks: readonly { id: string; status: string }[] | null | undefined,
): boolean {
  const ids = kind === 'llms' ? LLMS_CHECK_IDS : ROBOTS_CHECK_IDS;
  return (checks || []).some((check) => ids.has(check.id) && check.status === 'fail');
}

/** A starter row about llms.txt or robots.txt is dropped once that check was measured and did not fail. */
export function starterFixContradictsPass(
  label: string,
  checks: readonly { id: string; status: string }[] | null | undefined,
): boolean {
  const rows = checks || [];
  if (!rows.length) return false;
  const blob = label.toLowerCase();
  const measured = (ids: Set<string>) => rows.some((check) => ids.has(check.id) && check.status !== 'not_measured');
  if (/llms/.test(blob) && measured(LLMS_CHECK_IDS) && !crawlerFixWanted('llms', rows)) return true;
  if (/robots/.test(blob) && measured(ROBOTS_CHECK_IDS) && !crawlerFixWanted('robots', rows)) return true;
  return false;
}
