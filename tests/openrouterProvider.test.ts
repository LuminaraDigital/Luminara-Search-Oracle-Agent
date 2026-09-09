import { describe, expect, it, beforeEach, vi } from 'vitest';
import { OpenRouterProvider } from '../services/aiProviderService';
import { configService } from '../services/configService';

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

describe('OpenRouter Provider Service', () => {
  let provider: OpenRouterProvider;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
    provider = new OpenRouterProvider();
  });

  it('has correct identity and frontier capabilities', () => {
    expect(provider.id).toBe('openrouter');
    expect(provider.type).toBe('openrouter');
    expect(provider.name).toContain('OpenRouter');
    expect(provider.capabilities.streaming).toBe(true);
    expect(provider.capabilities.vision).toBe(true);
    expect(provider.capabilities.maxContextLength).toBeGreaterThanOrEqual(128000);
  });

  it('reports isAvailable only when API key is configured', async () => {
    expect(await provider.isAvailable()).toBe(false);

    configService.setOpenRouterKey('sk-or-v1-testkey123');
    expect(await provider.isAvailable()).toBe(true);

    configService.setOpenRouterKey('');
    expect(await provider.isAvailable()).toBe(false);
  });

  it('generates text via OpenRouter API with correct payload', async () => {
    configService.setOpenRouterKey('sk-or-v1-testkey123');

    let requestBody: any = null;
    let requestHeaders: any = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, init?: any) => {
      requestHeaders = init?.headers;
      if (init?.body) requestBody = JSON.parse(init.body);

      return new Response(JSON.stringify({
        choices: [
          {
            message: { content: 'Claude 3.5 Sonnet analysis completed.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 15, completion_tokens: 10, total_tokens: 25 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    try {
      const result = await provider.generateText('Analyze AEO share of voice', {
        model: 'anthropic/claude-3.5-sonnet',
        temperature: 0.2,
      });

      expect(result.text).toBe('Claude 3.5 Sonnet analysis completed.');
      expect(result.tokenUsage.total).toBe(25);
      expect(requestBody.model).toBe('anthropic/claude-3.5-sonnet');
      expect(requestBody.temperature).toBe(0.2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('streams text chunks over SSE correctly', async () => {
    configService.setOpenRouterKey('sk-or-v1-testkey123');

    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"Luminara "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Frontier "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Intelligence"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(ssePayload));
        controller.close();
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    try {
      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Stream prompt')) {
        chunks.push(chunk.text);
      }

      expect(chunks.join('')).toBe('Luminara Frontier Intelligence');
      expect(chunks).toEqual(['Luminara ', 'Frontier ', 'Intelligence']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
