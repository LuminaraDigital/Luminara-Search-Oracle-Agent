import { describe, expect, it } from 'vitest';
import { fetchPublicPage, PUBLIC_FETCH_MAX_BYTES } from '../worker/publicFetch';
import { isPrivateIp, resolvesToPublicAddress } from '../worker/security';

// Allora CL0-3: the bounded page fetch and the IPv6 ranges it depends on.

const env = { WEBAPP_URL: 'https://luminarasuite.com/', ALLOWED_ORIGINS: 'https://luminarasuite.com,https://app.example.org' };

function dnsAnswer(ip: string): Response {
  const type = ip.includes(':') ? 28 : 1;
  return new Response(JSON.stringify({ Status: 0, Answer: [{ type, data: ip }] }), {
    headers: { 'content-type': 'application/dns-json' },
  });
}

/** Every host resolves to one public address for its asked type. */
const publicDoh = async (url: string) => {
  const type = new URL(url).searchParams.get('type');
  return dnsAnswer(type === 'AAAA' ? '2606:4700:4700::1111' : '93.184.216.34');
};

type Call = { url: string; init?: RequestInit };

function pages(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  };
  return { calls, fetcher };
}

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const redirect = (location: string) => new Response(null, { status: 301, headers: { location } });

describe('fetchPublicPage (Allora CL0-3)', () => {
  it('returns HTML with fixed GET headers', async () => {
    const { calls, fetcher } = pages({ 'https://acme.com/': () => html('<title>Acme</title>') });
    const r = await fetchPublicPage('https://acme.com/', env, { fetcher, dohFetcher: publicDoh });
    expect(r).toEqual({ ok: true, status: 200, finalUrl: 'https://acme.com/', kind: 'html', text: '<title>Acme</title>', truncated: false });
    const headers = new Headers(calls[0].init?.headers);
    expect(calls[0].init?.method).toBe('GET');
    expect(headers.get('user-agent')).toBe('LuminaraOracle/1.0 (+https://luminarasuite.com)');
    expect(calls[0].init?.redirect).toBe('manual');
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('a slow DNS lookup hits the deadline, and the lookup receives the abort signal', async () => {
    let lookupSignal: AbortSignal | undefined;
    const slowDoh = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        lookupSignal = init?.signal ?? undefined;
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const started = Date.now();
    const r = await fetchPublicPage('https://slow.com/', env, { fetcher: async () => html('x'), dohFetcher: slowDoh, deadlineMs: 50 });
    expect(r).toEqual({ ok: false, code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(lookupSignal?.aborted).toBe(true);
  });

  it('cuts a body over the cap, flags it, and cancels the reader', async () => {
    let cancelled = false;
    const chunk = new TextEncoder().encode('a'.repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 20) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { fetcher } = pages({
      'https://big.com/': () => new Response(stream, { headers: { 'content-type': 'text/plain' } }),
    });
    const r = await fetchPublicPage('https://big.com/', env, { fetcher, dohFetcher: publicDoh });
    expect(r.ok && r.truncated).toBe(true);
    expect(r.ok && r.text.length).toBe(PUBLIC_FETCH_MAX_BYTES);
    expect(r.ok && r.kind).toBe('text');
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(20);
  });

  it('refuses a PDF and other non-text types', async () => {
    const { fetcher } = pages({
      'https://docs.com/a.pdf': () => new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
    });
    expect(await fetchPublicPage('https://docs.com/a.pdf', env, { fetcher, dohFetcher: publicDoh })).toEqual({
      ok: false,
      code: 'unsupported_type',
      status: 200,
    });
  });

  it('reports a non-2xx status without reading the body', async () => {
    const { fetcher } = pages({ 'https://acme.com/gone': () => html('not here', 404) });
    expect(await fetchPublicPage('https://acme.com/gone', env, { fetcher, dohFetcher: publicDoh })).toEqual({
      ok: false,
      code: 'http_status',
      status: 404,
    });
  });

  it('refuses a non-default port before any lookup or fetch', async () => {
    const { calls, fetcher } = pages({});
    let lookups = 0;
    const r = await fetchPublicPage('https://acme.com:8443/', env, {
      fetcher,
      dohFetcher: async (u) => {
        lookups += 1;
        return publicDoh(u);
      },
    });
    expect(r).toEqual({ ok: false, code: 'non_default_port' });
    expect(calls).toHaveLength(0);
    expect(lookups).toBe(0);
  });

  it("refuses the Worker's own hosts, their www twins and workers.dev", async () => {
    const { calls, fetcher } = pages({});
    for (const url of ['https://luminarasuite.com/', 'https://www.luminarasuite.com/x', 'https://app.example.org/', 'https://luminara.someone.workers.dev/']) {
      expect(await fetchPublicPage(url, env, { fetcher, dohFetcher: publicDoh }), url).toEqual({ ok: false, code: 'own_host' });
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses a redirect to another host at the hop, and never fetches it', async () => {
    const { calls, fetcher } = pages({ 'https://acme.com/': () => redirect('https://evil.com/') });
    expect(await fetchPublicPage('https://acme.com/', env, { fetcher, dohFetcher: publicDoh })).toEqual({
      ok: false,
      code: 'redirect_off_domain',
    });
    expect(calls.map((c) => c.url)).toEqual(['https://acme.com/']);
  });

  it('refuses a same-host redirect to a non-default port', async () => {
    const { fetcher } = pages({ 'https://acme.com/': () => redirect('https://acme.com:8080/') });
    expect(await fetchPublicPage('https://acme.com/', env, { fetcher, dohFetcher: publicDoh })).toEqual({
      ok: false,
      code: 'redirect_off_domain',
    });
  });

  it('follows the www twin and http to https, up to 3 redirects', async () => {
    const { fetcher } = pages({
      'http://acme.com/': () => redirect('https://acme.com/'),
      'https://acme.com/': () => redirect('https://www.acme.com/'),
      'https://www.acme.com/': () => html('ok'),
    });
    const r = await fetchPublicPage('http://acme.com/', env, { fetcher, dohFetcher: publicDoh });
    expect(r.ok && r.finalUrl).toBe('https://www.acme.com/');

    const loop = pages({
      'https://loop.com/a': () => redirect('/b'),
      'https://loop.com/b': () => redirect('/c'),
      'https://loop.com/c': () => redirect('/d'),
      'https://loop.com/d': () => redirect('/e'),
    });
    expect(await fetchPublicPage('https://loop.com/a', env, { fetcher: loop.fetcher, dohFetcher: publicDoh })).toEqual({
      ok: false,
      code: 'too_many_redirects',
    });
  });

  it('refuses a host whose DNS answer is private', async () => {
    const { calls, fetcher } = pages({});
    const doh = async (url: string) =>
      new URL(url).searchParams.get('type') === 'AAAA' ? dnsAnswer('::7f00:1') : dnsAnswer('93.184.216.34');
    expect(await fetchPublicPage('https://sneaky.com/', env, { fetcher, dohFetcher: doh })).toEqual({
      ok: false,
      code: 'not_public',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('isPrivateIp IPv6 ranges (Allora CL0-3)', () => {
  it('refuses the IPv4-compatible, mapped, site-local, Teredo and discard forms', () => {
    for (const ip of ['::127.0.0.1', '::7f00:1', '0:0:0:0:0:ffff:7f00:1', 'fec0::1', 'feff::1', '2001::1', '2001:0:4136:e378::1', '100::1', '100:0:0:0:ffff::1', '[::1]', 'not:an:ip::zz']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('parses prefixes instead of matching text, so neighbouring public ranges stay public', () => {
    for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111', '2001:db9::1', '100:1::1', '::ffff:8.8.8.8', '0:0:0:0:0:ffff:808:808']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('resolvesToPublicAddress takes an abort signal and fails closed when it fires', async () => {
    const controller = new AbortController();
    const pending = resolvesToPublicAddress(
      'acme.com',
      (_url, init) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
      controller.signal,
    );
    controller.abort();
    expect(await pending).toBe(false);
  });
});
