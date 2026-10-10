/**
 * SW0a-11, client side: a reply the Worker's fallback model wrote is labelled in the chat.
 * The marker travels: response headers -> GroqProvider -> StreamChunk / GenerateResult
 * -> Message.fallback (App.tsx) -> the line MessageList renders.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroqProvider, aiProviderService } from '../services/aiProviderService';
import { configService } from '../services/configService';
import { FALLBACK_ANSWER_LABEL, fallbackAnswerLine, readFallbackAnswer } from '../services/llm/fallbackAnswer';
import MessageList from '../components/MessageList';
import type { Message, StreamChunk } from '../types';

const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const FALLBACK_HEADERS = {
  'x-provider-fallback': 'workers-ai',
  'x-provider-fallback-model': MODEL,
  'x-provider-fallback-reason': 'upstream_5xx',
};

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

function jsonReply(headers: Record<string, string>, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function sseReply(headers: Record<string, string>, parts: string[]): Response {
  const payload = [
    ...parts.map(text => `data: ${JSON.stringify({ model: MODEL, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`),
    `data: ${JSON.stringify({ model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } });
}

describe('readFallbackAnswer', () => {
  it('reads the marker from the response headers', () => {
    expect(readFallbackAnswer(new Headers(FALLBACK_HEADERS))).toEqual({ model: MODEL, reason: 'upstream_5xx' });
  });

  it('returns undefined for a reply the asked engine wrote', () => {
    expect(readFallbackAnswer(new Headers({ 'content-type': 'application/json' }))).toBeUndefined();
    expect(readFallbackAnswer(new Headers(), { model: 'llama-3.3-70b-versatile', choices: [] })).toBeUndefined();
    expect(readFallbackAnswer(null)).toBeUndefined();
  });

  it('falls back to the JSON body field when the headers are not readable', () => {
    const body = { model: MODEL, x_fallback: { provider: 'workers-ai', model: MODEL, reason: 'network_error' } };
    expect(readFallbackAnswer(new Headers(), body)).toEqual({ model: MODEL, reason: 'network_error' });
  });

  it('still reports a fallback when only the first header arrived', () => {
    expect(readFallbackAnswer(new Headers({ 'x-provider-fallback': 'workers-ai' }))).toEqual({ model: '' });
  });
});

describe('fallbackAnswerLine', () => {
  it('says a fallback model answered and names it', () => {
    expect(fallbackAnswerLine({ model: MODEL, reason: 'upstream_5xx' })).toBe(`Answered by a fallback model: ${MODEL}`);
  });

  it('keeps the label when the Worker named no model', () => {
    expect(fallbackAnswerLine({ model: '' })).toBe(FALLBACK_ANSWER_LABEL);
  });

  it('is null for a reply that was not a fallback', () => {
    expect(fallbackAnswerLine(undefined)).toBeNull();
    expect(fallbackAnswerLine(null)).toBeNull();
  });
});

describe('GroqProvider surfaces the marker', () => {
  const originalFetch = globalThis.fetch;
  let provider: GroqProvider;

  beforeEach(() => {
    mockLocalStorage.clear();
    configService.setKey('luminara_groq_key', 'gsk_test_fallback_marker_key');
    provider = new GroqProvider();
    aiProviderService.clearCooldowns();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    mockLocalStorage.clear();
  });

  it('generateText: carries the marker on the result', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonReply(FALLBACK_HEADERS, {
        model: MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content: 'Fallback text' }, finish_reason: 'stop' }],
        x_fallback: { provider: 'workers-ai', model: MODEL, reason: 'upstream_5xx' },
      }),
    );

    const result = await provider.generateText('Ping');

    expect(result.text).toBe('Fallback text');
    expect(result.fallback).toEqual({ model: MODEL, reason: 'upstream_5xx' });
  });

  it('generateText: no marker on a reply Groq wrote', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonReply({}, {
        model: 'llama-3.3-70b-versatile',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Groq text' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    );

    const result = await provider.generateText('Ping');

    expect(result.text).toBe('Groq text');
    expect('fallback' in result).toBe(false);
  });

  it('streamText: the marker rides on the first chunk, read from the headers', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(sseReply(FALLBACK_HEADERS, ['Fallback ', 'stream']));

    const chunks: StreamChunk[] = [];
    for await (const chunk of provider.streamText('Ping')) chunks.push(chunk);

    expect(chunks).toEqual([
      { text: 'Fallback ', fallback: { model: MODEL, reason: 'upstream_5xx' } },
      { text: 'stream' },
    ]);
  });

  it('streamText: no marker on a stream Groq wrote', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(sseReply({}, ['Groq ', 'stream']));

    const chunks: StreamChunk[] = [];
    for await (const chunk of provider.streamText('Ping')) chunks.push(chunk);

    expect(chunks).toEqual([{ text: 'Groq ' }, { text: 'stream' }]);
  });

  it('the failover service the chat streams through passes the marker on', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(sseReply(FALLBACK_HEADERS, ['Fallback ', 'stream']));

    const chunks: StreamChunk[] = [];
    for await (const chunk of aiProviderService.streamWithFailover('Ping', { preferredProvider: 'groq' })) {
      chunks.push(chunk);
    }

    expect(chunks.map(c => c.text).join('')).toBe('Fallback stream');
    expect(chunks.find(c => c.fallback)?.fallback).toEqual({ model: MODEL, reason: 'upstream_5xx' });
  });
});

describe('the chat view shows who answered', () => {
  const reply = (extra: Partial<Message> = {}): Message => ({
    id: 'm1',
    role: 'model',
    content: 'A short answer.',
    timestamp: 1,
    ...extra,
  });
  const render = (messages: Message[]) => renderToStaticMarkup(createElement(MessageList, { messages }));

  it('renders the line and the model name with a fallback reply', () => {
    const html = render([reply({ fallback: { model: MODEL, reason: 'upstream_5xx' } })]);
    expect(html).toContain(`Answered by a fallback model: ${MODEL}`);
  });

  it('renders it while the reply is still streaming', () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        messages: [reply({ content: 'A sho', isStreaming: true, fallback: { model: MODEL } })],
        isThinking: true,
      }),
    );
    expect(html).toContain(`Answered by a fallback model: ${MODEL}`);
  });

  it('renders no such line for an ordinary reply, a user turn or an error notice', () => {
    expect(render([reply()])).not.toContain(FALLBACK_ANSWER_LABEL);
    expect(render([reply({ role: 'user', fallback: { model: MODEL } })])).not.toContain(FALLBACK_ANSWER_LABEL);
    expect(render([reply({ isError: true, fallback: { model: MODEL } })])).not.toContain(FALLBACK_ANSWER_LABEL);
  });

  it('App.tsx copies the marker from the stream onto the message (source-text check)', () => {
    // App.tsx cannot be rendered in this node setup, so this pins the two lines that join the
    // provider's chunk to the message the view above renders.
    const app = readFileSync(resolve(__dirname, '..', 'App.tsx'), 'utf8');
    expect(app).toContain('if (chunk.fallback) answeredByFallback = chunk.fallback;');
    expect(app.match(/fallback: answeredByFallback,/g)?.length).toBe(2);
  });
});
