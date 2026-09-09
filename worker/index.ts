/**
 * Luminara Suite - Cloudflare Worker
 *
 * Serves the built Vite app as static assets and exposes a small API:
 *   GET  /api/health                      which providers are configured server-side
 *   GET  /api/auth/session                current Telegram or Firebase identity (if signed in)
 *   GET  /api/enrichment/entity           signed-in Wikidata & Wayback Machine edge resolution with KV cache
 *   POST /api/providers/:id/<path>        authenticated proxy to LLM / search / scrape vendors
 *   *    /api/sidecars/:id/<path>         relay to self-hosted helpers: "languagetool" (Writing check)
 *                                         and "umami" (Results tracking); allow-listed, not metered
 *   POST /api/telegram/webhook            Telegram bot updates (secret-token protected)
 *   POST /api/telegram/auth               validates Mini App initData, returns user + plan
 *   POST /api/telegram/invoice            creates a Telegram Stars invoice link for a plan
 *
 * Provider keys and the bot token live only here (wrangler secrets), never in the client bundle.
 * Firebase ID tokens are verified with Google JWKS (FIREBASE_PROJECT_ID); no Admin private key needed.
 */

import { validateInitData } from './telegramAuth';
import { bearerFromAuthorization, verifyFirebaseIdToken } from './firebaseAuth';
import { handleTelegramUpdate, createInvoiceLink, sendTelegramAlert, PLANS, planCapsFor } from './telegramBot';
import { createTonInvoice, verifyTonPayment, TON_PRICING } from './tonPayment';
import {
  MAX_BODY_BYTES,
  MAX_SMALL_BODY_BYTES,
  RateLimiter,
  clampHostedChatCompletionsBody,
  clampHostedGeminiBody,
  clientIp,
  isGeminiModelActionAllowed,
  readBody,
  resolvesToPublicAddress,
  safePublicHostname,
  stripUpstreamHeaders,
  withSecurityHeaders,
} from './security';
import { withAccountId, linkTelegramAndFirebase, resolveAccountId, getWorkspace, putWorkspace, type WorkspacePayload } from './userStore';
import type { HostedIdentity } from './userTypes';

export type { HostedIdentity } from './userTypes';

/** Best-effort per-isolate limits (see security.ts). Authenticated hosted-key use is also metered in KV. */
const limiter = new RateLimiter();
const RATE_API_PER_MIN = 120; // any /api/* call, per IP
const RATE_PROVIDER_PER_MIN = 60; // provider / sidecar relays, per IP
const RATE_AUTH_PER_MIN = 20; // initData validation endpoints, per IP
const MAX_PROVIDER_KEY_LEN = 512;

export interface Env {
  ASSETS: Fetcher;
  LUMINARA_KV?: KVNamespace;
  /** Optional D1 users DB. When unset, profiles fall back to KV `user:{id}`. */
  DB?: D1Database;
  BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  WEBAPP_URL: string;
  ALLOWED_ORIGINS?: string;
  /** "true": app use needs a signed-in Telegram or Firebase user (hosted keys and BYOK relays). */
  REQUIRE_TG_AUTH?: string;
  /** "true": hosted provider keys additionally need an active paid plan. */
  REQUIRE_SUBSCRIPTION?: string;
  /** Requests per user per UTC day on hosted keys without a paid plan (0 = unlimited). */
  FREE_DAILY_LIMIT?: string;
  /** Firebase / GCP project id used to verify Auth ID tokens (public; not a secret). */
  FIREBASE_PROJECT_ID?: string;
  GROQ_API_KEY?: string;
  GROQ_API_KEY_FALLBACK?: string;
  NVIDIA_API_KEY?: string;
  NVIDIA_ORG_ID?: string;
  OPENROUTER_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OLLAMA_API_KEY?: string;
  /** Sovereign Ollama endpoint override (e.g. https://my-ollama.internal:11434). Defaults to https://ollama.com */
  OLLAMA_BASE_URL?: string;
  TAVILY_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  EXA_API_KEY?: string;
  /** Self-hosted LanguageTool server, e.g. https://writing.example.com (no trailing path). */
  LANGUAGETOOL_URL?: string;
  /** Self-hosted Umami (https://stats.example.com) or Umami Cloud (https://api.umami.is). */
  UMAMI_URL?: string;
  /** Umami API key (secret). Preferred over username/password. */
  UMAMI_API_KEY?: string;
  /** Self-hosted Umami login used to mint a bearer token when no API key is set (secrets). */
  UMAMI_USERNAME?: string;
  UMAMI_PASSWORD?: string;
  TON_RECEIVING_ADDRESS?: string;
  TON_API_KEY?: string;
}

interface ProviderSpec {
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
function isChatCompletionsPath(providerId: string, subPath: string): boolean {
  if (providerId === 'ollama') {
    return subPath === '/v1/chat/completions' || subPath === '/api/chat' || subPath === '/api/generate';
  }
  return subPath === '/chat/completions';
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
    base: (env: Env) => (env.OLLAMA_BASE_URL ? env.OLLAMA_BASE_URL.replace(/\/+$/, '') : 'https://ollama.com'),
    allow: ['/v1/chat/completions', '/api/tags', '/api/generate', '/api/chat'],
    auth: (env, h) => {
      if (!env.OLLAMA_API_KEY) return { ok: false };
      h.set('Authorization', `Bearer ${env.OLLAMA_API_KEY}`);
      return { ok: true };
    },
    byok: (key, h) => { h.set('Authorization', `Bearer ${key}`); return {}; },
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
    // /crawl is paid-tier only on hosted keys (see proxyProvider).
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
        'Access-Control-Expose-Headers': 'x-quota-limit, x-quota-remaining, x-quota-reset',
        'Vary': 'Origin',
      }
    : {};
}

/** Constant-time string comparison for shared secrets (webhook token). */
function secretEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Identifies the caller:
 * 1) Telegram Mini App initData (x-telegram-init-data), or
 * 2) Firebase Auth ID token (Authorization: Bearer …),
 * and when BOTH are present, links them onto one account_id so Stars/TON/Stripe share entitlements.
 * Upserts a durable user row when identity succeeds.
 * Returns null when auth is optional and absent.
 */
async function identify(request: Request, env: Env): Promise<{ user: HostedIdentity | null; error?: string }> {
  const initData = request.headers.get('x-telegram-init-data');
  const bearer = bearerFromAuthorization(request.headers.get('authorization'));

  let telegramUser: HostedIdentity | null = null;
  let firebaseUser: HostedIdentity | null = null;

  if (initData) {
    if (!env.BOT_TOKEN) return { user: null, error: 'Server has no BOT_TOKEN configured' };
    const result = await validateInitData(initData, env.BOT_TOKEN);
    if (!result.ok) return { user: null, error: result.reason };
    const tg = result.user;
    telegramUser = {
      id: String(tg.id),
      source: 'telegram',
      name: [tg.first_name, tg.last_name].filter(Boolean).join(' ') || tg.username,
    };
  }

  if (bearer && env.FIREBASE_PROJECT_ID) {
    const result = await verifyFirebaseIdToken(bearer, env.FIREBASE_PROJECT_ID);
    if (!result.ok) {
      // Telegram-only callers still succeed when Firebase token is bad/expired.
      if (!telegramUser) return { user: null, error: result.reason };
    } else {
      firebaseUser = {
        id: `fb:${result.user.uid}`,
        source: 'firebase',
        email: result.user.email,
        name: result.user.name,
      };
    }
  }

  if (telegramUser && firebaseUser) {
    try {
      const linked = await linkTelegramAndFirebase(
        env,
        telegramUser.id,
        firebaseUser.id.replace(/^fb:/, ''),
        { email: firebaseUser.email, name: firebaseUser.name, tgName: telegramUser.name },
      );
      // Prefer Telegram identity inside the Mini App; accountId is shared either way.
      const primary = initData ? telegramUser : firebaseUser;
      return { user: { ...primary, accountId: linked.accountId } };
    } catch {
      /* fall through to single-identity upsert */
    }
  }

  const primary = telegramUser || firebaseUser;
  if (primary) {
    try {
      return { user: await withAccountId(env, primary) };
    } catch {
      return { user: primary };
    }
  }

  if (env.REQUIRE_TG_AUTH === 'true') {
    const hint = env.FIREBASE_PROJECT_ID
      ? 'Sign in with Firebase or open the app inside Telegram.'
      : 'Telegram sign-in required';
    return { user: null, error: hint };
  }
  return { user: null };
}

function billingId(user: HostedIdentity): string {
  return user.accountId || user.id;
}
export async function proxyProvider(request: Request, env: Env, providerId: string, subPath: string): Promise<Response> {
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
  // When REQUIRE_TG_AUTH is on, an account is still required (Telegram or Firebase) even for BYOK.
  const userKey = request.headers.get('x-provider-key')?.trim() || '';
  if (userKey.length > MAX_PROVIDER_KEY_LEN || /[\r\n]/.test(userKey)) return json({ error: 'Invalid provider key' }, 400);

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return json({ error: 'Request body too large' }, 413);

  let quotaGate: QuotaStatus | null = null;

  if (userKey) {
    if (env.REQUIRE_TG_AUTH === 'true') {
      const who = await identify(request, env);
      if (who.error || !who.user) return json({ error: who.error || 'Sign in required' }, 401);
    }
  } else {
    const who = await identify(request, env);
    if (who.error) return json({ error: who.error }, 401);

    // Business AI Paywall Tier Policy:
    // - Groq Cloud LPU is free (subject to daily free quota).
    // - NVIDIA NIM Enterprise, Sovereign Ollama, and OpenRouter are behind our Paid Tier!
    const isPaidSubscriber = await isUserSubscribed(env, who.user);
    const PAID_TIER_PROVIDERS = new Set(['nim', 'ollama', 'openrouter']);
    if (!isPaidSubscriber && PAID_TIER_PROVIDERS.has(providerId)) {
      return json({
        error: `The ${providerId.toUpperCase()} engine is a premium feature reserved for active subscribers. Upgrade with Telegram Stars or TON to access NVIDIA NIM, Sovereign Ollama, and OpenRouter, or bring your own API key in Settings.`,
        code: 'TIER_UPGRADE_REQUIRED',
        requiredTier: 'paid',
        provider: providerId,
        upgrade: true,
      }, 402, {
        'X-Quota-Tier': 'paid_required',
      });
    }

    // Site-wide Firecrawl crawls are expensive; require an active plan on hosted keys.
    const firecrawlCrawl = providerId === 'firecrawl' && (subPath === '/crawl' || subPath.startsWith('/crawl/'));
    if (firecrawlCrawl && !isPaidSubscriber) {
      return json({
        error: 'Hosted Firecrawl /crawl requires an active plan. Use /scrape, subscribe, or bring your own Firecrawl key.',
        code: 'TIER_UPGRADE_REQUIRED',
        requiredTier: 'paid',
        provider: providerId,
        upgrade: true,
      }, 402, { 'X-Quota-Tier': 'paid_required' });
    }

    quotaGate = await checkHostedQuota(env, who.user);
    if (!quotaGate.ok) {
      return json({
        error: quotaGate.error,
        code: 'PAYWALL_EXCEEDED',
        limit: quotaGate.limit,
        used: quotaGate.used,
        remaining: quotaGate.remaining,
        resetSec: quotaGate.resetSec,
        upgrade: true,
      }, 402, {
        'X-Quota-Limit': String(quotaGate.limit),
        'X-Quota-Remaining': '0',
        'X-Quota-Reset': String(quotaGate.resetSec),
      });
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
    try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
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
      }
    }
  }

  const res = await fetch(upstream.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
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

// ---- Sidecars: self-hosted helper services -------------------------------------------------
//
// "languagetool" powers the Writing check feature, "umami" powers Results tracking. Both are
// cheap self-hosted calls, so they follow the same sign-in rule as hosted provider keys but are
// NOT counted against the daily quota. Credentials never leave the Worker.

type SidecarId = 'languagetool' | 'umami';

const SIDECAR_LABEL: Record<SidecarId, string> = { languagetool: 'Writing check', umami: 'Results tracking' };
const SIDECAR_TIMEOUT_MS = 15_000;
const UMAMI_TOKEN_KV_KEY = 'umami:token';
const UMAMI_TOKEN_TTL_SEC = 12 * 3600;

/** Read-only Umami API surface: the website list and per-website stats/metrics/pageviews/sessions. */
const UMAMI_PATH_RE = /^\/api\/websites(\/[A-Za-z0-9-]+\/(stats|metrics|pageviews|sessions))?$/;

/** Pure helper (unit-tested): which sidecar routes the relay will forward. `subPath` excludes the query string. */
export function isSidecarPathAllowed(id: string, method: string, subPath: string): boolean {
  const m = method.toUpperCase();
  if (id === 'languagetool') {
    return (m === 'POST' && subPath === '/v2/check') || (m === 'GET' && subPath === '/v2/languages');
  }
  if (id === 'umami') {
    return m === 'GET' && UMAMI_PATH_RE.test(subPath);
  }
  return false;
}

/**
 * Pure helper (unit-tested): builds the upstream Umami URL. Self-hosted Umami serves /api/...;
 * Umami Cloud (api.umami.is) serves the same resources under /v1/....
 */
export function umamiUpstreamPath(base: string, subPath: string): string {
  const root = base.replace(/\/+$/, '');
  let host = '';
  try { host = new URL(root).hostname.toLowerCase(); } catch { host = ''; }
  const path = host === 'api.umami.is' ? subPath.replace(/^\/api(?=\/|\?|$)/, '/v1') : subPath;
  return root + path;
}

function sidecarNotConfigured(id: SidecarId): Response {
  return json({ error: `${SIDECAR_LABEL[id]} is not set up on the server. Add a URL in Settings or ask your admin.` }, 503);
}

function isSidecarConfigured(env: Env, id: SidecarId): boolean {
  if (id === 'languagetool') return Boolean(env.LANGUAGETOOL_URL);
  return Boolean(env.UMAMI_URL && (env.UMAMI_API_KEY || (env.UMAMI_USERNAME && env.UMAMI_PASSWORD)));
}

async function fetchWithTimeout(input: string, init: RequestInit, ms: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && ((e as { name?: string }).name === 'AbortError' || /abort/i.test(String((e as { message?: string }).message || ''))));
}

/** Copies an upstream response for the browser, dropping headers that no longer apply after re-framing. */
function relayResponse(res: Response): Response {
  const out = new Headers(res.headers);
  stripUpstreamHeaders(out);
  return new Response(res.body, { status: res.status, headers: out });
}

/** Logs into self-hosted Umami and caches the bearer token in KV. Returns null on failure. */
async function umamiLogin(env: Env): Promise<string | null> {
  if (!env.UMAMI_URL || !env.UMAMI_USERNAME || !env.UMAMI_PASSWORD) return null;
  try {
    const res = await fetchWithTimeout(`${env.UMAMI_URL.replace(/\/+$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: env.UMAMI_USERNAME, password: env.UMAMI_PASSWORD }),
    }, SIDECAR_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { token?: string };
    if (!data.token) return null;
    try { if (env.LUMINARA_KV) await env.LUMINARA_KV.put(UMAMI_TOKEN_KV_KEY, data.token, { expirationTtl: UMAMI_TOKEN_TTL_SEC }); } catch { /* KV optional in dev */ }
    return data.token;
  } catch {
    return null;
  }
}

async function proxySidecar(request: Request, env: Env, id: SidecarId, subPath: string): Promise<Response> {
  const url = new URL(request.url);
  if (!isSidecarPathAllowed(id, request.method, subPath)) {
    return json({ error: `Path not allowed for ${id}: ${request.method} ${subPath}` }, 403);
  }
  if (!isSidecarConfigured(env, id)) return sidecarNotConfigured(id);

  // Same sign-in rule as hosted provider keys, but no daily quota and no bring-your-own-key here.
  const who = await identify(request, env);
  if (who.error) return json({ error: who.error }, 401);

  const timeoutMessage = `${SIDECAR_LABEL[id]} took too long to answer. Try again in a moment.`;
  const unreachableMessage = `${SIDECAR_LABEL[id]} could not be reached. Ask your admin to check the service.`;

  if (id === 'languagetool') {
    const upstream = env.LANGUAGETOOL_URL!.replace(/\/+$/, '') + subPath + url.search;
    const headers = new Headers();
    const ct = request.headers.get('content-type');
    if (ct) headers.set('content-type', ct);
    const accept = request.headers.get('accept');
    if (accept) headers.set('accept', accept);
    try {
      const res = await fetchWithTimeout(upstream, {
        method: request.method,
        headers,
        body: request.method === 'GET' ? undefined : await request.text(),
      }, SIDECAR_TIMEOUT_MS);
      return relayResponse(res);
    } catch (e) {
      return json({ error: isAbortError(e) ? timeoutMessage : unreachableMessage }, isAbortError(e) ? 504 : 502);
    }
  }

  // umami
  const upstream = umamiUpstreamPath(env.UMAMI_URL!, subPath) + url.search;
  const accept = request.headers.get('accept');
  const baseHeaders: Record<string, string> = { accept: accept || 'application/json' };

  const send = (token: string) => fetchWithTimeout(upstream, {
    method: 'GET',
    // Umami Cloud reads x-umami-api-key; self-hosted Umami reads a bearer token. Each ignores the other.
    headers: { ...baseHeaders, 'x-umami-api-key': token, authorization: `Bearer ${token}` },
  }, SIDECAR_TIMEOUT_MS);

  try {
    if (env.UMAMI_API_KEY) return relayResponse(await send(env.UMAMI_API_KEY));

    let cached: string | null = null;
    try { cached = env.LUMINARA_KV ? await env.LUMINARA_KV.get(UMAMI_TOKEN_KV_KEY) : null; } catch { cached = null; }
    let token = cached || (await umamiLogin(env));
    if (!token) return json({ error: `${SIDECAR_LABEL[id]} sign-in failed on the server. Ask your admin to check the username and password.` }, 502);

    let res = await send(token);
    if (res.status === 401 && cached) {
      // The cached token expired or was revoked: log in again once and retry.
      try { if (env.LUMINARA_KV) await env.LUMINARA_KV.delete(UMAMI_TOKEN_KV_KEY); } catch { /* ignore */ }
      token = await umamiLogin(env);
      if (!token) return json({ error: `${SIDECAR_LABEL[id]} sign-in failed on the server. Ask your admin to check the username and password.` }, 502);
      res = await send(token);
    }
    return relayResponse(res);
  } catch (e) {
    return json({ error: isAbortError(e) ? timeoutMessage : unreachableMessage }, isAbortError(e) ? 504 : 502);
  }
}

export interface QuotaStatus {
  ok: boolean;
  error?: string;
  limit: number;
  used: number;
  remaining: number;
  resetSec: number;
  isUnlimited: boolean;
}

/**
 * Checks whether a user has an active paid subscription stored in KV (sub:<accountId>).
 * Also accepts legacy sub:<loginId> rows written before account linking.
 * Stars, TON, and (later) Stripe all write the same key shape.
 */
export type SubRow = { plan?: string; expiresAt?: number; paymentMethod?: string };

export async function getActiveSubscription(
  env: Env,
  user: HostedIdentity | null,
): Promise<SubRow | null> {
  if (!user || !env.LUMINARA_KV) return null;
  try {
    const accountId = user.accountId || (await resolveAccountId(env, user.id));
    for (const key of [`sub:${accountId}`, `sub:${user.id}`]) {
      const sub = (await env.LUMINARA_KV.get(key, 'json')) as SubRow | null;
      if (sub?.expiresAt && sub.expiresAt > Date.now()) return sub;
    }
    return null;
  } catch {
    return null;
  }
}

export async function isUserSubscribed(env: Env, user: HostedIdentity | null): Promise<boolean> {
  return !!(await getActiveSubscription(env, user));
}

/**
 * Hosted keys are a paid resource. Signed-in users get FREE_DAILY_LIMIT requests per day;
 * an active subscription lifts the cap. Anonymous access is allowed only when REQUIRE_TG_AUTH is off.
 */
export async function checkHostedQuota(env: Env, user: HostedIdentity | null): Promise<QuotaStatus> {
  const now = new Date();
  const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const resetSec = Math.max(0, Math.floor((midnightUtc.getTime() - now.getTime()) / 1000));
  const limit = Number(env.FREE_DAILY_LIMIT || 0);

  if (!user) {
    if (env.REQUIRE_TG_AUTH === 'true') {
      return { ok: false, error: 'Sign in or add your own API key in Settings.', limit, used: 0, remaining: 0, resetSec, isUnlimited: false };
    }
    return { ok: true, limit, used: 0, remaining: limit > 0 ? limit : -1, resetSec, isUnlimited: limit <= 0 };
  }

  if (!env.LUMINARA_KV) {
    // Fail closed when auth/metering is required: without KV we cannot enforce quotas.
    if (env.REQUIRE_TG_AUTH === 'true' && limit > 0) {
      return {
        ok: false,
        error: 'Quota store unavailable. Try again later or add your own API key in Settings.',
        limit,
        used: 0,
        remaining: 0,
        resetSec,
        isUnlimited: false,
      };
    }
    return { ok: true, limit, used: 0, remaining: limit > 0 ? limit : -1, resetSec, isUnlimited: limit <= 0 };
  }

  const accountId = user.accountId || (await resolveAccountId(env, user.id));
  if (await isUserSubscribed(env, { ...user, accountId })) {
    return { ok: true, limit: -1, used: 0, remaining: -1, resetSec, isUnlimited: true };
  }

  if (env.REQUIRE_SUBSCRIPTION === 'true') {
    return {
      ok: false,
      error: user.source === 'telegram'
        ? 'This feature needs an active plan. Subscribe with Telegram Stars or TON, or add your own API key in Settings.'
        : 'This feature needs an active plan. Add your own API key in Settings, or subscribe with TON/Stars.',
      limit,
      used: 0,
      remaining: 0,
      resetSec,
      isUnlimited: false,
    };
  }

  if (limit <= 0) {
    return { ok: true, limit: 0, used: 0, remaining: -1, resetSec, isUnlimited: true };
  }

  const day = now.toISOString().slice(0, 10);
  const key = `quota:${accountId}:${day}`;
  const used = Number((await env.LUMINARA_KV.get(key)) || 0);

  if (used >= limit) {
    return {
      ok: false,
      error: `Daily free limit of ${limit} requests reached. Subscribe for unlimited use or add your own API key in Settings.`,
      limit,
      used,
      remaining: 0,
      resetSec,
      isUnlimited: false,
    };
  }

  const newUsed = used + 1;
  await env.LUMINARA_KV.put(key, String(newUsed), { expirationTtl: 2 * 86400 });
  return {
    ok: true,
    limit,
    used: newUsed,
    remaining: Math.max(0, limit - newUsed),
    resetSec,
    isUnlimited: false,
  };
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

  // Best-effort per-IP throttling. Telegram's webhook is exempt (it is authenticated by secret token).
  const ip = clientIp(request);
  const limited = (bucket: string, perMin: number) => {
    const r = limiter.check(`${bucket}:${ip}`, perMin, 60_000);
    return r.allowed ? null : withCors(json({ error: 'Too many requests. Slow down and try again.' }, 429, { 'Retry-After': String(r.retryAfterSec) }));
  };
  if (path !== '/telegram/webhook') {
    const hit = limited('api', RATE_API_PER_MIN);
    if (hit) return hit;
  }

  if (path === '/health') {
    if (request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405));
    const configured = Object.fromEntries(Object.keys(PROVIDERS).map(id => [id, PROVIDERS[id].auth(env, new Headers(), {}).ok]));
    return withCors(json({
      ok: true,
      providers: configured,
      byok: Object.keys(PROVIDERS),
      tiers: {
        free: ['groq'],
        paid: ['nim', 'ollama', 'openrouter'],
      },
      sidecars: {
        languagetool: isSidecarConfigured(env, 'languagetool'),
        umami: isSidecarConfigured(env, 'umami'),
      },
      telegram: Boolean(env.BOT_TOKEN),
      firebase: Boolean(env.FIREBASE_PROJECT_ID),
      ton: true,
      tonPricing: TON_PRICING,
      requireAuth: env.REQUIRE_TG_AUTH === 'true',
      requireSubscription: env.REQUIRE_SUBSCRIPTION === 'true',
      freeDailyLimit: Number(env.FREE_DAILY_LIMIT || 0),
      plans: PLANS,
    }));
  }

  if (path === '/auth/session') {
    if (request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    const who = await identify(request, env);
    if (who.error) return withCors(json({ ok: false, error: who.error }, 401));
    if (!who.user) return withCors(json({ ok: false, error: 'Not signed in' }, 401));
    return withCors(json({
      ok: true,
      user: who.user,
      accountId: billingId(who.user),
      linked: Boolean(who.user.accountId && who.user.accountId !== who.user.id),
    }));
  }

  // Explicit link: send BOTH Telegram initData and Firebase Bearer in one request.
  if (path === '/auth/link') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    const initData = request.headers.get('x-telegram-init-data');
    const bearer = bearerFromAuthorization(request.headers.get('authorization'));
    if (!initData || !bearer) {
      return withCors(json({
        ok: false,
        error: 'Open the Mini App in Telegram, sign in with email/Google there, then try Link again. Both Telegram and Firebase must be present.',
      }, 400));
    }
    if (!env.BOT_TOKEN || !env.FIREBASE_PROJECT_ID) {
      return withCors(json({ ok: false, error: 'Server linking is not configured' }, 503));
    }
    const tg = await validateInitData(initData, env.BOT_TOKEN);
    if (!tg.ok) return withCors(json({ ok: false, error: tg.reason }, 401));
    const fb = await verifyFirebaseIdToken(bearer, env.FIREBASE_PROJECT_ID);
    if (!fb.ok) return withCors(json({ ok: false, error: fb.reason }, 401));
    const linked = await linkTelegramAndFirebase(
      env,
      String(tg.user.id),
      fb.user.uid,
      {
        email: fb.user.email,
        name: fb.user.name,
        tgName: [tg.user.first_name, tg.user.last_name].filter(Boolean).join(' ') || tg.user.username,
      },
    );
    return withCors(json({ ok: true, ...linked }));
  }

  // Per-account workspace (DNA, VFS, audits, chat, optional BYOK keys).
  if (path === '/workspace') {
    const who = await identify(request, env);
    if (who.error || !who.user) return withCors(json({ ok: false, error: who.error || 'Sign in required' }, 401));
    const accountId = billingId(who.user);

    if (request.method === 'GET') {
      const record = await getWorkspace(env, accountId);
      return withCors(json({
        ok: true,
        accountId,
        updatedAt: record?.updatedAt ?? 0,
        payload: record?.payload ?? {},
      }));
    }

    if (request.method === 'PUT') {
      const read = await readBody(request, MAX_SMALL_BODY_BYTES);
      if (!read.ok) return withCors(json({ error: read.error }, read.status));
      const body = (read.value || {}) as { updatedAt?: number; payload?: WorkspacePayload; force?: boolean };
      const clientUpdatedAt = Number(body.updatedAt || 0);
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
      const existing = await getWorkspace(env, accountId);
      if (existing && !body.force && existing.updatedAt > clientUpdatedAt) {
        return withCors(json({
          ok: false,
          conflict: true,
          accountId,
          updatedAt: existing.updatedAt,
          payload: existing.payload,
        }, 409));
      }
      const updatedAt = Math.max(clientUpdatedAt, Date.now());
      const saved = await putWorkspace(env, accountId, payload, updatedAt);
      return withCors(json({ ok: true, accountId, updatedAt: saved.updatedAt }));
    }

    return withCors(json({ error: 'Method not allowed' }, 405));
  }

  if (path === '/auth/quota') {
    if (request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405));
    const who = await identify(request, env);
    const limit = Number(env.FREE_DAILY_LIMIT || 0);
    const now = new Date();
    const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const resetSec = Math.max(0, Math.floor((midnightUtc.getTime() - now.getTime()) / 1000));

    if (!who.user) {
      return withCors(json({
        ok: true,
        authenticated: false,
        limit,
        used: 0,
        remaining: limit,
        resetSec,
        isUnlimited: false,
      }));
    }

    const accountId = billingId(who.user);
    type SubRow = { plan?: string; expiresAt?: number };
    let sub: SubRow | null = null;
    if (env.LUMINARA_KV) {
      sub = (await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as SubRow | null;
      if (!sub?.expiresAt || sub.expiresAt <= Date.now()) {
        const legacy = (await env.LUMINARA_KV.get(`sub:${who.user.id}`, 'json')) as SubRow | null;
        if (legacy?.expiresAt && legacy.expiresAt > Date.now()) sub = legacy;
      }
    }
    const isSubActive = Boolean(sub?.expiresAt && sub.expiresAt > Date.now());

    if (isSubActive) {
      return withCors(json({
        ok: true,
        authenticated: true,
        accountId,
        plan: sub!.plan,
        expiresAt: sub!.expiresAt,
        limit: -1,
        used: 0,
        remaining: -1,
        resetSec,
        isUnlimited: true,
      }));
    }

    const day = now.toISOString().slice(0, 10);
    const used = env.LUMINARA_KV ? Number((await env.LUMINARA_KV.get(`quota:${accountId}:${day}`)) || 0) : 0;

    return withCors(json({
      ok: true,
      authenticated: true,
      accountId,
      plan: 'free',
      limit,
      used,
      remaining: Math.max(0, limit - used),
      resetSec,
      isUnlimited: limit <= 0,
    }));
  }

  const m = path.match(/^\/providers\/([a-z]+)(\/.*)$/);
  if (m) {
    const hit = limited('relay', RATE_PROVIDER_PER_MIN);
    if (hit) return hit;
    return withCors(proxyProvider(request, env, m[1], m[2]));
  }

  const s = path.match(/^\/sidecars\/([a-z]+)(\/.*)$/);
  if (s) {
    if (s[1] !== 'languagetool' && s[1] !== 'umami') return withCors(json({ error: `Unknown sidecar "${s[1]}"` }, 404));
    const hit = limited('relay', RATE_PROVIDER_PER_MIN);
    if (hit) return hit;
    return withCors(proxySidecar(request, env, s[1], s[2]));
  }

  if (path === '/telegram/webhook') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!env.BOT_TOKEN) return json({ error: 'BOT_TOKEN not configured' }, 503);
    // The secret token is mandatory: without it anyone could post fake payments / commands.
    // `npm run tg:setup` registers the webhook with TELEGRAM_WEBHOOK_SECRET.
    if (!env.TELEGRAM_WEBHOOK_SECRET) return json({ error: 'TELEGRAM_WEBHOOK_SECRET not configured' }, 503);
    const secret = request.headers.get('x-telegram-bot-api-secret-token') || '';
    if (!secretEquals(secret, env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: 'bad secret' }, 401);
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return json({ error: read.error }, read.status);
    ctx.waitUntil(handleTelegramUpdate(read.value, env));
    return json({ ok: true });
  }

  if (path === '/telegram/auth' || path === '/telegram/invoice') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return withCors(json({ error: read.error }, read.status));
    const { initData, plan } = (read.value || {}) as { initData?: unknown; plan?: unknown };
    if (typeof initData !== 'string' || !initData) return withCors(json({ error: 'initData required' }, 400));
    if (!env.BOT_TOKEN) return withCors(json({ error: 'BOT_TOKEN not configured' }, 503));
    const v = await validateInitData(initData, env.BOT_TOKEN);
    if (!v.ok) return withCors(json({ error: v.reason }, 401));

    if (path === '/telegram/auth') {
      const sub = env.LUMINARA_KV ? await env.LUMINARA_KV.get(`sub:${v.user.id}`, 'json') : null;
      return withCors(json({ ok: true, user: v.user, subscription: sub, startParam: v.startParam }));
    }
    if (typeof plan !== 'string' || !plan) return withCors(json({ error: 'initData and plan required' }, 400));
    const link = await createInvoiceLink(env, v.user.id, plan);
    return withCors(link.ok ? json({ ok: true, url: link.url }) : json({ error: link.error }, 400));
  }

  if (path === '/ton/invoice' || path === '/ton/verify') {
    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const hit = limited('auth', RATE_AUTH_PER_MIN);
    if (hit) return hit;
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return withCors(json({ error: read.error }, read.status));

    if (path === '/ton/invoice') {
      const { planId } = (read.value || {}) as { planId?: string };
      if (!planId) return withCors(json({ error: 'planId required' }, 400));
      const who = await identify(request, env);
      if (!who.user) return withCors(json({ error: who.error || 'Sign in required' }, 401));
      const result = await createTonInvoice(env, who.user.id, planId);
      return withCors(result.ok ? json(result) : json({ error: result.error }, 400));
    }

    if (path === '/ton/verify') {
      const { orderId } = (read.value || {}) as { orderId?: string };
      if (!orderId) return withCors(json({ error: 'orderId required' }, 400));
      const who = await identify(request, env);
      if (!who.user) return withCors(json({ error: who.error || 'Sign in required' }, 401));
      const result = await verifyTonPayment(env, orderId, { expectedUserId: who.user.id });
      return withCors(result.ok ? json(result) : json({ error: result.error }, 400));
    }
  }

  // Drift Sentinel targets are owned by the signed-in Telegram user: alerts can only go to that
  // user's own chat, and the list a user sees is their own. Anonymous registration is refused.
  if (path === '/sentinel/register' || path === '/sentinel/status') {
    const who = await identify(request, env);
    if (!who.user) return withCors(json({ error: who.error || 'Telegram sign-in required' }, 401));
    const ownerId = who.user.id;

    if (path === '/sentinel/status') {
      if (request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405));
      const raw = env.LUMINARA_KV ? ((await env.LUMINARA_KV.get('sentinel:targets', 'json')) as SentinelTarget[] | null) : null;
      return withCors(json({ ok: true, targets: (raw || []).filter(t => t.ownerId === ownerId) }));
    }

    if (request.method !== 'POST') return withCors(json({ error: 'Method not allowed' }, 405));
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return withCors(json({ error: read.error }, read.status));
    const body = (read.value || {}) as Partial<SentinelTarget>;
    const cleanDomain = safePublicHostname(String(body.domain || ''));
    if (!cleanDomain) return withCors(json({ error: 'domain must be a public hostname such as example.com' }, 400));

    const keywords = Array.isArray(body.keywords)
      ? body.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map(k => k.trim().slice(0, 200)).slice(0, 10)
      : [];
    const raw = env.LUMINARA_KV ? ((await env.LUMINARA_KV.get('sentinel:targets', 'json')) as SentinelTarget[] | null) : null;
    const targets = raw || [];
    const ownedCount = targets.filter(t => t.ownerId === ownerId).length;
    if (targets.length >= 500) return withCors(json({ error: 'Sentinel is full. Try again later.' }, 503));

    const sub = await getActiveSubscription(env, who.user);
    const caps = planCapsFor(sub?.plan);
    const existingIdx = targets.findIndex(t => t.domain.toLowerCase() === cleanDomain && t.ownerId === ownerId);
    if (existingIdx < 0 && ownedCount >= caps.sentinelLimit) {
      const msg =
        caps.sentinelLimit <= 0
          ? 'Drift Sentinel requires a paid plan. Upgrade to Starter or higher.'
          : `Your plan allows up to ${caps.sentinelLimit} watched domains. Upgrade for more.`;
      return withCors(json({ error: msg, code: 'DOMAIN_LIMIT', limit: caps.sentinelLimit, plan: sub?.plan || 'free' }, 402));
    }

    const bodyExtra = body as { reauditCadence?: string; competitorNames?: string[] };
    const cadenceRaw = typeof bodyExtra.reauditCadence === 'string' ? bodyExtra.reauditCadence : caps.scheduledReaudit;
    const reauditCadence =
      cadenceRaw === 'monthly' || cadenceRaw === 'weekly' || cadenceRaw === 'daily' ? cadenceRaw : 'none';

    const newTarget: SentinelTarget = {
      id: existingIdx >= 0 ? targets[existingIdx].id : `sentinel-${Date.now()}-${ownerId}`,
      ownerId,
      domain: cleanDomain,
      brandName: (typeof body.brandName === 'string' && body.brandName.trim() ? body.brandName.trim().slice(0, 100) : cleanDomain.split('.')[0]),
      // Alerts are delivered over Telegram only, and only to the registering user's own chat.
      tgChatId: who.user.source === 'telegram' ? Number(ownerId) : undefined,
      keywords: keywords.length > 0 ? keywords : [`what is ${cleanDomain}`, `best ${cleanDomain} alternative`],
      lastScanAt: Date.now(),
      lastStatus: 'healthy',
      reauditCadence,
      competitorNames: Array.isArray(bodyExtra.competitorNames)
        ? bodyExtra.competitorNames
            .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
            .map(k => k.trim().slice(0, 100))
            .slice(0, 20)
        : [],
    };

    if (existingIdx >= 0) {
      targets[existingIdx] = { ...targets[existingIdx], ...newTarget };
    } else {
      targets.push(newTarget);
    }

    if (env.LUMINARA_KV) {
      await env.LUMINARA_KV.put('sentinel:targets', JSON.stringify(targets));
    }
    return withCors(json({ ok: true, target: newTarget }));
  }

  if (path === '/enrichment/entity') {
    if (request.method !== 'GET') return withCors(json({ error: 'Method not allowed' }, 405));
    if (env.REQUIRE_TG_AUTH === 'true') {
      const who = await identify(request, env);
      if (who.error || !who.user) return withCors(json({ error: who.error || 'Sign in required' }, 401));
    }
    const domainParam = url.searchParams.get('domain') || '';
    const cleanDomain = safePublicHostname(domainParam);
    if (!cleanDomain) return withCors(json({ error: 'domain query parameter must be a public hostname such as example.com' }, 400));
    const brand = (url.searchParams.get('brand') || cleanDomain.split('.')[0] || '').slice(0, 200);
    const cacheKey = `enrich:${cleanDomain}`;

    try {
      const cached = env.LUMINARA_KV ? await env.LUMINARA_KV.get(cacheKey, 'json') : null;
      if (cached) {
        return withCors(json({ ok: true, cached: true, data: cached }));
      }
    } catch {
      // KV miss/unbound in local dev, proceed to fetch
    }

    // SSRF guard: the Worker is about to fetch https://<domain> on the caller's behalf. The name
    // must resolve to public addresses only (loopback, RFC1918, link-local, metadata are refused).
    if (!(await resolvesToPublicAddress(cleanDomain))) {
      return withCors(json({ error: 'domain does not resolve to a public address' }, 400));
    }

    const [wikidataRes, waybackRes, securityRes, microlinkRes] = await Promise.allSettled([
      (async () => {
        const qUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(brand)}&language=en&format=json&origin=*&limit=1`;
        const res = await fetch(qUrl, { headers: { 'User-Agent': 'LuminaraOracle/1.0 (https://luminarasuite.com)' } });
        if (!res.ok) return null;
        const data: any = await res.json();
        const first = data?.search?.[0];
        if (!first) return null;
        const wikipediaUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(String(first.label || brand).replace(/\s+/g, '_'))}`;
        return {
          id: first.id,
          label: first.label,
          description: first.description,
          url: `https://www.wikidata.org/wiki/${first.id}`,
          wikipediaUrl,
        };
      })(),
      (async () => {
        const wbUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(cleanDomain)}&timestamp=19960101`;
        const res = await fetch(wbUrl, { headers: { 'User-Agent': 'LuminaraOracle/1.0 (https://luminarasuite.com)' } });
        if (!res.ok) return null;
        const data: any = await res.json();
        const snap = data?.archived_snapshots?.closest;
        if (!snap || !snap.timestamp) {
          return { hasArchive: false, status: 'unindexed' as const };
        }
        const ts = String(snap.timestamp);
        const year = parseInt(ts.substring(0, 4), 10);
        const month = ts.substring(4, 6);
        const day = ts.substring(6, 8);
        const earliestDate = `${year}-${month}-${day}`;
        const archivedYearsAgo = Math.max(0, new Date().getFullYear() - year);
        let status: 'historic_authority' | 'established' | 'new_domain' | 'unindexed' = 'new_domain';
        if (archivedYearsAgo >= 10) status = 'historic_authority';
        else if (archivedYearsAgo >= 3) status = 'established';
        return {
          hasArchive: true,
          earliestDate,
          archivedYearsAgo,
          snapshotUrl: snap.url as string,
          status,
          // legacy fields kept for older clients
          earliestTimestamp: ts,
          firstArchiveYear: year,
          archiveSnapshotUrl: snap.url as string,
        };
      })(),
      auditSecurityOnEdge(cleanDomain),
      (async () => {
        try {
          const mlUrl = `https://api.microlink.io/?url=${encodeURIComponent(`https://${cleanDomain}`)}`;
          const res = await fetch(mlUrl, { headers: { 'User-Agent': 'LuminaraOracle/1.0 (https://luminarasuite.com)' } });
          if (!res.ok) return null;
          const data: any = await res.json();
          if (data?.status !== 'success' || !data?.data) return null;
          return {
            title: data.data.title,
            description: data.data.description,
            publisher: data.data.publisher,
            image: data.data.image?.url,
            author: data.data.author,
            date: data.data.date,
            lang: data.data.lang,
          };
        } catch {
          return null;
        }
      })(),
    ]);

    const wikidata = wikidataRes.status === 'fulfilled' ? wikidataRes.value : null;
    const waybackRaw = waybackRes.status === 'fulfilled' ? waybackRes.value : null;
    const wayback = waybackRaw || { hasArchive: false, status: 'unindexed' as const };
    const security = securityRes.status === 'fulfilled'
      ? securityRes.value
      : {
          httpsEnforced: true,
          redirectsToHttps: false,
          hstsEnabled: false,
          cspDetected: false,
          referrerPolicy: false,
          xFrameOptions: false,
          securityTxtPresent: false,
          trustScore: 40,
          measurementConfidence: 'failed' as const,
        };
    const metadata = microlinkRes.status === 'fulfilled' ? microlinkRes.value : null;

    const sameAsUrls: string[] = [];
    if (wikidata?.url) sameAsUrls.push(wikidata.url);
    if (wikidata?.wikipediaUrl) sameAsUrls.push(wikidata.wikipediaUrl);

    const result = {
      domain: cleanDomain,
      brandName: brand,
      brand,
      wikidata,
      wayback,
      metadata,
      security,
      sameAsUrls,
      timestamp: Date.now(),
    };

    try {
      if (env.LUMINARA_KV) {
        await env.LUMINARA_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 604800 });
      }
    } catch {
      // Non-fatal if KV put fails
    }

    return withCors(json({ ok: true, cached: false, data: result }));
  }

  return withCors(json({ error: 'Not found' }, 404));
}

/** Edge security audit without CORS limits. Score: https40+redir15+hsts15+csp10+ref5+xfo5+sectxt10. */
async function auditSecurityOnEdge(domain: string): Promise<{
  httpsEnforced: boolean;
  redirectsToHttps: boolean;
  hstsEnabled: boolean;
  cspDetected: boolean;
  referrerPolicy: boolean;
  xFrameOptions: boolean;
  securityTxtPresent: boolean;
  trustScore: number;
  measurementConfidence: 'full' | 'cors_limited' | 'failed';
}> {
  const httpsUrl = `https://${domain}`;
  let hsts = false;
  let csp = false;
  let referrerPolicy = false;
  let xFrameOptions = false;
  let redirectsToHttps = false;
  let securityTxtPresent = false;
  let fetchWorked = false;

  try {
    let res = await fetch(httpsUrl, { method: 'HEAD', redirect: 'follow' }).catch(() => null);
    if (!res || !res.ok) {
      res = await fetch(httpsUrl, { method: 'GET', redirect: 'follow' }).catch(() => null);
    }
    if (res) {
      fetchWorked = true;
      hsts = Boolean(res.headers.get('strict-transport-security'));
      csp = Boolean(res.headers.get('content-security-policy'));
      referrerPolicy = Boolean(res.headers.get('referrer-policy'));
      xFrameOptions = Boolean(res.headers.get('x-frame-options'));
    }

    const httpUrl = `http://${domain}`;
    const redir = await fetch(httpUrl, { method: 'GET', redirect: 'follow' }).catch(() => null);
    if (redir?.url?.startsWith('https://')) redirectsToHttps = true;

    const st = await fetch(`https://${domain}/.well-known/security.txt`, { method: 'GET' }).catch(() => null);
    if (st && st.ok) {
      const body = await st.text().catch(() => '');
      securityTxtPresent = /contact\s*:/i.test(body) || /canonical\s*:/i.test(body);
    }
  } catch {
    // leave defaults
  }

  const measurementConfidence = fetchWorked ? 'full' : 'failed';
  let trustScore = 40; // https assumed for edge probe target
  if (redirectsToHttps) trustScore += 15;
  if (hsts) trustScore += 15;
  if (csp) trustScore += 10;
  if (referrerPolicy) trustScore += 5;
  if (xFrameOptions) trustScore += 5;
  if (securityTxtPresent) trustScore += 10;

  return {
    httpsEnforced: true,
    redirectsToHttps,
    hstsEnabled: hsts,
    cspDetected: csp,
    referrerPolicy,
    xFrameOptions,
    securityTxtPresent,
    trustScore: Math.min(100, trustScore),
    measurementConfidence,
  };
}

export interface SentinelTarget {
  id: string;
  /** HostedIdentity.id of the person who registered the target (Telegram "123" or Firebase "fb:uid"). */
  ownerId?: string;
  domain: string;
  brandName: string;
  tgChatId?: number | string;
  keywords: string[];
  lastScanAt?: number;
  lastCitationRate?: number;
  lastIntegrityScore?: number;
  lastSecurityTrust?: number;
  lastStatus?: 'healthy' | 'drift_detected' | 'remediated' | 'reaudit_due';
  driftAlertSentAt?: number;
  /** Scheduled re-audit cadence (Rakazo-style routine jobs). */
  reauditCadence?: 'none' | 'monthly' | 'weekly' | 'daily';
  lastReauditNudgeAt?: number;
  /** Competitors to watch for citation presence in SERP snippets. */
  competitorNames?: string[];
  lastCompetitorHits?: Record<string, boolean>;
}

export async function runSentinelScan(env: Env): Promise<{ scanned: number; alertsSent: number; reauditNudges: number }> {
  try {
    const raw = env.LUMINARA_KV ? ((await env.LUMINARA_KV.get('sentinel:targets', 'json')) as SentinelTarget[] | null) : null;
    const targets = raw || [];
    if (targets.length === 0) return { scanned: 0, alertsSent: 0, reauditNudges: 0 };

    let alertsSent = 0;
    let reauditNudges = 0;
    const updatedTargets: SentinelTarget[] = [];
    const dayMs = 24 * 3600 * 1000;

    for (const target of targets) {
      // Legacy or tampered records: never probe non-public hosts, never alert a chat the owner doesn't own.
      if (!safePublicHostname(target.domain)) continue;
      const alertChat = target.ownerId && target.tgChatId !== undefined && String(target.tgChatId) === String(target.ownerId) ? target.tgChatId : undefined;
      const keyword = target.keywords?.[0] || `${target.brandName || target.domain} solutions`;
      let cited = true;
      let serpBlob = '';

      if (env.TAVILY_API_KEY) {
        try {
          const resp = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: env.TAVILY_API_KEY,
              query: keyword,
              search_depth: 'basic',
              max_results: 5,
            }),
          });
          if (resp.ok) {
            const data = (await resp.json()) as { results?: Array<{ url: string; content: string }> };
            const cleanDomain = target.domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase();
            cited = (data.results || []).some(r => r.url.toLowerCase().includes(cleanDomain));
            serpBlob = (data.results || []).map(r => `${r.url} ${r.content || ''}`).join('\n').toLowerCase();
          }
        } catch (e) {
          console.warn('[Sentinel] Tavily search fallback', e);
        }
      }

      let securityTrust = target.lastSecurityTrust;
      try {
        const sec = await auditSecurityOnEdge(target.domain);
        securityTrust = sec.trustScore;
      } catch {
        // keep previous
      }

      const trustRegression =
        typeof target.lastSecurityTrust === 'number' &&
        typeof securityTrust === 'number' &&
        target.lastSecurityTrust - securityTrust > 20;

      const now = Date.now();
      const competitorHits: Record<string, boolean> = { ...(target.lastCompetitorHits || {}) };
      const competitorChanges: string[] = [];
      for (const name of target.competitorNames || []) {
        const hit = serpBlob.includes(name.toLowerCase());
        const prev = target.lastCompetitorHits?.[name];
        if (typeof prev === 'boolean' && prev !== hit) {
          competitorChanges.push(hit ? `[[${name}]] gained SERP presence` : `[[${name}]] lost SERP presence`);
        }
        competitorHits[name] = hit;
      }

      const needsAlert = !cited || trustRegression || competitorChanges.length > 0;
      let status: SentinelTarget['lastStatus'] = needsAlert ? 'drift_detected' : 'healthy';

      if (needsAlert && alertChat && env.BOT_TOKEN) {
        const canAlert = !target.driftAlertSentAt || (now - target.driftAlertSentAt > dayMs);
        if (canAlert) {
          const reasons: string[] = [];
          if (!cited) reasons.push('Brand citation missing from top AI answers.');
          if (trustRegression) {
            reasons.push(
              `Trust regression: security trust dropped from ${target.lastSecurityTrust} to ${securityTrust} (>20 point drop).`
            );
          }
          if (competitorChanges.length) reasons.push(`Competitor deltas: ${competitorChanges.join('; ')}.`);
          const alertMsg = `⚠️ *Luminara 24/7 Drift Sentinel Alert*\n\n` +
            `Your domain *${target.domain}* has detected an AEO citation or trust regression.\n` +
            `• Target query: _${keyword}_\n` +
            `• Current status: ${reasons.join(' ')}\n\n` +
            `Tap below to review the empirical diff and deploy 1-click schema remediation.`;

          const sent = await sendTelegramAlert(env, alertChat, alertMsg, env.WEBAPP_URL);
          if (sent) {
            alertsSent++;
            target.driftAlertSentAt = now;
          }
        }
      }

      // Scheduled re-audit nudges (weekly / monthly / daily routines).
      const cadence = target.reauditCadence || 'none';
      const cadenceMs =
        cadence === 'daily' ? dayMs : cadence === 'weekly' ? 7 * dayMs : cadence === 'monthly' ? 30 * dayMs : 0;
      let lastReauditNudgeAt = target.lastReauditNudgeAt;
      if (cadenceMs > 0 && alertChat && env.BOT_TOKEN) {
        const due = !lastReauditNudgeAt || now - lastReauditNudgeAt >= cadenceMs;
        if (due) {
          const nudge = `🗓️ *Luminara scheduled re-audit*\n\n` +
            `It is time for your *${cadence}* AEO check on *${target.domain}*.\n` +
            `Open the app → Audit my website to refresh Brand Memory and competitor citation deltas.`;
          const sent = await sendTelegramAlert(env, alertChat, nudge, env.WEBAPP_URL);
          if (sent) {
            reauditNudges++;
            lastReauditNudgeAt = now;
            status = 'reaudit_due';
          }
        }
      }

      updatedTargets.push({
        ...target,
        lastScanAt: now,
        lastStatus: status,
        lastSecurityTrust: securityTrust,
        lastCompetitorHits: competitorHits,
        lastReauditNudgeAt,
        driftAlertSentAt: target.driftAlertSentAt,
      });
    }

    if (env.LUMINARA_KV) {
      await env.LUMINARA_KV.put('sentinel:targets', JSON.stringify(updatedTargets));
    }
    return { scanned: targets.length, alertsSent, reauditNudges };
  } catch (err) {
    console.error('[Sentinel] Scheduled scan error', err);
    return { scanned: 0, alertsSent: 0, reauditNudges: 0 };
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return withSecurityHeaders(await handleApi(request, env, ctx));
      } catch (e) {
        // Never echo internal error details (stack traces, upstream messages, env hints) to callers.
        console.error('[api] unhandled error', request.method, url.pathname, e);
        return withSecurityHeaders(json({ error: 'Internal error' }, 500));
      }
    }
    // Static assets with SPA fallback (configured in wrangler.jsonc); security headers + CSP on the HTML shell.
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSentinelScan(env));
  },
} satisfies ExportedHandler<Env>;
