import type { Env } from './env';
import { billingId, identify, json } from './workerUtils';
import { mintScoutReceipt } from './referrals';
import { scoutEvidenceDomain } from '../services/referrals/rules';
import { isUserSubscribed, checkHostedQuota, refundDailyQuota, type QuotaStatus } from './quotaMiddleware';
import { runWorkersAiChatFallback } from './workersAiFallback';
import {
  MAX_BODY_BYTES,
  clampHostedChatCompletionsBody,
  clampHostedGeminiBody,
  clampHostedFirecrawlCrawlBody,
  clientIp,
  isGeminiModelActionAllowed,
  readBody,
  safePublicHostname,
  safePublicUrl,
  resolvesToPublicAddress,
  stripUpstreamHeaders,
} from './security';
import { dataForSeoBasicAuthHeader, envHasDataForSeo } from '../services/config/runtimeKeys';

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
  dataforseo: {
    base: 'https://api.dataforseo.com',
    allow: [
      '/v3/ai_optimization',
      '/v3/serp',
      '/v3/dataforseo_labs',
      '/v3/backlinks',
      '/v3/domain_analytics',
      '/v3/keywords_data',
    ],
    auth: (env, h) => {
      if (!envHasDataForSeo(env)) return { ok: false };
      const header = dataForSeoBasicAuthHeader(
        `${String(env.DATAFORSEO_LOGIN).trim()}:${String(env.DATAFORSEO_PASSWORD).trim()}`,
      );
      if (!header) return { ok: false };
      h.set('Authorization', header);
      return { ok: true };
    },
    byok: (key, h) => {
      const header = dataForSeoBasicAuthHeader(key);
      if (header) h.set('Authorization', header);
      return {};
    },
  },
};

function makeFallbackResponse(
  aiResult: unknown,
  isStreaming: boolean,
  quotaGate: QuotaStatus | null,
): Response {
  const fallbackHeaders: Record<string, string> = {
    'X-Provider-Fallback': 'workers-ai',
  };
  if (quotaGate) {
    if (quotaGate.isUnlimited) {
      fallbackHeaders['X-Quota-Limit'] = 'unlimited';
      fallbackHeaders['X-Quota-Remaining'] = 'unlimited';
    } else if (quotaGate.limit > 0) {
      fallbackHeaders['X-Quota-Limit'] = String(quotaGate.limit);
      fallbackHeaders['X-Quota-Remaining'] = String(quotaGate.remaining);
      fallbackHeaders['X-Quota-Reset'] = String(quotaGate.resetSec);
      if (typeof quotaGate.bonusRemaining === 'number') {
        fallbackHeaders['X-Quota-Bonus'] = String(quotaGate.bonusRemaining);
      }
    }
  }
  if (isStreaming) {
    const streamHeaders = new Headers({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...fallbackHeaders,
    });
    return new Response(aiResult as BodyInit, { status: 200, headers: streamHeaders });
  }
  return json(aiResult, 200, fallbackHeaders);
}

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
  let scoutAccountId: string | null = null;

  if (!userKey) {
    const who = await identify(request, env);
    if (who.error) {
      return json(
        {
          error: who.error,
          code: 'AUTH_REQUIRED',
        },
        401,
      );
    }
    // Production (REQUIRE_TG_AUTH): hosted keys need a signed-in identity.
    // Staging open-auth may meter anonymous hosted use by IP via checkHostedQuota.
    if (who.user) scoutAccountId = billingId(who.user);
    if (!who.user && env.REQUIRE_TG_AUTH === 'true') {
      return json(
        {
          error: 'Sign in to use hosted AI, or add your own API key in Settings.',
          code: 'AUTH_REQUIRED',
        },
        401,
      );
    }

    // Business AI Paywall Tier Policy:
    // - Groq Cloud LPU is free (subject to daily free quota).
    // - NVIDIA NIM Enterprise, Sovereign Ollama, and OpenRouter are behind our Paid Tier!
    const isPaidSubscriber = await isUserSubscribed(env, who.user);
    const PAID_TIER_PROVIDERS = new Set(['nim', 'ollama', 'openrouter', 'dataforseo']);
    if (!isPaidSubscriber && PAID_TIER_PROVIDERS.has(providerId)) {
      return json(
        {
          error: `The ${providerId.toUpperCase()} engine is a premium feature reserved for active subscribers. Upgrade your plan to use premium hosted AI engines, or bring your own API key in Settings.`,
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

    const actionId = request.headers.get('x-luminara-action-id') || null;
    quotaGate = await checkHostedQuota(env, who.user, {
      clientIp: clientIp(request),
      actionId,
    });
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
    const preview = scoutEvidenceDomain({ providerId, subPath, body, hostname: safePublicHostname });
    if (preview) {
      try {
        const who = await identify(request, env);
        if (who.user) scoutAccountId = billingId(who.user);
      } catch {
        scoutAccountId = null;
      }
    }
  } else {
    const auth = spec.auth(env, headers, body);
    if (!auth.ok) {
      if (isChatCompletionsPath(providerId, subPath) && env.AI) {
        if (request.method !== 'GET') {
          const clamped = clampHostedChatCompletionsBody(body);
          if (!clamped.ok) return json({ error: clamped.error }, 400);
          body = clamped.body;
        }
        try {
          const isStreaming = Boolean(body && typeof body === 'object' && (body as { stream?: boolean }).stream);
          const aiResult = await runWorkersAiChatFallback(env.AI, body);
          return makeFallbackResponse(aiResult, isStreaming, quotaGate);
        } catch (aiErr) {
          console.warn('[Workers AI fallback error for unconfigured provider]', aiErr);
        }
      }
      if (quotaGate?.quotaKeyId) await refundDailyQuota(env, quotaGate.quotaKeyId, 1, quotaGate.actionId);
      return json({ error: `${providerId} is not configured on the server. Add your own key in Settings.` }, 503);
    }
    if (auth.body !== undefined) body = auth.body;

    // Cost caps apply only to hosted keys (BYOK keeps caller-chosen limits).
    if (request.method !== 'GET') {
      if (isChatCompletionsPath(providerId, subPath)) {
        const clamped = clampHostedChatCompletionsBody(body);
        if (!clamped.ok) {
          if (quotaGate?.quotaKeyId) await refundDailyQuota(env, quotaGate.quotaKeyId, 1, quotaGate.actionId);
          return json({ error: clamped.error }, 400);
        }
        body = clamped.body;
      } else if (providerId === 'gemini') {
        const clamped = clampHostedGeminiBody(body);
        if (!clamped.ok) {
          if (quotaGate?.quotaKeyId) await refundDailyQuota(env, quotaGate.quotaKeyId, 1, quotaGate.actionId);
          return json({ error: clamped.error }, 400);
        }
        body = clamped.body;
      } else if (providerId === 'firecrawl' && subPath === '/crawl') {
        const clamped = clampHostedFirecrawlCrawlBody(body);
        if (!clamped.ok) {
          if (quotaGate?.quotaKeyId) await refundDailyQuota(env, quotaGate.quotaKeyId, 1, quotaGate.actionId);
          return json({ error: clamped.error }, 400);
        }
        body = clamped.body;
      }
    }
  }

  // Server-side SSRF validation for crawling/scraping targets
  if (providerId === 'firecrawl' && body && typeof body === 'object') {
    const fcBody = body as { url?: unknown; urls?: unknown };
    const targets: string[] = [];
    if (typeof fcBody.url === 'string' && fcBody.url.trim()) targets.push(fcBody.url.trim());
    if (Array.isArray(fcBody.urls)) {
      for (const u of fcBody.urls) {
        if (typeof u === 'string' && u.trim()) targets.push(u.trim());
      }
    }
    for (const target of targets) {
      const parsed = safePublicUrl(target);
      if (!parsed) {
        if (quotaGate?.quotaKeyId) await refundDailyQuota(env, quotaGate.quotaKeyId, 1, quotaGate.actionId);
        return json(
          { error: 'Target URL is invalid or targets a private/local host (SSRF blocked)', code: 'SSRF_BLOCKED' },
          400,
        );
      }
      const isPublic = await resolvesToPublicAddress(parsed.hostname);
      if (!isPublic) {
        if (quotaGate?.quotaKeyId) await refundDailyQuota(env, quotaGate.quotaKeyId, 1, quotaGate.actionId);
        return json(
          { error: 'Target hostname does not resolve to a public address (SSRF blocked)', code: 'SSRF_BLOCKED' },
          400,
        );
      }
    }
  }

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  } catch (networkErr) {
    if (!userKey && isChatCompletionsPath(providerId, subPath) && env.AI) {
      try {
        const isStreaming = Boolean(body && typeof body === 'object' && (body as { stream?: boolean }).stream);
        const aiResult = await runWorkersAiChatFallback(env.AI, body);
        return makeFallbackResponse(aiResult, isStreaming, quotaGate);
      } catch (aiErr) {
        console.warn('[Workers AI fallback error after network throw]', aiErr);
      }
    }
    if (quotaGate?.quotaKeyId) await refundDailyQuota(env, quotaGate.quotaKeyId, 1, quotaGate.actionId);
    return json({ error: `Upstream connection failed: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}` }, 502);
  }

  // Seamless Groq failover if hosted primary key hits billing (402), auth (401), payload too large (413), or rate limit (429)
  if (!userKey && providerId === 'groq' && (res.status === 401 || res.status === 402 || res.status === 413 || res.status === 429) && env.GROQ_API_KEY_FALLBACK) {
    const fallbackKey = env.GROQ_API_KEY_FALLBACK.trim();
    const currentKey = (headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (fallbackKey && fallbackKey !== currentKey) {
      const fallbackHeaders = new Headers(headers);
      fallbackHeaders.set('Authorization', `Bearer ${fallbackKey}`);
      try {
        const retryRes = await fetch(upstream.toString(), {
          method: request.method,
          headers: fallbackHeaders,
          body: request.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        });
        if (retryRes.ok || retryRes.status < 400) {
          res = retryRes;
        }
      } catch (err) {
        console.warn('[Groq failover error]', err);
      }
    }
  }

  // Fallback to Cloudflare Workers AI edge model if hosted chat completions upstream fails
  if (!userKey && isChatCompletionsPath(providerId, subPath) && (!res.ok || res.status >= 400)) {
    if (env.AI) {
      try {
        const isStreaming = Boolean(body && typeof body === 'object' && (body as { stream?: boolean }).stream);
        const aiResult = await runWorkersAiChatFallback(env.AI, body);
        return makeFallbackResponse(aiResult, isStreaming, quotaGate);
      } catch (aiErr) {
        console.warn('[Workers AI fallback error]', aiErr);
      }
    }
    // If Workers AI also failed or env.AI is not configured, check if it's 402 billing to distinguish BYOK from hosted
    if (res.status === 402) {
      if (quotaGate?.quotaKeyId) await refundDailyQuota(env, quotaGate.quotaKeyId, 1, quotaGate.actionId);
      return json({
        ok: false,
        error: `The hosted ${providerId} service is temporarily unavailable due to upstream provider credit limits. Please add your own ${providerId.toUpperCase()} key in Settings or try again shortly.`,
        code: 'HOSTED_PROVIDER_DEPLETED',
        provider: providerId,
      }, 503);
    }
    // For 413, 429, 5xx, or when fallback throws: refund quota and return normalized friendly error
    if (quotaGate?.quotaKeyId) await refundDailyQuota(env, quotaGate.quotaKeyId, 1, quotaGate.actionId);
    return json({
      error: {
        code: 'AI_UNAVAILABLE',
        message: 'Luminara could not answer right now. Nothing was charged. Try again in a minute.',
      },
    }, 503);
  }

  // Stream the upstream body straight through (SSE for chat completions works unchanged).
  // Vendor CORS headers and cookies are dropped: our own CORS policy is applied by handleApi.
  const out = new Headers(res.headers);
  stripUpstreamHeaders(out);
  if (quotaGate) {
    if (quotaGate.fairUse) {
      out.set('X-Quota-Limit', String(quotaGate.limit));
      out.set('X-Quota-Remaining', String(quotaGate.remaining));
      out.set('X-Quota-Reset', String(quotaGate.resetSec));
      out.set('X-Quota-Fair-Use', 'true');
    } else if (quotaGate.isUnlimited) {
      out.set('X-Quota-Limit', 'unlimited');
      out.set('X-Quota-Remaining', 'unlimited');
    } else if (quotaGate.limit > 0) {
      out.set('X-Quota-Limit', String(quotaGate.limit));
      out.set('X-Quota-Remaining', String(quotaGate.remaining));
      out.set('X-Quota-Reset', String(quotaGate.resetSec));
      if (typeof quotaGate.bonusRemaining === 'number') {
        out.set('X-Quota-Bonus', String(quotaGate.bonusRemaining));
      }
    }
  }
  if (res.ok && scoutAccountId) {
    try {
      const domain = scoutEvidenceDomain({ providerId, subPath, body, hostname: safePublicHostname });
      if (domain) {
        const token = await mintScoutReceipt(env, scoutAccountId, domain);
        if (token) out.set('X-Scout-Receipt', token);
      }
    } catch {
      /* a missed receipt must not fail the provider call */
    }
  }

  // If the upstream provider returned 402 Payment Required (e.g. out of credits on Groq/Firecrawl/Tavily),
  // distinguish server hosted key depletion (503) from caller BYOK key depletion (402) so the user's paywall isn't triggered.
  if (!userKey && res.status === 402) {
    return json({
      ok: false,
      error: `The hosted ${providerId} service is temporarily unavailable due to upstream provider credit limits. Please add your own ${providerId.toUpperCase()} key in Settings or try again shortly.`,
      code: 'HOSTED_PROVIDER_DEPLETED',
      provider: providerId,
    }, 503, Object.fromEntries(out.entries()));
  }

  if (userKey && res.status === 402) {
    return json({
      ok: false,
      error: `Your custom ${providerId} API key returned 402 Payment Required. Please check your account credits or billing on ${providerId}.`,
      code: 'BYOK_PAYMENT_REQUIRED',
      provider: providerId,
    }, 402, Object.fromEntries(out.entries()));
  }

  return new Response(res.body, { status: res.status, headers: out });
}
