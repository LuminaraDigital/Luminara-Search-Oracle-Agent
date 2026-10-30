/**
 * Hybrid AI visibility router (W4).
 */
import type {
  EngineVisibilityResult,
  MissingMentionSource,
  VisibilityEngineId,
  VisibilityMeasurementStatus,
} from './engineVisibilityTypes';
import {
  aggregateMeasuredCitationRate,
  classifyOffSiteChannel,
  extractSourceHost,
  notMeasuredEngine,
} from './engineVisibilityTypes';
import { fetchDataForSeoMentions, type DfsPostFn } from './dataForSeoMentionsService';
import { probeLlmAnswers, type LlmGenerateFn } from './llmAnswerProbeService';
import { isNamesakeHost } from '../audit/entityMatch';

export type VisibilityRouterInput = {
  domain: string;
  brand?: string;
  competitors?: string[];
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
  /** Third-party sources cited in AI answers where the target brand is absent. */
  missingSources: MissingMentionSource[];
};

const ENGINES: VisibilityEngineId[] = ['chatgpt', 'google_aio', 'perplexity'];

function actionForChannel(channel: MissingMentionSource['channel'], host: string): string {
  switch (channel) {
    case 'editorial_pr':
      return `Pitch a collaborative data study or reactive founder expert commentary to ${host}.`;
    case 'roundup_listicle':
      return `Send a drop-in product spec block and inclusion pitch to the roundup editor at ${host}.`;
    case 'review_platform':
      return `Launch a guideline-safe review request funnel and route verified customers to ${host}.`;
    case 'community_forum':
      return `Post a non-promotional, expertise-first answer in the cited thread on ${host}.`;
  }
}

export function extractMissingMentionSources(
  targetDomain: string,
  engines: EngineVisibilityResult[],
): MissingMentionSource[] {
  const cleanTarget = extractSourceHost(targetDomain);
  const byHost = new Map<
    string,
    {
      sampleUrl?: string;
      sampleCtx: string;
      brandMentioned: boolean;
      competitors: Set<string>;
      competitorMentions: number;
      prompts: Set<string>;
      engines: Set<VisibilityEngineId>;
    }
  >();

  for (const eng of engines) {
    for (const ev of eng.evidence || []) {
      for (const rawSrc of ev.sources || []) {
        const host = extractSourceHost(rawSrc);
        if (!host || host === cleanTarget || isNamesakeHost(host, cleanTarget)) continue;
        let entry = byHost.get(host);
        if (!entry) {
          entry = {
            sampleUrl: rawSrc,
            sampleCtx: `${rawSrc} ${ev.answerSnippet || ''}`,
            brandMentioned: false,
            competitors: new Set(),
            competitorMentions: 0,
            prompts: new Set(),
            engines: new Set(),
          };
          byHost.set(host, entry);
        }
        if (ev.cited) entry.brandMentioned = true;
        entry.prompts.add(ev.query);
        entry.engines.add(eng.engine);
        for (const comp of ev.competitorsMentioned || []) {
          entry.competitors.add(comp);
          entry.competitorMentions += 1;
        }
      }
    }
  }

  const missing: MissingMentionSource[] = [];
  for (const [host, info] of byHost.entries()) {
    if (info.brandMentioned) continue;
    const channel = classifyOffSiteChannel(host, info.sampleCtx);
    missing.push({
      domain: host,
      sampleUrl: info.sampleUrl,
      channel,
      competitorsMentioned: [...info.competitors],
      competitorMentionCount: info.competitorMentions,
      promptCount: info.prompts.size,
      prompts: [...info.prompts],
      engines: [...info.engines],
      actionRecommendation: actionForChannel(channel, host),
    });
  }

  missing.sort(
    (a, b) =>
      b.competitorMentionCount - a.competitorMentionCount ||
      b.promptCount - a.promptCount ||
      b.engines.length - a.engines.length,
  );
  return missing;
}

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
        competitors: input.competitors,
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
        competitors: input.competitors,
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
  const missingSources = extractMissingMentionSources(domain, engines);
  return {
    engines,
    aggregateCitationRatePercent: aggregate,
    measurementStatus: rollupStatus(engines),
    missingSources,
  };
}
