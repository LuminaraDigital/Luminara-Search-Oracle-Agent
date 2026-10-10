import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Ai, Env } from '../worker/env';
import {
  WORKERS_AI_FALLBACK_EVENT,
  WORKERS_AI_FALLBACK_MAX_TOKENS,
  WORKERS_AI_FALLBACK_MODEL,
  WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET,
  planWorkersAiChatFallback,
  runWorkersAiChatFallback,
  type WorkersAiFallbackOutcome,
} from '../worker/workersAiFallback';
import {
  PROVIDERS,
  isChatCompletionsPath,
  isWorkersAiFallbackPath,
  proxyProvider,
} from '../worker/providerRelay';
import { corsHeaders } from '../worker/workerUtils';

const BOT_TOKEN = '123456:TEST_BOT_TOKEN_AI_FALLBACK';
const PROMPT = 'Zebra-crossing question that must never reach a log line';

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

function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const ev of events) controller.enqueue(encoder.encode(`data: ${ev}\n\n`));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

function sseChunks(text: string): any[] {
  return text
    .split('\n\n')
    .filter(Boolean)
    .filter(ev => ev !== 'data: [DONE]')
    .map(ev => JSON.parse(ev.slice(6)));
}

/** The structured fallback events written to console.log, parsed. */
function fallbackEvents(spy: { mock: { calls: unknown[][] } }): any[] {
  const events: any[] = [];
  for (const call of spy.mock.calls) {
    if (typeof call[0] !== 'string') continue;
    try {
      const parsed = JSON.parse(call[0]);
      if (parsed?.event === WORKERS_AI_FALLBACK_EVENT) events.push(parsed);
    } catch {
      /* not a JSON line */
    }
  }
  return events;
}

function answered(outcome: WorkersAiFallbackOutcome) {
  if (!outcome.answered) throw new Error(`fallback refused: ${outcome.refusal}`);
  return outcome;
}

function jsonAnswer(outcome: WorkersAiFallbackOutcome) {
  const a = answered(outcome);
  if (a.streaming) throw new Error('expected a JSON answer');
  return a.completion;
}

function streamAnswer(outcome: WorkersAiFallbackOutcome) {
  const a = answered(outcome);
  if (!a.streaming) throw new Error('expected a streamed answer');
  return a.stream;
}

/** Requests the fallback must refuse: each would come back as something the caller did not ask for. */
const REFUSED_REQUESTS: Array<{ name: string; refusal: string; body: Record<string, unknown> }> = [
  {
    name: 'response_format',
    refusal: 'response_format',
    body: { messages: [{ role: 'user', content: 'Ping' }], response_format: { type: 'json_object' } },
  },
  {
    name: 'tools',
    refusal: 'tools',
    body: {
      messages: [{ role: 'user', content: 'Ping' }],
      tools: [{ type: 'function', function: { name: 'live_search', description: 'Search', parameters: { type: 'object', properties: {} } } }],
    },
  },
  {
    name: 'tool_choice',
    refusal: 'tool_choice',
    body: { messages: [{ role: 'user', content: 'Ping' }], tool_choice: 'auto' },
  },
  {
    name: 'a message whose content is an array',
    refusal: 'non_string_content',
    body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }] },
  },
  {
    name: 'a prompt over the budget',
    refusal: 'prompt_too_long',
    body: {
      messages: [
        { role: 'system', content: 'a'.repeat(WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET) },
        { role: 'user', content: 'b' },
      ],
    },
  },
];

describe('Workers AI fallback (SW0a-11)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('planWorkersAiChatFallback: what it will answer', () => {
    it.each(REFUSED_REQUESTS)('refuses a request with $name', ({ body, refusal }) => {
      expect(planWorkersAiChatFallback(body)).toEqual({ ok: false, refusal });
    });

    it('refuses the older spellings of a tool call and a tool conversation', () => {
      const user = { role: 'user', content: 'Ping' };
      expect(planWorkersAiChatFallback({ messages: [user], functions: [{ name: 'f' }] })).toEqual({ ok: false, refusal: 'tools' });
      expect(planWorkersAiChatFallback({ messages: [user], function_call: 'auto' })).toEqual({ ok: false, refusal: 'tool_choice' });
      expect(
        planWorkersAiChatFallback({ messages: [user, { role: 'tool', tool_call_id: 'call_1', content: 'result' }] }),
      ).toEqual({ ok: false, refusal: 'tools' });
    });

    it('refuses null content, a message that is not an object, and an empty request', () => {
      expect(planWorkersAiChatFallback({ messages: [{ role: 'assistant', content: null }] })).toEqual({
        ok: false,
        refusal: 'non_string_content',
      });
      expect(planWorkersAiChatFallback({ messages: ['Ping'] })).toEqual({ ok: false, refusal: 'malformed_message' });
      expect(planWorkersAiChatFallback({})).toEqual({ ok: false, refusal: 'no_prompt' });
      expect(planWorkersAiChatFallback('not json')).toEqual({ ok: false, refusal: 'no_prompt' });
    });

    it('accepts a prompt exactly at the budget and keeps every message whole', () => {
      const messages = [
        { role: 'system', content: 'a'.repeat(WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET - 1) },
        { role: 'user', content: 'b' },
      ];
      const planned = planWorkersAiChatFallback({ messages });
      expect(planned.ok).toBe(true);
      if (planned.ok) expect(planned.plan.messages).toEqual(messages);
    });

    it('passes the caller temperature when it is a number from 0 to 2, else the default', () => {
      const temp = (temperature: unknown) => {
        const planned = planWorkersAiChatFallback({ messages: [{ role: 'user', content: 'Ping' }], temperature });
        if (!planned.ok) throw new Error('refused');
        return planned.plan.temperature;
      };
      expect(temp(0.2)).toBe(0.2);
      expect(temp(0)).toBe(0);
      expect(temp(2)).toBe(2);
      expect(temp(undefined)).toBe(0.7);
      expect(temp(2.5)).toBe(0.7);
      expect(temp(-1)).toBe(0.7);
      expect(temp('0.2')).toBe(0.7);
      expect(temp(Number.NaN)).toBe(0.7);
    });

    it('passes the caller max_tokens, capped at what the fallback allows', () => {
      const max = (extra: Record<string, unknown>) => {
        const planned = planWorkersAiChatFallback({ messages: [{ role: 'user', content: 'Ping' }], ...extra });
        if (!planned.ok) throw new Error('refused');
        return planned.plan.maxTokens;
      };
      expect(max({ max_tokens: 256 })).toBe(256);
      expect(max({ max_completion_tokens: 300 })).toBe(300);
      expect(max({ max_tokens: 999_999 })).toBe(WORKERS_AI_FALLBACK_MAX_TOKENS);
      expect(max({})).toBe(WORKERS_AI_FALLBACK_MAX_TOKENS);
      expect(max({ max_tokens: 0 })).toBe(WORKERS_AI_FALLBACK_MAX_TOKENS);
    });
  });

  describe('runWorkersAiChatFallback', () => {
    it('returns an OpenAI ChatCompletion that names the model and the reason', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      let capturedModel = '';
      let capturedInput: any = null;

      const mockAi: Ai = {
        async run(model: string, input: any) {
          capturedModel = model;
          capturedInput = input;
          return { response: 'Hello from Workers AI Llama 3.1!' };
        },
      };

      const result = jsonAnswer(
        await runWorkersAiChatFallback(
          mockAi,
          {
            model: 'groq/llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: 'What is the capital of France?' }],
            temperature: 0.5,
          },
          { reason: 'upstream_5xx', upstreamStatus: 503 },
        ),
      );

      expect(capturedModel).toBe('@cf/meta/llama-3.1-8b-instruct');
      // The caller asked for 0.5. It used to be overwritten with 0.7.
      expect(capturedInput.temperature).toBe(0.5);
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
      expect(result.x_fallback).toEqual({
        provider: 'workers-ai',
        model: '@cf/meta/llama-3.1-8b-instruct',
        reason: 'upstream_5xx',
      });
    });

    it('reports the usage the binding reported', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = {
        run: vi.fn().mockResolvedValue({
          response: 'Paris.',
          usage: { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 },
        }),
      };

      const result = jsonAnswer(
        await runWorkersAiChatFallback(mockAi, { messages: [{ role: 'user', content: PROMPT }] }, { reason: 'network_error' }),
      );

      expect(result.usage).toEqual({ prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 });
      const events = fallbackEvents(log);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 });
    });

    it('leaves usage out when the binding reported none: no zeros', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = { run: vi.fn().mockResolvedValue({ response: 'Paris.' }) };

      const result = jsonAnswer(
        await runWorkersAiChatFallback(mockAi, { messages: [{ role: 'user', content: PROMPT }] }, { reason: 'network_error' }),
      );

      expect('usage' in result).toBe(false);
      const events = fallbackEvents(log);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ prompt_tokens: null, completion_tokens: null, total_tokens: null });
    });

    it('logs one structured event per answer, with no prompt text and no user id', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = {
        run: vi.fn().mockResolvedValue({
          response: `An answer that repeats the prompt: ${PROMPT}`,
          usage: { prompt_tokens: 12, completion_tokens: 30, total_tokens: 42 },
        }),
      };

      await runWorkersAiChatFallback(
        mockAi,
        { messages: [{ role: 'user', content: PROMPT }], user: 'tg_999' },
        { reason: 'upstream_5xx', upstreamStatus: 502 },
      );

      const events = fallbackEvents(log);
      expect(events).toHaveLength(1);
      // The whole event is these fields. None of them can hold a prompt or an identity.
      expect(events[0]).toEqual({
        event: 'workers_ai_fallback_answer',
        provider: 'workers-ai',
        model: '@cf/meta/llama-3.1-8b-instruct',
        reason: 'upstream_5xx',
        upstream_status: 502,
        stream: false,
        prompt_tokens: 12,
        completion_tokens: 30,
        total_tokens: 42,
      });
      const everythingLogged = log.mock.calls.map(c => c.map(String).join(' ')).join('\n');
      expect(everythingLogged).not.toContain(PROMPT);
      expect(everythingLogged).not.toContain('tg_999');
    });

    it.each(REFUSED_REQUESTS)('does not call the binding for a request with $name', async ({ body, refusal }) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = { run: vi.fn().mockResolvedValue({ response: 'Should not be called' }) };

      const outcome = await runWorkersAiChatFallback(mockAi, body, { reason: 'upstream_5xx', upstreamStatus: 500 });

      expect(outcome).toEqual({ answered: false, refusal });
      expect(mockAi.run).not.toHaveBeenCalled();
      expect(fallbackEvents(log)).toHaveLength(0);
    });

    it('throws instead of answering when the binding returns no text', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = { run: vi.fn().mockResolvedValue({ tool_calls: [] }) };

      await expect(
        runWorkersAiChatFallback(mockAi, { messages: [{ role: 'user', content: 'Ping' }] }, { reason: 'network_error' }),
      ).rejects.toThrow(/no text/);
      expect(fallbackEvents(log)).toHaveLength(0);
    });

    it('extracts prompt if messages array is missing or empty', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      let capturedInput: any = null;
      const mockAi: Ai = {
        async run(_model: string, input: any) {
          capturedInput = input;
          return { response: 'Echo prompt answer' };
        },
      };

      const result = jsonAnswer(
        await runWorkersAiChatFallback(
          mockAi,
          { prompt: 'Explain quantum computing in one sentence' },
          { reason: 'provider_not_configured' },
        ),
      );

      expect(capturedInput.messages).toEqual([
        { role: 'user', content: 'Explain quantum computing in one sentence' },
      ]);
      expect(result.choices[0].message.content).toBe('Echo prompt answer');
    });

    it('returns valid OpenAI SSE stream when stream is requested', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAiStream: Ai = {
        async run(_model: string, _input: any) {
          return sseStream(['{"response":"Edge"}', '{"response":" AI"}', '[DONE]']);
        },
      };

      const stream = streamAnswer(
        await runWorkersAiChatFallback(
          mockAiStream,
          { messages: [{ role: 'user', content: 'Say Edge AI' }], stream: true },
          { reason: 'upstream_5xx', upstreamStatus: 503 },
        ),
      );
      expect(stream).toBeInstanceOf(ReadableStream);

      const text = await readAll(stream);
      expect(text.split('\n\n').filter(Boolean).pop()).toBe('data: [DONE]');

      const parsedChunks = sseChunks(text);
      expect(parsedChunks).toHaveLength(3);
      expect(parsedChunks[0].object).toBe('chat.completion.chunk');
      expect(parsedChunks[0].model).toBe('@cf/meta/llama-3.1-8b-instruct');
      expect(parsedChunks[0].choices[0].delta.content).toBe('Edge');
      expect(parsedChunks[1].choices[0].delta.content).toBe(' AI');
      expect(parsedChunks[2].choices[0].finish_reason).toBe('stop');
      // The binding reported no usage on this stream, so none is claimed.
      expect('usage' in parsedChunks[2]).toBe(false);

      const events = fallbackEvents(log);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ stream: true, reason: 'upstream_5xx', prompt_tokens: null, completion_tokens: null });
    });

    it('carries the usage a stream reports on its last chunk, and logs it once', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAiStream: Ai = {
        async run(_model: string, _input: any) {
          return sseStream([
            '{"response":"Edge"}',
            '{"response":"","usage":{"prompt_tokens":9,"completion_tokens":2,"total_tokens":11}}',
            '[DONE]',
          ]);
        },
      };

      const stream = streamAnswer(
        await runWorkersAiChatFallback(
          mockAiStream,
          { messages: [{ role: 'user', content: PROMPT }], stream: true },
          { reason: 'network_error' },
        ),
      );
      // Nothing is logged until the stream has been produced.
      const parsedChunks = sseChunks(await readAll(stream));

      expect(parsedChunks).toHaveLength(2);
      expect(parsedChunks[0].choices[0].delta.content).toBe('Edge');
      expect(parsedChunks[1].choices[0].finish_reason).toBe('stop');
      expect(parsedChunks[1].usage).toEqual({ prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 });

      const events = fallbackEvents(log);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ stream: true, prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 });
      expect(JSON.stringify(events[0])).not.toContain(PROMPT);
    });

    it('handles static object response when stream was requested as fallback resilience', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAiStatic: Ai = {
        async run(_model: string, _input: any) {
          return { response: 'Direct response' };
        },
      };

      const stream = streamAnswer(
        await runWorkersAiChatFallback(
          mockAiStatic,
          { messages: [{ role: 'user', content: 'Test' }], stream: true },
          { reason: 'network_error' },
        ),
      );
      const text = await readAll(stream);

      expect(text).toContain('data: {"id":');
      expect(text).toContain('"content":"Direct response"');
      expect(text).toContain('"finish_reason":"stop"');
      expect(text).toContain('data: [DONE]\n\n');
    });
  });

  describe('providerRelay: when the fallback may answer', () => {
    const originalFetch = globalThis.fetch;
    let kv: any;
    let validInitData: string;
    let log: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      kv = createMockKv();
      validInitData = signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 999, first_name: 'EdgeTester' }),
      });
      log = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
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

    const answeringAi = (text = 'Recovered via Workers AI'): Ai => ({
      run: vi.fn().mockResolvedValue({ response: text }),
    });

    const chatBody = (extra: Record<string, unknown> = {}) => ({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'Ping' }],
      ...extra,
    });

    const hostedRequest = (providerId: string, subPath: string, body: unknown, method = 'POST') =>
      new Request(`https://luminarasuite.com/api/providers/${providerId}${subPath}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': validInitData,
        },
        body: method === 'GET' ? undefined : JSON.stringify(body),
      });

    const upstreamError = (status: number) =>
      new Response(JSON.stringify({ error: { message: `upstream said ${status}` } }), {
        status,
        headers: { 'content-type': 'application/json', 'retry-after': '7' },
      });

    const callGroq = (env: Env, body: unknown = chatBody()) =>
      proxyProvider(hostedRequest('groq', '/chat/completions', body), env, 'groq', '/chat/completions');

    describe('never on a 4xx', () => {
      it.each([400, 401, 403, 404, 413, 422, 429])(
        'returns an upstream %i as itself, with its own body and headers',
        async status => {
          globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(status));
          const mockAi = answeringAi();

          const res = await callGroq(createTestEnv({ AI: mockAi }));

          expect(res.status).toBe(status);
          expect(res.headers.get('retry-after')).toBe('7');
          expect(res.headers.get('x-provider-fallback')).toBeNull();
          expect(await res.json()).toEqual({ error: { message: `upstream said ${status}` } });
          expect(mockAi.run).not.toHaveBeenCalled();
          expect(fallbackEvents(log)).toHaveLength(0);
        },
      );

      it('does not answer an upstream 402: the relay reports it the way it does without the binding', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(402));
        const mockAi = answeringAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }));

        // The relay has always turned a hosted-key 402 into this error so the caller's own
        // paywall is not triggered. That is unchanged; what changed is that no model answers.
        expect(res.status).toBe(503);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(((await res.json()) as any).code).toBe('HOSTED_PROVIDER_DEPLETED');
        expect(mockAi.run).not.toHaveBeenCalled();
      });

      it('lets the second Groq key answer a 429 before anything else', async () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce(upstreamError(429))
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ model: 'llama-3.3-70b-versatile', choices: [{ message: { content: 'From the second key' } }] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        globalThis.fetch = fetchMock;
        const mockAi = answeringAi();

        const res = await callGroq(createTestEnv({ AI: mockAi, GROQ_API_KEY_FALLBACK: 'gsk_second_test_key' }));

        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(((await res.json()) as any).choices[0].message.content).toBe('From the second key');
        expect(mockAi.run).not.toHaveBeenCalled();
      });

      it('still returns the 429 when the second key fails too', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(upstreamError(429)).mockResolvedValueOnce(upstreamError(500));
        globalThis.fetch = fetchMock;
        const mockAi = answeringAi();

        const res = await callGroq(createTestEnv({ AI: mockAi, GROQ_API_KEY_FALLBACK: 'gsk_second_test_key' }));

        expect(res.status).toBe(429);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(mockAi.run).not.toHaveBeenCalled();
      });
    });

    describe('on a 5xx or a network failure', () => {
      it.each([500, 502, 503])('answers an upstream %i and says which model did', async status => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(status));
        const mockAi = answeringAi(`Recovered via Workers AI on ${status}`);

        const res = await callGroq(createTestEnv({ AI: mockAi }));

        expect(res.status).toBe(200);
        expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
        expect(res.headers.get('x-provider-fallback-model')).toBe(WORKERS_AI_FALLBACK_MODEL);
        expect(res.headers.get('x-provider-fallback-reason')).toBe('upstream_5xx');
        const data = (await res.json()) as any;
        expect(data.model).toBe('@cf/meta/llama-3.1-8b-instruct');
        expect(data.x_fallback).toEqual({ provider: 'workers-ai', model: '@cf/meta/llama-3.1-8b-instruct', reason: 'upstream_5xx' });
        expect(data.choices[0].message.content).toBe(`Recovered via Workers AI on ${status}`);
        expect(mockAi.run).toHaveBeenCalledTimes(1);

        const events = fallbackEvents(log);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ reason: 'upstream_5xx', upstream_status: status, model: WORKERS_AI_FALLBACK_MODEL });
      });

      it('answers when the upstream fetch throws', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection reset by peer'));
        const mockAi = answeringAi('Recovered via Workers AI on network throw');

        const res = await callGroq(createTestEnv({ AI: mockAi }));

        expect(res.status).toBe(200);
        expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
        expect(res.headers.get('x-provider-fallback-model')).toBe(WORKERS_AI_FALLBACK_MODEL);
        expect(res.headers.get('x-provider-fallback-reason')).toBe('network_error');
        const data = (await res.json()) as any;
        expect(data.x_fallback.reason).toBe('network_error');
        expect(data.choices[0].message.content).toBe('Recovered via Workers AI on network throw');
        expect(fallbackEvents(log)).toHaveLength(1);
      });

      it('passes the caller temperature and max_tokens to the binding', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const mockAi = answeringAi();

        await callGroq(createTestEnv({ AI: mockAi }), chatBody({ temperature: 0.2, max_tokens: 256 }));

        expect(mockAi.run).toHaveBeenCalledTimes(1);
        const [model, input] = (mockAi.run as any).mock.calls[0];
        expect(model).toBe(WORKERS_AI_FALLBACK_MODEL);
        expect(input.temperature).toBe(0.2);
        expect(input.max_tokens).toBe(256);
      });

      it('reports the usage the binding reported, and none when it reported none', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const withUsage: Ai = {
          run: vi.fn().mockResolvedValue({ response: 'Pong', usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }),
        };
        const reported = (await (await callGroq(createTestEnv({ AI: withUsage }))).json()) as any;
        expect(reported.usage).toEqual({ prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 });

        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const silent = (await (await callGroq(createTestEnv({ AI: answeringAi() }))).json()) as any;
        expect('usage' in silent).toBe(false);
      });

      it('returns the upstream error when the binding itself fails', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const mockAi: Ai = { run: vi.fn().mockRejectedValue(new Error('binding down')) };

        const res = await callGroq(createTestEnv({ AI: mockAi }));

        expect(res.status).toBe(503);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(await res.json()).toEqual({ error: { message: 'upstream said 503' } });
      });

      it('does not answer a GET', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(500));
        const mockAi = answeringAi();

        const res = await proxyProvider(
          hostedRequest('groq', '/chat/completions', undefined, 'GET'),
          createTestEnv({ AI: mockAi }),
          'groq',
          '/chat/completions',
        );

        expect(res.status).toBe(500);
        expect(mockAi.run).not.toHaveBeenCalled();
      });
    });

    describe('requests it refuses', () => {
      it.each(REFUSED_REQUESTS)('a request with $name gets the upstream 5xx, not an answer', async ({ body }) => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const mockAi = answeringAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody(body));

        expect(res.status).toBe(503);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(await res.json()).toEqual({ error: { message: 'upstream said 503' } });
        expect(mockAi.run).not.toHaveBeenCalled();
        expect(fallbackEvents(log)).toHaveLength(0);
      });

      it.each(REFUSED_REQUESTS)('a request with $name gets the connection error after a network throw', async ({ body }) => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection reset by peer'));
        const mockAi = answeringAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody(body));

        expect(res.status).toBe(502);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(((await res.json()) as any).error).toBe('Upstream connection failed: Connection reset by peer');
        expect(mockAi.run).not.toHaveBeenCalled();
      });

      it.each(REFUSED_REQUESTS)('a request with $name gets the not-configured error when there is no hosted key', async ({ body }) => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('the upstream must not be called'));
        const mockAi = answeringAi();

        const res = await callGroq(
          createTestEnv({ AI: mockAi, GROQ_API_KEY: undefined, GROQ_API_KEY_FALLBACK: undefined }),
          chatBody(body),
        );

        expect(res.status).toBe(503);
        expect(((await res.json()) as any).error).toMatch(/groq is not configured on the server/);
        expect(mockAi.run).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });
    });

    describe('streaming follows the same rules', () => {
      const streamingAi = (): Ai => ({
        run: vi.fn().mockResolvedValue(sseStream(['{"response":"Streamed "}', '{"response":"fallback"}', '[DONE]'])),
      });

      it('streams the fallback answer on a 503 and marks it in the headers', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response('Service Unavailable', { status: 503 }));
        const mockAi = streamingAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody({ stream: true }));

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        // The headers arrive before the stream, so the client can label the reply as it starts.
        expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
        expect(res.headers.get('x-provider-fallback-model')).toBe(WORKERS_AI_FALLBACK_MODEL);
        expect(res.headers.get('x-provider-fallback-reason')).toBe('upstream_5xx');

        const text = await res.text();
        expect(text).toContain('data: {"id":');
        expect(text).toContain('"content":"Streamed "');
        expect(text).toContain('"content":"fallback"');
        expect(text).toContain(`"model":"${WORKERS_AI_FALLBACK_MODEL}"`);
        expect(text).toContain('data: [DONE]');
        expect((mockAi.run as any).mock.calls[0][1].stream).toBe(true);
        expect(fallbackEvents(log)).toHaveLength(1);
      });

      it('streams the fallback answer after a network throw', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection reset by peer'));

        const res = await callGroq(createTestEnv({ AI: streamingAi() }), chatBody({ stream: true }));

        expect(res.status).toBe(200);
        expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
        expect(res.headers.get('x-provider-fallback-reason')).toBe('network_error');
        expect(await res.text()).toContain('"content":"fallback"');
      });

      it('returns a streamed request its 429', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(429));
        const mockAi = streamingAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody({ stream: true }));

        expect(res.status).toBe(429);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(mockAi.run).not.toHaveBeenCalled();
      });

      it.each(REFUSED_REQUESTS)('refuses a streamed request with $name', async ({ body }) => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const mockAi = streamingAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody({ ...body, stream: true }));

        expect(res.status).toBe(503);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(mockAi.run).not.toHaveBeenCalled();
      });
    });

    describe('where no hosted key is configured', () => {
      it('answers on the groq chat path and says so', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('the upstream must not be called'));
        const mockAi = answeringAi('Handled when no Groq key configured');

        const res = await callGroq(createTestEnv({ AI: mockAi, GROQ_API_KEY: undefined, GROQ_API_KEY_FALLBACK: undefined }));

        expect(res.status).toBe(200);
        expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
        expect(res.headers.get('x-provider-fallback-model')).toBe(WORKERS_AI_FALLBACK_MODEL);
        expect(res.headers.get('x-provider-fallback-reason')).toBe('provider_not_configured');
        const data = (await res.json()) as any;
        expect(data.x_fallback.reason).toBe('provider_not_configured');
        expect(data.choices[0].message.content).toBe('Handled when no Groq key configured');
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it('returns the not-configured error when the binding is absent', async () => {
        const res = await callGroq(createTestEnv({ AI: undefined, GROQ_API_KEY: undefined, GROQ_API_KEY_FALLBACK: undefined }));

        expect(res.status).toBe(503);
        expect(((await res.json()) as any).error).toMatch(/groq is not configured on the server/);
      });
    });

    describe('only the groq chat path', () => {
      /** One hosted call per other provider: the path, the keys that configure it, a valid body. */
      const OTHER_PROVIDERS: Record<string, { path: string; keys: Partial<Env>; body: unknown }> = {
        nim: { path: '/chat/completions', keys: { NVIDIA_API_KEY: 'nv_test_key' }, body: chatBody() },
        ollama: { path: '/v1/chat/completions', keys: { OLLAMA_API_KEY: 'ol_test_key' }, body: chatBody() },
        openrouter: { path: '/chat/completions', keys: { OPENROUTER_API_KEY: 'or_test_key' }, body: chatBody() },
        gemini: {
          path: '/v1beta/models/gemini-test:generateContent',
          keys: { GEMINI_API_KEY: 'gm_test_key' },
          body: { contents: [{ role: 'user', parts: [{ text: 'Ping' }] }] },
        },
        tavily: { path: '/search', keys: { TAVILY_API_KEY: 'tv_test_key' }, body: { query: 'ping' } },
        firecrawl: { path: '/map', keys: { FIRECRAWL_API_KEY: 'fc_test_key' }, body: {} },
        exa: { path: '/search', keys: { EXA_API_KEY: 'exa_test_key' }, body: { query: 'ping' } },
        dataforseo: {
          path: '/v3/serp/google/organic/live/advanced',
          keys: { DATAFORSEO_LOGIN: 'login@example.com', DATAFORSEO_PASSWORD: 'test_password' },
          body: [{ keyword: 'ping' }],
        },
      };

      /** Every chat path the relay knows for a provider, plus the one in the table above. */
      const pathsFor = (providerId: string): string[] => {
        const chatPaths = PROVIDERS[providerId].allow.filter(p => isChatCompletionsPath(providerId, p));
        return [...new Set([OTHER_PROVIDERS[providerId].path, ...chatPaths])];
      };

      const unsetKeys = (keys: Partial<Env>): Partial<Env> =>
        Object.fromEntries(Object.keys(keys).map(k => [k, undefined])) as Partial<Env>;

      beforeEach(async () => {
        // Hosted NIM, Ollama, OpenRouter and DataForSEO need a plan; give the caller one so each
        // request gets as far as the upstream call.
        await kv.put('sub:999', JSON.stringify({ plan: 'starter', expiresAt: Date.now() + 86_400_000 }));
      });

      it('names the path with one predicate', () => {
        expect(isWorkersAiFallbackPath('groq', '/chat/completions')).toBe(true);
        expect(isWorkersAiFallbackPath('groq', '/models')).toBe(false);
        for (const id of Object.keys(PROVIDERS).filter(p => p !== 'groq')) {
          for (const path of PROVIDERS[id].allow) expect(isWorkersAiFallbackPath(id, path)).toBe(false);
        }
      });

      it('covers every other provider the relay has', () => {
        expect(Object.keys(OTHER_PROVIDERS).sort()).toEqual(Object.keys(PROVIDERS).filter(p => p !== 'groq').sort());
        expect(pathsFor('ollama').sort()).toEqual(['/api/chat', '/api/generate', '/v1/chat/completions']);
      });

      it.each(Object.keys(OTHER_PROVIDERS))('%s never reaches the fallback: upstream 5xx, network throw, or no key', async providerId => {
        const { keys, body } = OTHER_PROVIDERS[providerId];

        for (const path of pathsFor(providerId)) {
          for (const stream of [false, true]) {
            const requestBody = stream && body && typeof body === 'object' && !Array.isArray(body) ? { ...body, stream: true } : body;
            const mockAi = answeringAi();

            globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(500));
            const failed = await proxyProvider(hostedRequest(providerId, path, requestBody), createTestEnv({ AI: mockAi, ...keys }), providerId, path);
            expect(failed.status, `${providerId}${path} upstream 500`).toBe(500);
            expect(failed.headers.get('x-provider-fallback')).toBeNull();
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);

            globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection reset by peer'));
            const thrown = await proxyProvider(hostedRequest(providerId, path, requestBody), createTestEnv({ AI: mockAi, ...keys }), providerId, path);
            expect(thrown.status, `${providerId}${path} network throw`).toBe(502);
            expect(thrown.headers.get('x-provider-fallback')).toBeNull();

            globalThis.fetch = vi.fn().mockRejectedValue(new Error('the upstream must not be called'));
            const unconfigured = await proxyProvider(
              hostedRequest(providerId, path, requestBody),
              createTestEnv({ AI: mockAi, ...unsetKeys(keys) }),
              providerId,
              path,
            );
            expect(unconfigured.status, `${providerId}${path} no key`).toBe(503);
            expect(((await unconfigured.json()) as any).error).toMatch(new RegExp(`${providerId} is not configured on the server`));
            expect(unconfigured.headers.get('x-provider-fallback')).toBeNull();

            expect(mockAi.run, `${providerId}${path}`).not.toHaveBeenCalled();
          }
        }
        expect(fallbackEvents(log)).toHaveLength(0);
      });
    });

    describe('callers the fallback was never for', () => {
      it('returns 503 HOSTED_PROVIDER_DEPLETED on 402 if env.AI is not configured', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'billing' }), { status: 402 }),
        );

        const res = await callGroq(createTestEnv({ AI: undefined }));

        expect(res.status).toBe(503);
        const data = (await res.json()) as any;
        expect(data.code).toBe('HOSTED_PROVIDER_DEPLETED');
      });

      it('does not trigger Workers AI for BYOK requests with custom key returning 402', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'billing' }), { status: 402 }),
        );
        const mockAi = answeringAi('Should not be called');

        const req = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-provider-key': 'gsk_custom_user_key',
          },
          body: JSON.stringify(chatBody()),
        });

        const res = await proxyProvider(req, createTestEnv({ AI: mockAi }), 'groq', '/chat/completions');
        expect(res.status).toBe(402);
        const data = (await res.json()) as any;
        expect(data.code).toBe('BYOK_PAYMENT_REQUIRED');
        expect(mockAi.run).not.toHaveBeenCalled();
      });

      it.each([500, 503])('does not answer a BYOK request whose own key gets a %i', async status => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(status));
        const mockAi = answeringAi('Should not be called');

        const req = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-provider-key': 'gsk_custom_user_key',
          },
          body: JSON.stringify(chatBody()),
        });

        const res = await proxyProvider(req, createTestEnv({ AI: mockAi }), 'groq', '/chat/completions');
        expect(res.status).toBe(status);
        expect(mockAi.run).not.toHaveBeenCalled();
      });
    });
  });

  describe('what the browser may read', () => {
    it('exposes the fallback headers to a cross-origin client', () => {
      const env = { WEBAPP_URL: 'https://luminarasuite.com' } as Env;
      const request = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
        headers: { Origin: 'https://luminarasuite.com' },
      });
      const exposed = corsHeaders(env, request)['Access-Control-Expose-Headers'].split(',').map(h => h.trim());
      expect(exposed).toEqual(
        expect.arrayContaining(['x-provider-fallback', 'x-provider-fallback-model', 'x-provider-fallback-reason']),
      );
    });
  });
});
