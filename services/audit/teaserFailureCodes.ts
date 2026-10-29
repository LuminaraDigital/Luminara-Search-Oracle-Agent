/**
 * Stable failure codes for public teasers.
 * Mint these instead of raw provider error strings.
 */

export const TEASER_FAILURE_COPY = {
  page_fetch_empty: 'The page check returned no text we could read.',
  search_empty: 'No web results came back.',
  provider_failed: 'A check did not finish. The public summary leaves out the raw error.',
  crawler_llms_missing: 'The AI guide file (llms.txt) was missing or could not be read.',
  crawler_bots_blocked: 'The crawler file (robots.txt) blocks one or more AI crawlers.',
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

const LLMS_CHECK_IDS = new Set(['llms_txt', 'llms_structure', 'site_llms']);
const ROBOTS_CHECK_IDS = new Set(['ai_bot_directives', 'cite_paths', 'site_robots']);

/** True only when that file's measured check failed. A pass or a missing probe is not a fix. */
export function crawlerFixWanted(
  kind: 'llms' | 'robots',
  checks: readonly { id: string; status: string }[] | null | undefined,
): boolean {
  const ids = kind === 'llms' ? LLMS_CHECK_IDS : ROBOTS_CHECK_IDS;
  return (checks || []).some((check) => ids.has(check.id) && check.status === 'fail');
}

export interface CrawlerFix {
  id: 'fix-llms-txt' | 'fix-robots-txt' | 'fix-ai-txt';
  title: string;
  detail: string;
}

/**
 * One fix per crawler file whose check failed, in report order. The brief, the top fix,
 * and the fix list all read this, so a FAIL row always has a fix and a pass never does.
 */
export function crawlerFixes(checks: readonly { id: string; status: string }[] | null | undefined): CrawlerFix[] {
  const rows = checks || [];
  const failed = (id: string) => rows.some((check) => check.id === id && check.status === 'fail');
  const fixes: CrawlerFix[] = [];
  if (failed('llms_txt')) {
    fixes.push({
      id: 'fix-llms-txt',
      title: 'Add a short page at /llms.txt',
      detail: 'No llms.txt text file was found at the site root. Add one with a title and a short summary of what you sell. The file is a hint, not a score.',
    });
  } else if (failed('llms_structure')) {
    fixes.push({
      id: 'fix-llms-txt',
      title: 'Give /llms.txt a title and a short summary',
      detail: 'llms.txt is there but is missing a title or a short summary. Add both at the top. The file is a hint, not a score.',
    });
  }
  if (crawlerFixWanted('robots', rows)) {
    fixes.push({
      id: 'fix-robots-txt',
      title: 'Let crawlers read public pages in robots.txt',
      detail: 'robots.txt blocks one or more named AI crawlers. Allow them on the public pages you want quoted.',
    });
  }
  if (failed('ai_txt')) {
    fixes.push({
      id: 'fix-ai-txt',
      title: 'Add an optional /ai.txt',
      detail: 'No ai.txt text file was found at the site root. It is optional. It says how AI tools may use your pages.',
    });
  }
  return fixes;
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
