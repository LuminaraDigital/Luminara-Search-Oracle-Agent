import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Ai, Env } from '../worker/env';
import { runWorkersAiChatFallback } from '../worker/workersAiFallback';
import { proxyProvider } from '../worker/providerRelay';

const BOT_TOKEN = '123456:TEST_BOT_TOKEN_AI_FALLBACK';

function signInitData(fields: Record<string, string>, token = BOT_TOKEN): string {
  const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

function createMockKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (!val) return null;
      if (type === 'json') return JSON.parse(val);
      return val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

describe('Cloudflare Workers AI Edge Fallback', () => {
  describe('runWorkersAiChatFallback unit tests', () => {
    it('returns formatted OpenAI ChatCompletion for standard non-streaming messages', async () => {
      let capturedModel = '';
      let capturedInput: any = null;

      const mockAi: Ai = {
        async run(model: string, input: any) {
          capturedModel = model;
          capturedInput = input;
          return { response: 'Hello from Workers AI Llama 3.1!' };
        },
      };

      const result = await runWorkersAiChatFallback(mockAi, {
        model: 'groq/llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'What is the capital of France?' }],
        temperature: 0.5,
      });

      expect(capturedModel).toBe('@cf/meta/llama-3.1-8b-instruct');
      expect(capturedInput.temperature).toBe(0.7);
      expect(capturedInput.max_tokens).toBe(2048);
      expect(capturedInput.stream).toBe(false);
      expect(capturedInput.messages).toEqual([
        { role: 'user', content: 'What is the capital of France?' },
      ]);

      expect(result.id).toMatch(/^chatcmpl-cf-\d+$/);
      expect(result.object).toBe('chat.completion');
      expect(typeof result.created).toBe('number');
      expect(result.model).toBe('@cf/meta/llama-3.1-8b-instruct');
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0]).toEqual({
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello from Workers AI Llama 3.1!',
        },
        finish_reason: 'stop',
      });
      expect(result.usage).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });
    });

    it('extracts prompt if messages array is missing or empty', async () => {
      let capturedInput: any = null;
      const mockAi: Ai = {
        async run(_model: string, input: any) {
          capturedInput = input;
          return { response: 'Echo prompt answer' };
        },
      };

      const result = await runWorkersAiChatFallback(mockAi, {
        prompt: 'Explain quantum computing in one sentence',
      });

      expect(capturedInput.messages).toEqual([
        { role: 'user', content: 'Explain quantum computing in one sentence' },
      ]);
      expect(result.choices[0].message.content).toBe('Echo prompt answer');
    });

    it('returns valid OpenAI SSE stream when stream is requested', async () => {
      const encoder = new TextEncoder();
      const mockAiStream: Ai = {
        async run(_model: string, _input: any) {
          return new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"response":"Edge"}\n\n'));
              controller.enqueue(encoder.encode('data: {"response":" AI"}\n\n'));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            },
          });
        },
      };

      const streamResult = await runWorkersAiChatFallback(mockAiStream, {
        messages: [{ role: 'user', content: 'Say Edge AI' }],
        stream: true,
      });

      expect(streamResult).toBeInstanceOf(ReadableStream);

      const reader = streamResult.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }

      const events = text.split('\n\n').filter(Boolean);
      expect(events.length).toBeGreaterThanOrEqual(3);

      const parsedChunks: any[] = [];
      let foundDone = false;

      for (const ev of events) {
        if (ev === 'data: [DONE]') {
          foundDone = true;
          continue;
        }
        expect(ev.startsWith('data: ')).toBe(true);
        const parsed = JSON.parse(ev.slice(6));
        parsedChunks.push(parsed);
      }

      expect(foundDone).toBe(true);
      expect(parsedChunks[0].object).toBe('chat.completion.chunk');
      expect(parsedChunks[0].model).toBe('@cf/meta/llama-3.1-8b-instruct');
      expect(parsedChunks[0].choices[0].delta.content).toBe('Edge');
      expect(parsedChunks[1].choices[0].delta.content).toBe(' AI');
      expect(parsedChunks[parsedChunks.length - 1].choices[0].finish_reason).toBe('stop');
    });

    it('handles static object response when stream was requested as fallback resilience', async () => {
      const mockAiStatic: Ai = {
        async run(_model: string, _input: any) {
          return { response: 'Direct response' };
        },
      };

      const streamResult = await runWorkersAiChatFallback(mockAiStatic, {
        messages: [{ role: 'user', content: 'Test' }],
        stream: true,
      });

      const reader = streamResult.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }

      expect(text).toContain('data: {"id":');
      expect(text).toContain('"content":"Direct response"');
      expect(text).toContain('"finish_reason":"stop"');
      expect(text).toContain('data: [DONE]\n\n');
    });
  });

  describe('providerRelay failover integration tests', () => {
    const originalFetch = globalThis.fetch;
    let kv: any;
    let validInitData: string;

    beforeEach(() => {
      kv = createMockKv();
      validInitData = signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 999, first_name: 'EdgeTester' }),
      });
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    const createTestEnv = (overrides: Partial<Env> = {}): Env => ({
      ASSETS: { fetch: vi.fn() } as any,
      WEBAPP_URL: 'https://luminarasuite.com',
      LUMINARA_KV: kv,
      BOT_TOKEN,
      REQUIRE_TG_AUTH: 'true',
      FREE_DAILY_LIMIT: '10',
      GROQ_API_KEY: 'gsk_primary_test_key',
      ...overrides,
    });

    it('falls back to Workers AI when hosted Groq returns 402', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Credit balance exhausted' } }), {
          status: 402,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const mockAi: Ai = {
        run: vi.fn().mockResolvedValue({ response: 'Recovered via Workers AI on 402' }),
      };

      const env = createTestEnv({ AI: mockAi });

      const req = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': validInitData,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      const res = await proxyProvider(req, env, 'groq', '/chat/completions');

      expect(res.status).toBe(200);
      expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
      const data = (await res.json()) as any;
      expect(data.model).toBe('@cf/meta/llama-3.1-8b-instruct');
      expect(data.choices[0].message.content).toBe('Recovered via Workers AI on 402');
      expect(mockAi.run).toHaveBeenCalledTimes(1);
    });

    it('falls back to Workers AI when hosted Groq returns 429', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const mockAi: Ai = {
        run: vi.fn().mockResolvedValue({ response: 'Recovered via Workers AI on 429' }),
      };

      const env = createTestEnv({ AI: mockAi });

      const req = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': validInitData,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Ping' }],
        }),
      });

      const res = await proxyProvider(req, env, 'groq', '/chat/completions');

      expect(res.status).toBe(200);
      expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
      const data = (await res.json()) as any;
      expect(data.choices[0].message.content).toBe('Recovered via Workers AI on 429');
    });

    it('falls back to Workers AI when hosted Groq returns 500', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Internal server error' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const mockAi: Ai = {
        run: vi.fn().mockResolvedValue({ response: 'Recovered via Workers AI on 500' }),
      };

      const env = createTestEnv({ AI: mockAi });

      const req = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': validInitData,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Ping' }],
        }),
      });

      const res = await proxyProvider(req, env, 'groq', '/chat/completions');

      expect(res.status).toBe(200);
      expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
      const data = (await res.json()) as any;
      expect(data.choices[0].message.content).toBe('Recovered via Workers AI on 500');
    });

    it('falls back to Workers AI when upstream fetch throws network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection reset by peer'));

      const mockAi: Ai = {
        run: vi.fn().mockResolvedValue({ response: 'Recovered via Workers AI on network throw' }),
      };

      const env = createTestEnv({ AI: mockAi });

      const req = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': validInitData,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Ping' }],
        }),
      });

      const res = await proxyProvider(req, env, 'groq', '/chat/completions');

      expect(res.status).toBe(200);
      expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
      const data = (await res.json()) as any;
      expect(data.choices[0].message.content).toBe('Recovered via Workers AI on network throw');
    });

    it('streams SSE response on fallback when stream: true', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Service Unavailable', { status: 503 }),
      );

      const encoder = new TextEncoder();
      const mockAi: Ai = {
        run: vi.fn().mockResolvedValue(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"response":"Streamed "}\n\n'));
              controller.enqueue(encoder.encode('data: {"response":"fallback"}\n\n'));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            },
          }),
        ),
      };

      const env = createTestEnv({ AI: mockAi });

      const req = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': validInitData,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Stream test' }],
          stream: true,
        }),
      });

      const res = await proxyProvider(req, env, 'groq', '/chat/completions');

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');

      const text = await res.text();
      expect(text).toContain('data: {"id":');
      expect(text).toContain('"content":"Streamed "');
      expect(text).toContain('"content":"fallback"');
      expect(text).toContain('data: [DONE]');
    });

    it('returns 503 HOSTED_PROVIDER_DEPLETED on 402 if env.AI is not configured', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'billing' }), { status: 402 }),
      );

      const env = createTestEnv({ AI: undefined });

      const req = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': validInitData,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Ping' }],
        }),
      });

      const res = await proxyProvider(req, env, 'groq', '/chat/completions');
      expect(res.status).toBe(503);
      const data = (await res.json()) as any;
      expect(data.code).toBe('HOSTED_PROVIDER_DEPLETED');
    });

    it('does not trigger Workers AI for BYOK requests with custom key returning 402', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'billing' }), { status: 402 }),
      );

      const mockAi: Ai = {
        run: vi.fn().mockResolvedValue({ response: 'Should not be called' }),
      };

      const env = createTestEnv({ AI: mockAi });

      const req = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-provider-key': 'gsk_custom_user_key',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Ping' }],
        }),
      });

      const res = await proxyProvider(req, env, 'groq', '/chat/completions');
      expect(res.status).toBe(402);
      const data = (await res.json()) as any;
      expect(data.code).toBe('BYOK_PAYMENT_REQUIRED');
      expect(mockAi.run).not.toHaveBeenCalled();
    });

    it('falls back to Workers AI when hosted Groq key is completely unconfigured', async () => {
      const mockAi: Ai = {
        run: vi.fn().mockResolvedValue({ response: 'Handled when no Groq key configured' }),
      };

      const env = createTestEnv({
        AI: mockAi,
        GROQ_API_KEY: undefined,
        GROQ_API_KEY_FALLBACK: undefined,
      });

      const req = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': validInitData,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Ping' }],
        }),
      });

      const res = await proxyProvider(req, env, 'groq', '/chat/completions');
      expect(res.status).toBe(200);
      expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
      const data = (await res.json()) as any;
      expect(data.choices[0].message.content).toBe('Handled when no Groq key configured');
    });
  });
});
