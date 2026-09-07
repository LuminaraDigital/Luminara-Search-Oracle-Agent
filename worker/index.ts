/**
 * Luminara Suite - Cloudflare Worker
 *
 * Serves the built Vite app as static assets and exposes a small API:
 *   GET  /api/health                      which providers are configured server-side
 *   POST /api/providers/:id/<path>        authenticated proxy to LLM / search / scrape vendors
 *   POST /api/telegram/webhook            Telegram bot updates (secret-token protected)
 *   POST /api/telegram/auth               validates Mini App initData, returns user + plan
 *   POST /api/telegram/invoice            creates a Telegram Stars invoice link for a plan
 *
 * Provider keys and the bot token live only here (wrangler secrets), never in the client bundle.
 */

import { validateInitData, type TelegramUser } from './telegramAuth';
import { handleTelegramUpdate, createInvoiceLink, PLANS } from './telegramBot';

export interface Env {
  ASSETS: Fetcher;
  LUMINARA_KV: KVNamespace;
  BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  WEBAPP_URL: string;
  ALLOWED_ORIGINS?: string;
  /** "true": hosted provider keys need a signed-in Telegram user. */
  REQUIRE_TG_AUTH?: string;
  /** "true": hosted provider keys additionally need an active paid plan. */
  REQUIRE_SUBSCRIPTION?: string;
  /** Requests per user per UTC day on hosted keys without a paid plan (0 = unlimited). */
  FREE_DAILY_LIMIT?: string;
  GROQ_API_KEY?: string;
  GROQ_API_KEY_FALLBACK?: string;
  NVIDIA_API_KEY?: string;
  NVIDIA_ORG_ID?: string;
  GEMINI_API_KEY?: string;
  OLLAMA_API_KEY?: string;
  TAVILY_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  EXA_API_KEY?: string;
}

interface ProviderSpec {
  base: string;
  /** Only these path prefixes (after the provider id) may be proxied. */
  allow: string[];
  /** Applies the hosted (server) credential. */
  auth: (env: Env, headers: Headers, body: unknown) => { ok: boolean; body?: unknown };
  /** Applies a caller-supplied credential (bring-your-own-key). */
  byok: (key: string, headers: Headers, body: unknown) => { body?: unknown };
}

/** Pure helper so the allowlist can be unit-tested. */
export function isPathAllowed(spec: { allow: string[] } | undefined, subPath: string): boolean {
  if (!spec) return false;
  return spec.allow.some(p => subPath === p || subPath.startsWith(`${p}/`) || subPath.startsWith(`${p}:`));
}

const PROVIDERS: Record<string, ProviderSpec> = {
  groq: {
    base: 'https://api.groq.com/openai/v1',
    allow: ['/chat/completions', '/models'],
    auth: (env, h) => {
      const key = env.GROQ_API_KEY || env.GROQ_API_KEY_FALLBACK;
      if (!key) return { ok: false };
      h.set('Authorization', `Bearer ${key}`);
      return { ok: true };
    },
    byok: (key, h) => { h.set('Authorization', `Bearer ${key}`); return {}; },
  },
  nim: {
    base: 'https://integrate.api.nvidia.com/v1',
    allow: ['/chat/completions', '/models'],
    auth: (env, h) => {
      if (!env.NVIDIA_API_KEY) return { ok: false };
      h.set('Authorization', `Bearer ${env.NVIDIA_API_KEY}`);
      if (env.NVIDIA_ORG_ID) h.set('NV-Organization-ID', env.NVIDIA_ORG_ID);
      return { ok: true };
    },
    byok: (key, h) => {
      // "key" may be "nvapi-...|orgId" so users with an org-scoped key can pass both.
      const [k, org] = key.split('|');
      h.set('Authorization', `Bearer ${k}`);
      if (org) h.set('NV-Organization-ID', org);
      return {};
    },
  },
  ollama: {
    base: 'https://ollama.com',
    allow: ['/v1/chat/completions', '/api/tags'],
    auth: (env, h) => {
      if (!env.OLLAMA_API_KEY) return { ok: false };
      h.set('Authorization', `Bearer ${env.OLLAMA_API_KEY}`);
      return { ok: true };
    },
    byok: (key, h) => { h.set('Authorization', `Bearer ${key}`); return {}; },
  },
  gemini: {
    base: 'https://generativelanguage.googleapis.com',
    allow: ['/v1beta/models'],
    auth: (env, h) => {
      if (!env.GEMINI_API_KEY) return { ok: false };
      h.set('x-goog-api-key', env.GEMINI_API_KEY);
      return { ok: true };
    },
    byok: (key, h) => { h.set('x-goog-api-key', key); return {}; },
  },
  tavily: {
    base: 'https://api.tavily.com',
    allow: ['/search'],
    auth: (env, _h, body) => {
      if (!env.TAVILY_API_KEY) return { ok: false };
      // Tavily takes the key in the JSON body.
      return { ok: true, body: { ...(body as object), api_key: env.TAVILY_API_KEY } };
    },
    byok: (key, _h, body) => ({ body: { ...(body as object), api_key: key } }),
  },
  firecrawl: {
    base: 'https://api.firecrawl.dev/v1',
    allow: ['/scrape', '/crawl', '/map'],
    auth: (env, h) => {
      if (!env.FIRECRAWL_API_KEY) return { ok: false };
      h.set('Authorization', `Bearer ${env.FIRECRAWL_API_KEY}`);
      return { ok: true };
    },
    byok: (key, h) => { h.set('Authorization', `Bearer ${key}`); return {}; },
  },
  exa: {
    base: 'https://api.exa.ai',
    allow: ['/search', '/contents', '/findSimilar'],
    auth: (env, h) => {
      if (!env.EXA_API_KEY) return { ok: false };
      h.set('x-api-key', env.EXA_API_KEY);
      return { ok: true };
    },
    byok: (key, h) => { h.set('x-api-key', key); return {}; },
  },
};

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } });

function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || env.WEBAPP_URL || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.some(a => origin === a || origin === a.replace(/\/$/, ''));
  return ok
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, x-telegram-init-data, x-provider-key, authorization, x-goog-api-key, x-goog-api-client',
        'Vary': 'Origin',
      }
    : {};
}

/** Identifies the caller: a validated Telegram user, or null when auth is optional and absent. */
async function identify(request: Request, env: Env): Promise<{ user: TelegramUser | null; error?: string }> {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData) {
    return env.REQUIRE_TG_AUTH === 'true' ? { user: null, error: 'Telegram sign-in required' } : { user: null };
  }
  if (!env.BOT_TOKEN) return { user: null, error: 'Server has no BOT_TOKEN configured' };
  const result = await validateInitData(initData, env.BOT_TOKEN);
  return result.ok ? { user: result.user } : { user: null, error: result.reason };
}

async function proxyProvider(request: Request, env: Env, providerId: string, subPath: string): Promise<Response> {
  const spec = PROVIDERS[providerId];
  if (!spec) return json({ error: `Unknown provider "${providerId}"` }, 404);
  if (!isPathAllowed(spec, subPath)) {
    return json({ error: `Path not allowed for ${providerId}: ${subPath}` }, 403);
  }

  // Bring-your-own-key: the caller's credential is forwarded and the hosted key is never touched.
  // This is how browser-blocked vendors (NVIDIA NIM has no CORS headers) work for self-served users.
  const userKey = request.headers.get('x-provider-key')?.trim() || '';

  if (!userKey) {
    const who = await identify(request, env);
    if (who.error) return json({ error: who.error }, 401);
    const gate = await checkHostedQuota(env, who.user);
    if (!gate.ok) return json({ error: gate.error, upgrade: true }, 402);
  }

  const url = new URL(request.url);
  const upstream = new URL(spec.base + subPath + url.search);
  const headers = new Headers();
  headers.set('content-type', request.headers.get('content-type') || 'application/json');
  const accept = request.headers.get('accept');
  if (accept) headers.set('accept', accept);

  let body: unknown = undefined;
  if (request.method !== 'GET') {
    const text = await request.text();
    try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  }
  if (userKey) {
    const r = spec.byok(userKey, headers, body);
    if (r.body !== undefined) body = r.body;
  } else {
    const auth = spec.auth(env, headers, body);
    if (!auth.ok) return json({ error: `${providerId} is not configured on the server. Add your own key in Settings.` }, 503);
    if (auth.body !== undefined) body = auth.body;
  }

  const res = await fetch(upstream.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  // Stream the upstream body straight through (SSE for chat completions works unchanged).
  const out = new Headers(res.headers);
  out.delete('content-encoding');
  out.delete('content-length');
  return new Response(res.body, { status: res.status, headers: out });
}

/**
 * Hosted keys are a paid resource. Signed-in users get FREE_DAILY_LIMIT requests per day;
 * an active subscription lifts the cap. Anonymous access is allowed only when REQUIRE_TG_AUTH is off.
 */
async function checkHostedQuota(env: Env, user: TelegramUser | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!user) return env.REQUIRE_TG_AUTH === 'true'
    ? { ok: false, error: 'Sign in through Telegram or add your own API key in Settings.' }
    : { ok: true };

  const sub = (await env.LUMINARA_KV.get(`sub:${user.id}`, 'json')) as { expiresAt?: number } | null;
  const active = Boolean(sub?.expiresAt && sub.expiresAt > Date.now());
  if (active) return { ok: true };
  if (env.REQUIRE_SUBSCRIPTION === 'true') return { ok: false, error: 'This feature needs an active plan. Subscribe with Telegram Stars or add your own API key in Settings.' };

  const limit = Number(env.FREE_DAILY_LIMIT || 0);
  if (limit <= 0) return { ok: true };
  const day = new Date().toISOString().slice(0, 10);
  const key = `quota:${user.id}:${day}`;
  const used = Number((await env.LUMINARA_KV.get(key)) || 0);
  if (used >= limit) return { ok: false, error: `Daily free limit of ${limit} requests reached. Subscribe for unlimited use or add your own API key in Settings.` };
  await env.LUMINARA_KV.put(key, String(used + 1), { expirationTtl: 2 * 86400 });
  return { ok: true };
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const cors = corsHeaders(env, request);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const withCors = async (p: Promise<Response> | Response) => {
    const r = await p;
    Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v));
    return r;
  };

  if (path === '/health') {
    const configured = Object.fromEntries(Object.keys(PROVIDERS).map(id => [id, PROVIDERS[id].auth(env, new Headers(), {}).ok]));
    return withCors(json({
      ok: true,
      providers: configured,
      byok: Object.keys(PROVIDERS),
      telegram: Boolean(env.BOT_TOKEN),
      requireAuth: env.REQUIRE_TG_AUTH === 'true',
      requireSubscription: env.REQUIRE_SUBSCRIPTION === 'true',
      freeDailyLimit: Number(env.FREE_DAILY_LIMIT || 0),
      plans: PLANS,
    }));
  }

  const m = path.match(/^\/providers\/([a-z]+)(\/.*)$/);
  if (m) return withCors(proxyProvider(request, env, m[1], m[2]));

  if (path === '/telegram/webhook' && request.method === 'POST') {
    if (!env.BOT_TOKEN) return json({ error: 'BOT_TOKEN not configured' }, 503);
    const secret = request.headers.get('x-telegram-bot-api-secret-token');
    if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) return json({ error: 'bad secret' }, 401);
    const update = await request.json();
    ctx.waitUntil(handleTelegramUpdate(update, env));
    return json({ ok: true });
  }

  if (path === '/telegram/auth' && request.method === 'POST') {
    const { initData } = (await request.json().catch(() => ({}))) as { initData?: string };
    if (!initData) return withCors(json({ error: 'initData required' }, 400));
    if (!env.BOT_TOKEN) return withCors(json({ error: 'BOT_TOKEN not configured' }, 503));
    const v = await validateInitData(initData, env.BOT_TOKEN);
    if (!v.ok) return withCors(json({ error: v.reason }, 401));
    const sub = await env.LUMINARA_KV.get(`sub:${v.user.id}`, 'json');
    return withCors(json({ ok: true, user: v.user, subscription: sub, startParam: v.startParam }));
  }

  if (path === '/telegram/invoice' && request.method === 'POST') {
    const { initData, plan } = (await request.json().catch(() => ({}))) as { initData?: string; plan?: string };
    if (!initData || !plan) return withCors(json({ error: 'initData and plan required' }, 400));
    if (!env.BOT_TOKEN) return withCors(json({ error: 'BOT_TOKEN not configured' }, 503));
    const v = await validateInitData(initData, env.BOT_TOKEN);
    if (!v.ok) return withCors(json({ error: v.reason }, 401));
    const link = await createInvoiceLink(env, v.user.id, plan);
    return withCors(link.ok ? json({ ok: true, url: link.url }) : json({ error: link.error }, 400));
  }

  return withCors(json({ error: 'Not found' }, 404));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, ctx);
      } catch (e: any) {
        return json({ error: e?.message || 'Internal error' }, 500);
      }
    }
    // Static assets with SPA fallback (configured in wrangler.jsonc).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
