/**
 * Plain guest (and signed-in) scout summary.
 * Null metrics stay not_measured. This builder never invents a percentage.
 */
import type { LlmCrawlerCheck, LlmCrawlerReport } from './llmCrawlerReadiness';
import type { HostedScoutRail } from './hostedScoutRail';

export type EvidenceBadgeStatus = 'measured' | 'estimated' | 'not_measured';

export interface ScoutBadge {
  label: string;
  status: EvidenceBadgeStatus;
  /** Shown only when status is measured or estimated. */
  value?: string;
}

export interface GuestScoutSummary {
  domain: string;
  verdict: string;
  evidenceUsed: string;
  topFix: string;
  nextStep: string;
  badges: ScoutBadge[];
  crawlerChecks: LlmCrawlerCheck[];
  failed: string[];
  evidenceEmpty: boolean;
}

export interface GuestScoutSummaryInput {
  targetUrl: string;
  measurementStatus: 'measured' | 'not_measured';
  measurementReason?: string;
  citationRatePercent: number | null;
  shareOfVoiceScore: number | null;
  healthScore: number | null;
  scrapedPageCount: number;
  serpCount: number;
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

function metricBadge(label: string, value: number | null, suffix: string): ScoutBadge {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { label, status: 'not_measured' };
  }
  return { label, status: 'measured', value: `${value}${suffix}` };
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
  const brief = (input.plainEnglishBrief || '').replace(/\s+/g, ' ').trim();

  let verdict: string;
  if (evidenceEmpty || (input.measurementStatus === 'not_measured' && input.citationRatePercent == null && input.serpCount === 0 && input.scrapedPageCount === 0)) {
    verdict = `AI mention readiness for ${domain} was not measured. This run collected no page text and no search rows, so there is no citation rate, share of voice, or health score.`;
  } else if (input.measurementStatus === 'not_measured') {
    const reason = (input.measurementReason || '').trim();
    verdict = reason
      ? `Some signals for ${domain} were not measured. ${reason}.`
      : `Some signals for ${domain} were not measured. Missing figures are omitted rather than guessed.`;
  } else if (brief) {
    verdict = brief.slice(0, 600);
  } else {
    verdict = `Live evidence was collected for ${domain}. Use the badges to see what was measured.`;
  }

  const evidenceUsed = evidenceEmpty
    ? 'No page text and no search rows were collected in this run.'
    : `Pages with text or schema: ${input.scrapedPageCount}. Search rows: ${input.serpCount}.`;

  const firstFix = input.findings.map((f) => f.title.trim()).find(Boolean);
  const topFix = firstFix
    || (evidenceEmpty
      ? 'Do not ship changes from this run. Fetch the homepage and a search sample, then scout again.'
      : 'Ship the first measured gap before adding more pages.');

  const failed: string[] = [];
  for (const err of input.errors || []) {
    const clean = err.replace(/\s+/g, ' ').trim();
    if (clean && !failed.includes(clean)) failed.push(clean.slice(0, 240));
  }
  if (input.scrapedPageCount === 0) {
    const line = 'Page fetch returned no usable text or schema.';
    if (!failed.some((f) => /page fetch/i.test(f))) failed.push(line);
  }
  if (input.serpCount === 0) {
    const line = 'Search sample was empty or the search provider did not respond.';
    if (!failed.some((f) => /search/i.test(f))) failed.push(line);
  }

  const badges: ScoutBadge[] = [
    metricBadge('Citation rate', input.citationRatePercent, '%'),
    metricBadge('Share of voice', input.shareOfVoiceScore, '/100'),
    metricBadge('Page health', input.healthScore, '/100'),
  ];
  const crawlerChecks = input.llmCrawler?.checks || [];
  for (const check of crawlerChecks) {
    if (check.status === 'fail' && check.detail) failed.push(check.detail);
  }

  return {
    domain,
    verdict,
    evidenceUsed,
    topFix,
    nextStep: nextStepFor(input.hostedRail, evidenceEmpty),
    badges,
    crawlerChecks,
    failed: failed.slice(0, 8),
    evidenceEmpty,
  };
}
