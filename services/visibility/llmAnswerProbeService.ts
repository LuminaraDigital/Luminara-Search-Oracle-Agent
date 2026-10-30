/**
 * LLM answer probes for AI visibility (W4 fallback when DFS Mentions unavailable).
 * Results are estimated OpenRouter probes, not measured ChatGPT/Perplexity/AIO product KPIs.
 */
import type { EngineVisibilityResult, VisibilityEngineId } from './engineVisibilityTypes';
import {
  classifyBrandMentionStatus,
  findMentionedCompetitors,
  notMeasuredEngine,
} from './engineVisibilityTypes';
import { classifyMention } from '../audit/entityMatch';
import { countPhrase } from '../audit/reportSentence';

export type LlmGenerateFn = (prompt: string, model?: string) => Promise<string>;

function domainCited(text: string, domain: string, brand?: string): boolean {
  return classifyMention({ domain, brandName: brand }, { text }) === 'same';
}

/** Probe labels map to product engine slots for UI, but status stays estimated. */
const PROBES: Array<{ engine: VisibilityEngineId; model: string }> = [
  { engine: 'chatgpt', model: 'openai/gpt-4o-mini' },
  { engine: 'perplexity', model: 'perplexity/sonar' },
  { engine: 'google_aio', model: 'google/gemini-2.0-flash-001' },
];

export async function probeLlmAnswers(opts: {
  generate: LlmGenerateFn;
  domain: string;
  brand?: string;
  competitors?: string[];
  queries: string[];
}): Promise<EngineVisibilityResult[]> {
  const measuredAt = Date.now();
  const queries = opts.queries.slice(0, 3);
  const competitors = (opts.competitors || []).map((c) => c.trim()).filter(Boolean);
  if (!queries.length) {
    return (['chatgpt', 'google_aio', 'perplexity'] as VisibilityEngineId[]).map((e) =>
      notMeasuredEngine(e, 'No queries for LLM probe', measuredAt),
    );
  }

  const out: EngineVisibilityResult[] = [];
  for (const probe of PROBES) {
    const evidence = [];
    let failed = 0;
    for (const query of queries) {
      try {
        const prompt = `Answer briefly (under 120 words) as a helpful search assistant. Question: ${query}\nMention real brands/domains if relevant.`;
        const answer = await opts.generate(prompt, probe.model);
        const cited = domainCited(answer, opts.domain, opts.brand);
        const competitorsMentioned = findMentionedCompetitors(answer, competitors);
        const urlMatches = [...answer.matchAll(/https?:\/\/[^\s)>\]"',]+/gi)].map((m) => m[0]);
        const brandStatus = classifyBrandMentionStatus(cited, answer);
        evidence.push({
          query,
          cited,
          brandStatus,
          competitorsMentioned: competitorsMentioned.length ? competitorsMentioned : undefined,
          answerSnippet: answer.slice(0, 400),
          sources: urlMatches.length ? urlMatches : undefined,
        });
      } catch {
        failed += 1;
      }
    }
    if (!evidence.length) {
      out.push(notMeasuredEngine(probe.engine, 'This answer check failed', measuredAt));
      continue;
    }
    const citedCount = evidence.filter((e) => e.cited).length;
    out.push({
      engine: probe.engine,
      // Honest labeling: OpenRouter proxy, not product-engine citation measurement.
      measurementStatus: 'estimated',
      method: 'llm_answer_probe',
      cited: citedCount > 0,
      citationRatePercent: Math.round((citedCount / evidence.length) * 100),
      evidence,
      errorReason: failed
        ? `${countPhrase(failed, 'check')} failed`
        : 'Estimate only. This is not a measured citation rate.',
      measuredAt,
    });
  }
  return out;
}
