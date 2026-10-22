/**
 * One check, read from one fetched homepage. A blocked or empty fetch stays not measured.
 */
import { evaluateRealEstateChecks, type RealEstateCheck } from '../audit/realEstateChecks';

export type RecheckId = 'title' | 'schema' | 'nap' | 'agent_pages' | 'area_pages' | 'gbp' | 'reviews';

const RECHECK_IDS: readonly RecheckId[] = ['title', 'schema', 'nap', 'agent_pages', 'area_pages', 'gbp', 'reviews'];

export function isRecheckId(value: string): value is RecheckId {
  return (RECHECK_IDS as readonly string[]).includes(value);
}

export interface RecheckReading {
  measured: boolean;
  passed: boolean | null;
  detail: string;
}

function passedFlag(check: RealEstateCheck): boolean | null {
  if (check.status !== 'measured') return null;
  switch (check.id) {
    case 'schema':
      return /RealEstateAgent|LocalBusiness/.test(check.detail) && !check.detail.includes('were not among them');
    case 'nap':
      return check.detail.includes('match on');
    case 'agent_pages':
      return check.detail.includes('Agent profile URL');
    case 'area_pages':
      return check.detail.includes('Suburb or area URL');
    case 'gbp':
      return check.detail.includes('Google Business Profile link:');
    case 'reviews':
      return check.detail.startsWith('Measured.') && !check.detail.includes('No Review');
    default: {
      const _exhaustive: never = check.id;
      return _exhaustive;
    }
  }
}

function pageFromHtml(html: string, pageUrl: string, status: number) {
  const title = html.match(/<title[^>]*>([^<]*)/i)?.[1]?.replace(/\s+/g, ' ').trim() || '';
  const links: string[] = [];
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    if (links.length >= 40) break;
    try {
      links.push(new URL(match[1], pageUrl).toString());
    } catch {
      /* skip a bad href */
    }
  }
  const schemas: Array<{ type?: string; rawJson?: string }> = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (schemas.length >= 5) break;
    schemas.push({ rawJson: match[1].slice(0, 20_000) });
  }
  return {
    url: pageUrl,
    httpStatus: status,
    title,
    rawTextSnippet: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
    outboundLinks: links,
    schemasFound: schemas,
  };
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
  const checks = evaluateRealEstateChecks([pageFromHtml(html, pageUrl, status)]);
  const check = checks.find((item) => item.id === checkId);
  if (!check || check.status !== 'measured') {
    return { measured: false, passed: null, detail: check?.detail || 'Not measured. The page was not fetched.' };
  }
  return { measured: true, passed: passedFlag(check), detail: check.detail };
}
