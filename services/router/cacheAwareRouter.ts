/**
 * System-Optimized Cache-Aware Model Router (Pillar 2).
 *
 * Implements Pareto-optimal model routing:
 * - Dynamically evaluates prompt cache hits vs token sticker price.
 * - Balances cost, p95 latency, and task quality scores.
 * - Automatically dispatches between fast decision heads (clef-flash),
 *   local/edge policies, and upstream foundation providers.
 */

export type ModelProviderKind = 'groq' | 'nim' | 'ollama' | 'gemini' | 'clef_flash' | 'qwen_edge';

export type TaskComplexity = 'classification' | 'multi_turn_agent' | 'verdict_synthesis';

export interface ModelProfile {
  id: string;
  provider: ModelProviderKind;
  costPerMillionUncached: number; // In USD
  costPerMillionCached: number; // In USD
  baseLatencyMs: number;
  qualityScore: {
    classification: number;
    multi_turn_agent: number;
    verdict_synthesis: number;
  };
  supportsPrefixCaching: boolean;
  maxContextTokens: number;
}

export interface RouterInput {
  task: TaskComplexity;
  estimatedPromptTokens: number;
  estimatedCachedTokens?: number;
  byokProvider?: ModelProviderKind | null;
  preferLowLatency?: boolean;
  allowPaidModels?: boolean;
}

export interface RoutingDecision {
  selectedModel: string;
  provider: ModelProviderKind;
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
  cacheHitRatio: number;
  utilityScore: number;
  rationale: string;
}

/**
 * Standard Model Catalog with Cache Pricing Dynamics
 */
export const MODEL_CATALOG: ModelProfile[] = [
  {
    id: 'clef-flash',
    provider: 'clef_flash',
    costPerMillionUncached: 0.05,
    costPerMillionCached: 0.01,
    baseLatencyMs: 38,
    qualityScore: {
      classification: 0.98,
      multi_turn_agent: 0.40,
      verdict_synthesis: 0.65,
    },
    supportsPrefixCaching: false,
    maxContextTokens: 65536,
  },
  {
    id: 'qwen-2.5-7b-edge',
    provider: 'qwen_edge',
    costPerMillionUncached: 0.15,
    costPerMillionCached: 0.03,
    baseLatencyMs: 120,
    qualityScore: {
      classification: 0.92,
      multi_turn_agent: 0.88,
      verdict_synthesis: 0.90,
    },
    supportsPrefixCaching: true,
    maxContextTokens: 32768,
  },
  {
    id: 'groq-llama-3.3-70b',
    provider: 'groq',
    costPerMillionUncached: 0.59,
    costPerMillionCached: 0.59, // Fast TTFT, no cache discount on standard endpoint
    baseLatencyMs: 250,
    qualityScore: {
      classification: 0.90,
      multi_turn_agent: 0.94,
      verdict_synthesis: 0.92,
    },
    supportsPrefixCaching: false,
    maxContextTokens: 131072,
  },
  {
    id: 'nim-deepseek-r1-distill',
    provider: 'nim',
    costPerMillionUncached: 0.70,
    costPerMillionCached: 0.14, // Prefix caching enabled
    baseLatencyMs: 380,
    qualityScore: {
      classification: 0.85,
      multi_turn_agent: 0.96,
      verdict_synthesis: 0.95,
    },
    supportsPrefixCaching: true,
    maxContextTokens: 65536,
  },
  {
    id: 'gemini-1.5-flash',
    provider: 'gemini',
    costPerMillionUncached: 0.075,
    costPerMillionCached: 0.01875, // Gemini 75% prompt cache discount
    baseLatencyMs: 310,
    qualityScore: {
      classification: 0.91,
      multi_turn_agent: 0.90,
      verdict_synthesis: 0.88,
    },
    supportsPrefixCaching: true,
    maxContextTokens: 1048576,
  },
];

/**
 * Optimizes model dispatch by solving the multi-objective cost, latency, and quality Pareto frontier.
 */
export function routeTaskExecution(input: RouterInput): RoutingDecision {
  const totalTokens = Math.max(1, input.estimatedPromptTokens);
  const cachedTokens = Math.min(totalTokens, Math.max(0, input.estimatedCachedTokens || 0));
  const cacheHitRatio = cachedTokens / totalTokens;

  // Weight multipliers
  const alphaCost = input.allowPaidModels === false ? 2.5 : 1.0;
  const betaLatency = input.preferLowLatency ? 2.0 : 1.0;
  const gammaQuality = 1.5;

  let bestDecision: RoutingDecision | null = null;
  let highestUtility = -Infinity;

  for (const model of MODEL_CATALOG) {
    // If BYOK requested, enforce matching provider
    if (input.byokProvider && model.provider !== input.byokProvider) {
      continue;
    }

    // Classification tasks without multi-turn context strongly map to fast decision heads
    if (input.task === 'classification' && model.provider === 'clef_flash') {
      const latency = model.baseLatencyMs;
      const cost = (totalTokens * model.costPerMillionUncached) / 1_000_000;
      return {
        selectedModel: model.id,
        provider: model.provider,
        estimatedCostUsd: Number(cost.toFixed(6)),
        estimatedLatencyMs: latency,
        cacheHitRatio: 0,
        utilityScore: 100,
        rationale: 'Fast non-autoregressive decision model selected for sub-50ms classification.',
      };
    }

    // Calculate prompt caching cost benefits
    const effectiveCachedTokens = model.supportsPrefixCaching ? cachedTokens : 0;
    const uncachedTokens = totalTokens - effectiveCachedTokens;

    const costUsd =
      (effectiveCachedTokens * model.costPerMillionCached +
        uncachedTokens * model.costPerMillionUncached) /
      1_000_000;

    // Latency benefit from warm prompt cache (faster Time-To-First-Token)
    const cacheLatencyDiscount = model.supportsPrefixCaching ? 0.35 * (effectiveCachedTokens / totalTokens) : 0;
    const latencyMs = model.baseLatencyMs * (1 - cacheLatencyDiscount);

    const quality = model.qualityScore[input.task];

    // Normalized Utility Function: U = gamma * Quality - alpha * (Cost_Norm) - beta * (Latency_Norm)
    const normalizedCost = costUsd * 1000; // Scaled to ~0.1 - 2.0 range
    const normalizedLatency = latencyMs / 500; // Scaled to ~0.1 - 1.0 range
    const utility = gammaQuality * quality - alphaCost * normalizedCost - betaLatency * normalizedLatency;

    if (utility > highestUtility) {
      highestUtility = utility;
      bestDecision = {
        selectedModel: model.id,
        provider: model.provider,
        estimatedCostUsd: Number(costUsd.toFixed(6)),
        estimatedLatencyMs: Math.round(latencyMs),
        cacheHitRatio: Number((effectiveCachedTokens / totalTokens).toFixed(4)),
        utilityScore: Number(utility.toFixed(4)),
        rationale: `Selected via Pareto optimization for ${input.task} with ${(cacheHitRatio * 100).toFixed(0)}% cache hit.`,
      };
    }
  }

  // Safe fallback if filtered out
  return (
    bestDecision || {
      selectedModel: 'gemini-1.5-flash',
      provider: 'gemini',
      estimatedCostUsd: 0.0001,
      estimatedLatencyMs: 300,
      cacheHitRatio: 0,
      utilityScore: 0.5,
      rationale: 'Fallback default model applied.',
    }
  );
}
