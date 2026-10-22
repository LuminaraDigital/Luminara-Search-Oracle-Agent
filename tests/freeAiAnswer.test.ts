import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { handleAuditScoutRun } from '../worker/auditScoutRun';
import { handleFreeAiAnswer } from '../worker/freeAiAnswer';
import { invokeDailyQuota, meterName } from '../worker/dailyQuota';
import { readFreeUsed } from '../worker/quotaMiddleware';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';
import { agenciesFromAnswer, FREE_AI_ANSWER_LABEL, questionFor, realEstateAgentFix } from '../services/audit/freeAiAnswer';
import { JEV_MODEL, JEV_NOUL_MIN, JEV_URL } from '../services/audit/jevVerifier';
import { FREE_ANSWER_JEV_MODEL, FREE_ANSWER_JEV_NOUL_MIN, FREE_ANSWER_JEV_URL } from '../worker/freeAiAnswer';
import type { Env } from '../worker/env';

const BOT_TOKEN = '123456:MOCK_TOKEN';
const ANSWER = 'Ray White Richmond leads local coverage.\nAGENCIES: Ray White Richmond; Invented Agency; Harcourts';

function signInitData(id: number): string {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Ada' }),
  };
  const dcs = Object.keys(fields).sort().map((key) => `${key}=${fields[key as keyof typeof fields]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function envFor(extra: Partial<Env> = {}): Env & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    LUMINARA_KV: {
      get: async (key: string, type?: string) => {
        const raw = store.get(key);
        if (raw == null) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      put: async (key: string, value: string) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
    },
    DAILY_QUOTA: memoryDailyQuotaNamespace(),
    BOT_TOKEN,
    REQUIRE_TG_AUTH: 'true',
    GROQ_API_KEY: 'groq-test',
    TAVILY_API_KEY: 'tavily-test',
    TYPESAFE_API_KEY: 'jev-test',
    ...extra,
  } as Env & { store: Map<string, string> };
}

function ask(env: Env, id: number, body: unknown) {
  return handleFreeAiAnswer(new Request('https://luminarasuite.com/api/audit/free-answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(id) },
    body: JSON.stringify(body),
  }), env);
}

const profile = { suburb: 'Richmond', state: 'VIC', brandName: 'Ray White Richmond' };

function chat(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

function installFetch(mode: { groq?: 'ok' | 'fail'; nvidia?: 'ok' | 'fail'; tavily?: 'ok' | 'empty'; jev?: 'keep' | 'drop' | 'fail' } = {}) {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('tavily.com')) {
      if (mode.tavily === 'empty') return new Response(JSON.stringify({ results: [] }), { status: 200 });
      return new Response(JSON.stringify({
        results: [
          { title: 'Ray White Richmond', url: 'https://example.com/ray', content: 'Ray White Richmond is a local agency.' },
          { title: 'Harcourts', url: 'https://example.com/harcourts', content: 'Harcourts also works in Richmond.' },
        ],
      }), { status: 200 });
    }
    if (url.includes('api.groq.com')) {
      if (mode.groq === 'fail') return new Response('no', { status: 500 });
      return chat(ANSWER);
    }
    if (url.includes('nvidia.com')) {
      if (mode.nvidia !== 'ok') return new Response('no', { status: 500 });
      return chat(ANSWER);
    }
    if (url.includes('typesafe.ai')) {
      if (mode.jev === 'fail') return new Response('no', { status: 500 });
      return new Response(JSON.stringify({
        answers: {
          name_0: { type: 'noul', noul: 0.9 },
          name_1: { type: 'noul', noul: mode.jev === 'drop' ? 0.2 : 0.91 },
        },
      }), { status: 200 });
    }
    return new Response('miss', { status: 404 });
  }) as typeof fetch;
  return calls;
}

function installCache() {
  const store = new Map<string, string>();
  (globalThis as unknown as { caches?: unknown }).caches = {
    default: {
      match: async (key: string) => {
        const raw = store.get(key);
        return raw ? new Response(raw) : undefined;
      },
      put: async (key: string, res: Response) => {
        store.set(key, await res.clone().text());
      },
    },
  };
  return store;
}

describe('free AI answer', () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = (globalThis as unknown as { caches?: unknown }).caches;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as unknown as { caches?: unknown }).caches = originalCaches;
  });

  it('keeps only source-backed names and drops a name Jev rejects', () => {
    expect(agenciesFromAnswer(ANSWER, 'Ray White Richmond is here. Harcourts too.')).toEqual([
      'Ray White Richmond',
      'Harcourts',
    ]);
    expect(questionFor('Richmond', 'VIC')).toBe('Who is the best real estate agent/agency in Richmond, VIC?');
    const fix = JSON.parse(realEstateAgentFix('Ray White Richmond', 'Richmond', 'VIC')) as {
      '@type': string;
      areaServed: { name: string; address: { addressRegion: string } };
    };
    expect(fix['@type']).toBe('RealEstateAgent');
    expect(fix.areaServed.name).toBe('Richmond');
    expect(fix.areaServed.address.addressRegion).toBe('VIC');
    expect(FREE_ANSWER_JEV_MODEL).toBe(JEV_MODEL);
    expect(FREE_ANSWER_JEV_URL).toBe(JEV_URL);
    expect(FREE_ANSWER_JEV_NOUL_MIN).toBe(JEV_NOUL_MIN);
  });

  it('answers from live results and does not spend an audit check', async () => {
    const env = envFor();
    installFetch();
    const res = await ask(env, 11, profile);
    const body = await res.json() as {
      hidden: boolean;
      label: string;
      question: string;
      agencies: string[];
      userNamed: boolean;
      sources: Array<{ url: string }>;
      answeredAt: string;
      fix: string;
    };
    expect(res.status).toBe(200);
    expect(body.hidden).toBe(false);
    expect(body.label).toBe(FREE_AI_ANSWER_LABEL);
    expect(body.label).not.toMatch(/ChatGPT|Perplexity|Google/);
    expect(body.question).toBe('Who is the best real estate agent/agency in Richmond, VIC?');
    expect(body.agencies).toEqual(['Ray White Richmond', 'Harcourts']);
    expect(body.userNamed).toBe(true);
    expect(body.sources.map((source) => source.url)).toEqual(['https://example.com/ray', 'https://example.com/harcourts']);
    expect(body.answeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.fix).toContain('"areaServed"');
    expect(await readFreeUsed(env, '11', 3)).toBe(0);
  });

  it('hides the card when the daily answer is already used', async () => {
    const env = envFor();
    const calls = installFetch();
    expect((await (await ask(env, 11, profile)).json() as { hidden: boolean }).hidden).toBe(false);
    const second = await ask(env, 11, profile);
    expect((await second.json() as { hidden: boolean }).hidden).toBe(true);
    expect(calls.filter((url) => url.includes('tavily.com'))).toHaveLength(1);
  });

  it('hides the card when the quota object is down', async () => {
    const env = envFor({ DAILY_QUOTA: undefined });
    const calls = installFetch();
    const body = await (await ask(env, 11, profile)).json() as { hidden: boolean };
    expect(body.hidden).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('uses NVIDIA when Groq fails, and Workers AI when both fail', async () => {
    const env = envFor({ NVIDIA_API_KEY: 'nvidia-test' });
    const calls = installFetch({ groq: 'fail', nvidia: 'ok' });
    const body = await (await ask(env, 21, profile)).json() as { agencies: string[] };
    expect(body.agencies).toContain('Harcourts');
    const groqAt = calls.findIndex((url) => url.includes('api.groq.com'));
    const nvidiaAt = calls.findIndex((url) => url.includes('nvidia.com'));
    expect(groqAt).toBeGreaterThanOrEqual(0);
    expect(nvidiaAt).toBeGreaterThan(groqAt);

    const run = vi.fn(async () => ({ response: 'Harcourts covers Richmond.\nAGENCIES: Harcourts' }));
    const workers = envFor({ GROQ_API_KEY: undefined, NVIDIA_API_KEY: undefined, AI: { run } as Env['AI'] });
    installFetch();
    const viaWorkers = await (await ask(workers, 22, profile)).json() as { agencies: string[]; hidden: boolean };
    expect(viaWorkers.hidden).toBe(false);
    expect(viaWorkers.agencies).toEqual(['Harcourts']);
    expect(run).toHaveBeenCalledOnce();
  });

  it('drops a name Jev rejects and keeps source names when Jev errors', async () => {
    const env = envFor();
    installFetch({ jev: 'drop' });
    const dropped = await (await ask(env, 31, profile)).json() as { agencies: string[] };
    expect(dropped.agencies).toEqual(['Ray White Richmond']);

    installFetch({ jev: 'fail' });
    const kept = await (await ask(envFor(), 32, profile)).json() as { agencies: string[] };
    expect(kept.agencies).toEqual(['Ray White Richmond', 'Harcourts']);
  });

  it('serves a second account from the Cache API without a second search', async () => {
    installCache();
    const env = envFor();
    const calls = installFetch();
    await ask(env, 41, profile);
    const other = await (await ask(env, 42, { ...profile, brandName: 'Barry Plant' })).json() as { userNamed: boolean; agencies: string[] };
    expect(other.agencies).toEqual(['Ray White Richmond', 'Harcourts']);
    expect(other.userNamed).toBe(false);
    expect(calls.filter((url) => url.includes('tavily.com'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('api.groq.com'))).toHaveLength(1);
  });

  it('refunds the day when the search is empty, and rejects a missing sign-in', async () => {
    const env = envFor();
    installFetch({ tavily: 'empty' });
    const hidden = await (await ask(env, 51, profile)).json() as { hidden: boolean };
    expect(hidden.hidden).toBe(true);
    const used = await invokeDailyQuota(env, meterName('51:ai-answer'), 'read', 1) as { used: number };
    expect(used.used).toBe(0);

    const denied = await handleFreeAiAnswer(new Request('https://luminarasuite.com/api/audit/free-answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(profile),
    }), env);
    expect(denied.status).toBe(401);

    const bad = await ask(env, 51, { suburb: 'https://evil.example', state: 'VIC', brandName: 'Ada' });
    expect(bad.status).toBe(400);
  });

  it('hides a paid plan and is reachable on the scout route', async () => {
    const env = envFor();
    env.store.set('sub:61', JSON.stringify({ plan: 'starter', expiresAt: Date.now() + 86_400_000 }));
    const calls = installFetch();
    const paid = await (await ask(env, 61, profile)).json() as { hidden: boolean };
    expect(paid.hidden).toBe(true);
    expect(calls).toHaveLength(0);

    installFetch();
    const routed = await handleAuditScoutRun(new Request('https://luminarasuite.com/api/audit/free-answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(62) },
      body: JSON.stringify(profile),
    }), envFor());
    const body = await routed.json() as { label: string };
    expect(body.label).toBe(FREE_AI_ANSWER_LABEL);
  });

  it('lets a free signed-in caller through handleApi and still gates Oracle chat', async () => {
    const env = envFor();
    installFetch();
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const headers = {
      'content-type': 'application/json',
      'x-telegram-init-data': signInitData(71),
      'cf-connecting-ip': '203.0.113.71',
    };
    const answer = await worker.fetch(new Request('https://luminarasuite.com/api/audit/free-answer', {
      method: 'POST',
      headers,
      body: JSON.stringify(profile),
    }), env, ctx);
    expect(answer.status).toBe(200);
    const body = await answer.json() as { hidden?: boolean; label?: string };
    expect(body.hidden).not.toBe(true);
    expect(body.label).toBe(FREE_AI_ANSWER_LABEL);

    const oracle = await worker.fetch(new Request('https://luminarasuite.com/api/oracle/chat', {
      method: 'POST',
      headers: { ...headers, 'cf-connecting-ip': '203.0.113.72' },
      body: '{}',
    }), env, ctx);
    expect(oracle.status).toBe(403);
    expect(((await oracle.json()) as { code?: string }).code).toBe('API_ACCESS_REQUIRED');
  });
});
