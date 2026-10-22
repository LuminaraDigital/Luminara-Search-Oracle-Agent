import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Ai, Env } from '../worker/env';
import {
  WORKERS_AI_FALLBACK_EVENT,
  WORKERS_AI_FALLBACK_FAILED_EVENT,
  WORKERS_AI_FALLBACK_MAX_TOKENS,
  WORKERS_AI_FALLBACK_MODEL,
  WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET,
  WORKERS_AI_FALLBACK_REFUSED_EVENT,
  WorkersAiFallbackFailedError,
  fallbackFinishReason,
  planWorkersAiChatFallback,
  promptBudgetUnits,
  readBindingUsage,
  runWorkersAiChatFallback,
  type WorkersAiFallbackOutcome,
} from '../worker/workersAiFallback';
import {
  ACCEPT_FALLBACK_HEADER,
  PROVIDERS,
  isChatCompletionsPath,
  isWorkersAiFallbackPath,
  proxyProvider,
  upstreamErrorExcerpt,
} from '../worker/providerRelay';
import { corsHeaders } from '../worker/workerUtils';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';
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

/** A binding stream that sends the given events and then breaks. */
function brokenSseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent < events.length) {
        controller.enqueue(encoder.encode(`data: ${events[sent++]}\n\n`));
        return;
      }
      controller.error(new Error('binding stream broke'));
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

type LogSpy = { mock: { calls: unknown[][] } };

/** The structured lines of one event name written to console.log, parsed. */
function eventsNamed(spy: LogSpy, name: string): any[] {
  const events: any[] = [];
  for (const call of spy.mock.calls) {
    if (typeof call[0] !== 'string') continue;
    try {
      const parsed = JSON.parse(call[0]);
      if (parsed?.event === name) events.push(parsed);
    } catch {
      /* not a JSON line */
    }
  }
  return events;
}
const answerEvents = (spy: LogSpy) => eventsNamed(spy, WORKERS_AI_FALLBACK_EVENT);
const refusedEvents = (spy: LogSpy) => eventsNamed(spy, WORKERS_AI_FALLBACK_REFUSED_EVENT);
const failedEvents = (spy: LogSpy) => eventsNamed(spy, WORKERS_AI_FALLBACK_FAILED_EVENT);
const everythingLogged = (spy: LogSpy) => spy.mock.calls.map(c => c.map(String).join(' ')).join('\n');

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

const USER = { role: 'user', content: 'Ping' };

/** Requests the fallback must refuse: each would come back as something the caller did not ask for. */
const REFUSED_REQUESTS: Array<{ name: string; refusal: string; body: Record<string, unknown> }> = [
  {
    name: 'response_format',
    refusal: 'response_format',
    body: { messages: [USER], response_format: { type: 'json_object' } },
  },
  {
    name: 'tools',
    refusal: 'tools',
    body: {
      messages: [USER],
      tools: [{ type: 'function', function: { name: 'live_search', description: 'Search', parameters: { type: 'object', properties: {} } } }],
    },
  },
  {
    name: 'tool_choice',
    refusal: 'tool_choice',
    body: { messages: [USER], tool_choice: 'auto' },
  },
  {
    name: 'a message whose content is an array',
    refusal: 'non_string_content',
    body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }] },
  },
  {
    name: 'a parameter it would have to ignore (stop)',
    refusal: 'unsupported_parameter',
    body: { messages: [USER], stop: ['\n'] },
  },
  {
    name: 'a temperature it cannot use',
    refusal: 'invalid_parameter',
    body: { messages: [USER], temperature: 3 },
  },
];

function refusalOf(body: unknown) {
  const planned = planWorkersAiChatFallback(body);
  if (planned.ok) throw new Error('expected a refusal');
  return { refusal: planned.refusal, parameter: planned.parameter };
}

function planOf(body: unknown) {
  const planned = planWorkersAiChatFallback(body);
  if (!planned.ok) throw new Error(`refused: ${planned.refusal} ${planned.parameter ?? ''}`);
  return planned.plan;
}

describe('Workers AI fallback (SW0a-11)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('planWorkersAiChatFallback: what it will answer', () => {
    it.each(REFUSED_REQUESTS)('refuses a request with $name', ({ body, refusal }) => {
      expect(refusalOf(body).refusal).toBe(refusal);
    });

    it('refuses the older spellings of a tool call and a tool conversation', () => {
      expect(refusalOf({ messages: [USER], functions: [{ name: 'f' }] }).refusal).toBe('tools');
      expect(refusalOf({ messages: [USER], function_call: 'auto' }).refusal).toBe('tool_choice');
      expect(refusalOf({ messages: [USER, { role: 'tool', tool_call_id: 'call_1', content: 'result' }] }).refusal).toBe('tools');
    });

    it('refuses null content, a message that is not an object, and an empty request', () => {
      expect(refusalOf({ messages: [{ role: 'assistant', content: null }] }).refusal).toBe('non_string_content');
      expect(refusalOf({ messages: ['Ping'] }).refusal).toBe('malformed_message');
      expect(refusalOf({}).refusal).toBe('no_messages');
      expect(refusalOf('not json').refusal).toBe('no_messages');
    });

    it('refuses a bare prompt: the chat path takes messages', () => {
      expect(refusalOf({ prompt: 'Explain quantum computing in one sentence' })).toEqual({ refusal: 'no_messages', parameter: null });
      expect(refusalOf({ messages: [], prompt: 'Ping' }).refusal).toBe('no_messages');
      expect(refusalOf({ messages: [USER], prompt: 'Ping' })).toEqual({ refusal: 'unsupported_parameter', parameter: 'prompt' });
    });

    it.each(['stop', 'logprobs', 'top_logprobs', 'logit_bias', 'frequency_penalty', 'presence_penalty', 'stream_options'])(
      'refuses %s: it would be accepted and then ignored',
      field => {
        const value = field === 'stop' ? ['END'] : field === 'logit_bias' ? { 50256: -100 } : field === 'stream_options' ? { include_usage: true } : 1;
        expect(refusalOf({ messages: [USER], [field]: value })).toEqual({ refusal: 'unsupported_parameter', parameter: field });
      },
    );

    it('refuses a field it has never heard of, and does not repeat its name', () => {
      expect(refusalOf({ messages: [USER], [PROMPT]: true })).toEqual({ refusal: 'unsupported_parameter', parameter: 'other' });
    });

    it('lets through the fields that change nothing: model, user, n of 1, and nulls', () => {
      const plan = planOf({ model: 'llama-3.3-70b-versatile', messages: [USER], user: 'tg_999', n: 1, stop: null, response_format: null });
      expect(plan.messages).toEqual([USER]);
      expect(refusalOf({ messages: [USER], n: 2 })).toEqual({ refusal: 'invalid_parameter', parameter: 'n' });
    });

    it('forwards top_p and seed when they are valid, and refuses them when they are not', () => {
      const plan = planOf({ messages: [USER], top_p: 0.9, seed: 42 });
      expect(plan.topP).toBe(0.9);
      expect(plan.seed).toBe(42);
      const plain = planOf({ messages: [USER] });
      expect('topP' in plain).toBe(false);
      expect('seed' in plain).toBe(false);
      expect(refusalOf({ messages: [USER], top_p: 1.5 })).toEqual({ refusal: 'invalid_parameter', parameter: 'top_p' });
      expect(refusalOf({ messages: [USER], top_p: '0.9' })).toEqual({ refusal: 'invalid_parameter', parameter: 'top_p' });
      expect(refusalOf({ messages: [USER], seed: 1.5 })).toEqual({ refusal: 'invalid_parameter', parameter: 'seed' });
    });

    it('streams only for a boolean true', () => {
      expect(planOf({ messages: [USER], stream: true }).stream).toBe(true);
      expect(planOf({ messages: [USER], stream: false }).stream).toBe(false);
      expect(planOf({ messages: [USER] }).stream).toBe(false);
      expect(refusalOf({ messages: [USER], stream: 'false' })).toEqual({ refusal: 'invalid_parameter', parameter: 'stream' });
      expect(refusalOf({ messages: [USER], stream: 'true' })).toEqual({ refusal: 'invalid_parameter', parameter: 'stream' });
      expect(refusalOf({ messages: [USER], stream: 1 })).toEqual({ refusal: 'invalid_parameter', parameter: 'stream' });
    });

    it('passes a temperature from 0 to 2, uses the default when none is sent, and refuses any other', () => {
      expect(planOf({ messages: [USER], temperature: 0.2 }).temperature).toBe(0.2);
      expect(planOf({ messages: [USER], temperature: 0 }).temperature).toBe(0);
      expect(planOf({ messages: [USER], temperature: 2 }).temperature).toBe(2);
      expect(planOf({ messages: [USER] }).temperature).toBe(0.7);
      expect(planOf({ messages: [USER], temperature: null }).temperature).toBe(0.7);
      for (const temperature of [2.5, -1, '0.2', Number.NaN]) {
        expect(refusalOf({ messages: [USER], temperature })).toEqual({ refusal: 'invalid_parameter', parameter: 'temperature' });
      }
    });

    it('passes the caller max_tokens, capped at what the fallback allows', () => {
      expect(planOf({ messages: [USER], max_tokens: 256 }).maxTokens).toBe(256);
      expect(planOf({ messages: [USER], max_completion_tokens: 300 }).maxTokens).toBe(300);
      expect(planOf({ messages: [USER], max_tokens: 999_999 }).maxTokens).toBe(WORKERS_AI_FALLBACK_MAX_TOKENS);
      expect(planOf({ messages: [USER] }).maxTokens).toBe(WORKERS_AI_FALLBACK_MAX_TOKENS);
      expect(refusalOf({ messages: [USER], max_tokens: 0 })).toEqual({ refusal: 'invalid_parameter', parameter: 'max_tokens' });
      expect(refusalOf({ messages: [USER], max_tokens: '256' })).toEqual({ refusal: 'invalid_parameter', parameter: 'max_tokens' });
    });

    describe('the prompt budget', () => {
      it('accepts a prompt exactly at the budget and keeps every message whole', () => {
        const messages = [
          { role: 'system', content: 'a'.repeat(WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET - 1) },
          { role: 'user', content: 'b' },
        ];
        expect(planOf({ messages }).messages).toEqual(messages);
      });

      it('weighs a character by its UTF-8 bytes: 1 for ASCII, 2 to 4 for anything else', () => {
        expect(promptBudgetUnits('a')).toBe(1);
        expect(promptBudgetUnits('é')).toBe(2); // e with an acute accent
        expect(promptBudgetUnits('漢')).toBe(3); // a CJK character
        expect(promptBudgetUnits('\u{1F600}')).toBe(4); // an emoji
        expect(promptBudgetUnits('aé漢\u{1F600}')).toBe(10);
      });

      it('refuses CJK text that would pass if characters were counted', () => {
        const cjk = '漢';
        const fits = Math.floor(WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET / 3);
        expect(planWorkersAiChatFallback({ messages: [{ role: 'user', content: cjk.repeat(fits) }] }).ok).toBe(true);

        // One more character goes over the budget, at a third of the budget in characters.
        const over = planWorkersAiChatFallback({ messages: [{ role: 'user', content: cjk.repeat(fits + 1) }] });
        expect(over.ok).toBe(true);
        if (!over.ok) return;
        expect(over.plan.messages[0].content).toBe(cjk.repeat(fits));
        expect(over.prompt.units).toBeLessThanOrEqual(WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET);
        expect(fits + 1).toBeLessThan(WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET / 2);
      });

      it('reports the size of the prompt with any refusal', () => {
        const planned = planWorkersAiChatFallback({
          messages: [{ role: 'system', content: 'abc' }, { role: 'user', content: '漢漢' }],
          response_format: { type: 'json_object' },
        });
        expect(planned).toMatchObject({ ok: false, refusal: 'response_format', prompt: { chars: 5, units: 9 } });
      });
    });
  });

  describe('usage and finish reason', () => {
    it('reads the usage the binding reports', () => {
      expect(readBindingUsage({ usage: { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 } })).toEqual({
        prompt_tokens: 21,
        completion_tokens: 8,
        total_tokens: 29,
      });
      expect(readBindingUsage({ response: 'no usage' })).toBeNull();
    });

    it('treats all zeros as not reported', () => {
      expect(readBindingUsage({ usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })).toBeNull();
    });

    it('says length when the reported completion tokens reached the cap', () => {
      const usage = (completion_tokens: number) => ({ prompt_tokens: 10, completion_tokens, total_tokens: 10 + completion_tokens });
      expect(fallbackFinishReason(usage(2048), 2048)).toBe('length');
      expect(fallbackFinishReason(usage(2047), 2048)).toBe('stop');
      expect(fallbackFinishReason(usage(256), 256)).toBe('length');
    });

    it('says length only on evidence: with no usage reported it is stop', () => {
      expect(fallbackFinishReason(null, 2048)).toBe('stop');
      expect(fallbackFinishReason(null, 1)).toBe('stop');
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

      expect(capturedModel).toBe('@cf/meta/llama-3.1-8b-instruct-fast');
      // The caller asked for 0.5. It used to be overwritten with 0.7.
      expect(capturedInput).toEqual({
        messages: [{ role: 'user', content: 'What is the capital of France?' }],
        temperature: 0.5,
        max_tokens: 2048,
        stream: false,
      });

      expect(result.id).toMatch(/^chatcmpl-cf-\d+$/);
      expect(result.object).toBe('chat.completion');
      expect(typeof result.created).toBe('number');
      expect(result.model).toBe('@cf/meta/llama-3.1-8b-instruct-fast');
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
        model: '@cf/meta/llama-3.1-8b-instruct-fast',
        reason: 'upstream_5xx',
      });
    });

    it('forwards top_p and seed to the binding when the caller sent them', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = { run: vi.fn().mockResolvedValue({ response: 'ok' }) };

      await runWorkersAiChatFallback(mockAi, { messages: [USER], top_p: 0.9, seed: 42 }, { reason: 'network_error' });

      expect((mockAi.run as any).mock.calls[0][1]).toMatchObject({ top_p: 0.9, seed: 42 });
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
      const events = answerEvents(log);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 });
    });

    it.each([
      { name: 'none', bindingResult: { response: 'Paris.' } },
      { name: 'all zeros', bindingResult: { response: 'Paris.', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } } },
    ])('leaves usage out when the binding reported $name', async ({ bindingResult }) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = { run: vi.fn().mockResolvedValue(bindingResult) };

      const result = jsonAnswer(
        await runWorkersAiChatFallback(mockAi, { messages: [{ role: 'user', content: PROMPT }] }, { reason: 'network_error' }),
      );

      expect('usage' in result).toBe(false);
      const events = answerEvents(log);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ prompt_tokens: null, completion_tokens: null, total_tokens: null });
    });

    it('says finish_reason length when the reply was cut off at the cap', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = {
        run: vi.fn().mockResolvedValue({
          response: 'A reply that stops mid',
          usage: { prompt_tokens: 30, completion_tokens: 2048, total_tokens: 2078 },
        }),
      };

      // The client asks for 4096; the fallback caps at 2048 and must say the reply hit that cap.
      const result = jsonAnswer(
        await runWorkersAiChatFallback(mockAi, { messages: [USER], max_tokens: 4096 }, { reason: 'upstream_5xx', upstreamStatus: 500 }),
      );

      expect((mockAi.run as any).mock.calls[0][1].max_tokens).toBe(2048);
      expect(result.choices[0].finish_reason).toBe('length');
      expect(answerEvents(log)[0]).toMatchObject({ finish_reason: 'length', usage: 'reported' });
    });

    it('does not raise a false alarm: a long reply with no usage reported is stop, and the event says why', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      // Far longer than the cap in characters. Length in characters is not evidence of a cut.
      const long: Ai = { run: vi.fn().mockResolvedValue({ response: 'x'.repeat(WORKERS_AI_FALLBACK_MAX_TOKENS * 10) }) };

      const reply = jsonAnswer(await runWorkersAiChatFallback(long, { messages: [USER] }, { reason: 'network_error' }));

      expect(reply.choices[0].finish_reason).toBe('stop');
      expect(answerEvents(log)[0]).toMatchObject({ finish_reason: 'stop', usage: 'none' });
    });

    it('does the same for a long stream with no usage reported', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = {
        run: vi.fn().mockResolvedValue(sseStream([JSON.stringify({ response: 'x'.repeat(WORKERS_AI_FALLBACK_MAX_TOKENS * 10) }), '[DONE]'])),
      };

      const stream = streamAnswer(await runWorkersAiChatFallback(mockAi, { messages: [USER], stream: true }, { reason: 'network_error' }));
      const parsedChunks = sseChunks(await readAll(stream));

      expect(parsedChunks[parsedChunks.length - 1].choices[0].finish_reason).toBe('stop');
      expect(answerEvents(log)[0]).toMatchObject({ finish_reason: 'stop', usage: 'none' });
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

      const events = answerEvents(log);
      expect(events).toHaveLength(1);
      // The whole event is these fields. None of them can hold a prompt or an identity.
      expect(events[0]).toEqual({
        event: 'workers_ai_fallback_answer',
        provider: 'workers-ai',
        model: '@cf/meta/llama-3.1-8b-instruct-fast',
        reason: 'upstream_5xx',
        upstream_status: 502,
        stream: false,
        finish_reason: 'stop',
        usage: 'reported',
        prompt_tokens: 12,
        completion_tokens: 30,
        total_tokens: 42,
      });
      expect(refusedEvents(log)).toHaveLength(0);
      expect(failedEvents(log)).toHaveLength(0);
      expect(everythingLogged(log)).not.toContain(PROMPT);
      expect(everythingLogged(log)).not.toContain('tg_999');
    });

    it.each(REFUSED_REQUESTS)('does not call the binding for a request with $name', async ({ body, refusal }) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = { run: vi.fn().mockResolvedValue({ response: 'Should not be called' }) };

      const outcome = await runWorkersAiChatFallback(mockAi, body, { reason: 'upstream_5xx', upstreamStatus: 500 });

      expect(outcome).toEqual({ answered: false, refusal });
      expect(mockAi.run).not.toHaveBeenCalled();
      expect(answerEvents(log)).toHaveLength(0);
      expect(refusedEvents(log)).toHaveLength(1);
      expect(refusedEvents(log)[0].refusal).toBe(refusal);
    });

    it('truncates a prompt over the budget and still calls the binding, with no prompt text in the log', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const run = vi.fn().mockResolvedValue({ response: 'short answer' });
      const mockAi: Ai = { run };
      const long = `${PROMPT} `.repeat(200);

      const outcome = await runWorkersAiChatFallback(
        mockAi,
        { messages: [{ role: 'system', content: long }, { role: 'user', content: PROMPT }], user: 'tg_999' },
        { reason: 'upstream_5xx', upstreamStatus: 503 },
      );

      expect(outcome.answered).toBe(true);
      expect(refusedEvents(log)).toHaveLength(0);
      expect(run).toHaveBeenCalledTimes(1);
      const sent = run.mock.calls[0][1] as { messages: Array<{ content: string }> };
      const units = sent.messages.reduce((sum, message) => sum + new TextEncoder().encode(message.content).length, 0);
      expect(units).toBeLessThanOrEqual(WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET);
      expect(everythingLogged(log)).not.toContain(PROMPT);
      expect(everythingLogged(log)).not.toContain('tg_999');
    });

    it('names the refused parameter only when it is a known one', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = { run: vi.fn() };

      await runWorkersAiChatFallback(mockAi, { messages: [USER], stop: ['END'] }, { reason: 'network_error' });
      await runWorkersAiChatFallback(mockAi, { messages: [USER], [PROMPT]: 'x' }, { reason: 'network_error' });

      expect(refusedEvents(log).map(e => [e.refusal, e.parameter])).toEqual([
        ['unsupported_parameter', 'stop'],
        ['unsupported_parameter', 'other'],
      ]);
      expect(everythingLogged(log)).not.toContain(PROMPT);
    });

    it('throws instead of answering when the binding returns no text, and logs a failure', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = { run: vi.fn().mockResolvedValue({ tool_calls: [] }) };

      await expect(
        runWorkersAiChatFallback(mockAi, { messages: [USER] }, { reason: 'network_error' }),
      ).rejects.toBeInstanceOf(WorkersAiFallbackFailedError);

      expect(answerEvents(log)).toHaveLength(0);
      expect(failedEvents(log)).toEqual([
        {
          event: 'workers_ai_fallback_failed',
          provider: 'workers-ai',
          model: '@cf/meta/llama-3.1-8b-instruct-fast',
          reason: 'network_error',
          upstream_status: null,
          stream: false,
          failure: 'no_text',
          text_sent: false,
          error: 'no text',
        },
      ]);
    });

    it('logs a failure when the binding throws', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = { run: vi.fn().mockRejectedValue(new Error('binding down')) };

      await expect(
        runWorkersAiChatFallback(mockAi, { messages: [USER] }, { reason: 'upstream_5xx', upstreamStatus: 500 }),
      ).rejects.toMatchObject({ failure: 'binding_error' });

      expect(answerEvents(log)).toHaveLength(0);
      expect(failedEvents(log)).toHaveLength(1);
      expect(failedEvents(log)[0]).toMatchObject({ failure: 'binding_error', text_sent: false, error: 'binding down' });
      expect(everythingLogged(log)).not.toContain(PROMPT);
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
      expect(parsedChunks[0].model).toBe('@cf/meta/llama-3.1-8b-instruct-fast');
      expect(parsedChunks[0].choices[0].delta.content).toBe('Edge');
      expect(parsedChunks[1].choices[0].delta.content).toBe(' AI');
      expect(parsedChunks[2].choices[0].finish_reason).toBe('stop');
      // The binding reported no usage on this stream, so none is claimed.
      expect('usage' in parsedChunks[2]).toBe(false);

      const events = answerEvents(log);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ stream: true, reason: 'upstream_5xx', finish_reason: 'stop', prompt_tokens: null, completion_tokens: null });
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
      const parsedChunks = sseChunks(await readAll(stream));

      expect(parsedChunks).toHaveLength(2);
      expect(parsedChunks[0].choices[0].delta.content).toBe('Edge');
      expect(parsedChunks[1].choices[0].finish_reason).toBe('stop');
      expect(parsedChunks[1].usage).toEqual({ prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 });

      const events = answerEvents(log);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ stream: true, prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 });
      expect(everythingLogged(log)).not.toContain(PROMPT);
    });

    it('ends a stream with finish_reason length when it was cut off at the cap', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAiStream: Ai = {
        async run(_model: string, _input: any) {
          return sseStream([
            '{"response":"A reply that stops mid"}',
            '{"response":"","usage":{"prompt_tokens":30,"completion_tokens":2048,"total_tokens":2078}}',
            '[DONE]',
          ]);
        },
      };

      const stream = streamAnswer(
        await runWorkersAiChatFallback(mockAiStream, { messages: [USER], stream: true, max_tokens: 4096 }, { reason: 'network_error' }),
      );
      const parsedChunks = sseChunks(await readAll(stream));

      expect(parsedChunks[parsedChunks.length - 1].choices[0].finish_reason).toBe('length');
      expect(answerEvents(log)[0]).toMatchObject({ finish_reason: 'length' });
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

    it.each([
      { name: 'ends with no text', makeStream: () => sseStream(['{"response":""}', '[DONE]']), failure: 'no_text' },
      { name: 'is empty', makeStream: () => sseStream([]), failure: 'no_text' },
      { name: 'breaks before any text', makeStream: () => brokenSseStream([]), failure: 'stream_error' },
    ])('does not answer when the binding stream $name', async ({ makeStream, failure }) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = { run: vi.fn().mockResolvedValue(makeStream()) };

      await expect(
        runWorkersAiChatFallback(mockAi, { messages: [USER], stream: true }, { reason: 'upstream_5xx', upstreamStatus: 503 }),
      ).rejects.toMatchObject({ failure });

      expect(answerEvents(log)).toHaveLength(0);
      expect(failedEvents(log)).toHaveLength(1);
      expect(failedEvents(log)[0]).toMatchObject({ stream: true, failure, text_sent: false });
    });

    it('errors the stream and logs a failure, not an answer, when the binding breaks part-way', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAi: Ai = { run: vi.fn().mockResolvedValue(brokenSseStream(['{"response":"Half an"}'])) };

      const stream = streamAnswer(
        await runWorkersAiChatFallback(mockAi, { messages: [USER], stream: true }, { reason: 'network_error' }),
      );

      await expect(readAll(stream)).rejects.toThrow('binding stream broke');
      expect(answerEvents(log)).toHaveLength(0);
      expect(failedEvents(log)).toHaveLength(1);
      expect(failedEvents(log)[0]).toMatchObject({ stream: true, failure: 'stream_error', text_sent: true });
    });
  });

  describe('providerRelay: when the fallback may answer', () => {
    const originalFetch = globalThis.fetch;
    let kv: any;
    let validInitData: string;
    let log: ReturnType<typeof vi.spyOn>;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      kv = createMockKv();
      validInitData = signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 999, first_name: 'EdgeTester' }),
      });
      log = vi.spyOn(console, 'log').mockImplementation(() => {});
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    const createTestEnv = (overrides: Partial<Env> = {}): Env => ({
      ASSETS: { fetch: vi.fn() } as any,
      WEBAPP_URL: 'https://luminarasuite.com',
      LUMINARA_KV: kv, DAILY_QUOTA: memoryDailyQuotaNamespace(),
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

    /**
     * A signed-in hosted-key request. It asks for a fallback answer by default, as the app's chat
     * does; pass `acceptFallback: null` for a caller that does not ask, or another string to send
     * that value.
     */
    const hostedRequest = (
      providerId: string,
      subPath: string,
      body: unknown,
      method = 'POST',
      acceptFallback: string | null = '1',
    ) =>
      new Request(`https://luminarasuite.com/api/providers/${providerId}${subPath}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': validInitData,
          ...(acceptFallback === null ? {} : { [ACCEPT_FALLBACK_HEADER]: acceptFallback }),
        },
        body: method === 'GET' ? undefined : JSON.stringify(body),
      });

    const byokRequest = (body: unknown) =>
      new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-provider-key': 'gsk_custom_user_key',
        },
        body: JSON.stringify(body),
      });

    const upstreamError = (status: number) =>
      new Response(JSON.stringify({ error: { message: `upstream said ${status}` } }), {
        status,
        headers: { 'content-type': 'application/json', 'retry-after': '7' },
      });

    const callGroq = (env: Env, body: unknown = chatBody(), acceptFallback: string | null = '1') =>
      proxyProvider(hostedRequest('groq', '/chat/completions', body, 'POST', acceptFallback), env, 'groq', '/chat/completions');

    /** The structured lines the relay itself writes with console.warn, parsed. */
    const relayWarnings = (name: string) => eventsNamed(warn, name);

    describe('hosted groq chat falls back without a request header', () => {
      it.each([null, '0', 'true', ''])('answers an upstream 503 when the header is %j', async header => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const mockAi = answeringAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody(), header);

        expect(res.status).toBe(200);
        expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
        expect(res.headers.get('x-quota-refunded')).toBeNull();
        expect(mockAi.run).toHaveBeenCalledTimes(1);
      });

      it('answers a network throw when the header is absent', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection reset by peer'));
        const mockAi = answeringAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody(), null);

        expect(res.status).toBe(200);
        expect(res.headers.get('x-provider-fallback-reason')).toBe('network_error');
        expect(mockAi.run).toHaveBeenCalledTimes(1);
      });

      it('answers when no Groq key is configured and the header is absent', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('the upstream must not be called'));
        const mockAi = answeringAi('Handled when no Groq key configured');

        const res = await callGroq(
          createTestEnv({ AI: mockAi, GROQ_API_KEY: undefined, GROQ_API_KEY_FALLBACK: undefined }),
          chatBody(),
          null,
        );

        expect(res.status).toBe(200);
        expect(res.headers.get('x-provider-fallback-reason')).toBe('provider_not_configured');
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(((await res.json()) as any).choices[0].message.content).toBe('Handled when no Groq key configured');
      });

      it('streams a fallback when the header is absent', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const mockAi: Ai = { run: vi.fn().mockResolvedValue(sseStream(['{"response":"Streamed"}', '[DONE]'])) };

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody({ stream: true }), null);

        expect(res.status).toBe(200);
        expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
        expect(mockAi.run).toHaveBeenCalledTimes(1);
      });
    });

    describe('hosted groq chat falls through on a model rejection', () => {
      it.each([400, 404, 408])('answers an upstream %i with the backup model', async (status) => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(status));
        const mockAi = answeringAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }));

        expect(res.status).toBe(200);
        expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
        expect(res.headers.get('x-provider-fallback-reason')).toBe('upstream_4xx');
        expect(mockAi.run).toHaveBeenCalledTimes(1);
      });
    });

    describe('never on a body or validation error', () => {
      it.each([413, 422])(
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
          expect(log.mock.calls).toHaveLength(0);
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

      /** An upstream error body whose message quotes the request and part of a key, as some providers do. */
      const tellingUpstream = (status: number, error: Record<string, unknown>, contentType = 'application/json') =>
        new Response(JSON.stringify({ error }), { status, headers: { 'content-type': contentType } });
      const LEAKY_MESSAGE = `Incorrect API key provided: gsk_primary_test_key. Request was: ${PROMPT}`;

      it('reports a hosted-key upstream 401 as the provider refusing our key, not as the caller sign-in', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
          tellingUpstream(401, { message: LEAKY_MESSAGE, type: 'invalid_request_error', code: 'invalid_api_key' }),
        );
        const mockAi = answeringAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody({ messages: [{ role: 'user', content: PROMPT }] }));

        // A 401 or 403 from this route makes the client stop calling every hosted provider.
        // The upstream refusing the server's key is not the caller's session failing.
        expect(res.status).toBe(503);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        const data = (await res.json()) as any;
        expect(data.code).toBe('HOSTED_PROVIDER_KEY_REFUSED');
        expect(data.error).toMatch(/refused the hosted key/);
        expect(data.provider).toBe('groq');
        expect(data.upstreamStatus).toBe(401);
        expect(JSON.stringify(data)).not.toContain('gsk_primary_test_key');
        expect(mockAi.run).not.toHaveBeenCalled();

        // The upstream's body is not dropped silently: its status and its own code and type are logged.
        expect(relayWarnings('hosted_provider_refused')).toEqual([
          {
            event: 'hosted_provider_refused',
            provider: 'groq',
            upstream_status: 401,
            upstream_error_code: 'invalid_api_key',
            upstream_error_type: 'invalid_request_error',
            upstream_error_status: null,
          },
        ]);
        // Never its message: that is where a provider quotes the request or part of a key.
        expect(everythingLogged(warn)).not.toContain(PROMPT);
        expect(everythingLogged(warn)).not.toContain('gsk_primary_test_key');
      });

      it('reports a hosted-key upstream 403 as the request being refused, and claims no cause', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
          tellingUpstream(403, { message: `Content flagged: ${PROMPT}`, status: 'PERMISSION_DENIED', code: 403 }),
        );
        const mockAi = answeringAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody({ messages: [{ role: 'user', content: PROMPT }] }));

        expect(res.status).toBe(503);
        const data = (await res.json()) as any;
        expect(data.code).toBe('HOSTED_PROVIDER_REQUEST_REFUSED');
        // It says what is known. It does not say the key was refused: a 403 can be about the request.
        expect(data.error).toMatch(/refused this request/);
        expect(data.error).not.toMatch(/key was refused|refused the hosted key/);
        expect(data.error).toMatch(/not a problem with your sign-in/);
        expect(data.upstreamStatus).toBe(403);
        expect(mockAi.run).not.toHaveBeenCalled();

        expect(relayWarnings('hosted_provider_refused')).toEqual([
          {
            event: 'hosted_provider_refused',
            provider: 'groq',
            upstream_status: 403,
            upstream_error_code: '403',
            upstream_error_type: null,
            upstream_error_status: 'PERMISSION_DENIED',
          },
        ]);
        expect(everythingLogged(warn)).not.toContain(PROMPT);
      });

      it('labels its own body as JSON when the upstream sent an HTML refusal', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(`<html><body>Forbidden ${PROMPT}</body></html>`, { status: 403, headers: { 'content-type': 'text/html' } }),
        );

        const res = await callGroq(createTestEnv({ AI: answeringAi() }));

        expect(res.status).toBe(503);
        expect(res.headers.get('content-type')).toContain('application/json');
        expect(((await res.json()) as any).code).toBe('HOSTED_PROVIDER_REQUEST_REFUSED');
        expect(relayWarnings('hosted_provider_refused')[0]).toMatchObject({
          upstream_status: 403,
          upstream_error_code: null,
          upstream_error_type: null,
        });
        expect(everythingLogged(warn)).not.toContain(PROMPT);
      });

      it('keeps only short identifiers from an upstream error body', () => {
        expect(upstreamErrorExcerpt(JSON.stringify({ error: { code: 'rate_limit_exceeded', type: 'tokens', message: 'free text' } }))).toEqual({
          code: 'rate_limit_exceeded',
          type: 'tokens',
          status: null,
        });
        // Free text, an over-long value and a nested object are not identifiers.
        expect(
          upstreamErrorExcerpt(JSON.stringify({ error: { code: `said ${PROMPT}`, type: 'x'.repeat(65), status: { a: 1 } } })),
        ).toEqual({ code: null, type: null, status: null });
        // A provider that puts the fields at the top level, and a body that is not JSON.
        expect(upstreamErrorExcerpt(JSON.stringify({ code: 'forbidden', error: 'a sentence, not an object' }))).toEqual({
          code: 'forbidden',
          type: null,
          status: null,
        });
        expect(upstreamErrorExcerpt('<html>Forbidden</html>')).toEqual({ code: null, type: null, status: null });
      });

      it.each([401, 403])('passes a BYOK %i through: it is the caller key', async status => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(status));
        const mockAi = answeringAi();

        const res = await proxyProvider(byokRequest(chatBody()), createTestEnv({ AI: mockAi }), 'groq', '/chat/completions');

        expect(res.status).toBe(status);
        expect(await res.json()).toEqual({ error: { message: `upstream said ${status}` } });
        expect(mockAi.run).not.toHaveBeenCalled();
        expect(relayWarnings('hosted_provider_refused')).toHaveLength(0);
      });

      it('still answers 401 itself when the caller is not signed in', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('the upstream must not be called'));

        const res = await proxyProvider(
          new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(chatBody()),
          }),
          createTestEnv({ AI: answeringAi() }),
          'groq',
          '/chat/completions',
        );

        expect(res.status).toBe(401);
        expect(((await res.json()) as any).code).toBe('AUTH_REQUIRED');
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

      it('tries the fallback key after a 500, then Workers AI when that key fails too', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(upstreamError(500)).mockResolvedValueOnce(upstreamError(500));
        globalThis.fetch = fetchMock;
        const mockAi = answeringAi('Recovered after both Groq keys');

        const res = await callGroq(createTestEnv({ AI: mockAi, GROQ_API_KEY_FALLBACK: 'gsk_second_test_key' }), chatBody(), null);

        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const secondHeaders = fetchMock.mock.calls[1][1].headers as Headers;
        expect(secondHeaders.get('Authorization')).toBe('Bearer gsk_second_test_key');
        expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
        expect(res.headers.get('x-provider-fallback-reason')).toBe('upstream_5xx');
        expect(res.headers.get('x-quota-refunded')).toBeNull();
        expect(((await res.json()) as any).choices[0].message.content).toBe('Recovered after both Groq keys');
        expect(mockAi.run).toHaveBeenCalledTimes(1);
      });

      it('returns 503 and refunds the quota when the fallback key and Workers AI both fail', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(upstreamError(500)).mockResolvedValueOnce(upstreamError(500));
        globalThis.fetch = fetchMock;
        const mockAi: Ai = { run: vi.fn().mockRejectedValue(new Error('binding down')) };

        const res = await callGroq(createTestEnv({ AI: mockAi, GROQ_API_KEY_FALLBACK: 'gsk_second_test_key' }), chatBody(), null);

        expect(res.status).toBe(503);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(mockAi.run).toHaveBeenCalledTimes(1);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(res.headers.get('x-quota-refunded')).toBe('1');
        expect(await res.json()).toEqual({ error: 'The backup model did not answer.', code: 'BACKUP_MODEL_FAILED' });
      });

      it('returns 503 and refunds the quota when the binding is missing', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));

        const res = await callGroq(createTestEnv({ AI: undefined }), chatBody(), null);

        expect(res.status).toBe(503);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(res.headers.get('x-quota-refunded')).toBe('1');
        expect(await res.json()).toEqual({ error: { message: 'upstream said 503' } });
      });

      it('answers a 429 with Workers AI after the fallback key is also rate limited', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(upstreamError(429)).mockResolvedValueOnce(upstreamError(429));
        globalThis.fetch = fetchMock;
        const mockAi = answeringAi('Recovered after rate limits');

        const res = await callGroq(createTestEnv({ AI: mockAi, GROQ_API_KEY_FALLBACK: 'gsk_second_test_key' }), chatBody(), null);

        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(res.headers.get('x-provider-fallback-reason')).toBe('upstream_429');
        expect(((await res.json()) as any).x_fallback.reason).toBe('upstream_429');
        expect(mockAi.run).toHaveBeenCalledTimes(1);
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
        expect(data.model).toBe('@cf/meta/llama-3.1-8b-instruct-fast');
        expect(data.x_fallback).toEqual({ provider: 'workers-ai', model: '@cf/meta/llama-3.1-8b-instruct-fast', reason: 'upstream_5xx' });
        expect(data.choices[0].message.content).toBe(`Recovered via Workers AI on ${status}`);
        expect(mockAi.run).toHaveBeenCalledTimes(1);

        const events = answerEvents(log);
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
        expect(answerEvents(log)).toHaveLength(1);
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

      it('tells the caller when the reply was cut off at the fallback cap', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const mockAi: Ai = {
          run: vi.fn().mockResolvedValue({
            response: 'A reply that stops mid',
            usage: { prompt_tokens: 30, completion_tokens: 2048, total_tokens: 2078 },
          }),
        };

        // What the app's own client sends: max_tokens 4096.
        const data = (await (await callGroq(createTestEnv({ AI: mockAi }), chatBody({ max_tokens: 4096 }))).json()) as any;

        expect(data.choices[0].finish_reason).toBe('length');
      });

      it('returns the upstream error when the binding itself fails', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const mockAi: Ai = { run: vi.fn().mockRejectedValue(new Error('binding down')) };

        const res = await callGroq(createTestEnv({ AI: mockAi }));

        expect(res.status).toBe(503);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(res.headers.get('x-quota-refunded')).toBe('1');
        expect(await res.json()).toEqual({ error: 'The backup model did not answer.', code: 'BACKUP_MODEL_FAILED' });
        expect(answerEvents(log)).toHaveLength(0);
        expect(failedEvents(log)).toHaveLength(1);
        expect(failedEvents(log)[0]).toMatchObject({ error: 'binding down' });
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
      it.each(REFUSED_REQUESTS)('a request with $name gets the upstream 5xx, not an answer', async ({ body, refusal }) => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const mockAi = answeringAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody(body));

        expect(res.status).toBe(503);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(await res.json()).toEqual({ error: { message: 'upstream said 503' } });
        expect(mockAi.run).not.toHaveBeenCalled();
        expect(answerEvents(log)).toHaveLength(0);
        // The refusal is visible to whoever reads the logs: one line, with the rule.
        expect(refusedEvents(log)).toHaveLength(1);
        expect(refusedEvents(log)[0]).toMatchObject({ refusal, reason: 'upstream_5xx', upstream_status: 503 });
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
        expect(answerEvents(log)).toHaveLength(1);
      });

      it('streams the fallback answer after a network throw', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection reset by peer'));

        const res = await callGroq(createTestEnv({ AI: streamingAi() }), chatBody({ stream: true }));

        expect(res.status).toBe(200);
        expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
        expect(res.headers.get('x-provider-fallback-reason')).toBe('network_error');
        expect(await res.text()).toContain('"content":"fallback"');
      });

      it('streams the fallback answer on a 429', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(429));
        const mockAi = streamingAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody({ stream: true }), null);

        expect(res.status).toBe(200);
        expect(res.headers.get('x-provider-fallback-reason')).toBe('upstream_429');
        expect(mockAi.run).toHaveBeenCalledTimes(1);
      });

      it.each(REFUSED_REQUESTS)('refuses a streamed request with $name', async ({ body }) => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const mockAi = streamingAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody({ ...body, stream: true }));

        expect(res.status).toBe(503);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(mockAi.run).not.toHaveBeenCalled();
      });

      it('does not stream for the string "false": it refuses', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const mockAi = streamingAi();

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody({ stream: 'false' }));

        expect(res.status).toBe(503);
        expect(res.headers.get('content-type')).not.toContain('text/event-stream');
        expect(mockAi.run).not.toHaveBeenCalled();
        expect(refusedEvents(log)[0]).toMatchObject({ refusal: 'invalid_parameter', parameter: 'stream' });
      });

      it('returns the upstream error, not a labelled 200, when the fallback stream is empty', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(503));
        const mockAi: Ai = { run: vi.fn().mockResolvedValue(sseStream(['[DONE]'])) };

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody({ stream: true }));

        expect(res.status).toBe(503);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(res.headers.get('x-quota-refunded')).toBe('1');
        expect(await res.json()).toEqual({ error: 'The backup model did not answer.', code: 'BACKUP_MODEL_FAILED' });
        expect(answerEvents(log)).toHaveLength(0);
        expect(failedEvents(log)).toHaveLength(1);
        expect(failedEvents(log)[0]).toMatchObject({ failure: 'no_text', stream: true, error: 'Workers AI fallback failed: no_text' });
      });

      it('returns the connection error when the fallback stream breaks before any text', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection reset by peer'));
        const mockAi: Ai = { run: vi.fn().mockResolvedValue(brokenSseStream([])) };

        const res = await callGroq(createTestEnv({ AI: mockAi }), chatBody({ stream: true }));

        expect(res.status).toBe(503);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(res.headers.get('x-quota-refunded')).toBe('1');
        expect(await res.json()).toEqual({ error: 'The backup model did not answer.', code: 'BACKUP_MODEL_FAILED' });
        expect(answerEvents(log)).toHaveLength(0);
        expect(failedEvents(log)).toHaveLength(1);
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
        const res = await callGroq(
          createTestEnv({ AI: undefined, GROQ_API_KEY: undefined, GROQ_API_KEY_FALLBACK: undefined }),
          chatBody(),
          null,
        );

        expect(res.status).toBe(503);
        expect(res.headers.get('x-provider-fallback')).toBeNull();
        expect(res.headers.get('x-quota-refunded')).toBe('1');
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
        typesafe: {
          path: '/v1/systemone',
          keys: { TYPESAFE_API_KEY: 'ts_test_key' },
          body: { model: 'jev-latest', state: { pages: [] }, questions: { ping: { type: 'noul', instructions: 'ping' } } },
        },
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
        // Hosted NIM, Ollama and OpenRouter need a plan; DataForSEO needs Agency apiAccess. Agency
        // covers all of them, so each request gets as far as the upstream call.
        await kv.put('sub:999', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86_400_000 }));
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
        // Not answered, not refused, not failed: the fallback was never asked.
        expect(log.mock.calls).toHaveLength(0);
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

        const res = await proxyProvider(byokRequest(chatBody()), createTestEnv({ AI: mockAi }), 'groq', '/chat/completions');
        expect(res.status).toBe(402);
        const data = (await res.json()) as any;
        expect(data.code).toBe('BYOK_PAYMENT_REQUIRED');
        expect(mockAi.run).not.toHaveBeenCalled();
      });

      it.each([500, 503])('does not answer a BYOK request whose own key gets a %i', async status => {
        globalThis.fetch = vi.fn().mockResolvedValue(upstreamError(status));
        const mockAi = answeringAi('Should not be called');

        const res = await proxyProvider(byokRequest(chatBody()), createTestEnv({ AI: mockAi }), 'groq', '/chat/completions');
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

    it('lets a cross-origin client send the header that asks for a fallback answer', () => {
      const env = { WEBAPP_URL: 'https://luminarasuite.com' } as Env;
      const request = new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
        headers: { Origin: 'https://luminarasuite.com' },
      });
      const allowed = corsHeaders(env, request)['Access-Control-Allow-Headers'].split(',').map(h => h.trim());
      expect(allowed).toContain(ACCEPT_FALLBACK_HEADER);
    });
  });
});
