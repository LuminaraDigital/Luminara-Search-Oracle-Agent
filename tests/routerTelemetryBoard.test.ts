import { describe, expect, it, beforeEach } from 'vitest';
import {
  aiProviderService,
  emptyInferenceRouterUsage,
  USAGE_STORAGE_KEY,
} from '../services/aiProviderService';
import type { InferenceRouterUsage } from '../types';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => {
    storage[k] = String(v);
  },
  removeItem: (k: string) => {
    delete storage[k];
  },
  clear: () => {
    Object.keys(storage).forEach((k) => delete storage[k]);
  },
};
(globalThis as any).localStorage = mockLocalStorage;

describe('RouterTelemetryBoard & Usage Analytics (ZetaChain Track ZP Pattern 5)', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('generates an empty telemetry usage record with default zero counters', () => {
    const usage = emptyInferenceRouterUsage();
    expect(usage.schemaVersion).toBe(1);
    expect(usage.totals.requests).toBe(0);
    expect(usage.totals.inputTokens).toBe(0);
    expect(usage.totals.outputTokens).toBe(0);
    expect(usage.totals.estimatedCostUsd).toBe(0);
    expect(usage.providers.groq.requests).toBe(0);
    expect(usage.providers.nim.requests).toBe(0);
    expect(usage.providers.ollama.requests).toBe(0);
  });

  it('accurately accumulates request volume and calculates savings vs proprietary pricing', () => {
    // Record mock inference usage across Groq and NIM
    aiProviderService.recordUsage('groq', { prompt: 2000, completion: 500 }, 320);
    aiProviderService.recordUsage('nim', { prompt: 4000, completion: 1000 }, 650);
    aiProviderService.recordUsage('ollama', { prompt: 10000, completion: 2000 }, 1200);

    const raw = mockLocalStorage.getItem(USAGE_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw!) as InferenceRouterUsage;

    expect(stored.totals.requests).toBe(3);
    expect(stored.totals.inputTokens).toBe(16000);
    expect(stored.totals.outputTokens).toBe(3500);

    // Groq stats
    expect(stored.providers.groq.requests).toBe(1);
    expect(stored.providers.groq.inputTokens).toBe(2000);
    expect(stored.providers.groq.averageLatencyMs).toBe(320);

    // NIM stats
    expect(stored.providers.nim.requests).toBe(1);
    expect(stored.providers.nim.inputTokens).toBe(4000);
    expect(stored.providers.nim.averageLatencyMs).toBe(650);

    // Ollama stats (local runs are zero cost)
    expect(stored.providers.ollama.requests).toBe(1);
    expect(stored.providers.ollama.estimatedCostUsd).toBe(0);

    // Savings calculation: (19500 total tokens / 1M) * $5 benchmark - totalCost
    const totalTokens = stored.totals.inputTokens + stored.totals.outputTokens;
    const proprietaryBenchmarkUsd = (totalTokens / 1_000_000) * 5.0;
    const actualCost = stored.totals.estimatedCostUsd;
    const estimatedSavings = proprietaryBenchmarkUsd - actualCost;

    expect(estimatedSavings).toBeGreaterThan(0);
  });
});
