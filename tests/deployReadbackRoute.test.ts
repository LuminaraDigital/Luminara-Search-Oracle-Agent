import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import { DEPLOY_READBACK_PER_MIN } from '../worker/deployReadback';

/**
 * POST /api/deploy/readback, driven through worker.fetch so the wiring in worker/index.ts is
 * covered too. No test here reaches the network: global fetch is replaced by a fake that
 * answers DNS-over-HTTPS lookups and serves the fake site, and throws on anything else.
 */

const botToken = '123456:READBACK_TEST';
const DOH = 'https://cloudflare-dns.com/dns-query';

function signInitData(userId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Owner' }),
  };
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

function makeEnv(): Env {
  const store = new Map<string, string>();
  const kv = {
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
    list: async () => ({ keys: [] as { name: string }[], list_complete: true, cacheStatus: null }),
  };
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: kv as unknown as KVNamespace,
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    BOT_TOKEN: botToken,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

const schema = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme', url: 'https://my-site.com/' };
const schemaJsonLd = JSON.stringify(schema, null, 2);

const page = (head: string) =>
  `<!doctype html><html><head><title>Acme</title>${head}</head><body><h1>UNCHANGED-PAGE-BODY</h1></body></html>`;
const ldScript = (json: string) => `<script type="application/ld+json">${json}</script>`;
const unchangedPage = page(ldScript(JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Acme' })));

type Site = Record<string, () => Response>;

/** Fake network. `dns` maps a hostname to the A record the resolver reports (default: a public address). */
function fakeNetwork(site: Site, dns: Record<string, string> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(DOH)) {
      const q = new URL(url).searchParams;
      const host = q.get('name') || '';
      const answer = q.get('type') === 'A' ? [{ type: 1, data: dns[host] ?? '93.184.216.34' }] : [];
      return new Response(JSON.stringify({ Status: 0, Answer: answer }), {
        headers: { 'content-type': 'application/dns-json' },
      });
    }
    const serve = site[url];
    if (!serve) throw new Error(`unexpected network call: ${url}`);
    return serve();
  });
}

const siteCalls = (spy: ReturnType<typeof fakeNetwork>) =>
  spy.mock.calls.map((c) => String(c[0])).filter((u) => !u.startsWith(DOH));

let nextIp = 1;
function call(env: Env, body: unknown, opts: { userId?: number; method?: string; ip?: string } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('cf-connecting-ip', opts.ip ?? `198.51.100.${nextIp++}`);
  if (opts.userId) headers.set('x-telegram-init-data', signInitData(opts.userId));
  const method = opts.method ?? 'POST';
  return worker.fetch(
    new Request('https://luminarasuite.com/api/deploy/readback', {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
    env,
    ctx,
  );
}

type Body = { ok: boolean; found?: boolean; code?: string; error?: string };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/deploy/readback: who may call it', () => {
  it('refuses a guest with 401 and fetches nothing', async () => {
    const spy = fakeNetwork({ 'https://my-site.com/': () => new Response(page(ldScript(schemaJsonLd))) });
    const res = await call(makeEnv(), { url: 'https://my-site.com/', schemaJsonLd });
    expect(res.status).toBe(401);
    const data = (await res.json()) as Body;
    expect(data.ok).toBe(false);
    expect(data.code).toBe('AUTH_REQUIRED');
    expect(data.found).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  // Each row trips one of the two counters only, so losing either one fails a row.
  it.each([
    ['one address, however many accounts use it', (i: number) => ({ userId: 9200 + i, ip: '198.51.100.251' })],
    ['one account, however many addresses it uses', (i: number) => ({ userId: 9300, ip: `198.51.100.${200 + i}` })],
  ])(`stops ${DEPLOY_READBACK_PER_MIN} calls a minute from %s, before fetching anything`, async (_label, caller) => {
    const spy = fakeNetwork({ 'https://my-site.com/': () => new Response(unchangedPage) });
    const env = makeEnv();
    for (let i = 0; i < DEPLOY_READBACK_PER_MIN; i++) {
      const ok = await call(env, { url: 'https://my-site.com/', schemaJsonLd }, caller(i));
      expect(ok.status, `call ${i + 1}`).toBe(200);
    }
    const fetchedBefore = siteCalls(spy).length;
    const limited = await call(env, { url: 'https://my-site.com/', schemaJsonLd }, caller(DEPLOY_READBACK_PER_MIN));
    expect(limited.status).toBe(429);
    expect(siteCalls(spy).length).toBe(fetchedBefore);
  });

  // A GET carries no CSRF check for cookie sessions, so it must never start a fetch.
  it('answers 405 to a GET and fetches nothing', async () => {
    const spy = fakeNetwork({});
    const res = await call(makeEnv(), null, { userId: 9004, method: 'GET' });
    expect(res.status).toBe(405);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('POST /api/deploy/readback: where it may reach', () => {
  it.each([
    'http://127.0.0.1/',
    'https://localhost/',
    'https://2130706433/',
    'https://10.0.0.5/',
    'https://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'https://[::1]/',
    'https://[fe80::1]/',
    'https://[fd12:3456::1]/',
    'https://user:pass@my-site.com/',
    'file:///etc/passwd',
  ])('refuses %s before any lookup or fetch', async (url) => {
    const spy = fakeNetwork({});
    const res = await call(makeEnv(), { url, schemaJsonLd }, { userId: 9010 });
    expect(res.status).toBe(400);
    const data = (await res.json()) as Body;
    expect(data.ok).toBe(false);
    expect(data.code).toBe('UNSAFE_URL');
    expect(data.found).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['a private address', '10.0.0.5'],
    ['loopback', '127.0.0.1'],
    ['a link-local address', '169.254.169.254'],
  ])('refuses a public name that resolves to %s', async (_label, address) => {
    const spy = fakeNetwork(
      { 'https://rebind-alias.com/': () => new Response(page(ldScript(schemaJsonLd))) },
      { 'rebind-alias.com': address },
    );
    const res = await call(makeEnv(), { url: 'https://rebind-alias.com/', schemaJsonLd }, { userId: 9011 });
    expect(res.status).toBe(422);
    const data = (await res.json()) as Body;
    expect(data.ok).toBe(false);
    expect(data.found).toBeUndefined();
    expect(siteCalls(spy)).toEqual([]);
  });

  it('refuses to follow a redirect to a private address', async () => {
    const spy = fakeNetwork({
      'https://my-site.com/': () => new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/' } }),
      'http://169.254.169.254/latest/': () => new Response(page(ldScript(schemaJsonLd))),
    });
    const res = await call(makeEnv(), { url: 'https://my-site.com/', schemaJsonLd }, { userId: 9012 });
    expect(res.status).toBe(422);
    expect(((await res.json()) as Body).found).toBeUndefined();
    expect(siteCalls(spy)).toEqual(['https://my-site.com/']);
  });

  it('refuses a redirect to a public name that resolves to a private address', async () => {
    const spy = fakeNetwork(
      {
        'https://my-site.com/': () => new Response(null, { status: 301, headers: { Location: 'https://rebind-alias.com/' } }),
        'https://rebind-alias.com/': () => new Response(page(ldScript(schemaJsonLd))),
      },
      { 'rebind-alias.com': '192.168.1.10' },
    );
    const res = await call(makeEnv(), { url: 'https://my-site.com/', schemaJsonLd }, { userId: 9013 });
    expect(res.status).toBe(422);
    expect(siteCalls(spy)).toEqual(['https://my-site.com/']);
  });
});

describe('POST /api/deploy/readback: what it answers', () => {
  it('says found: false for an unchanged page and returns none of the page', async () => {
    fakeNetwork({ 'https://my-site.com/': () => new Response(unchangedPage) });
    const res = await call(makeEnv(), { url: 'https://my-site.com/', schemaJsonLd }, { userId: 9020 });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, found: false });
    expect(text).not.toContain('UNCHANGED-PAGE-BODY');
  });

  it('says found: true when the page now holds the schema, and still returns none of the page', async () => {
    fakeNetwork({ 'https://my-site.com/': () => new Response(page(ldScript(schemaJsonLd))) });
    const res = await call(makeEnv(), { url: 'https://my-site.com/', schemaJsonLd }, { userId: 9021 });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, found: true });
    expect(text).not.toContain('UNCHANGED-PAGE-BODY');
    expect(text).not.toContain('Acme');
  });

  it('follows a redirect to another public page and reads that page', async () => {
    const spy = fakeNetwork({
      'https://my-site.com/': () => new Response(null, { status: 301, headers: { Location: 'https://www.my-site.com/' } }),
      'https://www.my-site.com/': () => new Response(page(ldScript(schemaJsonLd))),
    });
    const res = await call(makeEnv(), { url: 'https://my-site.com/', schemaJsonLd }, { userId: 9022 });
    expect(await res.json()).toEqual({ ok: true, found: true });
    expect(siteCalls(spy)).toEqual(['https://my-site.com/', 'https://www.my-site.com/']);
  });

  it.each([
    ['HTTP 500', () => new Response('oops', { status: 500 })],
    ['HTTP 404', () => new Response(page(ldScript(schemaJsonLd)), { status: 404 })],
  ])('does not answer found or not found when the site answers %s', async (_label, serve) => {
    fakeNetwork({ 'https://my-site.com/': serve });
    const res = await call(makeEnv(), { url: 'https://my-site.com/', schemaJsonLd }, { userId: 9023 });
    expect(res.status).toBe(422);
    const data = (await res.json()) as Body;
    expect(data.ok).toBe(false);
    expect(data.code).toBe('PAGE_NOT_READ');
    expect(data.found).toBeUndefined();
  });

  it('does not answer found or not found when the site cannot be reached', async () => {
    fakeNetwork({
      'https://my-site.com/': () => {
        throw new Error('connection reset');
      },
    });
    const res = await call(makeEnv(), { url: 'https://my-site.com/', schemaJsonLd }, { userId: 9024 });
    expect(res.status).toBe(422);
    expect(((await res.json()) as Body).found).toBeUndefined();
  });

  it('does not call a page unchanged when it was too large to read to the end', async () => {
    const huge = `<html><head>${'<!-- pad -->'.repeat(200_000)}${ldScript(schemaJsonLd)}</head></html>`;
    fakeNetwork({ 'https://my-site.com/': () => new Response(huge) });
    const res = await call(makeEnv(), { url: 'https://my-site.com/', schemaJsonLd }, { userId: 9025 });
    expect(res.status).toBe(422);
    const data = (await res.json()) as Body;
    expect(data.code).toBe('PAGE_TOO_LARGE');
    expect(data.found).toBeUndefined();
  });

  it.each([
    ['no url', { schemaJsonLd }, 'BAD_REQUEST'],
    ['no schema', { url: 'https://my-site.com/' }, 'BAD_REQUEST'],
    ['a schema that is not JSON', { url: 'https://my-site.com/', schemaJsonLd: '{not-json' }, 'INVALID_SCHEMA'],
    ['a schema that is a bare string', { url: 'https://my-site.com/', schemaJsonLd: '"Acme"' }, 'INVALID_SCHEMA'],
  ])('answers 400 to %s and fetches nothing', async (_label, body, code) => {
    const spy = fakeNetwork({});
    const res = await call(makeEnv(), body, { userId: 9026 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Body).code).toBe(code);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('POST /api/deploy/readback: what counts as the schema being in the page', () => {
  let userId = 9100;
  async function found(html: string): Promise<boolean | undefined> {
    fakeNetwork({ 'https://my-site.com/': () => new Response(html) });
    const res = await call(makeEnv(), { url: 'https://my-site.com/', schemaJsonLd }, { userId: userId++ });
    vi.restoreAllMocks();
    return ((await res.json()) as Body).found;
  }

  it('finds the schema however the CMS re-encoded it', async () => {
    const reordered = JSON.stringify({ url: schema.url, name: 'Acme', '@type': 'Organization', '@context': schema['@context'] });
    const slashEscaped = reordered.replace(/\//g, '\\/');
    expect(slashEscaped).toContain('https:\\/\\/schema.org');
    expect(await found(page(ldScript(slashEscaped)))).toBe(true);
    expect(await found(page(`<SCRIPT class="x" TYPE='application/ld+json'>\n${schemaJsonLd}\n</SCRIPT>`))).toBe(true);
    expect(await found(page(ldScript(JSON.stringify([{ '@type': 'WebSite' }, schema]))))).toBe(true);
    expect(await found(page(`${ldScript('{"@type":"WebSite"}')}<script>var a = 1 > 0;</script>${ldScript(schemaJsonLd)}`))).toBe(true);
  });

  it('does not count a different schema, or the same text outside a JSON-LD block', async () => {
    expect(await found(page(ldScript(JSON.stringify({ ...schema, name: 'Other' }))))).toBe(false);
    expect(await found(page(ldScript(JSON.stringify({ '@type': 'Organization', name: 'Acme' }))))).toBe(false);
    expect(await found(page(`<pre>${schemaJsonLd}</pre>`))).toBe(false);
    expect(await found(page(`<script type="text/plain">${schemaJsonLd}</script>`))).toBe(false);
    expect(await found(page(ldScript('{broken json')))).toBe(false);
    expect(await found('')).toBe(false);
  });
});
