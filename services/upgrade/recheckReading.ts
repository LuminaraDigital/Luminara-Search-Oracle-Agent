/**
 * One check, read from one fetched homepage. A blocked or empty fetch stays not measured.
 */
import { evaluateRealEstateChecks, realEstatePageFromHtml, type RealEstateCheck } from '../audit/realEstateChecks';

export type RecheckId = 'title' | 'schema' | 'nap' | 'agent_pages' | 'area_pages' | 'gbp' | 'reviews' | 'brand_mention';

const RECHECK_IDS: readonly RecheckId[] = [
  'title',
  'schema',
  'nap',
  'agent_pages',
  'area_pages',
  'gbp',
  'reviews',
  'brand_mention',
];

export function isRecheckId(value: string): value is RecheckId {
  return (RECHECK_IDS as readonly string[]).includes(value);
}

export interface RecheckReading {
  measured: boolean;
  passed: boolean | null;
  detail: string;
}

function passedFlag(check: RealEstateCheck): boolean | null {
  return check.status === 'measured' ? check.hit : null;
}

export function readRecheck(html: string, pageUrl: string, status: number, checkId: string, expect = ''): RecheckReading {
  if (!isRecheckId(checkId) || !html.trim() || status < 200 || status >= 300) {
    return { measured: false, passed: null, detail: 'Not measured. The page was not fetched.' };
  }
  if (checkId === 'title') {
    const title = html.match(/<title[^>]*>([^<]*)/i)?.[1]?.replace(/\s+/g, ' ').trim() || '';
    const needle = expect.trim();
    if (!title || !needle) return { measured: false, passed: null, detail: 'Not measured. The page title was not read.' };
    const passed = title.toLowerCase().includes(needle.toLowerCase());
    return {
      measured: true,
      passed,
      detail: passed ? `Measured. The title includes "${needle}".` : `Measured. The title does not include "${needle}".`,
    };
  }
  if (checkId === 'brand_mention') {
    const needle = expect.trim();
    if (!needle) return { measured: false, passed: null, detail: 'Not measured. A brand or domain needle is required.' };
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return { measured: false, passed: null, detail: 'Not measured. The page body text was empty.' };
    const passed = text.toLowerCase().includes(needle.toLowerCase());
    return {
      measured: true,
      passed,
      detail: passed ? `Measured. The page mentions "${needle}".` : `Measured. The page does not mention "${needle}".`,
    };
  }
  const checks = evaluateRealEstateChecks([realEstatePageFromHtml(html, pageUrl, status)]);
  const check = checks.find((item) => item.id === checkId);
  if (!check || check.status !== 'measured') {
    return { measured: false, passed: null, detail: check?.detail || 'Not measured. The page was not fetched.' };
  }
  return { measured: true, passed: passedFlag(check), detail: check.detail };
}
