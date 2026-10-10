/**
 * Plain guest (and signed-in) scout summary.
 * Null metrics stay not_measured. This builder never invents a percentage.
 * The Instant Scout card keeps the full brief in verdictMarkdown.
 * Share, teaser, and clipboard use verdict: the same text with heading
 * and emphasis markers removed. The worker still clips that plain field.
 */
import { isProviderDecisionRecord } from '../apiClient';
import type { LlmCrawlerCheck, LlmCrawlerReport } from './llmCrawlerReadiness';
import { hostedAuthRecoveryHint, type HostedScoutRail } from './hostedScoutRail';
import { teaserFailureCodes, teaserFailureLine, type TeaserFailureCode } from './teaserFailureCodes';

export type EvidenceBadgeStatus = 'measured' | 'estimated' | 'not_measured';

export interface ScoutBadge {
  label: string;
  status: EvidenceBadgeStatus;
  /** Shown only when status is measured or estimated. */
  value?: string;
}

export interface GuestScoutSummary {
  domain: string;
  /** Plain text for teaser, share, and clipboard. No heading or emphasis markers. */
  verdict: string;
  /** Full brief for the Instant Scout card. Newlines stay. Never sliced mid-string. */
  verdictMarkdown: string;
  evidenceUsed: string;
  topFix: string;
  nextStep: string;
  badges: ScoutBadge[];
  crawlerChecks: LlmCrawlerCheck[];
  /** Public sentences. Raw provider errors are not copied here. */
  failed: string[];
  /** Allow-listed codes sent when minting a public teaser. */
  failureCodes: TeaserFailureCode[];
  evidenceEmpty: boolean;
  /** True when metrics must not be shown as live measurements. */
  degraded: boolean;
  /** Set when the run cannot show live scores. Wording follows hostedRail. */
  banner?: string;
}

export interface GuestScoutSummaryInput {
  targetUrl: string;
  measurementStatus: 'measured' | 'not_measured';
  measurementReason?: string;
  citationRatePercent: number | null;
  /** Count of the serpCount search rows that mention the brand. Not a 0-100 score. */
  shareOfVoiceScore: number | null;
  /**
   * The checklist number (85 minus a fixed amount for each failed check).
   * It says whether the checks ran. The card does not print it: it prints healthChecks.
   */
  healthScore: number | null;
  /** How many of the site checks passed, of how many ran. Shown on the card as that count. */
  healthChecks?: { passed: number; total: number } | null;
  scrapedPageCount: number;
  serpCount: number;
  /** The engines the search rows came from, as recorded on the rows. */
  searchEngines?: readonly string[];
  findings: Array<{ title: string }>;
  errors?: string[];
  plainEnglishBrief?: string;
  llmCrawler?: LlmCrawlerReport | null;
  hostedRail: HostedScoutRail;
}

function hostLabel(targetUrl: string): string {
  const raw = String(targetUrl || '').trim();
  const host = raw.replace(/^https?:\/\//i, '').split(/[/?#]/)[0]?.replace(/:\d+$/, '') || raw;
  return host || 'this site';
}

/** Degraded Instant Audit banner. Signed-in and Telegram rails never ask the user to sign in. */
export function liveDataUnavailableCopy(hostedRail: HostedScoutRail): string {
  if (hostedRail === 'byok_or_signin') {
    return 'Live data unavailable. Sample / not measured. Add your own keys in Settings, or sign in.';
  }
  return `Live search or page fetch did not run. ${hostedAuthRecoveryHint({ rail: hostedRail })}`;
}

const DEGRADED_FAILURE_CODES = new Set<string>(['provider_failed', 'search_empty', 'page_fetch_empty']);

export function isDegradedScout(input: {
  measurementStatus: 'measured' | 'not_measured';
  evidenceEmpty: boolean;
  failureCodes: readonly string[];
}): boolean {
  if (input.measurementStatus === 'not_measured' || input.evidenceEmpty) return true;
  return input.failureCodes.some((code) => DEGRADED_FAILURE_CODES.has(code));
}

/**
 * Skip the report model when the scout is degraded or not measured.
 * Guests and signed-in runs share this gate. The guest flag stays so callers
 * can pass the session they already have. It does not reopen a degraded run.
 */
export function shouldGenerateAuditReport(
  _isGuest: boolean,
  summary: Pick<GuestScoutSummary, 'evidenceEmpty' | 'failureCodes'>,
  measurementStatus: 'measured' | 'not_measured',
): boolean {
  return !isDegradedScout({
    measurementStatus,
    evidenceEmpty: summary.evidenceEmpty,
    failureCodes: summary.failureCodes,
  });
}

/**
 * A value that cannot be a count of the rows collected is treated as not measured.
 * That covers a 0-100 score stored before share of voice became a count.
 */
function mentionCountOf(count: number | null, total: number): number | null {
  if (typeof count !== 'number' || !Number.isInteger(count)) return null;
  if (!Number.isInteger(total) || total <= 0 || count < 0 || count > total) return null;
  return count;
}

/** Share of voice is shown as the count it is: rows that mention the brand, of rows collected. */
function mentionCountBadge(label: string, count: number | null, total: number): ScoutBadge {
  if (count == null) return { label, status: 'not_measured' };
  return { label, status: 'measured', value: `mentioned in ${count} of ${total} web results` };
}

/** Page health is shown as passed checks of checks run, never as an out-of-100 number. */
function checksBadge(
  label: string,
  healthScore: number | null,
  checks: { passed: number; total: number } | null | undefined,
): ScoutBadge {
  if (typeof healthScore !== 'number' || !checks) return { label, status: 'not_measured' };
  const passed = mentionCountOf(checks.passed, checks.total);
  if (passed == null) return { label, status: 'not_measured' };
  return { label, status: 'measured', value: `${passed} of ${checks.total} checks passed` };
}

/** Names only a search source the rows really came from. */
const SEARCH_ENGINE_NAMES: Record<string, string> = {
  tavily: 'Tavily web search',
  local_serp: 'the local search sidecar',
  google: 'Google search',
  perplexity: 'Perplexity',
};

function searchSourceLabel(engines: readonly string[] | undefined): string {
  const names = [...new Set((engines || []).map((engine) => SEARCH_ENGINE_NAMES[engine]).filter(Boolean))];
  return names.join(' and ');
}

/**
 * Plain text for public teasers. Heading markers, emphasis, and tags come off.
 * Already-plain sentences stay readable. This is not the card renderer.
 */
export function plainScoutVerdict(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/\*\*|__|~~/g, '')
    .replace(/(^|[\s(])[*_~](?=\S)([\s\S]*?\S)[*_~](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function nextStepFor(rail: HostedScoutRail, evidenceEmpty: boolean): string {
  if (evidenceEmpty && rail === 'byok_or_signin') {
    return 'Add your own AI keys in Settings, or sign in, then run the scout again. This run is not a finished audit.';
  }
  if (evidenceEmpty && rail === 'tma_hosted') {
    return 'Try the scout again when search and page fetch respond. You can also add your own keys in Settings. This run is not a finished audit.';
  }
  if (evidenceEmpty) {
    return 'Check provider status in Settings and run the scout again. This run is not a finished audit.';
  }
  if (rail === 'byok_or_signin') {
    return 'Sign in to save this scout to a project. Full branded share links stay on Growth and Agency. A redacted teaser needs Telegram or a signed-in session.';
  }
  if (rail === 'tma_hosted') {
    return 'Share the redacted teaser if it is useful. Sign in on the web later to save a project. Full branded share links stay on Growth and Agency.';
  }
  return 'Save the strategy to a project if you want it kept. Full branded share links stay on Growth and Agency.';
}

export function buildGuestScoutSummary(input: GuestScoutSummaryInput): GuestScoutSummary {
  const domain = hostLabel(input.targetUrl);
  const evidenceEmpty = input.scrapedPageCount === 0 && input.serpCount === 0;
  const rawBrief = (input.plainEnglishBrief || '').replace(/\r\n/g, '\n').trim();

  let verdict: string;
  let verdictMarkdown: string;
  const notMeasuredEmpty = input.measurementStatus === 'not_measured'
    && input.citationRatePercent == null
    && input.serpCount === 0
    && input.scrapedPageCount === 0;
  if (evidenceEmpty || notMeasuredEmpty) {
    verdict = `AI mention readiness for ${domain} was not measured. This run collected no page text and no search rows, so there is no citation rate, share of voice, or health score.`;
    verdictMarkdown = verdict;
  } else if (input.measurementStatus === 'not_measured') {
    const reason = (input.measurementReason || '').trim();
    verdict = reason
      ? `Some signals for ${domain} were not measured. ${reason}.`
      : `Some signals for ${domain} were not measured. Missing figures are omitted rather than guessed.`;
    verdictMarkdown = verdict;
  } else if (rawBrief) {
    verdictMarkdown = rawBrief;
    verdict = plainScoutVerdict(rawBrief) || `Live evidence was collected for ${domain}. Use the badges to see what was measured.`;
  } else {
    verdict = `Live evidence was collected for ${domain}. Use the badges to see what was measured.`;
    verdictMarkdown = verdict;
  }

  const searchSource = searchSourceLabel(input.searchEngines);
  const searchUsed = input.serpCount > 0
    ? `Found ${input.serpCount} web result${input.serpCount === 1 ? '' : 's'}${searchSource ? ` through ${searchSource}` : ''}.`
    : 'No web results were collected.';
  const evidenceUsed = evidenceEmpty
    ? 'No page text and no search rows were collected in this run.'
    : `Pages with text or schema: ${input.scrapedPageCount}. ${searchUsed}`;

  const firstFix = input.findings.map((f) => f.title.trim()).find(Boolean);
  const topFix = firstFix
    || (evidenceEmpty
      ? 'Do not ship changes from this run. Fetch the homepage and a search sample, then scout again.'
      : 'Ship the first measured gap before adding more pages.');

  const crawlerChecks = input.llmCrawler?.checks || [];
  const failureCodes = teaserFailureCodes({
    scrapedPageCount: input.scrapedPageCount,
    serpCount: input.serpCount,
    hadProviderError: (input.errors || []).some((err) => err.trim().length > 0 && !isProviderDecisionRecord(err)),
    crawlerChecks,
  });
  const degraded = isDegradedScout({
    measurementStatus: input.measurementStatus,
    evidenceEmpty,
    failureCodes,
  });
  const failed = failureCodes.map((code) => teaserFailureLine(code));
  const mentionCount = mentionCountOf(input.shareOfVoiceScore, input.serpCount);
  // Citation rate and share of voice were always the same two counts: search rows
  // that mention the brand, out of the rows collected. Both badges print those counts.
  // Neither prints a percentage.
  let badges: ScoutBadge[] = [
    mentionCountBadge('Citation rate', typeof input.citationRatePercent === 'number' ? mentionCount : null, input.serpCount),
    mentionCountBadge('Share of voice', mentionCount, input.serpCount),
    checksBadge('Page health', input.healthScore, input.healthChecks),
  ];
  if (degraded) {
    badges = badges.map((badge) => ({ label: badge.label, status: 'not_measured' }));
  }

  if (degraded) {
    verdict = evidenceEmpty
      ? `AI mention readiness for ${domain} was not measured. This run collected no page text and no search rows, so there is no citation rate, share of voice, or health score.`
      : `Live data unavailable for ${domain}. Some signals were not measured. Missing figures are omitted rather than guessed.`;
    verdictMarkdown = verdict;
  }

  return {
    domain,
    verdict,
    verdictMarkdown,
    evidenceUsed,
    topFix,
    nextStep: nextStepFor(input.hostedRail, degraded || evidenceEmpty),
    badges,
    crawlerChecks,
    failed,
    failureCodes,
    evidenceEmpty,
    degraded,
    banner: degraded ? liveDataUnavailableCopy(input.hostedRail) : undefined,
  };
}
