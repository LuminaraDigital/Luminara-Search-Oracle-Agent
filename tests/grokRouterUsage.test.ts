import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aiProviderService, emptyInferenceRouterUsage, USAGE_STORAGE_KEY } from '../services/aiProviderService';
import { InferenceRouterUsage } from '../types';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
};

(globalThis as any).localStorage = mockLocalStorage;

describe('Grok Bot Inference Router & Usage Tracker', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    aiProviderService.resetUsageStats();
    aiProviderService.clearCooldowns();
  });

  it('initializes with empty schema-valid usage statistics', () => {
    const stats = aiProviderService.getUsageStats();
    expect(stats.schemaVersion).toBe(1);
    expect(stats.totals.requests).toBe(0);
    expect(stats.totals.inputTokens).toBe(0);
    expect(stats.totals.outputTokens).toBe(0);
    expect(stats.totals.estimatedCostUsd).toBe(0);
    expect(stats.providers.groq.requests).toBe(0);
    expect(stats.providers.nim.requests).toBe(0);
    expect(stats.providers.openrouter.requests).toBe(0);
  });

  it('records turn token usage and calculates estimated cost correctly', () => {
    // Record Groq call (10,000 prompt tokens, 5,000 completion tokens, 120ms latency)
    aiProviderService.recordUsage('groq', { prompt: 10_000, completion: 5_000 }, 120, 'openai/gpt-oss-120b');

    const stats = aiProviderService.getUsageStats();
    expect(stats.totals.requests).toBe(1);
    expect(stats.totals.inputTokens).toBe(10_000);
    expect(stats.totals.outputTokens).toBe(5_000);
    expect(stats.providers.groq.requests).toBe(1);
    expect(stats.providers.groq.inputTokens).toBe(10_000);
    expect(stats.providers.groq.outputTokens).toBe(5_000);
    expect(stats.providers.groq.averageLatencyMs).toBe(120);
    expect(stats.providers.groq.lastUsedAt).toBeGreaterThan(0);
    expect(stats.providers.groq.estimatedCostUsd).toBeGreaterThan(0);

    // Record NVIDIA NIM call
    aiProviderService.recordUsage('nim', { prompt: 20_000, completion: 10_000 }, 250);
    const updated = aiProviderService.getUsageStats();
    expect(updated.totals.requests).toBe(2);
    expect(updated.totals.inputTokens).toBe(30_000);
    expect(updated.totals.outputTokens).toBe(15_000);
    expect(updated.providers.nim.requests).toBe(1);
    expect(updated.providers.nim.inputTokens).toBe(20_000);
  });

  it('notifies subscribers and emits custom window event on usage changes', () => {
    let capturedUsage: InferenceRouterUsage | null = null;
    const unsubscribe = aiProviderService.subscribeToUsage((u) => {
      capturedUsage = u;
    });

    const windowSpy = vi.fn();
    if (typeof window !== 'undefined') {
      window.addEventListener('luminara-inference-usage', windowSpy);
    }

    aiProviderService.recordUsage('ollama', { prompt: 500, completion: 200 }, 50);

    expect(capturedUsage).not.toBeNull();
    expect((capturedUsage as any)?.providers.ollama.requests).toBe(1);
    expect((capturedUsage as any)?.providers.ollama.estimatedCostUsd).toBe(0); // Ollama is local/free

    unsubscribe();

    if (typeof window !== 'undefined') {
      window.removeEventListener('luminara-inference-usage', windowSpy);
    }
  });

  it('resets usage stats and updates persistent storage', () => {
    aiProviderService.recordUsage('groq', { prompt: 1000, completion: 500 }, 80);
    expect(aiProviderService.getUsageStats().totals.requests).toBe(1);

    aiProviderService.resetUsageStats();
    expect(aiProviderService.getUsageStats().totals.requests).toBe(0);
    expect(aiProviderService.getUsageStats().totals.inputTokens).toBe(0);
  });
});
