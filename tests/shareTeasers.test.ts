import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { handleShareRoute, parseTeaserCreateBody, TEASER_DAILY_LIMIT } from '../worker/shareService';
import { loadCrawlerSnapshot } from '../worker/llmCrawlerRoute';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:TEASER_TEST';

function signInitData(fields: Record<string, string>): string {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(store = new Map<string, string>()): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(store),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    BOT_TOKEN: botToken,
    REQUIRE_TG_AUTH: 'true',
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function freeInit(id = 11): string {
  return signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Free' }),
  });
}

describe('teaser share entitlement', () => {
  it('drops secret fields and ignores a caller-supplied CTA', () => {
    const parsed = parseTeaserCreateBody({
      domain: 'Stripe.com',
      verdict: 'Not measured.',
      topFix: 'Add a homepage.',
      apiKey: 'sk-secret',
      ctaUrl: 'https://evil.example/phish',
      nested: { password: 'nope' },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.domain).toBe('stripe.com');
    expect(parsed.payload.ctaUrl).toBe('https://t.me/LuminaraSuiteBot/app');
    expect(JSON.stringify(parsed.payload)).not.toContain('sk-secret');
    expect(JSON.stringify(parsed.payload)).not.toContain('evil.example');
  });

  it('rejects credential-like text in every persisted string', () => {
    const secret = ['sk', '-', 'abcdefghijklmnopqrstuvwxyz'].join('');
    const bearer = 'Bearer abcdefghijklmnop';
    const base = {
      domain: 'stripe.com',
      verdict: 'AI mention readiness was not measured.',
      topFix: 'Fetch the homepage again.',
    };
    const bodies = [
      { ...base, verdict: `Leak ${secret}` },
      { ...base, topFix: `Leak ${bearer}` },
      { ...base, evidenceNote: `Provider said ${secret}` },
      { ...base, failed: [secret] },
      { ...base, badges: [{ label: 'Citation rate', status: 'measured', value: secret }] },
      {
        ...base,
        crawlerChecks: [{ id: 'llms_txt', label: 'llms.txt', status: 'fail', detail: `blocked ${bearer}` }],
      },
    ];
    for (const body of bodies) {
      const parsed = parseTeaserCreateBody(body);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.toLowerCase()).toContain('credential');
    }
  });

  it('maps allow-listed failure codes and keeps a clean free-text line', () => {
    const parsed = parseTeaserCreateBody({
      domain: 'stripe.com',
      verdict: 'AI mention readiness was not measured.',
      topFix: 'Fetch the homepage again.',
      evidenceNote: 'No search rows.',
      failed: ['page_fetch_empty', 'provider_failed', 'Search sample was empty.'],
      badges: [{ label: 'Citation rate', status: 'measured' }],
      crawlerChecks: [{ id: 'llms_txt', label: 'llms.txt', status: 'fail', detail: 'llms.txt was not found at the site root.' }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.failed).toEqual([
      'Page fetch returned no usable text or schema.',
      'A provider call failed. The public teaser omits the raw error.',
      'Search sample was empty.',
    ]);
    expect(parsed.payload.badges[0]).toEqual({ label: 'Citation rate', status: 'not_measured' });
    expect(parsed.payload.crawlerChecks[0]?.status).toBe('not_measured');
    expect(parsed.payload.crawlerChecks[0]?.detail).toContain('not found');
    expect(parsed.payload.ctaUrl).toBe('https://t.me/LuminaraSuiteBot/app');
    expect(JSON.stringify(parsed.payload)).not.toContain('page_fetch_empty');
  });

  it('rejects private and special-use teaser domains', () => {
    for (const domain of ['localhost', '127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.5', '8.8.8.8', 'printer.local', 'db.internal', 'foo.example']) {
      const parsed = parseTeaserCreateBody({
        domain,
        verdict: 'Not measured.',
        topFix: 'Fetch the homepage.',
      });
      expect(parsed.ok, domain).toBe(false);
    }
  });

  it('rejects a measured percentage so the public card cannot show 97%', async () => {
    const env = makeEnv();
    const createdRes = await worker.fetch(
      new Request('https://luminarasuite.com/api/share/teasers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': freeInit(21),
          origin: 'https://luminarasuite.com',
        },
        body: JSON.stringify({
          domain: 'competitor.com',
          verdict: 'AI mention readiness was not measured.',
          topFix: 'Fetch the homepage again.',
          badges: [{ label: 'Citation rate', status: 'measured', value: '97%' }],
          crawlerChecks: [{ id: 'llms_txt', label: 'llms.txt', status: 'pass', detail: 'Present.' }],
        }),
      }),
      env,
      ctx,
    );
    expect(createdRes.status).toBe(400);
    const created = (await createdRes.json()) as { ok?: boolean; token?: string; error?: string };
    expect(created.ok).toBe(false);
    expect(created.token).toBeUndefined();
    expect(JSON.stringify(created)).not.toContain('97%');
    expect(JSON.stringify(created)).not.toContain('"measured"');
  });

  it('coerces a measured badge with no number to not_measured', () => {
    const parsed = parseTeaserCreateBody({
      domain: 'stripe.com',
      verdict: 'AI mention readiness was not measured.',
      topFix: 'Fetch the homepage again.',
      badges: [
        { label: 'Citation rate', status: 'measured', value: 'high' },
        { label: 'Share of voice', status: 'estimated', value: 'mid' },
      ],
      crawlerChecks: [{ id: 'ai_bot_directives', label: 'AI crawler directives', status: 'pass', detail: 'Named bots are not blocked at /.' }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.badges.every((badge) => badge.status === 'not_measured' && badge.value === undefined)).toBe(true);
    expect(parsed.payload.crawlerChecks.every((check) => check.status === 'not_measured')).toBe(true);
    expect(JSON.stringify(parsed.payload.badges)).not.toContain('97%');
    expect(JSON.stringify(parsed.payload.badges)).not.toContain('"measured"');
  });

  it('stops minting after the daily teaser limit', async () => {
    const env = makeEnv();
    const initData = freeInit(31);
    const post = () => worker.fetch(
      new Request('https://luminarasuite.com/api/share/teasers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
          origin: 'https://luminarasuite.com',
        },
        body: JSON.stringify({
          domain: 'stripe.com',
          verdict: 'AI mention readiness was not measured.',
          topFix: 'Fetch the homepage again.',
          badges: [{ label: 'Citation rate', status: 'not_measured' }],
        }),
      }),
      env,
      ctx,
    );
    for (let i = 0; i < TEASER_DAILY_LIMIT; i++) {
      const ok = await post();
      expect(ok.status, `mint ${i + 1}`).toBe(200);
    }
    const blocked = await post();
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { code?: string };
    expect(body.code).toBe('TEASER_QUOTA');
  });

  it('lets a free Telegram user mint a teaser and still blocks full share links', async () => {
    const env = makeEnv();
    const initData = freeInit();
    const denied = await handleShareRoute(
      new Request('https://luminarasuite.com/api/share/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ markdownText: '# Full report', apiKey: 'sk-should-not-matter' }),
      }),
      env,
      '/share/reports',
    );
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as { code?: string };
    expect(deniedBody.code).toBe('SHARE_ENTITLEMENT_REQUIRED');

    const createdRes = await worker.fetch(
      new Request('https://luminarasuite.com/api/share/teasers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
          origin: 'https://luminarasuite.com',
        },
        body: JSON.stringify({
          domain: 'stripe.com',
          verdict: 'AI mention readiness was not measured.',
          topFix: 'Fetch the homepage again.',
          evidenceNote: 'No search rows.',
          apiKey: 'sk-leak',
          badges: [{ label: 'Citation rate', status: 'not_measured' }],
          failed: ['Search sample was empty.'],
        }),
      }),
      env,
      ctx,
    );
    expect(createdRes.status).toBe(200);
    const created = (await createdRes.json()) as { ok: boolean; token: string; url: string };
    expect(created.ok).toBe(true);
    expect(created.token).toMatch(/^[a-f0-9]{64}$/);
    expect(created.url).toBe(`https://luminarasuite.com/share/teaser/${created.token}`);
    expect(created.url).not.toContain('sk-leak');

    const anon = await worker.fetch(
      new Request('https://luminarasuite.com/api/share/teasers', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://luminarasuite.com' },
        body: JSON.stringify({ domain: 'stripe.com', verdict: 'x', topFix: 'y' }),
      }),
      env,
      ctx,
    );
    expect(anon.status).toBe(401);

    const pub = await worker.fetch(
      new Request(`https://luminarasuite.com/api/share/teasers/${created.token}`),
      env,
      ctx,
    );
    expect(pub.status).toBe(200);
    const body = (await pub.json()) as { teaser: { verdict: string; apiKey?: string; ctaUrl: string } };
    expect(body.teaser.verdict).toContain('not measured');
    expect(body.teaser.apiKey).toBeUndefined();
    expect(body.teaser.ctaUrl).toBe('https://t.me/LuminaraSuiteBot/app');
    expect(JSON.stringify(body)).not.toContain('sk-leak');
  });
});

describe('crawler file fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads only robots.txt and llms.txt for a public host', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cloudflare-dns.com')) {
        if (url.includes('type=AAAA')) {
          return new Response(JSON.stringify({ Status: 0, Answer: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] }), { status: 200 });
      }
      if (url.endsWith('/llms.txt')) return new Response('# Suite\n', { status: 200 });
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /\n', { status: 200 });
      return new Response('no', { status: 404 });
    });
    const loaded = await loadCrawlerSnapshot('https://luminarasuite.com/pricing', fetcher as unknown as typeof fetch);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.snapshot.llmsTxt).toContain('Suite');
    expect(loaded.snapshot.robotsTxt).toContain('Allow: /');
    expect(fetcher.mock.calls.map((call) => String(call[0])).some((url) => url.includes('/wp-admin'))).toBe(false);
  });

  it('rejects private hosts', async () => {
    const loaded = await loadCrawlerSnapshot('http://127.0.0.1/robots.txt', fetch);
    expect(loaded.ok).toBe(false);
  });
});
