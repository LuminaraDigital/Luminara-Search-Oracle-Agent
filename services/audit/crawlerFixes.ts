/**
 * The fix for each crawler file whose check failed. The brief, the top fix, and the fix list
 * all read this, so a FAIL row always has a fix and a passing or unmeasured row never does.
 */
import { crawlerFixWanted } from './teaserFailureCodes';

export type CrawlerCheckRow = { id: string; status: string };

export interface CrawlerFix {
  id: 'fix-robots-txt' | 'fix-llms-txt' | 'fix-ai-txt';
  filename: '/robots.txt' | '/llms.txt' | '/ai.txt';
  title: string;
  detail: string;
  /** ai.txt is optional. It is listed, but it never becomes the top fix or a needed fix. */
  optional: boolean;
}

/** Most serious first: a robots rule that blocks AI crawlers, then llms.txt, then optional ai.txt. */
export function crawlerFixes(checks: readonly CrawlerCheckRow[] | null | undefined): CrawlerFix[] {
  const rows = checks || [];
  const failed = (id: string) => rows.some((check) => check.id === id && check.status === 'fail');
  const fixes: CrawlerFix[] = [];
  if (crawlerFixWanted('robots', rows)) {
    fixes.push({
      id: 'fix-robots-txt',
      filename: '/robots.txt',
      title: 'Let crawlers read public pages in robots.txt',
      detail: 'robots.txt blocks one or more named AI crawlers. Allow them on the public pages you want quoted.',
      optional: false,
    });
  }
  if (crawlerFixWanted('llms', rows)) {
    const missing = failed('llms_txt');
    fixes.push({
      id: 'fix-llms-txt',
      filename: '/llms.txt',
      title: missing ? 'Add a short page at /llms.txt' : 'Give /llms.txt a title and a short summary',
      detail: missing
        ? 'No llms.txt text file was found at the site root. Add one with a title and a short summary of what you sell. The file is a hint, not a score.'
        : 'llms.txt is there but is missing a title or a short summary. Add both at the top. The file is a hint, not a score.',
      optional: false,
    });
  }
  if (failed('ai_txt')) {
    fixes.push({
      id: 'fix-ai-txt',
      filename: '/ai.txt',
      title: 'Optional: add /ai.txt',
      detail: 'No ai.txt text file was found at the site root. It is optional. Write your own policy for how AI tools may use your pages.',
      optional: true,
    });
  }
  return fixes;
}

/** The sentence that counts crawler fixes. Empty when none is needed, because optional ai.txt alone is not a problem. */
export function crawlerFixNote(fixes: readonly CrawlerFix[]): string {
  const needed = fixes.filter((fix) => !fix.optional).length;
  if (needed === 0) return '';
  const optional = fixes.length - needed;
  return ` ${needed} AI crawler ${needed === 1 ? 'fix is' : 'fixes are'} needed${optional > 0 ? `, plus ${optional} optional` : ''}.`;
}
