/**
 * Per-engine AI visibility measurement results.
 * Never invent citations: use not_measured when keys fail or are absent.
 * Use estimated for OpenRouter LLM answer probes (not product-engine citation KPIs).
 */

export type VisibilityEngineId = 'chatgpt' | 'google_aio' | 'perplexity' | 'web_serp';

export type VisibilityMeasurementStatus = 'measured' | 'estimated' | 'not_measured';

export type VisibilityMeasurementMethod =
  | 'dataforseo_llm_mentions'
  | 'llm_answer_probe'
  | 'gemini_google_search'
  | 'tavily_serp'
  | 'local_serp'
  | 'none';

export type OffSiteMentionChannel =
  | 'editorial_pr'
  | 'roundup_listicle'
  | 'review_platform'
  | 'community_forum';

export type BrandMentionStatus = 'recommended' | 'mentioned' | 'absent';

export interface EngineVisibilityEvidence {
  query: string;
  cited: boolean;
  brandStatus?: BrandMentionStatus;
  competitorsMentioned?: string[];
  answerSnippet?: string;
  sources?: string[];
  rawRef?: string;
}

export interface MissingMentionSource {
  domain: string;
  sampleUrl?: string;
  channel: OffSiteMentionChannel;
  competitorsMentioned: string[];
  competitorMentionCount: number;
  promptCount: number;
  prompts: string[];
  engines: VisibilityEngineId[];
  actionRecommendation: string;
}

export function extractSourceHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return rawUrl.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  }
}

export function classifyBrandMentionStatus(cited: boolean, text: string): BrandMentionStatus {
  if (!cited) return 'absent';
  return /\b(recommend|recommended|best|top pick|top choice|leading)\b/i.test(text)
    ? 'recommended'
    : 'mentioned';
}

export function findMentionedCompetitors(text: string, competitors: string[]): string[] {
  const lower = text.toLowerCase();
  return competitors.filter((comp) => lower.includes(comp.toLowerCase().replace(/^www\./i, '')));
}

export function classifyOffSiteChannel(domain: string, urlOrSnippet = ''): OffSiteMentionChannel {
  const d = domain.toLowerCase();
  const ctx = `${d} ${urlOrSnippet.toLowerCase()}`;
  if (
    d.includes('reddit.com') ||
    d.includes('quora.com') ||
    d.includes('ycombinator.com') ||
    d.includes('discord') ||
    d.includes('community') ||
    d.includes('forum') ||
    d.includes('stackoverflow.com')
  ) {
    return 'community_forum';
  }
  if (
    d.includes('g2.com') ||
    d.includes('capterra.com') ||
    d.includes('trustpilot.com') ||
    d.includes('yelp.com') ||
    d.includes('tripadvisor.com') ||
    d.includes('reviews.io') ||
    d.includes('feefo.com') ||
    d.includes('youtube.com') ||
    d.includes('youtu.be')
  ) {
    return 'review_platform';
  }
  if (
    d.includes('pcmag.com') ||
    d.includes('wired.com') ||
    d.includes('tomshardware.com') ||
    d.includes('zdnet.com') ||
    d.includes('macrumors.com') ||
    d.includes('cnet.com') ||
    d.includes('techradar.com') ||
    d.includes('timeout.com') ||
    /\b(best-|top-|\bbest\b|\broundup\b|\bvs\b|\bcomparison\b|\balternatives\b)/.test(ctx)
  ) {
    return 'roundup_listicle';
  }
  return 'editorial_pr';
}

export interface EngineVisibilityResult {
  engine: VisibilityEngineId;
  measurementStatus: VisibilityMeasurementStatus;
  method: VisibilityMeasurementMethod;
  /** Only meaningful when measurementStatus === 'measured'. */
  cited: boolean | null;
  citationRatePercent: number | null;
  evidence: EngineVisibilityEvidence[];
  errorReason?: string;
  measuredAt: number;
}

export function notMeasuredEngine(
  engine: VisibilityEngineId,
  reason: string,
  measuredAt = Date.now(),
): EngineVisibilityResult {
  return {
    engine,
    measurementStatus: 'not_measured',
    method: 'none',
    cited: null,
    citationRatePercent: null,
    evidence: [],
    errorReason: reason,
    measuredAt,
  };
}

/**
 * Aggregate citation rate over product-measured engines only.
 * Excludes estimated (llm_answer_probe) so OpenRouter probes are not product KPIs.
 */
export function aggregateMeasuredCitationRate(results: EngineVisibilityResult[]): number | null {
  const measured = results.filter(
    (r) =>
      r.measurementStatus === 'measured' &&
      r.method !== 'llm_answer_probe' &&
      r.citationRatePercent != null,
  );
  if (measured.length === 0) return null;
  const sum = measured.reduce((acc, r) => acc + (r.citationRatePercent ?? 0), 0);
  return Math.round(sum / measured.length);
}
