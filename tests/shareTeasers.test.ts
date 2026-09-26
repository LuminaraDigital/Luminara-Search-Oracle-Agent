import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { handleShareRoute, parseTeaserCreateBody } from '../worker/shareService';
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
