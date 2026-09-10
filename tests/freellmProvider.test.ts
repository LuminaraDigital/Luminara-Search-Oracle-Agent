import { describe, expect, it, beforeEach, vi } from 'vitest';
import { FreeLlmProvider, aiProviderService } from '../services/aiProviderService';
import { configService } from '../services/configService';
import { freeLlmModalitiesService } from '../services/freellm/modalitiesService';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
};

const eventTarget = new EventTarget();
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = eventTarget;
} else if (!window.addEventListener) {
  (window as any).addEventListener = eventTarget.addEventListener.bind(eventTarget);
  (window as any).removeEventListener = eventTarget.removeEventListener.bind(eventTarget);
  (window as any).dispatchEvent = eventTarget.dispatchEvent.bind(eventTarget);
}
(globalThis as any).localStorage = mockLocalStorage;

describe('FreeLLMAPI BYOK gateway', () => {
  let provider: FreeLlmProvider;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
    provider = new FreeLlmProvider();
  });

  it('has freellm identity and multimodal capabilities', () => {
    expect(provider.id).toBe('freellm');
    expect(provider.type).toBe('freellm');
    expect(provider.config.model).toBe('auto');
    expect(provider.capabilities.streaming).toBe(true);
    expect(provider.capabilities.audio).toBe(true);
  });

  it('is available only when unified key is set', async () => {
    expect(await provider.isAvailable()).toBe(false);
    configService.setFreeLlmKey('freellmapi-test-key');
    expect(await provider.isAvailable()).toBe(true);
  });

  it('defaults base URL to local FreeLLMAPI /v1', () => {
    expect(configService.getFreeLlmBaseUrl()).toBe('http://localhost:3001/v1');
    configService.setFreeLlmBaseUrl('http://127.0.0.1:4000/v1/');
    expect(configService.getFreeLlmBaseUrl()).toBe('http://127.0.0.1:4000/v1');
  });

  it('puts freellm first when prefer-gateway is on and key exists', () => {
    configService.setFreeLlmKey('freellmapi-test-key');
    configService.setFreeLlmPreferGateway(true);
    const order = configService.getNativePriority();
    expect(order[0]).toBe('freellm');
    expect(order).toContain('nim');
    expect(order).toContain('groq');
  });

  it('keeps default trinity order when freellm key is absent', () => {
    const order = configService.getNativePriority();
    expect(order[0]).toBe('nim');
    expect(order).toContain('freellm');
  });

  it('posts chat completions to configured FreeLLMAPI base', async () => {
    configService.setFreeLlmKey('freellmapi-test-key');
    configService.setFreeLlmBaseUrl('http://localhost:3001/v1');

    let requestUrl = '';
    let requestBody: any = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, init?: any) => {
      requestUrl = String(url);
      if (init?.body) requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Gateway routed OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    try {
      const result = await provider.generateText('ping', { model: 'auto:fast' });
      expect(requestUrl).toBe('http://localhost:3001/v1/chat/completions');
      expect(requestBody.model).toBe('auto:fast');
      expect(result.text).toBe('Gateway routed OK');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('registers freellm on the shared aiProviderService', async () => {
    expect(aiProviderService.getProvider('freellm')?.id).toBe('freellm');
  });

  it('cools down a provider after 429 and skips it on next best pick', async () => {
    configService.setFreeLlmKey('freellmapi-a');
    configService.setFreeLlmPreferGateway(true);
    localStorage.setItem('luminara_groq_key', 'gsk_fallback');

    const freellm = aiProviderService.getProvider('freellm')!;
    const groq = aiProviderService.getProvider('groq')!;

    vi.spyOn(freellm, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(groq, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(freellm, 'generateText').mockRejectedValue(new Error('FreeLLMAPI error (429): rate limited'));
    vi.spyOn(groq, 'generateText').mockResolvedValue({
      text: 'from groq',
      tokenUsage: { prompt: 1, completion: 1, total: 2 },
      finishReason: 'stop',
      latencyMs: 10,
    });

    const result = await aiProviderService.generateWithFailover('continue audit');
    expect(result.text).toBe('from groq');
    expect(aiProviderService.getCooldownRemainingMs('freellm')).toBeGreaterThan(0);

    const best = await aiProviderService.getBestAvailableProvider();
    expect(best?.id).not.toBe('freellm');
  });

  it('modalities service cosine similarity is symmetric and bounded', () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    const c = [0, 1, 0];
    expect(freeLlmModalitiesService.cosineSimilarity(a, b)).toBeCloseTo(1);
    expect(freeLlmModalitiesService.cosineSimilarity(a, c)).toBeCloseTo(0);
  });
});
