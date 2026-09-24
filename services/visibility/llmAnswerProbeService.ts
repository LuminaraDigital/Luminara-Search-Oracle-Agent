/**
 * LLM answer probes for AI visibility (W4 fallback when DFS Mentions unavailable).
 * Results are estimated OpenRouter probes, not measured ChatGPT/Perplexity/AIO product KPIs.
 */
import type { EngineVisibilityResult, VisibilityEngineId } from './engineVisibilityTypes';
import { notMeasuredEngine } from './engineVisibilityTypes';

export type LlmGenerateFn = (prompt: string, model?: string) => Promise<string>;

function domainCited(text: string, domain: string, brand?: string): boolean {
  const lower = text.toLowerCase();
  const host = domain.replace(/^www\./, '').toLowerCase();
  if (lower.includes(host)) return true;
  if (brand && lower.includes(brand.toLowerCase())) return true;
  return false;
}

/** Probe labels map to product engine slots for UI, but status stays estimated. */
const PROBES: Array<{ engine: VisibilityEngineId; model: string; label: string }> = [
  { engine: 'chatgpt', model: 'openai/gpt-4o-mini', label: 'ChatGPT-class OpenRouter' },
  { engine: 'perplexity', model: 'perplexity/sonar', label: 'Perplexity-class OpenRouter' },
  { engine: 'google_aio', model: 'google/gemini-2.0-flash-001', label: 'Google AI-class OpenRouter' },
];

export async function probeLlmAnswers(opts: {
  generate: LlmGenerateFn;
  domain: string;
  brand?: string;
  queries: string[];
}): Promise<EngineVisibilityResult[]> {
  const measuredAt = Date.now();
  const queries = opts.queries.slice(0, 3);
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
        evidence.push({
          query,
          cited: domainCited(answer, opts.domain, opts.brand),
          answerSnippet: answer.slice(0, 400),
        });
      } catch {
        failed += 1;
      }
    }
    if (!evidence.length) {
      out.push(notMeasuredEngine(probe.engine, `${probe.label} probe failed`, measuredAt));
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
        ? `${failed} probe(s) failed`
        : `${probe.label} estimate only; not a product citation rate`,
      measuredAt,
    });
  }
  return out;
}
