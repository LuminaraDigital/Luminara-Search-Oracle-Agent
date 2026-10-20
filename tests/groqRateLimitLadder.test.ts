/**
 * Instant Audit hits Groq's per-model TPM cap as HTTP 503 (the relay keeps Groq's JSON).
 * The next Groq model has its own cap, so the write continues instead of failing the report.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const providerFetchMock = vi.hoisted(() => vi.fn());

vi.mock('../services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/apiClient')>();
  return { ...actual, providerFetch: providerFetchMock };
});

import { GroqProvider } from '../services/llm/providers/GroqProvider';
import { configService } from '../services/configService';
import { isHostedRateLimit } from '../services/llm/nativeModelDefaults';
import { NVIDIA_FALLBACK_MODEL } from '../worker/nvidiaChatFallback';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
};
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as { window: EventTarget }).window = new EventTarget();
}
(globalThis as { localStorage: typeof mockLocalStorage }).localStorage = mockLocalStorage;

function rateLimitBody(): string {
  return JSON.stringify({
    error: {
      message: 'Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 7158, Requested 7627.',
      type: 'tokens',
      code: 'rate_limit_exceeded',
    },
  });
}

function okReply(text: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Groq rate-limit model ladder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    providerFetchMock.mockReset();
    Object.keys(storage).forEach(k => delete storage[k]);
  });

  it('treats a relay 503 that still carries Groq\'s rate-limit JSON as a cap', () => {
    expect(isHostedRateLimit(503, rateLimitBody())).toBe(true);
    expect(isHostedRateLimit(429, '')).toBe(true);
    expect(isHostedRateLimit(413, JSON.stringify({
      error: { message: 'Request too large for model `openai/gpt-oss-20b` Limit 8000, Requested 10930', code: 'rate_limit_exceeded' },
    }))).toBe(true);
    expect(isHostedRateLimit(503, '{"error":"The hosted groq service is temporarily unavailable"}')).toBe(false);
    expect(isHostedRateLimit(413, '{"error":"Request body too large"}')).toBe(false);
  });

  it('writes the audit with the next Groq model after gpt-oss-120b is capped', async () => {
    configService.setKey('luminara_groq_key', 'gsk_test_rate_limit');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    providerFetchMock
      .mockResolvedValueOnce(new Response(rateLimitBody(), { status: 503, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(okReply('Movida rents cars across Australia.'));

    const result = await new GroqProvider().generateText('Write the audit', {
      allowFallback: true,
      maxTokens: 4000,
      systemPrompt: 'Measured facts only.',
    });

    expect(result.text).toBe('Movida rents cars across Australia.');
    const models = providerFetchMock.mock.calls.map(call => JSON.parse(String((call[3] as RequestInit).body)).model);
    expect(models).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
  });

  it('shrinks max_tokens when the prompt fits and the completion budget does not', async () => {
    configService.setKey('luminara_groq_key', 'gsk_test_rate_limit');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tooLarge = JSON.stringify({
      error: {
        message: 'Request too large for model `openai/gpt-oss-20b` on tokens per minute (TPM): Limit 8000, Requested 10930, please reduce your message size and try again.',
        type: 'tokens',
        code: 'rate_limit_exceeded',
      },
    });
    providerFetchMock
      .mockResolvedValueOnce(new Response(rateLimitBody(), { status: 503 }))
      .mockResolvedValueOnce(new Response(tooLarge, { status: 413 }))
      .mockResolvedValueOnce(okReply('Movida publishes fleet sizes on its site.'));

    const result = await new GroqProvider().generateText('Write the audit', { maxTokens: 4000 });
    expect(result.text).toBe('Movida publishes fleet sizes on its site.');
    const bodies = providerFetchMock.mock.calls.map(call => JSON.parse(String((call[3] as RequestInit).body)));
    expect(bodies.map(body => body.model)).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'openai/gpt-oss-20b']);
    expect(bodies[2].max_tokens).toBe(670);
  });

  it('does not burn the rest of the ladder on an ordinary hosted outage', async () => {
    configService.setKey('luminara_groq_key', 'gsk_test_rate_limit');
    providerFetchMock.mockResolvedValue(new Response(
      JSON.stringify({ error: 'The hosted groq service is temporarily unavailable' }),
      { status: 503 },
    ));

    await expect(new GroqProvider().generateText('Write the audit')).rejects.toThrow(/503/);
    expect(providerFetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the hosted NVIDIA step off the retired Llama 3.3 instruct id', () => {
    expect(NVIDIA_FALLBACK_MODEL).toBe('nvidia/llama-3.1-nemotron-70b-instruct');
  });
});
