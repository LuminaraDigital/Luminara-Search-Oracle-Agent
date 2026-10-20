/**
 * Hosted Groq chat: Groq, then NVIDIA, then Workers AI.
 * Direct NVIDIA stays a paid engine.
 */
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ai, Env } from '../worker/env';
import { proxyProvider } from '../worker/providerRelay';
import { NIM_DEFAULT_MODEL } from '../services/llm/nativeModelDefaults';
import { fallbackAnswerLine, readFallbackAnswer } from '../services/llm/fallbackAnswer';

const BOT_TOKEN = '123456:TEST_BOT_TOKEN_NVIDIA_FALLBACK';

function signInitData(userId: number, token = BOT_TOKEN): string {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Probe' }),
  };
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
      if (val == null) return null;
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

function answeringAi(text = 'Workers AI text'): Ai {
  return { run: vi.fn().mockResolvedValue({ response: text }) };
}

function chatRequest(userId: number, body: unknown) {
  return new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-init-data': signInitData(userId),
    },
    body: JSON.stringify(body),
  });
}

const chatBody = {
  model: 'openai/gpt-oss-120b',
  messages: [{ role: 'user', content: 'Say hello' }],
};

function nvidiaReply(text = 'NVIDIA text') {
  return new Response(JSON.stringify({
    model: NIM_DEFAULT_MODEL,
    choices: [{ message: { role: 'assistant', content: text } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('hosted Groq chat falls through NVIDIA', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function env(kv: ReturnType<typeof createMockKv>, overrides: Partial<Env> = {}): Env {
    return {
      ASSETS: { fetch: vi.fn() } as unknown as Env['ASSETS'],
      WEBAPP_URL: 'https://luminarasuite.com',
      LUMINARA_KV: kv as unknown as Env['LUMINARA_KV'],
      BOT_TOKEN,
      REQUIRE_TG_AUTH: 'true',
      FREE_DAILY_LIMIT: '10',
      NVIDIA_API_KEY: 'nvapi-test',
      AI: answeringAi(),
      ...overrides,
    } as Env;
  }

  it('sends a missing Groq key to NVIDIA and meters quota once', async () => {
    const calls: { url: string; model: string; auth: string }[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { model?: string };
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), model: body.model || '', auth: headers.get('authorization') || '' });
      return nvidiaReply();
    });
    const kv = createMockKv();
    const ai = answeringAi();
    const res = await proxyProvider(chatRequest(11, chatBody), env(kv, {
      GROQ_API_KEY: undefined,
      GROQ_API_KEY_FALLBACK: undefined,
      AI: ai,
    }), 'groq', '/chat/completions');

    expect(res.status).toBe(200);
    expect(res.headers.get('x-provider-fallback')).toBe('nvidia');
    expect(res.headers.get('x-provider-fallback-model')).toBe(NIM_DEFAULT_MODEL);
    expect(res.headers.get('x-provider-fallback-reason')).toBe('provider_not_configured');
    expect(res.headers.get('x-quota-refunded')).toBeNull();
    expect(res.headers.get('x-quota-remaining')).toBe('9');
    const data = await res.json() as { x_fallback: { provider: string; model: string }; choices: { message: { content: string } }[] };
    expect(data.x_fallback).toEqual({
      provider: 'nvidia',
      model: NIM_DEFAULT_MODEL,
      reason: 'provider_not_configured',
    });
    expect(data.choices[0].message.content).toBe('NVIDIA text');
    expect(calls).toEqual([{
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      model: NIM_DEFAULT_MODEL,
      auth: 'Bearer nvapi-test',
    }]);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('sends an NVIDIA failure on to Workers AI', async () => {
    const hosts: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      hosts.push(url);
      return new Response(JSON.stringify({ error: { message: 'nvidia down' } }), { status: 500 });
    });
    const ai = answeringAi('Recovered');
    const res = await proxyProvider(chatRequest(11, chatBody), env(createMockKv(), {
      GROQ_API_KEY: 'gsk_primary',
      AI: ai,
    }), 'groq', '/chat/completions');

    expect(res.status).toBe(200);
    expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
    expect(res.headers.get('x-quota-refunded')).toBeNull();
    const data = await res.json() as { choices: { message: { content: string } }[] };
    expect(data.choices[0].message.content).toBe('Recovered');
    expect(hosts.some(url => url.includes('api.groq.com'))).toBe(true);
    expect(hosts.some(url => url.includes('integrate.api.nvidia.com'))).toBe(true);
    expect(ai.run).toHaveBeenCalledOnce();
  });

  it('skips NVIDIA once the global daily cap is spent', async () => {
    const hosts: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      hosts.push(String(input));
      return nvidiaReply('first');
    });
    const shared = createMockKv();
    const limited = env(shared, {
      GROQ_API_KEY: undefined,
      NVIDIA_FALLBACK_DAILY_CAP: '1',
      AI: answeringAi('after cap'),
    });
    const first = await proxyProvider(chatRequest(11, chatBody), limited, 'groq', '/chat/completions');
    const second = await proxyProvider(chatRequest(12, chatBody), limited, 'groq', '/chat/completions');

    expect(first.status).toBe(200);
    expect(first.headers.get('x-provider-fallback')).toBe('nvidia');
    expect(second.status).toBe(200);
    expect(second.headers.get('x-provider-fallback')).toBe('workers-ai');
    expect((await second.json() as { choices: { message: { content: string } }[] }).choices[0].message.content).toBe('after cap');
    expect(hosts.filter(url => url.includes('integrate.api.nvidia.com'))).toHaveLength(1);
  });

  it('skips NVIDIA for one free account once that account cap is spent', async () => {
    const hosts: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      hosts.push(String(input));
      return nvidiaReply('ok');
    });
    const shared = createMockKv();
    const limited = env(shared, {
      GROQ_API_KEY: undefined,
      NVIDIA_FALLBACK_USER_DAILY_CAP: '1',
      AI: answeringAi('user capped'),
    });
    const first = await proxyProvider(chatRequest(21, chatBody), limited, 'groq', '/chat/completions');
    const again = await proxyProvider(chatRequest(21, chatBody), limited, 'groq', '/chat/completions');
    const other = await proxyProvider(chatRequest(22, chatBody), limited, 'groq', '/chat/completions');

    expect(first.headers.get('x-provider-fallback')).toBe('nvidia');
    expect(again.headers.get('x-provider-fallback')).toBe('workers-ai');
    expect((await again.json() as { choices: { message: { content: string } }[] }).choices[0].message.content).toBe('user capped');
    expect(other.headers.get('x-provider-fallback')).toBe('nvidia');
    expect(hosts.filter(url => url.includes('integrate.api.nvidia.com'))).toHaveLength(2);
  });

  it('skips a missing NVIDIA key and answers with Workers AI', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('upstream must not be called');
    });
    const ai = answeringAi('no nvidia key');
    const res = await proxyProvider(chatRequest(11, chatBody), env(createMockKv(), {
      GROQ_API_KEY: undefined,
      NVIDIA_API_KEY: undefined,
      AI: ai,
    }), 'groq', '/chat/completions');

    expect(res.status).toBe(200);
    expect(res.headers.get('x-provider-fallback')).toBe('workers-ai');
    expect((await res.json() as { choices: { message: { content: string } }[] }).choices[0].message.content).toBe('no nvidia key');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(ai.run).toHaveBeenCalledOnce();
  });

  it('refunds quota when NVIDIA and Workers AI both fail', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 503 }));
    const res = await proxyProvider(chatRequest(11, chatBody), env(createMockKv(), {
      GROQ_API_KEY: 'gsk_primary',
      AI: undefined,
    }), 'groq', '/chat/completions');

    expect(res.status).toBe(503);
    expect(res.headers.get('x-provider-fallback')).toBeNull();
    expect(res.headers.get('x-quota-refunded')).toBe('1');
  });

  it('keeps a paid caller on direct NVIDIA and still blocks a free caller', async () => {
    const kv = createMockKv();
    await kv.put('sub:31', JSON.stringify({ plan: 'starter', expiresAt: Date.now() + 86_400_000 }));
    const calls: { url: string; model: string }[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { model?: string };
      calls.push({ url: String(input), model: body.model || '' });
      return nvidiaReply('direct');
    });
    const paidBody = { model: 'nvidia/llama-3.1-nemotron-70b-instruct', messages: [{ role: 'user', content: 'Ping' }] };
    const paid = await proxyProvider(
      chatRequest(31, paidBody),
      env(kv, { GROQ_API_KEY: 'gsk_primary', NVIDIA_FALLBACK_DAILY_CAP: '0' }),
      'nim',
      '/chat/completions',
    );
    const free = await proxyProvider(
      chatRequest(32, paidBody),
      env(kv, { GROQ_API_KEY: 'gsk_primary', NVIDIA_FALLBACK_DAILY_CAP: '0' }),
      'nim',
      '/chat/completions',
    );

    expect(paid.status).toBe(200);
    expect(paid.headers.get('x-provider-fallback')).toBeNull();
    expect((await paid.json() as { choices: { message: { content: string } }[] }).choices[0].message.content).toBe('direct');
    expect(calls).toEqual([{
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      model: 'nvidia/llama-3.1-nemotron-70b-instruct',
    }]);
    expect(free.status).toBe(402);
    const denied = await free.json() as { code: string; provider: string };
    expect(denied.code).toBe('TIER_UPGRADE_REQUIRED');
    expect(denied.provider).toBe('nim');
  });

  it('still lets a paid plan use NVIDIA on the Groq fallback path when the free cap is closed', async () => {
    const kv = createMockKv();
    await kv.put('sub:41', JSON.stringify({ plan: 'starter', expiresAt: Date.now() + 86_400_000 }));
    globalThis.fetch = vi.fn(async () => nvidiaReply('paid fallback'));
    const res = await proxyProvider(chatRequest(41, chatBody), env(kv, {
      GROQ_API_KEY: undefined,
      NVIDIA_FALLBACK_DAILY_CAP: '0',
      NVIDIA_FALLBACK_USER_DAILY_CAP: '0',
    }), 'groq', '/chat/completions');

    expect(res.status).toBe(200);
    expect(res.headers.get('x-provider-fallback')).toBe('nvidia');
    expect((await res.json() as { choices: { message: { content: string } }[] }).choices[0].message.content).toBe('paid fallback');
  });

  it('names NVIDIA on the marker the chat reads', () => {
    const info = readFallbackAnswer(new Headers({
      'x-provider-fallback': 'nvidia',
      'x-provider-fallback-model': NIM_DEFAULT_MODEL,
      'x-provider-fallback-reason': 'upstream_5xx',
    }));
    expect(info).toEqual({ model: NIM_DEFAULT_MODEL, provider: 'nvidia', reason: 'upstream_5xx' });
    expect(fallbackAnswerLine(info)).toBe(`Answered by a fallback model: NVIDIA (${NIM_DEFAULT_MODEL})`);
  });
});
