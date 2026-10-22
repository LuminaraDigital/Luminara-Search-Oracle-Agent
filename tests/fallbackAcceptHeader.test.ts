/**
 * SW0a-11: the chat still asks for a fallback answer. Hosted Groq falls back without the header.
 *
 * `providerFetch` adds `x-accept-fallback: 1` when it is called with `acceptFallback`, so this
 * file checks who passes it: the chat does, and no other caller of the Groq engine does.
 * (That `providerFetch` then sends the header only on a hosted relay call is in apiClientRelay.test.ts.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providerFetchMock = vi.hoisted(() => vi.fn());

vi.mock('../services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/apiClient')>();
  return { ...actual, providerFetch: providerFetchMock };
});

import { GroqProvider, aiProviderService } from '../services/aiProviderService';
import { configService } from '../services/configService';
import { geminiService } from '../services/geminiService';
import { agentMatrixService } from '../services/harness/agentMatrixService';
import { notebookService } from '../services/notebook/notebookService';
import { audioOverviewService } from '../services/notebook/audioOverviewService';
import { OracleMode } from '../types';

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

function jsonReply(): Response {
  return new Response(
    JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Groq text' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function sseReply(): Response {
  const payload = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Groq stream' }, finish_reason: null }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** The `acceptFallback` option of every Groq chat call made since the last reset. */
function groqCalls(): Array<boolean | undefined> {
  return providerFetchMock.mock.calls
    .filter(call => call[0] === 'groq' && call[1] === '/chat/completions')
    .map(call => (call[4] as { acceptFallback?: boolean } | undefined)?.acceptFallback);
}

describe('who asks the Worker for a fallback answer', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    configService.setKey('luminara_groq_key', 'gsk_test_accept_header_key');
    aiProviderService.clearCooldowns();
    providerFetchMock.mockReset();
    providerFetchMock.mockImplementation(async (_provider: string, _path: string, _url: string, init: RequestInit) => {
      const streaming = typeof init.body === 'string' && JSON.parse(init.body).stream === true;
      return streaming ? sseReply() : jsonReply();
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
    aiProviderService.clearCooldowns();
  });

  it('GroqProvider asks only when the caller passed allowFallback', async () => {
    const provider = new GroqProvider();

    await provider.generateText('Ping');
    await provider.generateText('Ping', { allowFallback: true });
    for await (const _chunk of provider.streamText('Ping')) { /* drain */ }
    for await (const _chunk of provider.streamText('Ping', { allowFallback: true })) { /* drain */ }

    expect(groqCalls()).toEqual([false, true, false, true]);
  });

  it('the chat asks', async () => {
    for await (const _chunk of geminiService.streamQuery('Ping', OracleMode.FLASH, null, { skipSearch: true })) { /* drain */ }

    expect(groqCalls()).toEqual([true]);
  });

  it('no other caller asks: audits and helpers, the crew agent, the notebook, the audio overview', async () => {
    await geminiService.generateText('Ping');
    await aiProviderService.generateWithFallback('Ping');
    await agentMatrixService.dispatchPrompt('Ping', 'groq');

    const nb = notebookService.createNotebook('Header test notebook');
    notebookService.addTextSource(nb.id, 'A source', 'Entity authority requires Organization schema markup linked to Wikidata.');
    await notebookService.queryNotebook(nb.id, 'What does the source say?');
    await notebookService.generateArtifact(nb.id, 'faq');
    await audioOverviewService.generatePodcast(nb.id).catch(() => { /* the canned reply is not a script */ });

    const calls = groqCalls();
    expect(calls.length).toBeGreaterThanOrEqual(6);
    expect(calls.every(accept => accept === false)).toBe(true);
  });
});
