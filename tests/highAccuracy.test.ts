import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import {
  CallLedger,
  HA_CAPS,
  HighAccuracyError,
  accuracyWakeComment,
  bestOfN,
  callModel,
  highAccuracyEnabled,
  resolveTarget,
  runHighAccuracySchema,
  validateJsonLdCandidate,
} from '../worker/highAccuracy';
import type { ModelTarget } from '../worker/highAccuracy';
import { createSqliteD1 } from './helpers/sqliteD1';

const ORG = (name: string, url = 'https://acme.example/') => JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name,
  url,
});

function completion(content: string, usage?: { prompt_tokens: number; completion_tokens: number }) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    ...(usage ? { usage } : {}),
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CallLedger', () => {
  it('stops at the call cap and sums reported tokens', () => {
    const ledger = new CallLedger(2);
    ledger.reserve();
    ledger.record({ prompt_tokens: 10, completion_tokens: 4 });
    ledger.reserve();
    ledger.record(undefined);
    expect(() => ledger.reserve()).toThrow(HighAccuracyError);
    expect(ledger.calls).toBe(2);
    expect(ledger.summary()).toEqual({
      calls: 2,
      failed: 0,
      usageMissing: 1,
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
    });
  });

  it('ignores a usage block that has no token fields and drops negative counts', () => {
    const ledger = new CallLedger();
    ledger.record({});
    ledger.record({ prompt_tokens: -5, completion_tokens: 3.9 });
    expect(ledger.usageMissing).toBe(1);
    expect(ledger.promptTokens).toBe(0);
    expect(ledger.completionTokens).toBe(3);
  });
});

describe('bestOfN', () => {
  it('escalate keeps candidate 0 and does not generate the rest when it passes', async () => {
    const seen: number[] = [];
    const result = await bestOfN({
      n: 3,
      strategy: 'escalate',
      generate: async (index) => {
        seen.push(index);
        return { text: ORG('Acme'), ms: 1 };
      },
      validate: (text) => validateJsonLdCandidate(text, { siteHost: 'acme.example' }),
    });
    expect(seen).toEqual([0]);
    expect(result.winnerIndex).toBe(0);
    expect(result.value).toContain('Acme');
    expect(result.attempts.map((a) => a.ok)).toEqual([true]);
  });

  it('escalate generates the rest after a failing candidate and picks the lowest pass', async () => {
    const texts = [ORG(''), ORG('Second'), ORG('Third')];
    const seen: number[] = [];
    const result = await bestOfN({
      n: 9,
      generate: async (index) => {
        seen.push(index);
        return { text: texts[index], ms: 1 };
      },
      validate: (text) => validateJsonLdCandidate(text, { siteHost: 'acme.example', expectedType: 'Organization' }),
    });
    expect(seen).toEqual([0, 1, 2]);
    expect(result.winnerIndex).toBe(1);
    expect(result.value).toContain('Second');
    expect(result.attempts[0].reasons).toContain('MISSING_Organization_name');
  });

  it('parallel picks the lowest passing index', async () => {
    const result = await bestOfN({
      n: 3,
      strategy: 'parallel',
      generate: async (index) => ({ text: index === 0 ? '{not' : ORG('Acme'), ms: 1 }),
      validate: (text) => validateJsonLdCandidate(text, { siteHost: 'acme.example' }),
    });
    expect(result.winnerIndex).toBe(1);
    expect(result.attempts.map((a) => a.index)).toEqual([0, 1, 2]);
  });

  it('records a generator error code and does not throw', async () => {
    const result = await bestOfN({
      n: 1,
      generate: async () => { throw new HighAccuracyError('timeout'); },
      validate: () => ({ ok: true, value: 'x' }),
    });
    expect(result).toEqual({
      value: null,
      winnerIndex: null,
      attempts: [{ index: 0, ok: false, reasons: ['timeout'] }],
    });
  });
});

describe('validateJsonLdCandidate', () => {
  it('returns canonical JSON with script characters escaped', () => {
    const result = validateJsonLdCandidate(ORG('Acme <b>'), { siteHost: 'acme.example' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('\\u003c');
    expect(result.value).not.toContain('<b>');
  });

  it('accepts the site, its www twin, a subdomain, and a relative url', () => {
    expect(validateJsonLdCandidate(ORG('Acme', 'https://www.acme.example/a'), { siteHost: 'acme.example' }).ok).toBe(true);
    expect(validateJsonLdCandidate(ORG('Acme', 'https://acme.example/a'), { siteHost: 'www.acme.example' }).ok).toBe(true);
    expect(validateJsonLdCandidate(ORG('Acme', 'https://shop.acme.example/a'), { siteHost: 'acme.example' }).ok).toBe(true);
    expect(validateJsonLdCandidate(ORG('Acme', '/about'), { siteHost: 'acme.example' }).ok).toBe(true);
  });

  it('rejects off-site urls, placeholders, the wrong type, and a script breakout', () => {
    expect(validateJsonLdCandidate(ORG('Acme', 'https://evil.test/'), { siteHost: 'acme.example' })).toMatchObject({
      ok: false,
      reasons: ['OFF_SITE_URL'],
    });
    expect(validateJsonLdCandidate(ORG('TODO'), { siteHost: 'acme.example' }).ok).toBe(false);
    const wrong = validateJsonLdCandidate(ORG('Acme'), { siteHost: 'acme.example', expectedType: 'Product' });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reasons).toContain('WRONG_TYPE');
    const broke = validateJsonLdCandidate(ORG('Acme </script>'), { siteHost: 'acme.example' });
    expect(broke.ok).toBe(false);
    if (!broke.ok) expect(broke.reasons).toContain('SCRIPT_BREAKOUT');
  });

  it('does not treat the audited host example.com as a placeholder', () => {
    const text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Example',
      url: 'https://example.com/',
    });
    expect(validateJsonLdCandidate(text, { siteHost: 'example.com' }).ok).toBe(true);
    const suffix = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Acme',
      url: 'https://acme.example.com/',
    });
    expect(validateJsonLdCandidate(suffix, { siteHost: 'acme.example.com' }).ok).toBe(true);
  });

  it('requires product snippet fields, local business address, and event place details', () => {
    const product = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'Widget' });
    const missing = validateJsonLdCandidate(product, { siteHost: 'acme.example' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reasons).toContain('MISSING_Product_offers|review|aggregateRating');

    const withOffer = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Widget',
      offers: { '@type': 'Offer', price: '10', priceCurrency: 'USD' },
      url: 'https://acme.example/widget',
    });
    expect(validateJsonLdCandidate(withOffer, { siteHost: 'acme.example' }).ok).toBe(true);

    const restaurant = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Restaurant', name: 'Acme' });
    const noAddress = validateJsonLdCandidate(restaurant, { siteHost: 'acme.example' });
    expect(noAddress.ok).toBe(false);
    if (!noAddress.ok) expect(noAddress.reasons).toContain('MISSING_Restaurant_address');

    const event = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Open house',
      startDate: '2026-11-01T18:00',
      location: { '@type': 'Place', name: 'Hall', address: '1 Main St' },
    });
    expect(validateJsonLdCandidate(event, { siteHost: 'acme.example' }).ok).toBe(true);
  });

  it('lets a context-bearing Article and FAQPage pass without Google-required extras', () => {
    const article = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: 'Hello' });
    expect(validateJsonLdCandidate(article, { siteHost: 'acme.example', expectedType: 'Article' }).ok).toBe(true);
    const faq = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: 'Hours?', acceptedAnswer: { '@type': 'Answer', text: 'Nine to five' } }],
    });
    expect(validateJsonLdCandidate(faq, { siteHost: 'acme.example' }).ok).toBe(true);
  });
});

describe('callModel and resolveTarget', () => {
  const env = { GROQ_API_KEY: 'hosted-secret-should-not-leak', WEBAPP_URL: 'https://luminarasuite.com' } as Env;

  it('refuses to resolve a target when no user key was sent', () => {
    expect(() => resolveTarget(env, 'groq', 'openai/gpt-oss-120b', '')).toThrow(HighAccuracyError);
    try {
      resolveTarget(env, 'groq', 'openai/gpt-oss-120b', '');
    } catch (e) {
      expect(e).toBeInstanceOf(HighAccuracyError);
      if (e instanceof HighAccuracyError) expect(e.code).toBe('no_credential');
    }
  });

  it('puts a NIM key and org on headers and never the hosted Groq secret', () => {
    const target = resolveTarget(env, 'nim', 'google/gemma-3-12b-it', 'nvapi-user|org_9');
    expect(target.url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(target.headers.get('Authorization')).toBe('Bearer nvapi-user');
    expect(target.headers.get('NV-Organization-ID')).toBe('org_9');
    expect(target.keySource).toBe('byok');
    expect(JSON.stringify([...target.headers.entries()])).not.toContain('hosted-secret-should-not-leak');
  });

  it('caps max_tokens, records usage, and keeps the key out of the JSON body', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      bodies.push(String(init.body));
      return completion('{"ok":true}', { prompt_tokens: 3, completion_tokens: 2 });
    });
    const target: ModelTarget = resolveTarget(env, 'groq', 'openai/gpt-oss-120b', 'gsk_user');
    const ledger = new CallLedger();
    const ac = new AbortController();
    const result = await callModel(target, {
      messages: [{ role: 'user', content: 'hi' }],
      jsonMode: true,
      maxTokens: 99_999,
      signal: ac.signal,
      ledger,
    });
    expect(result.text).toBe('{"ok":true}');
    expect(ledger.summary().totalTokens).toBe(5);
    const sent = JSON.parse(bodies[0]) as { max_tokens: number; stream: boolean; response_format: { type: string } };
    expect(sent.max_tokens).toBe(HA_CAPS.maxTokensPerCall);
    expect(sent.stream).toBe(false);
    expect(sent.response_format).toEqual({ type: 'json_object' });
    expect(bodies[0]).not.toContain('gsk_user');
  });

  it('counts an aborted run as deadline and a slow call as timeout', async () => {
    const ledger = new CallLedger();
    const target = resolveTarget(env, 'groq', 'm', 'gsk_user');
    const aborted = new AbortController();
    aborted.abort();
    await expect(callModel(target, {
      messages: [{ role: 'user', content: 'hi' }],
      signal: aborted.signal,
      ledger,
    })).rejects.toMatchObject({ code: 'deadline' });
    expect(ledger.failed).toBe(1);

    vi.stubGlobal('fetch', (_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    await expect(callModel(target, {
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 20,
      signal: new AbortController().signal,
      ledger,
    })).rejects.toMatchObject({ code: 'timeout' });
    expect(ledger.calls).toBe(2);
  });
});

describe('runHighAccuracySchema', () => {
  it('stops the whole run at the overall deadline', async () => {
    let fetches = 0;
    vi.stubGlobal('fetch', (_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      fetches += 1;
      init.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    const env = { WEBAPP_URL: 'https://luminarasuite.com' } as Env;
    const target = resolveTarget(env, 'groq', 'm', 'gsk_user');
    const result = await runHighAccuracySchema({
      target,
      messages: [{ role: 'user', content: 'page' }],
      siteHost: 'acme.example',
      deadlineMs: 40,
    });
    expect(result.schemaJsonLd).toBeNull();
    expect(result.accuracy.usage.calls).toBe(3);
    expect(result.accuracy.attempts.every((a) => a.reasons.includes('deadline'))).toBe(true);
    expect(fetches).toBe(1);
    expect(accuracyWakeComment(result.accuracy)).toContain('winner=none');
    expect(accuracyWakeComment(result.accuracy)).not.toContain('page');
  });
});

describe('POST /api/high-accuracy/schema', () => {
  const botToken = '123456:HA_TEST';
  const evidence = 'Acme builds public water fountains in Austin and lists its name on the about page.';

  function signInitData(userId: number): string {
    const fields: Record<string, string> = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: userId, first_name: 'Owner' }),
    };
    const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const hash = createHmac('sha256', secret).update(dcs).digest('hex');
    const p = new URLSearchParams(fields);
    p.set('hash', hash);
    return p.toString();
  }

  function makeEnv(extra: Partial<Env> = {}): Env {
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
      list: async () => ({ keys: [] as { name: string }[], list_complete: true, cacheStatus: null }),
    };
    return {
      ASSETS: { fetch: async () => new Response('ok') },
      LUMINARA_KV: kv,
      WEBAPP_URL: 'https://luminarasuite.com/',
      ALLOWED_ORIGINS: 'https://luminarasuite.com',
      BOT_TOKEN: botToken,
      GROQ_API_KEY: 'hosted-secret-should-not-leak',
      HIGH_ACCURACY: 'on',
      DB: createSqliteD1(),
      ...extra,
    } as Env;
  }

  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

  function call(env: Env, body: unknown, headers: Record<string, string> = {}) {
    return worker.fetch(new Request('https://luminarasuite.com/api/high-accuracy/schema', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-init-data': signInitData(42),
        ...headers,
      },
      body: JSON.stringify(body),
    }), env, ctx);
  }

  const goodBody = {
    providerId: 'groq',
    model: 'openai/gpt-oss-120b',
    pageUrl: 'https://acme.example.com/about',
    evidence,
    expectedType: 'Organization',
  };

  it('stays dark until HIGH_ACCURACY is on', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await call(makeEnv({ HIGH_ACCURACY: undefined }), goodBody, { 'x-provider-key': 'gsk_user' });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, code: 'disabled' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(highAccuracyEnabled({})).toBe(false);
    expect(highAccuracyEnabled({ HIGH_ACCURACY: 'on' })).toBe(true);
  });

  it('rejects a signed-in caller who did not send a provider key', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await call(makeEnv(), goodBody);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'no_credential' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a guest', async () => {
    const res = await worker.fetch(new Request('https://luminarasuite.com/api/high-accuracy/schema', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-provider-key': 'gsk_user' },
      body: JSON.stringify(goodBody),
    }), makeEnv(), ctx);
    expect(res.status).toBe(401);
  });

  it('keeps the first passing candidate, bills the user key, and stores codes only', async () => {
    const seen: { url: string; auth: string | null; body: string }[] = [];
    vi.stubGlobal('fetch', async (url: unknown, init: RequestInit) => {
      const headers = new Headers(init.headers);
      seen.push({ url: String(url), auth: headers.get('authorization'), body: String(init.body) });
      const sent = JSON.parse(String(init.body)) as { temperature: number };
      const text = sent.temperature === 0.2
        ? JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', url: 'https://acme.example/' })
        : ORG('Acme Fountains', 'https://acme.example.com/');
      return completion(text, { prompt_tokens: 11, completion_tokens: 7 });
    });
    const logs: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((msg) => { logs.push(String(msg)); });
    const env = makeEnv();
    const res = await call(env, goodBody, { 'x-provider-key': 'gsk_user_owned' });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; schemaJsonLd: string; accuracy: { winnerIndex: number; usage: { calls: number; totalTokens: number } } };
    expect(data.ok).toBe(true);
    expect(data.accuracy.winnerIndex).toBe(1);
    expect(data.accuracy.usage.calls).toBe(3);
    expect(data.accuracy.usage.totalTokens).toBe(54);
    expect(data.schemaJsonLd).toContain('Acme Fountains');
    expect(data.schemaJsonLd).not.toContain('gsk_user_owned');
    expect(seen).toHaveLength(3);
    expect(seen[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(seen.every((s) => s.auth === 'Bearer gsk_user_owned')).toBe(true);
    expect(seen.every((s) => !s.body.includes('gsk_user_owned') && !s.body.includes('hosted-secret'))).toBe(true);
    const line = logs.find((l) => l.includes('high_accuracy_schema')) ?? '';
    expect(line).toContain('"calls":3');
    expect(line).not.toContain('water fountains');
    expect(line).not.toContain('gsk_user_owned');
    const rows = (env.DB as ReturnType<typeof createSqliteD1>).sqlite
      .prepare("SELECT wake_comment, surface FROM run_provenance WHERE surface = 'high_accuracy'")
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].wake_comment).toContain('winner=1');
    expect(rows[0].wake_comment).toContain('MISSING_Organization_name');
    expect(String(rows[0].wake_comment)).not.toContain('water fountains');
  });
});
