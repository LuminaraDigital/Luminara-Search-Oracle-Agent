/**
 * Public win page: a measured checklist pass, or a measured recheck pass.
 * The page never carries findings, evidence, or a 0-100 health figure.
 */
import { cleanScrapedName } from '../audit/brandName';
import { formatAuDate } from '../../utils/formatAuDate';

/** At least 3 of 4 checks. Same ratio for a longer checklist. */
const WIN_MIN_PASSED = 3;
const WIN_MIN_TOTAL = 4;

export const WIN_FOOTER = 'Checked with Luminara Suite';
export const WIN_CTA = 'Check your agency free';
export const IMPROVEMENT_LINE = 'This check passed on the page we just fetched.';
export const WIN_LINK_PLACEHOLDER = 'the public page link';
export const WIN_SHARES_KEY = 'luminara_win_shares_v1';

export type WinClaim =
  | { kind: 'score'; passed: number; total: number; fixesDone: number }
  | { kind: 'improvement'; fixesDone: number };

export type ShareChannel = 'linkedin' | 'x' | 'copy' | 'native';

export interface PublicWin {
  agency: string;
  result: string | null;
  date: string;
  footer: string;
}

const CHECKS = /\bpassed (\d+) of (\d+) checks\b/i;

export function checksQualify(passed: number, total: number): boolean {
  return Number.isInteger(passed)
    && Number.isInteger(total)
    && total >= 1
    && passed >= 0
    && passed <= total
    && passed * WIN_MIN_TOTAL >= total * WIN_MIN_PASSED;
}

export function measuredChecks(reportText: string, measured: boolean): { passed: number; total: number } | null {
  if (!measured) return null;
  const match = reportText.match(CHECKS);
  if (!match) return null;
  const passed = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isInteger(passed) || !Number.isInteger(total) || total < 1 || passed < 0 || passed > total) return null;
  return { passed, total };
}

function clampFixes(value: number): number {
  if (!Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, 500);
}

/** Null unless the run measured a pass at the threshold, or a recheck measured a pass. */
export function winEligibility(input: {
  measured: boolean;
  reportText: string;
  recheckPassed: boolean;
  fixesDone: number;
}): WinClaim | null {
  const fixesDone = clampFixes(input.fixesDone);
  const checks = measuredChecks(input.reportText, input.measured);
  if (checks && checksQualify(checks.passed, checks.total)) {
    return { kind: 'score', passed: checks.passed, total: checks.total, fixesDone };
  }
  if (input.recheckPassed) return { kind: 'improvement', fixesDone };
  return null;
}

/** Page-supported name. A host or a blank stays "This agency". */
export function publicAgencyName(name: string | null | undefined): string {
  return cleanScrapedName(name) || 'This agency';
}

export function publicWin(input: {
  agencyName: string | null | undefined;
  claim: WinClaim;
  hideScore: boolean;
  createdAt: number;
}): PublicWin {
  const agency = publicAgencyName(input.agencyName);
  let result: string | null = null;
  if (input.claim.kind === 'score' && !input.hideScore) {
    result = `Passed ${input.claim.passed} of ${input.claim.total} checks`;
  } else if (input.claim.kind === 'improvement') {
    result = IMPROVEMENT_LINE;
  }
  return { agency, result, date: formatAuDate(input.createdAt), footer: WIN_FOOTER };
}

function fixesClause(count: number): string {
  if (count <= 0) return '';
  return ` Fixed ${count} ${count === 1 ? 'issue' : 'issues'}.`;
}

/** Factual post the user can edit. They publish it themselves. */
export function winPostText(input: { win: PublicWin; claim: WinClaim; link: string }): string {
  const fixes = fixesClause(input.claim.fixesDone);
  const lead = input.claim.kind === 'improvement'
    ? `We just rechecked how AI search sees ${input.win.agency}. ${IMPROVEMENT_LINE}`
    : input.win.result
      ? `We just checked how AI search sees ${input.win.agency}: ${input.win.result.charAt(0).toLowerCase()}${input.win.result.slice(1)}.`
      : `We just checked how AI search sees ${input.win.agency}.`;
  return `${lead}${fixes} Free check: ${input.link}`;
}

export function canonicalWinUrl(origin: string, id: string): string {
  return `${origin.replace(/\/+$/, '')}/win/${id}`;
}

export function trackedWinUrl(pageUrl: string, source: string): string {
  const url = new URL(pageUrl);
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', 'social');
  url.searchParams.set('utm_campaign', 'win');
  return url.toString();
}

export function shareIntent(channel: 'linkedin' | 'x', pageUrl: string, text: string): string {
  if (channel === 'linkedin') {
    return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;
  }
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`;
}

const CREATE_KEYS = new Set(['agencyName', 'kind', 'passed', 'total', 'fixesDone', 'hideScore']);

export type WinCreate =
  | { ok: true; agencyName: string; claim: WinClaim; hideScore: boolean }
  | { ok: false; error: string; code: 'WIN_PRIVATE' | 'WIN_SHAPE' };

/** Trust boundary for the publish body. Extra keys are refused, including findings. */
export function parseWinCreate(raw: unknown): WinCreate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Send the agency name and the measured result.', code: 'WIN_SHAPE' };
  }
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!CREATE_KEYS.has(key)) {
      return {
        ok: false,
        error: 'The public page only accepts the agency name, the result, and the fix count.',
        code: 'WIN_PRIVATE',
      };
    }
  }
  const hideScore = body.hideScore === true;
  const fixesDone = clampFixes(typeof body.fixesDone === 'number' ? body.fixesDone : 0);
  const agencyName = publicAgencyName(typeof body.agencyName === 'string' ? body.agencyName : null);
  if (body.kind === 'improvement') {
    return { ok: true, agencyName, hideScore, claim: { kind: 'improvement', fixesDone } };
  }
  if (body.kind !== 'score' || typeof body.passed !== 'number' || typeof body.total !== 'number') {
    return { ok: false, error: 'That result is not a measured pass this page can publish.', code: 'WIN_SHAPE' };
  }
  if (!checksQualify(body.passed, body.total)) {
    return { ok: false, error: 'That result is not a measured pass this page can publish.', code: 'WIN_SHAPE' };
  }
  return {
    ok: true,
    agencyName,
    hideScore,
    claim: { kind: 'score', passed: body.passed, total: body.total, fixesDone },
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
