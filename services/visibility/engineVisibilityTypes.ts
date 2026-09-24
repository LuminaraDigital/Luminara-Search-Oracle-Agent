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

export interface EngineVisibilityEvidence {
  query: string;
  cited: boolean;
  answerSnippet?: string;
  sources?: string[];
  rawRef?: string;
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
