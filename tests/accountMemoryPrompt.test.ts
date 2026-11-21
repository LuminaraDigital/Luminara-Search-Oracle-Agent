/**
 * The web chat's own path (geminiService.streamQuery) puts the server's account-memory block into
 * the prompt it sends, and sends nothing extra without one. Groq is the only answering host; no
 * real network is used.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
};
if (typeof (globalThis as any).window === 'undefined') (globalThis as any).window = new EventTarget();

import { aiProviderService } from '../services/aiProviderService';
import { configService } from '../services/configService';
import { geminiService } from '../services/geminiService';
import { OracleMode } from '../types';

const MEMORY_BLOCK = '## Account memory (retrieved)\n<<<UNTRUSTED_ACCOUNT_MEMORY_ab12_BEGIN>>>\n1. [profile] Family bakery in Leeds\n<<<UNTRUSTED_ACCOUNT_MEMORY_ab12_END>>>';

function sse(text: string): Response {
  const payload = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  return new Response(new TextEncoder().encode(payload), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('web chat prompt carries account memory', () => {
  const originalFetch = globalThis.fetch;
  const sent: string[] = [];

  beforeEach(() => {
    sent.length = 0;
    configService.setKey('luminara_groq_key', 'gsk_test_account_memory');
    aiProviderService.clearCooldowns();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : input?.url ?? input);
      if (!url.includes('api.groq.com')) throw new Error(`no network in this test: ${url}`);
      sent.push(String(init?.body ?? ''));
      return sse('Try a Leeds delivery page.');
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    (globalThis as any).localStorage.clear();
    aiProviderService.clearCooldowns();
  });

  const drain = async (it: AsyncIterable<unknown>) => {
    for await (const _ of it) void _;
  };

  it('includes the block before the user directive', async () => {
    await drain(geminiService.streamQuery('Where do we deliver?', OracleMode.FLASH, null, { skipSearch: true, accountMemory: MEMORY_BLOCK }));
    const body = sent.join('\n');
    expect(body).toContain('Family bakery in Leeds');
    expect(body.indexOf('UNTRUSTED_ACCOUNT_MEMORY_ab12_BEGIN')).toBeLessThan(body.indexOf('USER DIRECTIVE'));
  });

  it('waits for a block that is still on its way', async () => {
    const later = new Promise<string>((resolve) => setTimeout(() => resolve(MEMORY_BLOCK), 20));
    await drain(geminiService.streamQuery('Where do we deliver?', OracleMode.FLASH, null, { skipSearch: true, accountMemory: later }));
    expect(sent.join('\n')).toContain('Family bakery in Leeds');
  });

  it('sends no memory text without a block', async () => {
    await drain(geminiService.streamQuery('Where do we deliver?', OracleMode.FLASH, null, { skipSearch: true }));
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join('\n')).not.toContain('Account memory');
  });
});
