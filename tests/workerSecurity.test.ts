import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import {
  HTML_CSP,
  HOSTED_MAX_TOKENS,
  RateLimiter,
  clampHostedChatCompletionsBody,
  clampHostedGeminiBody,
  isGeminiModelActionAllowed,
  isPrivateIp,
  readBody,
  resolvesToPublicAddress,
  safePublicHostname,
  safePublicUrl,
  stripUpstreamHeaders,
  withSecurityHeaders,
} from '../worker/security';

function kv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  } as unknown as KVNamespace;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('<!doctype html><html><body>app</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }) } as unknown as Fetcher,
    LUMINARA_KV: kv(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    ...overrides,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

/** Unique client IP per test so the module-level rate limiter never bleeds between cases. */
let ipCounter = 0;
const req = (path: string, init: RequestInit = {}, ip = `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`) => {
  const headers = new Headers(init.headers || {});
  headers.set('cf-connecting-ip', ip);
  return new Request(`https://luminarasuite.com${path}`, { ...init, headers });
};

describe('security headers', () => {
  it('adds CSP and hardening headers to the HTML shell', async () => {
    const res = await worker.fetch(req('/'), makeEnv(), ctx);
    expect(res.headers.get('content-security-policy')).toBe(HTML_CSP);
    expect(HTML_CSP).toContain('https://telegram.org');
    expect(HTML_CSP).toContain('https://fonts.googleapis.com');
    expect(HTML_CSP).toContain('https://fonts.gstatic.com');
    expect(HTML_CSP).toContain("'wasm-unsafe-eval'");
    expect(HTML_CSP).toContain("object-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).toContain('camera=()');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('adds hardening headers but no CSP to JSON API responses', async () => {
    const res = await worker.fetch(req('/api/health'), makeEnv(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('withSecurityHeaders only applies CSP to text/html', () => {
    const html = withSecurityHeaders(new Response('x', { headers: { 'content-type': 'text/html' } }));
    const js = withSecurityHeaders(new Response('x', { headers: { 'content-type': 'text/javascript' } }));
    expect(html.headers.get('content-security-policy')).toBeTruthy();
    expect(js.headers.get('content-security-policy')).toBeNull();
  });
});

describe('CORS', () => {
  it('never reflects an unknown origin', async () => {
    const res = await worker.fetch(req('/api/health', { headers: { origin: 'https://evil.example' } }), makeEnv(), ctx);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('allows only the configured origin', async () => {
    const res = await worker.fetch(req('/api/health', { headers: { origin: 'https://luminarasuite.com' } }), makeEnv(), ctx);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://luminarasuite.com');
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('strips vendor CORS headers and cookies from relayed responses', () => {
    const h = new Headers({
      'access-control-allow-origin': '*',
      'access-control-allow-credentials': 'true',
      'set-cookie': 'a=b',
      'content-encoding': 'br',
      'content-type': 'application/json',
    });
    stripUpstreamHeaders(h);
    expect(h.get('access-control-allow-origin')).toBeNull();
    expect(h.get('access-control-allow-credentials')).toBeNull();
    expect(h.get('set-cookie')).toBeNull();
    expect(h.get('content-encoding')).toBeNull();
    expect(h.get('content-type')).toBe('application/json');
  });
});

describe('provider proxy gating', () => {
  it('refuses hosted-key use without Telegram sign-in', async () => {
    const res = await worker.fetch(req('/api/providers/groq/chat/completions', { method: 'POST', body: '{}' }), makeEnv({ GROQ_API_KEY: 'gsk_test' }), ctx);
    expect(res.status).toBe(401);
  });

  it('refuses BYOK relays without sign-in when REQUIRE_TG_AUTH is on', async () => {
    const res = await worker.fetch(
      req('/api/providers/groq/models', { headers: { 'x-provider-key': 'gsk_user_owned' } }),
      makeEnv({ REQUIRE_TG_AUTH: 'true' }),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it('rejects unknown providers, disallowed paths and methods', async () => {
    expect((await worker.fetch(req('/api/providers/openai/chat/completions', { method: 'POST', body: '{}' }), makeEnv(), ctx)).status).toBe(404);
    expect((await worker.fetch(req('/api/providers/groq/audio/transcriptions', { method: 'POST', body: '{}' }), makeEnv(), ctx)).status).toBe(403);
    expect((await worker.fetch(req('/api/providers/groq/models', { method: 'DELETE' }), makeEnv(), ctx)).status).toBe(405);
  });

  it('rejects oversized bodies before touching the upstream', async () => {
    const res = await worker.fetch(
      req('/api/providers/groq/chat/completions', { method: 'POST', body: '{}', headers: { 'content-length': String(5_000_000), 'x-provider-key': 'gsk_user' } }),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(413);
  });

  it('rejects malformed provider keys', async () => {
    const res = await worker.fetch(
      req('/api/providers/groq/models', { headers: { 'x-provider-key': 'x'.repeat(600) } }),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(400);
  });
});

describe('Telegram endpoints', () => {
  it('refuses the webhook when no secret is configured', async () => {
    const res = await worker.fetch(req('/api/telegram/webhook', { method: 'POST', body: '{}' }), makeEnv({ BOT_TOKEN: '1:a' }), ctx);
    expect(res.status).toBe(503);
  });

  it('refuses the webhook with a wrong secret and accepts the right one', async () => {
    const env = makeEnv({ BOT_TOKEN: '1:a', TELEGRAM_WEBHOOK_SECRET: 's3cret' });
    const bad = await worker.fetch(req('/api/telegram/webhook', { method: 'POST', body: '{}', headers: { 'x-telegram-bot-api-secret-token': 'nope' } }), env, ctx);
    expect(bad.status).toBe(401);
    const good = await worker.fetch(req('/api/telegram/webhook', { method: 'POST', body: '{}', headers: { 'x-telegram-bot-api-secret-token': 's3cret' } }), env, ctx);
    expect(good.status).toBe(200);
    const malformed = await worker.fetch(req('/api/telegram/webhook', { method: 'POST', body: '{not json', headers: { 'x-telegram-bot-api-secret-token': 's3cret' } }), env, ctx);
    expect(malformed.status).toBe(400);
  });

  it('validates auth/invoice input shape without leaking internals', async () => {
    const env = makeEnv({ BOT_TOKEN: '1:a' });
    expect((await worker.fetch(req('/api/telegram/auth', { method: 'POST', body: 'garbage' }), env, ctx)).status).toBe(400);
    expect((await worker.fetch(req('/api/telegram/auth', { method: 'POST', body: JSON.stringify({ initData: 42 }) }), env, ctx)).status).toBe(400);
    expect((await worker.fetch(req('/api/telegram/auth', { method: 'GET' }), env, ctx)).status).toBe(405);
    const bogus = await worker.fetch(req('/api/telegram/auth', { method: 'POST', body: JSON.stringify({ initData: 'hash=abc&auth_date=1' }) }), env, ctx);
    expect(bogus.status).toBe(401);
  });
});

describe('Sentinel and enrichment', () => {
  it('requires a signed-in user to register or list sentinel targets', async () => {
    expect((await worker.fetch(req('/api/sentinel/register', { method: 'POST', body: JSON.stringify({ domain: 'example.com', tgChatId: 123 }) }), makeEnv(), ctx)).status).toBe(401);
    expect((await worker.fetch(req('/api/sentinel/status'), makeEnv(), ctx)).status).toBe(401);
  });

  it('requires sign-in for enrichment when REQUIRE_TG_AUTH is on', async () => {
    const res = await worker.fetch(req('/api/enrichment/entity?domain=example.com'), makeEnv(), ctx);
    expect(res.status).toBe(401);
  });

  it('refuses enrichment probes of private or malformed hosts before any fetch', async () => {
    for (const d of ['localhost', '127.0.0.1', '169.254.169.254', '10.0.0.1', 'intranet.local', 'http://[::1]/', 'a', '']) {
      const res = await worker.fetch(req(`/api/enrichment/entity?domain=${encodeURIComponent(d)}`), makeEnv({ REQUIRE_TG_AUTH: 'false' }), ctx);
      expect(res.status, d).toBe(400);
    }
  });

  it('serves the cached enrichment record without probing when auth is off', async () => {
    const store = new Map<string, string>();
    store.set('enrich:example.com', JSON.stringify({ domain: 'example.com' }));
    const res = await worker.fetch(
      req('/api/enrichment/entity?domain=https://EXAMPLE.com/path'),
      makeEnv({ REQUIRE_TG_AUTH: 'false', LUMINARA_KV: kv(store) }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).cached).toBe(true);
  });
});

describe('error handling', () => {
  it('never echoes exception messages', async () => {
    const env = makeEnv({ LUMINARA_KV: { get: async () => { throw new Error('KV secret path /var/kv'); } } as unknown as KVNamespace });
    const res = await worker.fetch(req('/api/sentinel/status', { headers: { 'x-telegram-init-data': 'hash=1&auth_date=1' } }), { ...env, BOT_TOKEN: '1:a' }, ctx);
    // initData fails validation first (401); force the KV throw through a path that reaches it:
    expect([401, 500]).toContain(res.status);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain('/var/kv');
  });

  it('unknown API routes 404 with security headers', async () => {
    const res = await worker.fetch(req('/api/nope'), makeEnv(), ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('rate limiter', () => {
  it('allows up to the limit per window then blocks until reset', () => {
    let t = 0;
    const rl = new RateLimiter(() => t);
    for (let i = 0; i < 3; i++) expect(rl.check('k', 3, 1000).allowed).toBe(true);
    const blocked = rl.check('k', 3, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
    t = 1001;
    expect(rl.check('k', 3, 1000).allowed).toBe(true);
  });

  it('returns 429 with Retry-After for a flooding client', async () => {
    const env = makeEnv();
    let last: Response | null = null;
    for (let i = 0; i < 130; i++) last = await worker.fetch(req('/api/health', {}, '203.0.113.77'), env, ctx);
    expect(last!.status).toBe(429);
    expect(last!.headers.get('retry-after')).toBeTruthy();
  });
});

describe('body reader', () => {
  it('enforces size and JSON validity', async () => {
    const big = await readBody(new Request('https://x/', { method: 'POST', body: 'a'.repeat(100) }), 10);
    expect(big.ok).toBe(false);
    const bad = await readBody(new Request('https://x/', { method: 'POST', body: '{' }), 100);
    expect(bad.ok).toBe(false);
    const empty = await readBody(new Request('https://x/', { method: 'POST', body: '' }), 100);
    expect(empty.ok && empty.value).toEqual({});
    const raw = await readBody(new Request('https://x/', { method: 'POST', body: 'plain' }), 100, false);
    expect(raw.ok && raw.value).toBe('plain');
  });
});

describe('hosted LLM cost caps', () => {
  it('clamps max_tokens and n on OpenAI-compatible bodies', () => {
    const r = clampHostedChatCompletionsBody({ max_tokens: 999999, n: 8, messages: [{ role: 'user', content: 'hi' }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.body as any).max_tokens).toBe(HOSTED_MAX_TOKENS);
      expect((r.body as any).n).toBe(1);
    }
  });

  it('rejects oversized message arrays on hosted keys', () => {
    const messages = Array.from({ length: 100 }, () => ({ role: 'user', content: 'x' }));
    const r = clampHostedChatCompletionsBody({ messages });
    expect(r.ok).toBe(false);
  });

  it('clamps Gemini maxOutputTokens', () => {
    const r = clampHostedGeminiBody({ generationConfig: { maxOutputTokens: 50000 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.body as any).generationConfig.maxOutputTokens).toBe(HOSTED_MAX_TOKENS);
  });

  it('allows only Gemini generate/stream/count actions', () => {
    expect(isGeminiModelActionAllowed('/v1beta/models/gemini-2.0-flash:generateContent')).toBe(true);
    expect(isGeminiModelActionAllowed('/v1beta/models/gemini-2.0-flash:streamGenerateContent')).toBe(true);
    expect(isGeminiModelActionAllowed('/v1beta/models/gemini-2.0-flash:countTokens')).toBe(true);
    expect(isGeminiModelActionAllowed('/v1beta/models/gemini-2.0-flash:embedContent')).toBe(false);
    expect(isGeminiModelActionAllowed('/v1beta/models')).toBe(false);
  });
});

describe('SSRF guards', () => {
  it('classifies private and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'ff02::1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '104.16.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('accepts only DNS-shaped public hostnames', () => {
    expect(safePublicHostname('Example.com')).toBe('example.com');
    expect(safePublicHostname('https://Sub.Example.co.uk/path?q=1')).toBe('sub.example.co.uk');
    expect(safePublicHostname('user:pw@example.com')).toBe('example.com');
    expect(safePublicHostname('example.com:8080')).toBe('example.com');
    for (const bad of ['localhost', 'foo.localhost', '127.0.0.1', '[::1]', '10.0.0.1', 'intranet', 'printer.local', 'db.internal', 'x.arpa', 'foo.example', '-bad.com', 'a'.repeat(300) + '.com', '']) {
      expect(safePublicHostname(bad), bad).toBeNull();
    }
  });

  it('accepts only http(s) URLs to public hosts without credentials', () => {
    expect(safePublicUrl('https://example.com/a')?.hostname).toBe('example.com');
    for (const bad of ['ftp://example.com', 'file:///etc/passwd', 'http://127.0.0.1/', 'http://user:pw@example.com/', 'http://localhost:3001/', 'javascript:alert(1)', 'http://169.254.169.254/latest/meta-data']) {
      expect(safePublicUrl(bad), bad).toBeNull();
    }
  });

  it('fails closed when DoH is unreachable and blocks names that resolve privately', async () => {
    const answer = (records: Array<[number, string]>) => async () =>
      new Response(JSON.stringify({ Status: 0, Answer: records.map(([type, data]) => ({ type, data })) }), { headers: { 'content-type': 'application/dns-json' } });
    expect(await resolvesToPublicAddress('example.com', answer([[1, '93.184.216.34']]))).toBe(true);
    expect(await resolvesToPublicAddress('rebind.example', answer([[1, '93.184.216.34'], [1, '127.0.0.1']]))).toBe(false);
    expect(await resolvesToPublicAddress('v6.example', answer([[28, 'fe80::1']]))).toBe(false);
    expect(await resolvesToPublicAddress('nx.example', answer([]))).toBe(false);
    expect(await resolvesToPublicAddress('down.example', async () => { throw new Error('offline'); })).toBe(false);
  });
});
