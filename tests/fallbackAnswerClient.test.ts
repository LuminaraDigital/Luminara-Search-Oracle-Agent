/**
 * SW0a-11, client side: a reply the Worker's fallback model wrote is labelled in the chat, and
 * Instant Audit keeps the same reply.
 *
 * The marker travels: response headers -> GroqProvider -> StreamChunk -> streamQuery ->
 * the reply reducer (services/chat/streamedReply.ts) -> Message.fallback -> the MessageList line.
 * Hosted Groq calls keep a Workers AI reply and its marker. The chat shows the line.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroqProvider, aiProviderService } from '../services/aiProviderService';
import { configService } from '../services/configService';
import { geminiService } from '../services/geminiService';
import { tavilyService } from '../services/search/tavilyService';
import { agentMatrixService } from '../services/harness/agentMatrixService';
import {
  FALLBACK_ANSWER_CUT_OFF_NOTE,
  FALLBACK_ANSWER_LABEL,
  fallbackAnswerLine,
  readFallbackAnswer,
} from '../services/llm/fallbackAnswer';
import {
  INSIGHT_EXCERPT_CHARS,
  addStreamChunk,
  completeReply,
  newStreamedReply,
  replyIsMemorable,
  replyToMessage,
  showReplyProgress,
  type ReplyEffects,
  type ReplyInsight,
  type StreamedReply,
} from '../services/chat/streamedReply';
import MessageList from '../components/MessageList';
import { OracleMode, type Message, type StreamChunk } from '../types';

const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const FALLBACK_TEXT = 'Text only the fallback model wrote';
const FALLBACK_HEADERS = {
  'x-provider-fallback': 'workers-ai',
  'x-provider-fallback-model': MODEL,
  'x-provider-fallback-reason': 'upstream_5xx',
};
const MARKER = { model: MODEL, reason: 'upstream_5xx' };

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

function fallbackJsonReply(finishReason = 'stop'): Response {
  return jsonReply(FALLBACK_HEADERS, {
    model: MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content: FALLBACK_TEXT }, finish_reason: finishReason }],
    x_fallback: { provider: 'workers-ai', model: MODEL, reason: 'upstream_5xx' },
  });
}

function sseReply(headers: Record<string, string>, parts: string[], finishReason = 'stop'): Response {
  const payload = [
    ...parts.map(text => `data: ${JSON.stringify({ model: MODEL, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`),
    `data: ${JSON.stringify({ model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`,
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

/** Answers Groq calls with `groq()`, and every other host with a failure. */
function fetchWhereGroqAnswers(groq: () => Response, others: Record<string, () => Response> = {}) {
  return vi.fn(async (input: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? input);
    if (url.includes('api.groq.com')) return groq();
    for (const [host, reply] of Object.entries(others)) {
      if (url.includes(host)) return reply();
    }
    throw new Error(`no network in this test: ${url}`);
  });
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

/** What App.tsx does with one send: a new reply, every chunk folded in, the message at the end. */
function messageFromChunks(chunks: StreamChunk[], id = 'm1'): Message {
  let reply: StreamedReply = newStreamedReply();
  for (const chunk of chunks) reply = addStreamChunk(reply, chunk);
  const blank: Message = { id, role: 'model', content: '', timestamp: 1, isStreaming: true };
  return replyToMessage(blank, reply, { done: true });
}

const render = (messages: Message[]) => renderToStaticMarkup(createElement(MessageList, { messages }));

describe('readFallbackAnswer', () => {
  it('reads the marker from the response headers', () => {
    expect(readFallbackAnswer(new Headers(FALLBACK_HEADERS))).toEqual(MARKER);
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
    expect(fallbackAnswerLine(MARKER)).toBe(`Answered by a fallback model: ${MODEL}`);
  });

  it('adds that the answer may be cut short when the Worker reported it', () => {
    expect(fallbackAnswerLine({ ...MARKER, truncated: true })).toBe(
      `Answered by a fallback model: ${MODEL}. ${FALLBACK_ANSWER_CUT_OFF_NOTE}`,
    );
  });

  it('keeps the label when the Worker named no model', () => {
    expect(fallbackAnswerLine({ model: '' })).toBe(FALLBACK_ANSWER_LABEL);
  });

  it('is null for a reply that was not a fallback', () => {
    expect(fallbackAnswerLine(undefined)).toBeNull();
    expect(fallbackAnswerLine(null)).toBeNull();
  });
});

describe('the reply reducer (what App.tsx runs for every chunk)', () => {
  it('labels the message when a chunk carries the marker', () => {
    const message = messageFromChunks([{ text: 'Fallback ', fallback: MARKER }, { text: 'stream' }]);
    expect(message.content).toBe('Fallback stream');
    expect(message.fallback).toEqual(MARKER);
    expect(message.isStreaming).toBe(false);
  });

  it('leaves the message unlabelled when no chunk carries it', () => {
    const message = messageFromChunks([{ text: 'Groq ' }, { text: 'stream' }]);
    expect(message.content).toBe('Groq stream');
    expect(message.fallback).toBeUndefined();
  });

  it('does not label a second send after a fallback answer', () => {
    const first = messageFromChunks([{ text: 'From the fallback', fallback: MARKER }], 'm1');
    const second = messageFromChunks([{ text: 'From Groq' }], 'm2');
    expect(first.fallback).toEqual(MARKER);
    expect(second.fallback).toBeUndefined();
    expect(render([first, second]).split(FALLBACK_ANSWER_LABEL)).toHaveLength(2);
  });

  it('shows the marker from the first chunk on, while the reply is still streaming', () => {
    const blank: Message = { id: 'm1', role: 'model', content: '', timestamp: 1, isStreaming: true };
    const reply = addStreamChunk(newStreamedReply(), { text: 'Fal', fallback: MARKER });
    const shown = replyToMessage(blank, reply, { done: false });
    expect(shown.fallback).toEqual(MARKER);
    expect(shown.isStreaming).toBe(true);
  });

  it('takes a later marker over an earlier one, so a cut-off reply says so', () => {
    const message = messageFromChunks([
      { text: 'Half an answ', fallback: MARKER },
      { fallback: { ...MARKER, truncated: true }, finishReason: 'length' },
    ]);
    expect(message.fallback).toEqual({ ...MARKER, truncated: true });
    expect(render([message])).toContain(FALLBACK_ANSWER_CUT_OFF_NOTE);
  });

  it('keeps sources once each, tool runs in order, and the text whole', () => {
    const a = { uri: 'https://a.example', title: 'A' };
    const b = { uri: 'https://b.example', title: 'B' };
    const search = { tool: 'live_search', args: {}, output: 'Checked live search results' };
    const message = messageFromChunks([
      { toolExecution: search },
      { text: 'One ', groundingUrls: [a] },
      { text: 'two', groundingUrls: [a, b] },
    ]);
    expect(message.content).toBe('One two');
    expect(message.groundingUrls).toEqual([a, b]);
    expect(message.toolExecutions).toEqual([search]);
  });

  it('does not change the reply it is given', () => {
    const before = newStreamedReply();
    const after = addStreamChunk(before, { text: 'x', fallback: MARKER });
    expect(before).toEqual(newStreamedReply());
    expect(after).not.toBe(before);
  });

  it('writes "Stopped." only for a stopped reply with no text', () => {
    const blank: Message = { id: 'm1', role: 'model', content: '', timestamp: 1 };
    expect(replyToMessage(blank, newStreamedReply(), { done: true, stopped: true }).content).toBe('*Stopped.*');
    expect(replyToMessage(blank, newStreamedReply(), { done: true }).content).toBe('');
  });

  it('does not keep a fallback reply as a brand-memory insight', () => {
    const groq = addStreamChunk(newStreamedReply(), { text: 'From Groq' });
    const fallback = addStreamChunk(newStreamedReply(), { text: 'From the fallback', fallback: MARKER });
    expect(replyIsMemorable(groq, { stopped: false })).toBe(true);
    expect(replyIsMemorable(fallback, { stopped: false })).toBe(false);
    expect(replyIsMemorable(groq, { stopped: true })).toBe(false);
    expect(replyIsMemorable(groq, { stopped: false, skipSearch: true })).toBe(false);
  });

  describe('ending a reply: what is shown and what is remembered', () => {
    /** Stand-ins for the two things App.tsx lets a reply do: update its message, write to brand memory. */
    function fakeApp() {
      const state = {
        message: { id: 'm1', role: 'model', content: '', timestamp: 1, isStreaming: true } as Message,
        remembered: [] as ReplyInsight[],
      };
      const effects: ReplyEffects = {
        show: (update) => { state.message = update(state.message); },
        remember: (insight) => { state.remembered.push(insight); },
      };
      return { state, effects };
    }
    const replyFrom = (chunks: StreamChunk[]) => chunks.reduce(addStreamChunk, newStreamedReply());
    const ctx = { question: 'What should I fix first?', stopped: false };

    it('a fallback reply is shown with its label and is not saved to brand memory', () => {
      const { state, effects } = fakeApp();

      completeReply(replyFrom([{ text: 'From the fallback', fallback: MARKER }]), ctx, effects);

      expect(state.message.content).toBe('From the fallback');
      expect(state.message.isStreaming).toBe(false);
      expect(state.message.fallback).toEqual(MARKER);
      expect(render([state.message])).toContain(`Answered by a fallback model: ${MODEL}`);
      expect(state.remembered).toEqual([]);
    });

    it('a normal reply is saved and has no label', () => {
      const { state, effects } = fakeApp();

      completeReply(replyFrom([{ text: 'From Groq' }]), ctx, effects);

      expect(state.message.content).toBe('From Groq');
      expect(state.message.fallback).toBeUndefined();
      expect(render([state.message])).not.toContain(FALLBACK_ANSWER_LABEL);
      expect(state.remembered).toEqual([{ question: 'What should I fix first?', answerExcerpt: 'From Groq' }]);
    });

    it('keeps only an excerpt, and nothing for a stopped, empty or rewrite-only reply', () => {
      const long = fakeApp();
      completeReply(replyFrom([{ text: 'x'.repeat(INSIGHT_EXCERPT_CHARS + 500) }]), ctx, long.effects);
      expect(long.state.remembered[0].answerExcerpt).toHaveLength(INSIGHT_EXCERPT_CHARS);

      const stopped = fakeApp();
      completeReply(replyFrom([{ text: 'Half' }]), { ...ctx, stopped: true }, stopped.effects);
      expect(stopped.state.remembered).toEqual([]);
      expect(stopped.state.message.content).toBe('Half');

      const empty = fakeApp();
      completeReply(newStreamedReply(), { ...ctx, stopped: true }, empty.effects);
      expect(empty.state.message.content).toBe('*Stopped.*');
      expect(empty.state.remembered).toEqual([]);

      const rewrite = fakeApp();
      completeReply(replyFrom([{ text: 'Plain English version' }]), { ...ctx, skipSearch: true }, rewrite.effects);
      expect(rewrite.state.remembered).toEqual([]);
    });

    it('shows progress without ending the reply or remembering anything', () => {
      const { state, effects } = fakeApp();

      showReplyProgress(replyFrom([{ text: 'Fal', fallback: MARKER }]), effects);

      expect(state.message.content).toBe('Fal');
      expect(state.message.isStreaming).toBe(true);
      expect(state.message.fallback).toEqual(MARKER);
      expect(state.remembered).toEqual([]);
    });
  });

  it('App.tsx leaves both decisions to this module (source-text check)', () => {
    // App.tsx cannot be rendered in this node setup. The behaviour is tested above; this pins
    // that App.tsx only wires the two effects and calls in, and decides nothing itself.
    const app = readFileSync(resolve(__dirname, '..', 'App.tsx'), 'utf8');
    expect(app).toContain('let reply = newStreamedReply();');
    expect(app).toContain('reply = addStreamChunk(reply, chunk);');
    expect(app.match(/showReplyProgress\(reply, replyEffects\)/g)).toHaveLength(2);
    expect(app.match(/completeReply\(/g)).toHaveLength(1);
    // The one write to brand memory from the chat is the effect handed to completeReply.
    expect(app.match(/ingestChatInsight\(/g)).toHaveLength(1);
    expect(app).not.toContain('replyIsMemorable');
    expect(app).not.toContain('replyToMessage');
  });
});

describe('with a hosted Groq call the fallback answered', () => {
  const originalFetch = globalThis.fetch;
  let provider: GroqProvider;

  beforeEach(() => {
    mockLocalStorage.clear();
    configService.setKey('luminara_groq_key', 'gsk_test_fallback_marker_key');
    provider = new GroqProvider();
    aiProviderService.clearCooldowns();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    mockLocalStorage.clear();
    aiProviderService.clearCooldowns();
  });

  describe('GroqProvider', () => {
    it('generateText: keeps the text and the marker when the caller did not opt in', async () => {
      globalThis.fetch = fetchWhereGroqAnswers(() => fallbackJsonReply());

      const result = await provider.generateText('Ping');

      expect(result.text).toBe(FALLBACK_TEXT);
      expect(result.fallback).toEqual(MARKER);
    });

    it('generateText: with allowFallback, returns the text and the marker together', async () => {
      globalThis.fetch = fetchWhereGroqAnswers(() => fallbackJsonReply());

      const result = await provider.generateText('Ping', { allowFallback: true });

      expect(result.text).toBe(FALLBACK_TEXT);
      expect(result.fallback).toEqual(MARKER);
    });

    it('generateText: marks a fallback reply the Worker reported as cut off', async () => {
      globalThis.fetch = fetchWhereGroqAnswers(() => fallbackJsonReply('length'));

      const result = await provider.generateText('Ping', { allowFallback: true });

      expect(result.finishReason).toBe('length');
      expect(result.fallback).toEqual({ ...MARKER, truncated: true });
    });

    it('generateText: a reply Groq wrote has no marker and needs no opt-in', async () => {
      globalThis.fetch = fetchWhereGroqAnswers(() =>
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

    it('streamText: keeps the marker when the caller did not opt in', async () => {
      globalThis.fetch = fetchWhereGroqAnswers(() => sseReply(FALLBACK_HEADERS, ['Fallback ', 'stream']));

      const chunks = await collect(provider.streamText('Ping'));

      expect(chunks).toEqual([{ text: 'Fallback ', fallback: MARKER }, { text: 'stream' }]);
    });

    it('streamText: with allowFallback, the marker rides on the first chunk, read from the headers', async () => {
      globalThis.fetch = fetchWhereGroqAnswers(() => sseReply(FALLBACK_HEADERS, ['Fallback ', 'stream']));

      const chunks = await collect(provider.streamText('Ping', { allowFallback: true }));

      expect(chunks).toEqual([{ text: 'Fallback ', fallback: MARKER }, { text: 'stream' }]);
    });

    it('streamText: says so when the fallback stream ended at its length limit', async () => {
      globalThis.fetch = fetchWhereGroqAnswers(() => sseReply(FALLBACK_HEADERS, ['Half an answ'], 'length'));

      const chunks = await collect(provider.streamText('Ping', { allowFallback: true }));

      expect(chunks).toEqual([
        { text: 'Half an answ', fallback: MARKER },
        { fallback: { ...MARKER, truncated: true }, finishReason: 'length' },
      ]);
    });

    it('streamText: a stream Groq wrote has no marker and needs no opt-in', async () => {
      globalThis.fetch = fetchWhereGroqAnswers(() => sseReply({}, ['Groq ', 'stream'], 'length'));

      const chunks = await collect(provider.streamText('Ping'));

      expect(chunks).toEqual([{ text: 'Groq ' }, { text: 'stream' }]);
    });
  });

  describe('the chat: the caller that opts in', () => {
    it('streamQuery passes the marker through, and the chat shows the line', async () => {
      globalThis.fetch = fetchWhereGroqAnswers(() => sseReply(FALLBACK_HEADERS, ['Fallback ', 'stream']));

      const chunks = await collect(geminiService.streamQuery('Ping', OracleMode.FLASH, null, { skipSearch: true }));
      const message = messageFromChunks(chunks);

      expect(message.content).toBe('Fallback stream');
      expect(message.fallback).toEqual(MARKER);
      expect(render([message])).toContain(`Answered by a fallback model: ${MODEL}`);
    });

    it('keeps the marker on the first chunk when live search sources are attached to it', async () => {
      vi.spyOn(configService, 'getTavilyKey').mockReturnValue('tvly-test-key');
      vi.spyOn(tavilyService, 'search').mockResolvedValue({
        query: 'q',
        answer: 'A summary',
        results: [{ title: 'A source', url: 'https://source.example/a', content: 'Excerpt', score: 0.9 }],
      } as any);
      globalThis.fetch = fetchWhereGroqAnswers(() => sseReply(FALLBACK_HEADERS, ['Fallback ', 'stream']));

      const chunks = await collect(
        geminiService.streamQuery('What is the latest news about example.com pricing today?', OracleMode.FLASH, null),
      );
      const message = messageFromChunks(chunks);

      // This run went through the branch that rebuilds the first chunk to add the sources.
      expect(message.groundingUrls).toEqual([{ uri: 'https://source.example/a', title: 'A source' }]);
      expect(message.fallback).toEqual(MARKER);
      expect(render([message])).toContain(`Answered by a fallback model: ${MODEL}`);
    });

    it('does not label the next reply when Groq is back', async () => {
      const replies = [
        () => sseReply(FALLBACK_HEADERS, ['From the fallback']),
        () => sseReply({}, ['From Groq']),
      ];
      globalThis.fetch = fetchWhereGroqAnswers(() => replies.shift()!());

      const first = messageFromChunks(await collect(geminiService.streamQuery('Ping', OracleMode.FLASH, null, { skipSearch: true })), 'm1');
      const second = messageFromChunks(await collect(geminiService.streamQuery('Pong', OracleMode.FLASH, null, { skipSearch: true })), 'm2');

      expect(first.fallback).toEqual(MARKER);
      expect(second.content).toBe('From Groq');
      expect(second.fallback).toBeUndefined();
      expect(render([second])).not.toContain(FALLBACK_ANSWER_LABEL);
    });
  });

describe('hosted callers keep the Workers AI reply', () => {
  it('geminiService.generateText returns the fallback text', async () => {
    globalThis.fetch = fetchWhereGroqAnswers(() => fallbackJsonReply());

    await expect(geminiService.generateText('Ping')).resolves.toBe(FALLBACK_TEXT);
  });

  it('a failover caller does not skip a Workers AI answer for the next engine', async () => {
    configService.setKey('luminara_openrouter_key', 'sk-or-v1-testkey123');
    globalThis.fetch = fetchWhereGroqAnswers(() => fallbackJsonReply(), {
      'openrouter.ai': () =>
        jsonReply({}, {
          choices: [{ index: 0, message: { role: 'assistant', content: 'OpenRouter text' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
    });

    const text = await geminiService.generateText('Ping');

    expect(text).toBe(FALLBACK_TEXT);
    expect(text).not.toContain('OpenRouter text');
  });

  it('a direct caller (the crew "groq" agent) records the fallback text', async () => {
    globalThis.fetch = fetchWhereGroqAnswers(() => fallbackJsonReply());

    const task = await agentMatrixService.dispatchPrompt('Ping', 'groq');

    expect(task.status).toBe('completed');
    expect(task.result).toContain(FALLBACK_TEXT);
  });
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

  it('renders the line and the model name with a fallback reply', () => {
    const html = render([reply({ fallback: MARKER })]);
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
});
