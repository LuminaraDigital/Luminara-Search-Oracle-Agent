/**
 * Hybrid AI visibility router (W4).
 */
import type { EngineVisibilityResult, VisibilityEngineId, VisibilityMeasurementStatus } from './engineVisibilityTypes';
import {
  aggregateMeasuredCitationRate,
  notMeasuredEngine,
} from './engineVisibilityTypes';
import { fetchDataForSeoMentions, type DfsPostFn } from './dataForSeoMentionsService';
import { probeLlmAnswers, type LlmGenerateFn } from './llmAnswerProbeService';

export type VisibilityRouterInput = {
  domain: string;
  brand?: string;
  queries?: string[];
  locationCode?: number;
  languageCode?: string;
  dfsPost?: DfsPostFn;
  llmGenerate?: LlmGenerateFn;
};

export type VisibilityRouterOutput = {
  engines: EngineVisibilityResult[];
  /** Product KPI aggregate: measured DFS mentions only (excludes LLM probe estimates). */
  aggregateCitationRatePercent: number | null;
  measurementStatus: VisibilityMeasurementStatus;
};

const ENGINES: VisibilityEngineId[] = ['chatgpt', 'google_aio', 'perplexity'];

function statusRank(status: VisibilityMeasurementStatus): number {
  if (status === 'measured') return 3;
  if (status === 'estimated') return 2;
  return 1;
}

function mergePreferMeasured(
  primary: EngineVisibilityResult[],
  fallback: EngineVisibilityResult[],
): EngineVisibilityResult[] {
  const byEngine = new Map<VisibilityEngineId, EngineVisibilityResult>();
  for (const r of primary) byEngine.set(r.engine, r);
  for (const r of fallback) {
    const cur = byEngine.get(r.engine);
    if (!cur || statusRank(r.measurementStatus) > statusRank(cur.measurementStatus)) {
      byEngine.set(r.engine, r);
    }
  }
  return ENGINES.map(
    (e) => byEngine.get(e) || notMeasuredEngine(e, 'Engine not probed'),
  );
}

function rollupStatus(engines: EngineVisibilityResult[]): VisibilityMeasurementStatus {
  if (engines.some((e) => e.measurementStatus === 'measured' && e.method !== 'llm_answer_probe')) {
    return 'measured';
  }
  if (engines.some((e) => e.measurementStatus === 'estimated' || e.method === 'llm_answer_probe')) {
    return 'estimated';
  }
  return 'not_measured';
}

export async function runVisibilityRouter(
  input: VisibilityRouterInput,
): Promise<VisibilityRouterOutput> {
  const domain = input.domain.replace(/^www\./, '');
  const queries = (input.queries || []).filter(Boolean).slice(0, 5);
  const seedQueries = queries.length ? queries : [domain, input.brand].filter(Boolean) as string[];

  let dfsResults: EngineVisibilityResult[] = [];
  if (input.dfsPost) {
    try {
      dfsResults = await fetchDataForSeoMentions({
        dfsPost: input.dfsPost,
        domain,
        brand: input.brand,
        queries: seedQueries,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
      });
    } catch (e) {
      dfsResults = ENGINES.map((eng) =>
        notMeasuredEngine(eng, e instanceof Error ? e.message : 'DFS mentions failed'),
      );
    }
  }

  let probeResults: EngineVisibilityResult[] = [];
  const needsProbe =
    !dfsResults.length ||
    dfsResults.some((r) => r.measurementStatus !== 'measured');
  if (needsProbe && input.llmGenerate) {
    try {
      probeResults = await probeLlmAnswers({
        generate: input.llmGenerate,
        domain,
        brand: input.brand,
        queries: seedQueries.length ? seedQueries : [domain],
      });
    } catch {
      probeResults = [];
    }
  }

  let engines: EngineVisibilityResult[];
  if (dfsResults.length || probeResults.length) {
    engines = mergePreferMeasured(dfsResults, probeResults);
  } else {
    engines = ENGINES.map((e) =>
      notMeasuredEngine(e, 'No DataForSEO or OpenRouter credentials for visibility probes'),
    );
  }

  const aggregate = aggregateMeasuredCitationRate(engines);
  return {
    engines,
    aggregateCitationRatePercent: aggregate,
    measurementStatus: rollupStatus(engines),
  };
}
