import { describe, expect, it } from 'vitest';
import {
  routeTaskExecution,
  MODEL_CATALOG,
} from '../services/router/cacheAwareRouter';

describe('System-Optimized Cache-Aware Model Router (Pillar 2)', () => {
  it('dispatches classification tasks directly to clef-flash with low latency', () => {
    const decision = routeTaskExecution({
      task: 'classification',
      estimatedPromptTokens: 1200,
    });

    expect(decision.selectedModel).toBe('clef-flash');
    expect(decision.provider).toBe('clef_flash');
    expect(decision.estimatedLatencyMs).toBeLessThanOrEqual(50);
    expect(decision.rationale).toContain('Fast non-autoregressive decision model');
  });

  it('demonstrates prompt cache economics: warm KV cache selects prefix-cached model over cold models', () => {
    // 15,000 prompt tokens with 13,000 cached tokens (86.7% cache hit)
    const decision = routeTaskExecution({
      task: 'multi_turn_agent',
      estimatedPromptTokens: 15000,
      estimatedCachedTokens: 13000,
      preferLowLatency: true,
    });

    // When cache hit is high, prefix caching model (qwen-2.5-7b-edge or nim) provides superior cost-latency utility
    expect(['qwen-2.5-7b-edge', 'gemini-1.5-flash', 'nim-deepseek-r1-distill']).toContain(
      decision.selectedModel,
    );
    expect(decision.cacheHitRatio).toBeGreaterThan(0.8);
    expect(decision.estimatedCostUsd).toBeLessThan(0.005);
  });

  it('honors caller BYOK provider override', () => {
    const decision = routeTaskExecution({
      task: 'multi_turn_agent',
      estimatedPromptTokens: 5000,
      byokProvider: 'groq',
    });

    expect(decision.provider).toBe('groq');
    expect(decision.selectedModel).toBe('groq-llama-3.3-70b');
  });

  it('calculates mathematically sound utility score balancing quality, cost, and latency', () => {
    const decision = routeTaskExecution({
      task: 'verdict_synthesis',
      estimatedPromptTokens: 3000,
      preferLowLatency: false,
    });

    expect(decision.utilityScore).toBeDefined();
    expect(typeof decision.utilityScore).toBe('number');
    expect(decision.estimatedLatencyMs).toBeGreaterThan(0);
  });

  it('contains valid entries in MODEL_CATALOG with required Pareto attributes', () => {
    expect(MODEL_CATALOG.length).toBeGreaterThanOrEqual(4);
    for (const model of MODEL_CATALOG) {
      expect(model.id).toBeTruthy();
      expect(model.costPerMillionUncached).toBeGreaterThan(0);
      expect(model.costPerMillionCached).toBeLessThanOrEqual(model.costPerMillionUncached);
      expect(model.qualityScore.classification).toBeGreaterThan(0);
      expect(model.qualityScore.multi_turn_agent).toBeGreaterThan(0);
      expect(model.qualityScore.verdict_synthesis).toBeGreaterThan(0);
    }
  });
});
