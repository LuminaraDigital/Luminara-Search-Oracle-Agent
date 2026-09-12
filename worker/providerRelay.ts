import type { Env } from './env';
import { identify, json } from './workerUtils';
import { isUserSubscribed, checkHostedQuota, type QuotaStatus } from './quotaMiddleware';
import {
  MAX_BODY_BYTES,
  clampHostedChatCompletionsBody,
  clampHostedGeminiBody,
  clampHostedFirecrawlCrawlBody,
  isGeminiModelActionAllowed,
  readBody,
  stripUpstreamHeaders,
} from './security';

export const MAX_PROVIDER_KEY_LEN = 512;

export interface ProviderSpec {
  base: string | ((env: Env) => string);
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

/** OpenAI-compatible chat completion paths that get hosted token caps. */
export function isChatCompletionsPath(providerId: string, subPath: string): boolean {
  if (providerId === 'ollama') {
    return subPath === '/v1/chat/completions' || subPath === '/api/chat' || subPath === '/api/generate';
  }
  return subPath === '/chat/completions';
}

export const PROVIDERS: Record<string, ProviderSpec> = {
  groq: {
    base: 'https://api.groq.com/openai/v1',
    allow: ['/chat/completions', '/models'],
    auth: (env, h) => {
      const key = env.GROQ_API_KEY || env.GROQ_API_KEY_FALLBACK;
      if (!key) return { ok: false };
      h.set('Authorization', `Bearer ${key}`);
      return { ok: true };
    },
    byok: (key, h) => {
      h.set('Authorization', `Bearer ${key}`);
      return {};
    },
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
    base: (env: Env) => (env.OLLAMA_BASE_URL ? env.OLLAMA_BASE_URL.replace(/\/+$/, '') : 'https://ollama.com'),
    allow: ['/v1/chat/completions', '/v1/models', '/api/tags', '/api/generate', '/api/chat'],
    auth: (env, h) => {
      if (!env.OLLAMA_API_KEY) return { ok: false };
      h.set('Authorization', `Bearer ${env.OLLAMA_API_KEY}`);
      return { ok: true };
    },
    byok: (key, h) => {
      h.set('Authorization', `Bearer ${key}`);
      return {};
    },
  },
  openrouter: {
    base: 'https://openrouter.ai/api/v1',
    allow: ['/chat/completions', '/models'],
    auth: (env, h) => {
      if (!env.OPENROUTER_API_KEY) return { ok: false };
      h.set('Authorization', `Bearer ${env.OPENROUTER_API_KEY}`);
      h.set('HTTP-Referer', env.WEBAPP_URL || 'https://luminarasuite.com');
      h.set('X-Title', 'Luminara Suite');
      return { ok: true };
    },
    byok: (key, h) => {
      h.set('Authorization', `Bearer ${key}`);
      h.set('HTTP-Referer', 'https://luminarasuite.com');
      h.set('X-Title', 'Luminara Suite');
      return {};
    },
  },
  gemini: {
    base: 'https://generativelanguage.googleapis.com',
    // Prefix kept for isPathAllowed; proxyProvider also requires isGeminiModelActionAllowed.
    allow: ['/v1beta/models'],
    auth: (env, h) => {
      if (!env.GEMINI_API_KEY) return { ok: false };
      h.set('x-goog-api-key', env.GEMINI_API_KEY);
      return { ok: true };
    },
    byok: (key, h) => {
      h.set('x-goog-api-key', key);
      return {};
    },
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
    // /crawl is paid-tier only on hosted keys (see proxyProvider).
    allow: ['/scrape', '/crawl', '/map'],
    auth: (env, h) => {
      if (!env.FIRECRAWL_API_KEY) return { ok: false };
      h.set('Authorization', `Bearer ${env.FIRECRAWL_API_KEY}`);
      return { ok: true };
    },
    byok: (key, h) => {
      h.set('Authorization', `Bearer ${key}`);
      return {};
    },
  },
  exa: {
    base: 'https://api.exa.ai',
    allow: ['/search', '/contents', '/findSimilar'],
    auth: (env, h) => {
      if (!env.EXA_API_KEY) return { ok: false };
      h.set('x-api-key', env.EXA_API_KEY);
      return { ok: true };
    },
    byok: (key, h) => {
      h.set('x-api-key', key);
      return {};
    },
  },
};

export async function proxyProvider(
  request: Request,
  env: Env,
  providerId: string,
  subPath: string
): Promise<Response> {
  const spec = PROVIDERS[providerId];
  if (!spec) return json({ error: `Unknown provider "${providerId}"` }, 404);
  if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!isPathAllowed(spec, subPath)) {
    return json({ error: `Path not allowed for ${providerId}: ${subPath}` }, 403);
  }
  if (providerId === 'gemini' && !isGeminiModelActionAllowed(subPath)) {
    return json({ error: `Path not allowed for gemini: ${subPath}` }, 403);
  }

  // Bring-your-own-key: the caller's credential is forwarded and the hosted key is never touched.
  // This is how browser-blocked vendors (NVIDIA NIM has no CORS headers) work for self-served users.
  // BYOK does not require sign-in: the caller pays the vendor, and Settings promises keys work without hosted auth.
  // Hosted keys (no x-provider-key) still require identify + quota / tier checks below.
  const userKey = request.headers.get('x-provider-key')?.trim() || '';
  if (userKey.length > MAX_PROVIDER_KEY_LEN || /[\r\n]/.test(userKey)) return json({ error: 'Invalid provider key' }, 400);

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return json({ error: 'Request body too large' }, 413);

  let quotaGate: QuotaStatus | null = null;

  if (!userKey) {
    const who = await identify(request, env);
    if (who.error) return json({ error: who.error }, 401);

    // Business AI Paywall Tier Policy:
    // - Groq Cloud LPU is free (subject to daily free quota).
    // - NVIDIA NIM Enterprise, Sovereign Ollama, and OpenRouter are behind our Paid Tier!
    const isPaidSubscriber = await isUserSubscribed(env, who.user);
    const PAID_TIER_PROVIDERS = new Set(['nim', 'ollama', 'openrouter']);
    if (!isPaidSubscriber && PAID_TIER_PROVIDERS.has(providerId)) {
      return json(
        {
          error: `The ${providerId.toUpperCase()} engine is a premium feature reserved for active subscribers. Upgrade with Telegram Stars or TON to access NVIDIA NIM, Sovereign Ollama, and OpenRouter, or bring your own API key in Settings.`,
          code: 'TIER_UPGRADE_REQUIRED',
          requiredTier: 'paid',
          provider: providerId,
          upgrade: true,
        },
        402,
        {
          'X-Quota-Tier': 'paid_required',
        }
      );
    }

    // Site-wide Firecrawl crawls are expensive; require an active plan on hosted keys.
    const firecrawlCrawl = providerId === 'firecrawl' && (subPath === '/crawl' || subPath.startsWith('/crawl/'));
    if (firecrawlCrawl && !isPaidSubscriber) {
      return json(
        {
          error: 'Hosted Firecrawl /crawl requires an active plan. Use /scrape, subscribe, or bring your own Firecrawl key.',
          code: 'TIER_UPGRADE_REQUIRED',
          requiredTier: 'paid',
          provider: providerId,
          upgrade: true,
        },
        402,
        { 'X-Quota-Tier': 'paid_required' }
      );
    }

    quotaGate = await checkHostedQuota(env, who.user);
    if (!quotaGate.ok) {
      return json(
        {
          error: quotaGate.error,
          code: 'PAYWALL_EXCEEDED',
          limit: quotaGate.limit,
          used: quotaGate.used,
          remaining: quotaGate.remaining,
          resetSec: quotaGate.resetSec,
          upgrade: true,
        },
        402,
        {
          'X-Quota-Limit': String(quotaGate.limit),
          'X-Quota-Remaining': '0',
          'X-Quota-Reset': String(quotaGate.resetSec),
        }
      );
    }
  }

  const url = new URL(request.url);
  const baseUrl = typeof spec.base === 'function' ? spec.base(env) : spec.base;
  const upstream = new URL(baseUrl + subPath + url.search);
  const headers = new Headers();
  headers.set('content-type', request.headers.get('content-type') || 'application/json');
  const accept = request.headers.get('accept');
  if (accept) headers.set('accept', accept);

  let body: unknown = undefined;
  if (request.method !== 'GET') {
    const read = await readBody(request, MAX_BODY_BYTES, false);
    if (!read.ok) return json({ error: read.error }, read.status);
    const text = read.text;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = text;
    }
  }
  if (userKey) {
    const r = spec.byok(userKey, headers, body);
    if (r.body !== undefined) body = r.body;
  } else {
    const auth = spec.auth(env, headers, body);
    if (!auth.ok) return json({ error: `${providerId} is not configured on the server. Add your own key in Settings.` }, 503);
    if (auth.body !== undefined) body = auth.body;

    // Cost caps apply only to hosted keys (BYOK keeps caller-chosen limits).
    if (request.method !== 'GET') {
      if (isChatCompletionsPath(providerId, subPath)) {
        const clamped = clampHostedChatCompletionsBody(body);
        if (!clamped.ok) return json({ error: clamped.error }, 400);
        body = clamped.body;
      } else if (providerId === 'gemini') {
        const clamped = clampHostedGeminiBody(body);
        if (!clamped.ok) return json({ error: clamped.error }, 400);
        body = clamped.body;
      } else if (providerId === 'firecrawl' && subPath === '/crawl') {
        const clamped = clampHostedFirecrawlCrawlBody(body);
        if (!clamped.ok) return json({ error: clamped.error }, 400);
        body = clamped.body;
      }
    }
  }

  const res = await fetch(upstream.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

  // Stream the upstream body straight through (SSE for chat completions works unchanged).
  // Vendor CORS headers and cookies are dropped: our own CORS policy is applied by handleApi.
  const out = new Headers(res.headers);
  stripUpstreamHeaders(out);
  if (quotaGate) {
    if (quotaGate.isUnlimited) {
      out.set('X-Quota-Limit', 'unlimited');
      out.set('X-Quota-Remaining', 'unlimited');
    } else if (quotaGate.limit > 0) {
      out.set('X-Quota-Limit', String(quotaGate.limit));
      out.set('X-Quota-Remaining', String(quotaGate.remaining));
      out.set('X-Quota-Reset', String(quotaGate.resetSec));
    }
  }
  return new Response(res.body, { status: res.status, headers: out });
}
