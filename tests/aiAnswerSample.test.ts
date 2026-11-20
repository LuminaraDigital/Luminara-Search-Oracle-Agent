import { createHmac } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiAnswerSamplePanel } from '../components/marketing/AiAnswerSamplePanel';
import {
  AI_SAMPLE_PROVIDER,
  answerNamesAgency,
  buyerPrompts,
  citedDomains,
  sampleLabel,
  sampleNextStep,
} from '../services/audit/aiAnswerSample';
import { readBusinessSignals } from '../worker/pageHead';
import { collectAiAnswerSample } from '../worker/aiAnswerSample';
import { handleProbeCrawlRoute } from '../worker/probeCrawlRoute';
import type { Env } from '../worker/env';

const BOT_TOKEN = '123456:MOCK_TOKEN';
const DAY = new Date().toISOString().slice(0, 10);

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

function kvOf(store: Map<string, string>): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw == null) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function envFor(extra: Partial<Env> = {}): Env & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    LUMINARA_KV: kvOf(store),
    TAVILY_API_KEY: 'tavily-test',
    FREE_AI_SAMPLE_DAILY_BUDGET: '10',
    BOT_TOKEN,
    REQUIRE_TG_AUTH: 'true',
    ...extra,
  } as Env & { store: Map<string, string> };
}

function requestFor(ip: string, initData?: string): Request {
  const headers = new Headers({ 'cf-connecting-ip': ip });
  if (initData) headers.set('x-telegram-init-data', initData);
  return new Request('https://www.luminarasuite.com/api/visibility/probe-crawl?url=agency.com.au', { headers });
}

const richmond = { host: 'agency.com.au', agencyName: 'Ray White Richmond', suburb: '' };

function installTavily(answer = 'Ray White Richmond is named for local sales.') {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (!url.includes('api.tavily.com')) return new Response('miss', { status: 404 });
    return new Response(JSON.stringify({
      answer,
      results: [
        { title: 'Harcourts', url: 'https://harcourts.com.au/richmond' },
        { title: 'Agency', url: 'https://agency.com.au/about' },
      ],
    }), { status: 200 });
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

describe('AI answer sample labeling', () => {
  it('builds one to three buyer questions and names only Tavily', () => {
    expect(buyerPrompts({ agencyName: '', suburb: '' })).toEqual([]);
    expect(buyerPrompts({ agencyName: 'Ray White Richmond', suburb: '' })).toEqual([
      'Ray White Richmond reviews',
    ]);
    expect(buyerPrompts({ agencyName: '', suburb: 'Richmond' })).toEqual([
      'best real estate agent in Richmond',
      'who should I use to sell my home in Richmond',
    ]);
    expect(buyerPrompts({ agencyName: 'Ray White Richmond', suburb: 'Richmond' })).toEqual([
      'best real estate agent in Richmond',
      'Ray White Richmond reviews',
      'who should I use to sell my home in Richmond',
    ]);
    const label = sampleLabel(1, '2026-11-15T01:00:00.000Z');
    expect(label).toBe(`Measured: one sample on 15 Nov 2026 from ${AI_SAMPLE_PROVIDER}`);
    expect(label).not.toMatch(/ChatGPT|Gemini|Perplexity|Google/);
    expect(sampleLabel(3, '2026-11-15T01:00:00.000Z')).toBe('Measured: three samples on 15 Nov 2026 from Tavily');
    expect(sampleNextStep('guest')).toContain('Create a free account');
    expect(sampleNextStep('free')).toBe('Upgrade for weekly re-audit reminders.');
  });

  it('reports a name or domain hit and drops the audited host from cited domains', () => {
    expect(answerNamesAgency({
      domain: 'agency.com.au',
      agencyName: 'Ray White Richmond',
      answer: 'People ask for Ray White Richmond.',
      urls: [],
    })).toBe(true);
    expect(answerNamesAgency({
      domain: 'agency.com.au',
      agencyName: 'Ray White Richmond',
      answer: 'A few local names come up.',
      urls: ['https://www.agency.com.au/team'],
    })).toBe(true);
    expect(answerNamesAgency({
      domain: 'agency.com.au',
      agencyName: 'Ray White Richmond',
      answer: 'Harcourts covers Richmond.',
      urls: ['https://harcourts.com.au/richmond'],
    })).toBe(false);
    expect(citedDomains([
      'https://agency.com.au/about',
      'https://www.agency.com.au/team',
      'https://harcourts.com.au/richmond',
      'https://harcourts.com.au/other',
      'not a url',
    ], 'agency.com.au')).toEqual(['harcourts.com.au']);
  });

  it('reads the suburb and agency name the homepage states', () => {
    const html = `<html><head>
      <meta property="og:site_name" content="Ray White Richmond">
      <script type="application/ld+json">
        {"@type":"RealEstateAgent","name":"Ray White Richmond","address":{"@type":"PostalAddress","addressLocality":"Richmond"}}
      </script>
    </head></html>`;
    expect(readBusinessSignals(html, 'Ray White Richmond')).toEqual({
      agencyName: 'Ray White Richmond',
      suburb: 'Richmond',
    });
    expect(readBusinessSignals('<html><head><title>Home</title></head></html>', 'Home')).toEqual({
      agencyName: '',
      suburb: '',
    });
    const both = `<script type="application/ld+json">{"@type":"RealEstateAgent","name":"Ray White Richmond","areaServed":"Victoria","address":{"addressLocality":"Richmond"}}</script>`;
    expect(readBusinessSignals(both, null).suburb).toBe('Richmond');
  });

  it('renders the measured sample without naming another AI product', () => {
    const html = renderToStaticMarkup(createElement(AiAnswerSamplePanel, {
      sample: {
        status: 'measured',
        label: 'Measured: one sample on 15 Nov 2026 from Tavily',
        provider: 'Tavily',
        answeredAt: '2026-11-15T01:00:00.000Z',
        named: false,
        citedDomains: ['harcourts.com.au'],
        prompts: [{
          prompt: 'best real estate agent in Richmond',
          answer: 'Harcourts is cited.',
          named: false,
          citedDomains: ['harcourts.com.au'],
        }],
        nextStep: 'Create a free account for more daily samples. Upgrade for weekly re-audit reminders.',
      },
    }));
    expect(html).toContain('Does AI name this agency?');
    expect(html).toContain('Measured: one sample on 15 Nov 2026 from Tavily');
    expect(html).toContain('best real estate agent in Richmond');
    expect(html).toContain('harcourts.com.au');
    expect(html).toContain('Create a free account');
    expect(html).not.toMatch(/ChatGPT|Gemini|Perplexity/);
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('AI answer sample caps', () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = (globalThis as unknown as { caches?: unknown }).caches;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as unknown as { caches?: unknown }).caches = originalCaches;
  });

  it('pauses on the kill switch and stays Not measured without a key, a signal, or a meter', async () => {
    const calls = installTavily();
    const paused = await collectAiAnswerSample(
      requestFor('203.0.113.1'),
      envFor({ FREE_AI_SAMPLE_DAILY_BUDGET: '0' }),
      richmond,
    );
    expect(paused.status).toBe('not_measured');
    if (paused.status === 'not_measured') expect(paused.reasonCode).toBe('paused');
    expect(calls).toHaveLength(0);

    const missing = await collectAiAnswerSample(
      requestFor('203.0.113.2'),
      envFor({ TAVILY_API_KEY: undefined }),
      richmond,
    );
    if (missing.status === 'not_measured') expect(missing.reasonCode).toBe('no_key');

    const blank = await collectAiAnswerSample(
      requestFor('203.0.113.3'),
      envFor(),
      { host: 'agency.com.au', agencyName: '', suburb: '' },
    );
    if (blank.status === 'not_measured') expect(blank.reasonCode).toBe('no_signal');

    const down = await collectAiAnswerSample(
      requestFor('203.0.113.4'),
      envFor({ LUMINARA_KV: undefined }),
      richmond,
    );
    if (down.status === 'not_measured') expect(down.reasonCode).toBe('unavailable');
    expect(calls).toHaveLength(0);
  });

  it('allows one anonymous sample a day and serves the next caller from the 24h cache', async () => {
    const env = envFor();
    const calls = installTavily();
    const first = await collectAiAnswerSample(requestFor('203.0.113.10'), env, richmond);
    expect(first.status).toBe('measured');
    if (first.status === 'measured') {
      expect(first.label).toMatch(/^Measured: one sample on \d{1,2} [A-Z][a-z]{2} \d{4} from Tavily$/);
      expect(first.named).toBe(true);
      expect(first.citedDomains).toEqual(['harcourts.com.au']);
      expect(JSON.stringify(first)).not.toMatch(/ChatGPT|Gemini|Perplexity/);
    }
    const second = await collectAiAnswerSample(
      requestFor('203.0.113.10'),
      env,
      { ...richmond, host: 'other.com.au' },
    );
    if (second.status === 'not_measured') expect(second.reasonCode).toBe('cap');
    expect(calls).toHaveLength(1);

    installCache();
    const cachedEnv = envFor();
    const again = installTavily();
    await collectAiAnswerSample(requestFor('203.0.113.20'), cachedEnv, richmond);
    const other = await collectAiAnswerSample(requestFor('203.0.113.21'), cachedEnv, richmond);
    expect(other.status).toBe('measured');
    expect(again).toHaveLength(1);
    expect(cachedEnv.store.get(`free_ai_sample_ip:203.0.113.21:${DAY}`)).toBeUndefined();
  });

  it('stops at the global budget and does not spend the daily allowance on an empty answer', async () => {
    const env = envFor({ FREE_AI_SAMPLE_DAILY_BUDGET: '1' });
    const calls = installTavily();
    const sample = await collectAiAnswerSample(
      requestFor('203.0.113.30'),
      env,
      { host: 'agency.com.au', agencyName: '', suburb: 'Richmond' },
    );
    expect(calls).toHaveLength(1);
    if (sample.status === 'measured') expect(sample.label).toContain('one sample');

    installTavily('');
    const emptyEnv = envFor();
    const empty = await collectAiAnswerSample(requestFor('203.0.113.31'), emptyEnv, richmond);
    if (empty.status === 'not_measured') expect(empty.reasonCode).toBe('empty');
    expect(emptyEnv.store.get(`free_ai_sample_ip:203.0.113.31:${DAY}`)).toBeUndefined();
    installTavily();
    const retried = await collectAiAnswerSample(requestFor('203.0.113.31'), emptyEnv, richmond);
    expect(retried.status).toBe('measured');
  });

  it('allows three samples for a signed-in free account and skips a paid plan', async () => {
    const env = envFor();
    const init = signInitData(41);
    installTavily();
    for (const host of ['a.com.au', 'b.com.au', 'c.com.au']) {
      const body = await collectAiAnswerSample(
        requestFor('203.0.113.41', init),
        env,
        { host, agencyName: 'Ray White Richmond', suburb: '' },
      );
      expect(body.status).toBe('measured');
    }
    const capped = await collectAiAnswerSample(
      requestFor('203.0.113.41', init),
      env,
      { host: 'd.com.au', agencyName: 'Ray White Richmond', suburb: '' },
    );
    if (capped.status === 'not_measured') expect(capped.reasonCode).toBe('cap');

    const paidEnv = envFor();
    paidEnv.store.set('sub:61', JSON.stringify({ plan: 'starter', expiresAt: Date.now() + 86_400_000 }));
    const calls = installTavily();
    const paid = await collectAiAnswerSample(
      requestFor('203.0.113.61', signInitData(61)),
      paidEnv,
      richmond,
    );
    if (paid.status === 'not_measured') expect(paid.reasonCode).toBe('paid');
    expect(calls).toHaveLength(0);
  });

  it('attaches the sample to the free check for an anonymous caller', async () => {
    const html = `<html><head><title>Ray White Richmond</title>
      <script type="application/ld+json">{"@type":"RealEstateAgent","name":"Ray White Richmond","address":{"addressLocality":"Richmond"}}</script>
      </head><body>ok</body></html>`;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://cloudflare-dns.com/')) {
        if (url.includes('type=AAAA')) return Response.json({ Status: 0, Answer: [] });
        return Response.json({ Status: 0, Answer: [{ type: 1, data: '104.21.8.8' }] });
      }
      if (url.includes('api.tavily.com')) {
        return new Response(JSON.stringify({
          answer: 'Ray White Richmond shows up in local roundups.',
          results: [{ title: 'Harcourts', url: 'https://harcourts.com.au/richmond' }],
        }), { status: 200 });
      }
      if (url.endsWith('/')) {
        return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const env = envFor();
    const res = await handleProbeCrawlRoute(
      new Request('https://www.luminarasuite.com/api/visibility/probe-crawl?url=https://agency.com.au', {
        headers: { 'cf-connecting-ip': '203.0.113.80' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      detected: { suburb: string; agencyName: string };
      aiSample: { status: string; label: string; prompts: Array<{ prompt: string }> };
    };
    expect(body.detected).toEqual({ agencyName: 'Ray White Richmond', suburb: 'Richmond' });
    expect(body.aiSample.status).toBe('measured');
    expect(body.aiSample.label).toContain('three samples');
    expect(body.aiSample.label).not.toMatch(/ChatGPT|Gemini|Perplexity/);
    expect(body.aiSample.prompts.map((row) => row.prompt)).toContain('best real estate agent in Richmond');
  });
});
