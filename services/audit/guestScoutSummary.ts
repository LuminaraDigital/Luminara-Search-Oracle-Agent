/**
 * Plain guest (and signed-in) scout summary.
 * Null metrics stay not_measured. This builder never invents a percentage.
 * The Instant Scout card keeps the full brief in verdictMarkdown.
 * Share, teaser, and clipboard use verdict: the same text with heading
 * and emphasis markers removed. The worker still clips that plain field.
 */
import type { ReportFocus } from '../../types';
import { isProviderDecisionRecord } from '../apiClient';
import type { AnswerDepth } from './answerDepth';
import type { LlmCrawlerCheck, LlmCrawlerReport } from './llmCrawlerReadiness';
import { hostedAuthRecoveryHint, type HostedScoutRail } from './hostedScoutRail';
import { crawlerFixes, teaserFailureCodes, teaserFailureLine, type TeaserFailureCode } from './teaserFailureCodes';
import { guardUnmeasuredClaims, type MeasuredClaimFacts } from './unmeasuredClaimGuard';
import { measuredCheckLine, resolveCheckCounts } from '../agentCore/auditEvidenceGate';
import { countPhrase, joinList, tidySentence } from './reportSentence';

export type EvidenceBadgeStatus = 'measured' | 'estimated' | 'not_measured';

export interface ScoutBadge {
  label: string;
  status: EvidenceBadgeStatus;
  /** Shown only when status is measured or estimated. */
  value?: string;
}

export interface GuestScoutSummary {
  domain: string;
  /** Display name when the page or Jev supplied one. The domain stays in `domain`. */
  brand?: string;
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
  /** Numbers this run measured. The claim guard reads them. The card does not. */
  measured?: MeasuredClaimFacts;
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
  healthChecks?: { passed: number; total: number; failed?: number; unmeasured?: number } | null;
  scrapedPageCount: number;
  serpCount: number;
  /** The engines the search rows came from, as recorded on the rows. */
  searchEngines?: readonly string[];
  findings: Array<{ title: string }>;
  errors?: string[];
  plainEnglishBrief?: string;
  llmCrawler?: LlmCrawlerReport | null;
  hostedRail: HostedScoutRail;
  /** SEO, AEO, or GEO. Omitted means the Quick answer-engine pass. */
  focus?: ReportFocus;
  /** Header Thorough. Omitted means Quick. */
  depth?: AnswerDepth;
  brand?: string | null;
}

const EMPTY_COLLECTED = 'This run collected no page text and no search rows, so there is no citation rate, share of voice, or health score.';

/** Unmeasured empty runs must not all print the Quick answer-engine sentence. */
export function emptyUnmeasuredVerdict(domain: string, focus: ReportFocus = 'AEO', depth: AnswerDepth = 'quick'): string {
  if (focus === 'AEO' && depth === 'quick') {
    return `AI mention readiness for ${domain} was not measured. ${EMPTY_COLLECTED}`;
  }
  const pass = depth === 'thorough' ? `${focus} thorough` : focus;
  return `${pass} for ${domain} was not measured, and this is not the Quick result. ${EMPTY_COLLECTED}`;
}

function hostLabel(targetUrl: string): string {
  const raw = String(targetUrl || '').trim();
  const host = raw.replace(/^https?:\/\//i, '').split(/[/?#]/)[0]?.replace(/:\d+$/, '') || raw;
  return host || 'this site';
}

/** Degraded Instant Audit banner. Signed-in and Telegram rails never ask the user to sign in. */
export function liveDataUnavailableCopy(hostedRail: HostedScoutRail): string {
  if (hostedRail === 'byok_or_signin') {
    return 'Live data unavailable. Sample / not measured.';
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

/** The count as it is: rows that mention the brand, of rows collected. */
function mentionCountBadge(label: string, count: number | null, total: number): ScoutBadge {
  if (count == null) return { label, status: 'not_measured' };
  return { label, status: 'measured', value: `mentioned in ${count} of ${total} web results` };
}

/** Page health is the same sentence as the brief: passed, failed, and not measured only when a check was not run. */
function checksBadge(
  label: string,
  checks: { passed: number; total: number; failed?: number; unmeasured?: number } | null | undefined,
): ScoutBadge {
  if (!checks) return { label, status: 'not_measured' };
  const passed = mentionCountOf(checks.passed, checks.total);
  if (passed == null) return { label, status: 'not_measured' };
  const counts = resolveCheckCounts({ ...checks, passed });
  const value = measuredCheckLine(counts);
  if (counts.passed === 0 && counts.failed === 0) return { label, status: 'not_measured', value };
  return { label, status: 'measured', value };
}

/**
 * Names only a search source the rows really came from.
 * Vendor and model names stay off the card. "web search" is dropped from the
 * "through" clause so the sentence does not say "web results through web search".
 */
const SEARCH_ENGINE_NAMES: Record<string, string> = {
  tavily: 'web search',
  local_serp: 'a saved search sample',
  google: 'web search',
  perplexity: 'web search',
};

function searchSourceLabel(engines: readonly string[] | undefined): string {
  const names = [...new Set((engines || []).map((engine) => SEARCH_ENGINE_NAMES[engine]).filter(Boolean))];
  return joinList(names.filter((name) => name !== 'web search'));
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

/** The summary card when the run did not keep a scout summary. Every field says it was not measured. */
export function unmeasuredScoutSummary(domain: string): GuestScoutSummary {
  return {
    domain: hostLabel(domain),
    verdict: 'Not measured.',
    verdictMarkdown: 'Not measured.',
    evidenceUsed: 'Not measured.',
    topFix: 'Not measured.',
    nextStep: 'Not measured.',
    badges: [
      { label: 'Citation rate', status: 'not_measured', value: 'Not measured' },
      { label: 'Page health', status: 'not_measured', value: 'Not measured' },
    ],
    crawlerChecks: [],
    failed: [],
    failureCodes: [],
    evidenceEmpty: true,
    degraded: false,
  };
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
  const emptyVerdict = emptyUnmeasuredVerdict(domain, input.focus ?? 'AEO', input.depth ?? 'quick');
  if (evidenceEmpty || notMeasuredEmpty) {
    verdict = emptyVerdict;
    verdictMarkdown = verdict;
  } else if (input.measurementStatus === 'not_measured') {
    const reason = (input.measurementReason || '').trim();
    const reasonSentence = /[.!?]$/.test(reason) ? reason : `${reason}.`;
    verdict = reason
      ? tidySentence(`Some signals for ${domain} were not measured. ${reasonSentence}`)
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
    ? tidySentence(`Found ${countPhrase(input.serpCount, 'web result', 'web results')}${searchSource ? ` through ${searchSource}` : ''}.`)
    : 'No web results were collected.';
  const evidenceUsed = evidenceEmpty
    ? 'No page text and no search rows were collected in this run.'
    : input.measurementStatus === 'not_measured' && input.serpCount === 0
      ? 'No web results were collected. This run did not measure the site.'
      : `Pages with text or schema: ${input.scrapedPageCount}. ${searchUsed}`;

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

  const firstFix = input.findings.map((f) => f.title.trim()).find(Boolean) || crawlerFixes(crawlerChecks)[0]?.title;
  const topFix = (degraded || evidenceEmpty)
    ? 'Do not ship changes from this run. Fetch the homepage and a search sample, then scout again.'
    : (firstFix || 'Ship the first measured gap before adding more pages.');
  const failed = failureCodes.map((code) => teaserFailureLine(code));
  const mentionCount = mentionCountOf(input.shareOfVoiceScore, input.serpCount);
  // Citation rate and share of voice were always the same two counts: search rows
  // that mention the brand, out of the rows collected. One badge prints them, as
  // counts. It keeps the citation rate name: the count is of rows that mention the
  // brand, not of the brand's share against anyone else.
  let badges: ScoutBadge[] = [
    mentionCountBadge('Citation rate', typeof input.citationRatePercent === 'number' ? mentionCount : null, input.serpCount),
    checksBadge('Page health', input.healthChecks),
  ];
  if (degraded) {
    badges = badges.map((badge) => ({ label: badge.label, status: 'not_measured' }));
  }

  if (degraded) {
    verdict = evidenceEmpty
      ? emptyVerdict
      : `Live data unavailable for ${domain}. Some signals were not measured. Missing figures are omitted rather than guessed.`;
    verdictMarkdown = verdict;
  }

  const measured: MeasuredClaimFacts = {
    healthScore: input.healthScore,
    citationRatePercent: input.citationRatePercent,
    shareOfVoice: input.shareOfVoiceScore,
    tavilyResultCount: input.serpCount,
  };
  verdict = guardUnmeasuredClaims(verdict, measured);
  verdictMarkdown = guardUnmeasuredClaims(verdictMarkdown, measured);

  const brand = (input.brand || '').trim();
  return {
    domain,
    ...(brand ? { brand } : {}),
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
    measured,
  };
}
