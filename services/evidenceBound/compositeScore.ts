/**
 * Combine atomic dimensions with weights in code.
 * Output is always estimated or not_measured - never a Live SEO metric.
 */
import type { AtomicDimension, CompositeJudgment } from './types';

export const DEFAULT_WEIGHTS: Record<string, number> = {
  indexability: 0.25,
  llm_crawler: 0.15,
  intent_match: 0.3,
  interactive_faq: 0.15,
  research_fresh: 0.15,
};

/**
 * Weighted mean over measured/estimated dimensions with numeric values.
 * If no dimension has a value, status is not_measured.
 */
export function composeJudgment(
  dimensions: AtomicDimension[],
  weights: Record<string, number> = DEFAULT_WEIGHTS,
): CompositeJudgment {
  let num = 0;
  let den = 0;
  for (const d of dimensions) {
    if (d.value == null || d.status === 'not_measured' || d.status === 'unknown') continue;
    const w = weights[d.id] ?? 0;
    if (w <= 0) continue;
    num += d.value * w;
    den += w;
  }

  if (den <= 0) {
    return {
      dimensions,
      composite: null,
      status: 'not_measured',
      weights: { ...weights },
    };
  }

  return {
    dimensions,
    composite: num / den,
    status: 'estimated',
    weights: { ...weights },
  };
}
