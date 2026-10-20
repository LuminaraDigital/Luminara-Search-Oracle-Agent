import type { Env } from './env';
import { billingId, identify, json } from './workerUtils';
import { mintScoutReceipt } from './referrals';
import { scoutEvidenceDomain } from '../services/referrals/rules';
import { isUserSubscribed, checkHostedQuota, refundMeteredQuota, type QuotaStatus } from './quotaMiddleware';
import { noteAuditRunSuccess, requestTargetHost, takeAuditRunCall } from './auditScoutRun';
import { requireApiAccess } from './apiAccess';
import {
  WORKERS_AI_FALLBACK_PROVIDER,
  runWorkersAiChatFallback,
  type WorkersAiFallbackContext,
  type WorkersAiFallbackOutcome,
  type WorkersAiFallbackReason,
} from './workersAiFallback';
import { tryNvidiaChatFallback } from './nvidiaChatFallback';
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

/**
 * Hosted Groq chat is the only path that may fall through to NVIDIA and then Workers AI.
 * Every other provider, and every other Groq path, returns its own result or its own error.
 */
export function isWorkersAiFallbackPath(providerId: string, subPath: string): boolean {
  return providerId === 'groq' && subPath === '/chat/completions';
}

/**
 * Old clients send this header. Hosted Groq chat falls back without it. The header stays
 * allowed so those clients are not rejected at CORS.
 */
export const ACCEPT_FALLBACK_HEADER = 'x-accept-fallback';

/** A short machine-readable value (an error code or type, at most 64 characters), or null. Free text never passes. */
function upstreamErrorField(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(text) ? text : null;
}

/**
 * What an upstream error body says about itself, for a log line: its error code, type and
 * status when they are short identifiers. The error message is never read into this, because a
 * provider's message can quote the request or part of a key.
 */
export function upstreamErrorExcerpt(bodyText: string): { code: string | null; type: string | null; status: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { code: null, type: null, status: null };
  }
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const err = root.error && typeof root.error === 'object' && !Array.isArray(root.error) ? (root.error as Record<string, unknown>) : {};
  return {
    code: upstreamErrorField(err.code) ?? upstreamErrorField(root.code),
    type: upstreamErrorField(err.type) ?? upstreamErrorField(root.type),
    status: upstreamErrorField(err.status) ?? upstreamErrorField(root.status),
  };
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
  outcome: Extract<WorkersAiFallbackOutcome, { answered: true }>,
  quotaGate: QuotaStatus | null,
): Response {
  // The client reads these to show "Answered by a fallback model" with the reply. They arrive
  // before the body, so a streamed reply is labelled too. corsHeaders (workerUtils.ts) exposes
  // them, so a client on another origin can read them as well.
  const fallbackHeaders: Record<string, string> = {
    'X-Provider-Fallback': WORKERS_AI_FALLBACK_PROVIDER,
    'X-Provider-Fallback-Model': outcome.model,
    'X-Provider-Fallback-Reason': outcome.reason,
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
  if (outcome.streaming) {
    const streamHeaders = new Headers({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...fallbackHeaders,
    });
    return new Response(outcome.stream as BodyInit, { status: 200, headers: streamHeaders });
  }
  return json(outcome.completion, 200, fallbackHeaders);
}

/** The other hosted Groq key, when it is set and is not the key already on this request. */
function groqFallbackKey(env: Env, headers: Headers): string | null {
  const fallbackKey = env.GROQ_API_KEY_FALLBACK?.trim() || '';
  if (!fallbackKey) return null;
  const current = (headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return fallbackKey === current ? null : fallbackKey;
}

function headersWithBearer(headers: Headers, key: string): Headers {
  const next = new Headers(headers);
  next.set('Authorization', `Bearer ${key}`);
  return next;
}

/** 401 and 402 stay the hosted-key errors. 429 and 5xx may be answered by Workers AI. */
function workersAiStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function workersAiReason(status: number): WorkersAiFallbackReason {
  return status === 429 ? 'upstream_429' : 'upstream_5xx';
}

/**
 * Asks Workers AI to answer a hosted Groq chat call, or returns null so the caller sends its own error.
 * Bring-your-own-key calls, other providers, and a missing binding are null. A refusal or a binding
 * error is also null. No second quota check: the caller metered this request once.
 */
async function tryWorkersAiFallback(
  env: Env,
  request: Request,
  providerId: string,
  subPath: string,
  userKey: string,
  body: unknown,
  context: WorkersAiFallbackContext,
  quotaGate: QuotaStatus | null,
): Promise<Response | null> {
  if (userKey || !env.AI || request.method !== 'POST') return null;
  if (!isWorkersAiFallbackPath(providerId, subPath)) return null;
  try {
    const outcome = await runWorkersAiChatFallback(env.AI, body, context);
    if (!outcome.answered) return null;
    return makeFallbackResponse(outcome, quotaGate);
  } catch {
    return json({ error: 'The backup model did not answer.', code: 'BACKUP_MODEL_FAILED' }, 503);
  }
}

/** NVIDIA, then Workers AI. Null means both declined, so the caller sends its own error. */
async function tryChatFallbacks(
  env: Env,
  request: Request,
  providerId: string,
  subPath: string,
  userKey: string,
  body: unknown,
  context: WorkersAiFallbackContext,
  quotaGate: QuotaStatus | null,
  accountId: string,
  paid: boolean,
): Promise<Response | null> {
  if (userKey || request.method !== 'POST' || !isWorkersAiFallbackPath(providerId, subPath)) return null;
  const nvidia = await tryNvidiaChatFallback({
    env,
    body,
    reason: context.reason,
    accountId,
    paid,
    quotaGate,
  });
  if (nvidia) return nvidia;
  return tryWorkersAiFallback(env, request, providerId, subPath, userKey, body, context, quotaGate);
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
  let auditCoveredToken = '';
  let auditDomain = '';
  let paidSubscriber = false;
  let fallbackAccountId = 'anon';

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
    paidSubscriber = isPaidSubscriber;
    fallbackAccountId = who.user ? (scoutAccountId || billingId(who.user)) : `anon:${(clientIp(request) || '').trim() || 'unknown'}`;
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
    // APS invariant 2: hosted paid research needs Agency apiAccess (BYOK skips this block entirely).
    if (providerId === 'dataforseo' && who.user) {
      const denied = await requireApiAccess(env, who.user);
      if (denied) return denied;
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

    if (who.user) {
      const claim = await takeAuditRunCall(env, who.user, request);
      if (claim.kind === 'reject') {
        return json({ error: claim.error, code: 'AUDIT_RUN_REJECTED' }, 401);
      }
      if (claim.kind === 'covered') {
        auditCoveredToken = claim.token;
        auditDomain = claim.domain;
      }
    }
    if (!auditCoveredToken) {
      quotaGate = await checkHostedQuota(env, who.user, { clientIp: clientIp(request) });
    }
    if (quotaGate && !quotaGate.ok) {
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

  const deliver = async (response: Response): Promise<Response> => {
    if (auditCoveredToken && response.ok) await noteAuditRunSuccess(env, auditCoveredToken);
    return response;
  };

  const releaseUnmeasured = async (response: Response): Promise<Response> => {
    if (quotaGate?.meterKey) {
      const released = await refundMeteredQuota(env, quotaGate);
      quotaGate = { ...quotaGate, meterKey: undefined };
      if (released.refunded) response.headers.set('X-Quota-Refunded', '1');
    }
    return response;
  };

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
    if (!read.ok) return releaseUnmeasured(json({ error: read.error }, read.status));
    const text = read.text;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = text;
    }
    const targetHost = requestTargetHost(body);
    if (auditCoveredToken && targetHost && targetHost !== auditDomain) {
      return json({ error: 'This audit run is for a different site.', code: 'AUDIT_RUN_REJECTED' }, 401);
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
      // No hosted Groq key. Chat completions try NVIDIA, then Workers AI. Other providers keep their own error.
      if (isWorkersAiFallbackPath(providerId, subPath) && request.method === 'POST') {
        const clamped = clampHostedChatCompletionsBody(body);
        if (!clamped.ok) return releaseUnmeasured(json({ error: clamped.error }, 400));
        body = clamped.body;
        const fallback = await tryChatFallbacks(
          env, request, providerId, subPath, userKey, body,
          { reason: 'provider_not_configured' }, quotaGate, fallbackAccountId, paidSubscriber,
        );
        if (fallback) return fallback.ok ? deliver(fallback) : releaseUnmeasured(fallback);
      }
      return releaseUnmeasured(json({ error: `${providerId} is not configured on the server. Add your own key in Settings.` }, 503));
    }
    if (auth.body !== undefined) body = auth.body;

    // Cost caps apply only to hosted keys (BYOK keeps caller-chosen limits).
    if (request.method !== 'GET') {
      if (isChatCompletionsPath(providerId, subPath)) {
        const clamped = clampHostedChatCompletionsBody(body);
        if (!clamped.ok) return releaseUnmeasured(json({ error: clamped.error }, 400));
        body = clamped.body;
      } else if (providerId === 'gemini') {
        const clamped = clampHostedGeminiBody(body);
        if (!clamped.ok) return releaseUnmeasured(json({ error: clamped.error }, 400));
        body = clamped.body;
      } else if (providerId === 'firecrawl' && subPath === '/crawl') {
        const clamped = clampHostedFirecrawlCrawlBody(body);
        if (!clamped.ok) return releaseUnmeasured(json({ error: clamped.error }, 400));
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
        return releaseUnmeasured(json(
          { error: 'Target URL is invalid or targets a private/local host (SSRF blocked)', code: 'SSRF_BLOCKED' },
          400,
        ));
      }
      const isPublic = await resolvesToPublicAddress(parsed.hostname);
      if (!isPublic) {
        return releaseUnmeasured(json(
          { error: 'Target hostname does not resolve to a public address (SSRF blocked)', code: 'SSRF_BLOCKED' },
          400,
        ));
      }
    }
  }

  const upstreamBody = request.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const callUpstream = (hdrs: Headers) =>
    fetch(upstream.toString(), { method: request.method, headers: hdrs, body: upstreamBody });

  const networkFailure = async (err: unknown): Promise<Response> => {
    const fallback = await tryChatFallbacks(
      env, request, providerId, subPath, userKey, body,
      { reason: 'network_error' }, quotaGate, fallbackAccountId, paidSubscriber,
    );
    if (fallback) return fallback.ok ? deliver(fallback) : releaseUnmeasured(fallback);
    const message = err instanceof Error ? err.message : String(err);
    return releaseUnmeasured(json({ error: `Upstream connection failed: ${message}` }, 502));
  };

  let res: Response;
  let triedFallbackKey = false;
  try {
    res = await callUpstream(headers);
  } catch (networkErr) {
    // Timeout and other connection failures try the other Groq key before Workers AI.
    const altKey = !userKey && providerId === 'groq' ? groqFallbackKey(env, headers) : null;
    if (!altKey) return networkFailure(networkErr);
    triedFallbackKey = true;
    try {
      res = await callUpstream(headersWithBearer(headers, altKey));
    } catch (err) {
      console.warn('[Groq failover error]', err);
      return networkFailure(networkErr);
    }
  }

  // Primary key failed. One try with GROQ_API_KEY_FALLBACK when it is a different key.
  if (
    !triedFallbackKey &&
    !userKey &&
    providerId === 'groq' &&
    (res.status === 401 || res.status === 402 || workersAiStatus(res.status))
  ) {
    const altKey = groqFallbackKey(env, headers);
    if (altKey) {
      triedFallbackKey = true;
      try {
        const retryRes = await callUpstream(headersWithBearer(headers, altKey));
        if (retryRes.ok || retryRes.status < 400 || workersAiStatus(retryRes.status)) res = retryRes;
      } catch (err) {
        console.warn('[Groq failover error]', err);
      }
    }
  }

  // After the second key: 429 and 5xx try NVIDIA, then Workers AI. 401 and 402 are not replaced.
  if (workersAiStatus(res.status)) {
    const fallback = await tryChatFallbacks(
      env, request, providerId, subPath, userKey, body,
      { reason: workersAiReason(res.status), upstreamStatus: res.status },
      quotaGate, fallbackAccountId, paidSubscriber,
    );
    if (fallback) return fallback.ok ? deliver(fallback) : releaseUnmeasured(fallback);
  }

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
    return releaseUnmeasured(json({
      ok: false,
      error: `The hosted ${providerId} service is temporarily unavailable due to upstream provider credit limits. Please add your own ${providerId.toUpperCase()} key in Settings or try again shortly.`,
      code: 'HOSTED_PROVIDER_DEPLETED',
      provider: providerId,
    }, 503, Object.fromEntries(out.entries())));
  }

  if (userKey && res.status === 402) {
    return json({
      ok: false,
      error: `Your custom ${providerId} API key returned 402 Payment Required. Please check your account credits or billing on ${providerId}.`,
      code: 'BYOK_PAYMENT_REQUIRED',
      provider: providerId,
    }, 402, Object.fromEntries(out.entries()));
  }

  // An upstream 401 or 403 on a hosted key says nothing about the caller's own sign-in, but the
  // client reads a 401 or 403 from this route as exactly that (it stops calling every hosted
  // provider for a while). So neither is passed through. Each becomes a 503 that says only what
  // is known: a 401 means the provider refused the server's key; a 403 means it refused this
  // request, which can be the key's permissions or the request itself (a moderation flag, a site
  // it will not fetch). The relay's own 401s above are the caller's session and are unchanged,
  // and a BYOK 401 or 403 is the caller's key and passes through.
  if (!userKey && (res.status === 401 || res.status === 403)) {
    // The upstream's body is replaced, so say what it was in the log: its status and its own
    // error code or type. Never its message, which can quote the request or part of a key.
    let excerpt = upstreamErrorExcerpt('');
    try {
      excerpt = upstreamErrorExcerpt((await res.text()).slice(0, 8_192));
    } catch {
      /* an unreadable body leaves the excerpt empty */
    }
    console.warn(JSON.stringify({
      event: 'hosted_provider_refused',
      provider: providerId,
      upstream_status: res.status,
      upstream_error_code: excerpt.code,
      upstream_error_type: excerpt.type,
      upstream_error_status: excerpt.status,
    }));

    // The body below is ours, so the upstream's content type (it may have sent HTML) is not kept.
    const passed = Object.fromEntries(out.entries());
    delete passed['content-type'];

    const keyRefused = res.status === 401;
    return releaseUnmeasured(json({
      ok: false,
      error: keyRefused
        ? `The hosted ${providerId} service is temporarily unavailable: the provider refused the hosted key. This is not a problem with your sign-in. Please add your own ${providerId.toUpperCase()} key in Settings or try again shortly.`
        : `The hosted ${providerId} service refused this request. This is not a problem with your sign-in. You can add your own ${providerId.toUpperCase()} key in Settings.`,
      code: keyRefused ? 'HOSTED_PROVIDER_KEY_REFUSED' : 'HOSTED_PROVIDER_REQUEST_REFUSED',
      provider: providerId,
      upstreamStatus: res.status,
    }, 503, passed));
  }

  if (!res.ok) {
    // Groq 429/5xx that Workers AI also could not answer is one failed call: 503, quota refunded.
    const status =
      !userKey && request.method === 'POST' && isWorkersAiFallbackPath(providerId, subPath) && workersAiStatus(res.status)
        ? 503
        : res.status;
    return releaseUnmeasured(new Response(res.body, { status, headers: out }));
  }
  return deliver(new Response(res.body, { status: res.status, headers: out }));
}
