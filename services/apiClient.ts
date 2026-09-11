/**
 * Talks to the Luminara Cloudflare Worker (/api/*).
 *
 * "Proxy mode" means provider calls go through the Worker, which injects the real API keys.
 * It is on automatically when the app is served by the Worker (luminarasuite.com or `wrangler dev`)
 * and can be forced for local Vite dev with VITE_API_BASE=http://localhost:8787.
 */
import { getInitDataRaw } from './telegram/tma';
import { getFirebaseIdToken, getFirebaseIdTokenSync } from './auth/firebaseAuthService';
import { toUserFacingText } from '../utils/userFacingText';

export interface ServerHealth {
  ok: boolean;
  providers: Record<string, boolean>;
  /** Providers the Worker can relay with a caller-supplied key. */
  byok?: string[];
  /** Self-hosted helper services the Worker can reach (writing check, results tracking). */
  sidecars?: Partial<Record<SidecarId, boolean>>;
  telegram: boolean;
  /** True when the Worker verifies Firebase ID tokens (FIREBASE_PROJECT_ID set). */
  firebase?: boolean;
  requireAuth: boolean;
  requireSubscription?: boolean;
  freeDailyLimit?: number;
  plans: Record<string, { title: string; description: string; stars: number; days: number }>;
}

const EMPTY_HEALTH: ServerHealth = { ok: false, providers: {}, telegram: false, requireAuth: false, plans: {} };

/** Keep in sync with `PROVIDERS` in worker/index.ts. Used when /api/health has not loaded yet. */
export const BYOK_PROVIDER_IDS = [
  'groq',
  'nim',
  'ollama',
  'openrouter',
  'gemini',
  'tavily',
  'firecrawl',
  'exa',
] as const;

let healthCache: ServerHealth | null = null;
let healthPromise: Promise<ServerHealth> | null = null;
let healthFailedAt = 0;

export function apiBase(): string {
  const forced = (import.meta as any).env?.VITE_API_BASE as string | undefined;
  if (forced) return forced.replace(/\/$/, '');
  if (typeof window === 'undefined' || !window.location) return '';
  const protocol = window.location.protocol || '';
  // Same-origin /api: Cloudflare Worker in prod, Vite proxy in local dev (see vite.config.ts).
  if (protocol === 'http:' || protocol === 'https:') {
    return window.location.origin || '';
  }
  return '';
}

export function isProxyMode(): boolean {
  return Boolean(apiBase()) && healthCache?.ok === true;
}

/**
 * True when BYOK calls should go through the Worker (avoids vendor CORS).
 * Same-origin / VITE_API_BASE is enough: do not require a prior successful /api/health,
 * because a single timed-out health probe used to permanently disable relays.
 */
export function canRelayWithOwnKey(providerId: string): boolean {
  if (!apiBase()) return false;
  if (healthCache?.ok === true) {
    const list = healthCache.byok;
    if (Array.isArray(list) && list.length > 0) return list.includes(providerId);
  }
  return (BYOK_PROVIDER_IDS as readonly string[]).includes(providerId);
}

/** Fetches /api/health; retries after failures instead of caching a permanent miss. */
export async function loadServerHealth(opts: { force?: boolean } = {}): Promise<ServerHealth> {
  if (!apiBase()) {
    healthCache = EMPTY_HEALTH;
    return healthCache;
  }
  if (!opts.force && healthCache?.ok === true) return healthCache;
  if (!opts.force && healthPromise) return healthPromise;

  const recentlyFailed =
    healthCache?.ok === false && healthFailedAt > 0 && Date.now() - healthFailedAt < 5_000;
  if (!opts.force && recentlyFailed) return healthCache as ServerHealth;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
  healthPromise = fetch(`${apiBase()}/api/health`, { signal: controller?.signal })
    .then(r => (r.ok ? r.json() : EMPTY_HEALTH))
    .then((h: ServerHealth) => {
      healthCache = h?.ok ? h : EMPTY_HEALTH;
      healthFailedAt = healthCache.ok ? 0 : Date.now();
      return healthCache;
    })
    .catch(() => {
      healthCache = EMPTY_HEALTH;
      healthFailedAt = Date.now();
      return EMPTY_HEALTH;
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
      healthPromise = null;
    });
  return healthPromise;
}

export function getServerHealthSync(): ServerHealth { return healthCache || EMPTY_HEALTH; }

export function isProviderConfiguredOnServer(id: string): boolean {
  return Boolean(healthCache?.providers?.[id]);
}

// ---- Sidecars (self-hosted helper services) ------------------------------------------------

/**
 * "languagetool": grammar/style checker behind the "Writing check" feature.
 * "umami": privacy-first web analytics behind the "Results tracking" feature.
 * Users never see these ids; the UI talks about the feature, not the tool.
 */
export type SidecarId = 'languagetool' | 'umami';

export function isSidecarConfiguredOnServer(id: SidecarId): boolean {
  return Boolean(healthCache?.sidecars?.[id]);
}

export interface SidecarFetchOptions {
  /** A base URL the user configured in Settings. When set, the browser calls it directly. */
  directBase?: string;
  /** Credential for the direct call (Umami API key / bearer token). Ignored for the relay. */
  userKey?: string;
}

/**
 * Reaches a sidecar either directly (user-configured URL) or through the Worker relay at
 * /api/sidecars/:id/<path>. In Vite dev the relay path is proxied by vite.config.ts.
 * Returns null when there is no way to reach the service, so callers can degrade quietly.
 */
export async function sidecarFetch(id: SidecarId, path: string, init: RequestInit = {}, opts: SidecarFetchOptions = {}): Promise<Response | null> {
  const headers = new Headers(init.headers || {});
  if (opts.directBase) {
    const base = opts.directBase.replace(/\/$/, '');
    if (opts.userKey) {
      // Umami Cloud reads x-umami-api-key; self-hosted Umami reads a bearer token. Sending both is harmless.
      headers.set('x-umami-api-key', opts.userKey);
      headers.set('Authorization', `Bearer ${opts.userKey}`);
    }
    return fetch(`${base}${path}`, { ...init, headers });
  }
  const viaWorker = Boolean(apiBase()) && isSidecarConfiguredOnServer(id);
  const viaViteProxy = !apiBase() && typeof window !== 'undefined';
  if (!viaWorker && !viaViteProxy) return null;
  return workerFetchWithAuthRetry(`${apiBase()}/api/sidecars/${id}${path}`, { ...init });
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const initData = getInitDataRaw();
  if (initData) headers['x-telegram-init-data'] = initData;
  const idToken = getFirebaseIdTokenSync();
  if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
  return headers;
}

/** Builds Worker auth headers; forceRefresh pulls a fresh Firebase ID token after expiry. */
async function authHeadersAsync(forceRefresh = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const initData = getInitDataRaw();
  if (initData) headers['x-telegram-init-data'] = initData;
  const idToken = forceRefresh
    ? await getFirebaseIdToken(true)
    : (getFirebaseIdTokenSync() ?? await getFirebaseIdToken(false));
  if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
  return headers;
}

function applyAuthHeaders(target: Headers, source: Record<string, string>): void {
  Object.entries(source).forEach(([k, v]) => target.set(k, v));
}

/**
 * Worker fetch that retries once on 401 after forcing a Firebase ID token refresh.
 * Skips refresh when Telegram initData is already present (Telegram identity takes precedence).
 */
async function workerFetchWithAuthRetry(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  applyAuthHeaders(headers, await authHeadersAsync(false));
  let res = await fetch(url, { ...init, headers });
  if (res.status !== 401) return res;
  if (getInitDataRaw()) return res;
  applyAuthHeaders(headers, await authHeadersAsync(true));
  return fetch(url, { ...init, headers });
}

/** Auth headers for Worker API calls (Telegram initData and/or Firebase ID token). */
export function getApiAuthHeaders(): Record<string, string> {
  return authHeaders();
}

/**
 * Sends a provider request either directly (browser holds the key) or through the Worker proxy.
 * `directUrl` is the vendor URL; `path` is the vendor path relative to the provider base.
 */
export interface ProviderFetchOptions {
  /** The user's own key. When set and a Worker is reachable, the request is relayed with this key. */
  userKey?: string;
}

export async function providerFetch(providerId: string, path: string, directUrl: string, init: RequestInit, opts: ProviderFetchOptions = {}): Promise<Response> {
  const relayOwnKey = Boolean(opts.userKey) && opts.userKey !== 'proxy' && canRelayWithOwnKey(providerId);
  const hostedKey = !opts.userKey || opts.userKey === 'proxy';

  if (!relayOwnKey && !(hostedKey && isProxyMode())) {
    return fetch(directUrl, init);
  }

  const headers = new Headers(init.headers || {});
  headers.delete('authorization');
  headers.delete('x-api-key');
  headers.delete('nv-organization-id');
  let res: Response;
  if (relayOwnKey) {
    headers.set('x-provider-key', opts.userKey as string);
    res = await fetch(`${apiBase()}/api/providers/${providerId}${path}`, { ...init, headers });
  } else {
    res = await workerFetchWithAuthRetry(`${apiBase()}/api/providers/${providerId}${path}`, { ...init, headers });
  }
  updateQuotaFromHeaders(res.headers);
  if (res.status === 402) {
    try {
      const clone = res.clone();
      const body = await clone.json();
      // Tier gates (hosted NIM/Ollama/OpenRouter) must not interrupt BYOK or auto-failover.
      // Quota exhaustion still opens the paywall so the user can upgrade.
      if (body?.code === 'TIER_UPGRADE_REQUIRED') {
        return res;
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('luminara-open-paywall', {
          detail: {
            reason: toUserFacingText(body.error, 'Daily free limit reached'),
            code: body.code,
            requiredTier: body.requiredTier,
            provider: body.provider,
            limit: body.limit,
            used: body.used,
            remaining: body.remaining,
          }
        }));
      }
    } catch {}
  }
  return res;
}

export function geminiProxyHttpOptions(): { baseUrl: string; headers: Record<string, string> } {
  return { baseUrl: `${apiBase()}/api/providers/gemini`, headers: authHeaders() };
}

// ---- Live Quota Store & Paywall Interceptor --------------------------------------------------

export interface QuotaInfo {
  limit: number;
  used: number;
  remaining: number;
  resetSec: number;
  isUnlimited: boolean;
  plan?: string;
  expiresAt?: number;
}

let currentQuota: QuotaInfo | null = null;
const quotaListeners = new Set<(q: QuotaInfo | null) => void>();

export function subscribeQuota(fn: (q: QuotaInfo | null) => void): () => void {
  quotaListeners.add(fn);
  fn(currentQuota);
  return () => quotaListeners.delete(fn);
}

export function getCurrentQuotaSync(): QuotaInfo | null {
  return currentQuota;
}

/** Paid hosted engines (NIM / Ollama Cloud / OpenRouter) require an active plan when not BYOK. */
export const PAID_HOSTED_PROVIDER_IDS = ['nim', 'ollama', 'openrouter'] as const;

export function isPaidHostedProvider(providerId: string): boolean {
  return (PAID_HOSTED_PROVIDER_IDS as readonly string[]).includes(providerId);
}

/** Best-effort client view of an active Stars/TON/license plan (from quota headers or /api/auth/quota). */
export function hasActivePaidPlanSync(): boolean {
  const q = currentQuota;
  if (!q) return false;
  if (q.isUnlimited) return true;
  if (typeof q.expiresAt === 'number' && q.expiresAt > Date.now()) return true;
  if (q.plan && q.plan !== 'free' && q.plan !== 'active') {
    // Named plans from quota endpoint (starter/growth/agency/...)
    return true;
  }
  // Some paths set plan:'active' with isUnlimited for subscribers.
  if (q.plan === 'active' && q.isUnlimited) return true;
  return false;
}

/** True when the Worker may inject a hosted key for this provider for the current user. */
export function canUseHostedProviderKey(providerId: string): boolean {
  if (!isProxyMode() || !isProviderConfiguredOnServer(providerId)) return false;
  if (isPaidHostedProvider(providerId)) return hasActivePaidPlanSync();
  return true;
}

export function updateQuotaFromHeaders(headers: Headers): void {
  const rem = headers.get('x-quota-remaining');
  const lim = headers.get('x-quota-limit');
  const rst = headers.get('x-quota-reset');
  if (rem !== null || lim !== null) {
    const isUnlimited = rem === 'unlimited' || lim === 'unlimited';
    const limitNum = isUnlimited ? -1 : (Number(lim) || 0);
    const remNum = isUnlimited ? -1 : (Number(rem) || 0);
    const resetSec = Number(rst) || 0;
    const used = isUnlimited ? 0 : Math.max(0, limitNum - remNum);
    currentQuota = {
      limit: limitNum,
      used,
      remaining: remNum,
      resetSec,
      isUnlimited,
      plan: isUnlimited ? 'active' : 'free',
    };
    quotaListeners.forEach(fn => { try { fn(currentQuota); } catch {} });
  }
}

export async function fetchQuotaStatus(): Promise<QuotaInfo | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const r = await workerFetchWithAuthRetry(`${base}/api/auth/quota`);
    if (!r.ok) return null;
    const data = await r.json();
    if (data.ok) {
      currentQuota = {
        limit: data.limit,
        used: data.used,
        remaining: data.remaining,
        resetSec: data.resetSec,
        isUnlimited: data.isUnlimited,
        plan: data.plan,
        expiresAt: data.expiresAt,
      };
      quotaListeners.forEach(fn => { try { fn(currentQuota); } catch {} });
      return currentQuota;
    }
  } catch {}
  return null;
}

import type { EncryptedKeyBag } from './crypto/envelopeEncryptionService';

/** Product memory + optional BYOK bag stored per linked account in D1/KV. */
export type WorkspacePayload = {
  storage?: Record<string, string>;
  keys?: Record<string, string>;
  /** Zero-knowledge client-side encrypted key bag (AES-256-GCM + PBKDF2) */
  encryptedKeys?: EncryptedKeyBag;
};

export async function fetchWorkspace(): Promise<{
  ok: boolean;
  accountId?: string;
  updatedAt?: number;
  payload?: WorkspacePayload;
  error?: string;
}> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'No API' };
  const r = await workerFetchWithAuthRetry(`${base}/api/workspace`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: data.error || `HTTP ${r.status}` };
  return {
    ok: true,
    accountId: data.accountId,
    updatedAt: data.updatedAt,
    payload: data.payload || {},
  };
}

export async function putWorkspaceRemote(input: {
  updatedAt: number;
  payload: WorkspacePayload;
  force?: boolean;
}): Promise<{
  ok: boolean;
  conflict?: boolean;
  accountId?: string;
  updatedAt?: number;
  payload?: WorkspacePayload;
  error?: string;
}> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'No API' };
  const r = await workerFetchWithAuthRetry(`${base}/api/workspace`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 409) {
    return {
      ok: false,
      conflict: true,
      accountId: data.accountId,
      updatedAt: data.updatedAt,
      payload: data.payload,
    };
  }
  if (!r.ok) return { ok: false, error: data.error || `HTTP ${r.status}` };
  return { ok: true, accountId: data.accountId, updatedAt: data.updatedAt };
}

/** Link Telegram Mini App session with Firebase (both auth headers required). */
export async function linkTelegramFirebaseAccounts(): Promise<{
  ok: boolean;
  accountId?: string;
  error?: string;
}> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'No API' };
  const r = await workerFetchWithAuthRetry(`${base}/api/auth/link`, { method: 'POST' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: data.error || `HTTP ${r.status}` };
  return { ok: true, accountId: data.accountId };
}

export function openPaywallModal(reason?: unknown): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('luminara-open-paywall', {
      detail: { reason: toUserFacingText(reason, 'Daily free limit reached') },
    }));
  }
}

export async function activateLicenseKey(key: string): Promise<{
  ok: boolean;
  plan?: string;
  expiresAt?: number;
  durationDays?: number;
  error?: string;
}> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'Worker API is unreachable' };
  const r = await workerFetchWithAuthRetry(`${base}/api/license/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await r.json().catch(() => ({}));
  if (data.ok) {
    await fetchQuotaStatus();
  }
  return data;
}

// ---- Telegram account endpoints -------------------------------------------------------------

export interface TelegramSession {
  user: { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string; is_premium?: boolean };
  subscription: { plan: string; expiresAt: number; startedAt: number } | null;
  startParam?: string;
}

export type TelegramAuthResult =
  | { status: 'ok'; session: TelegramSession }
  | { status: 'invalid'; error: string }
  | { status: 'unavailable'; error: string };

/**
 * Validate Mini App initData with the Worker.
 * - ok: signature accepted
 * - invalid: 401 / bad signature (do not soft-open the product gate)
 * - unavailable: missing config, network, or 5xx (soft-open if initData present)
 */
export async function telegramAuth(): Promise<TelegramAuthResult> {
  const initData = getInitDataRaw();
  if (!initData) return { status: 'unavailable', error: 'missing_init_data' };
  if (!apiBase()) return { status: 'unavailable', error: 'api_base_missing' };
  try {
    const r = await fetch(`${apiBase()}/api/telegram/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData }),
    });
    if (r.status === 401) {
      const data = await r.json().catch(() => ({}));
      return { status: 'invalid', error: String((data as { error?: string }).error || 'initData rejected') };
    }
    if (!r.ok) {
      return { status: 'unavailable', error: `http_${r.status}` };
    }
    const data = await r.json();
    if (data?.ok) {
      return { status: 'ok', session: data as TelegramSession };
    }
    return { status: 'unavailable', error: 'malformed_auth_response' };
  } catch (e) {
    return {
      status: 'unavailable',
      error: e instanceof Error ? e.message : 'network_error',
    };
  }
}

export async function createStarsInvoice(plan: string): Promise<string> {
  const initData = getInitDataRaw();
  if (!initData) throw new Error('Open the app inside Telegram to subscribe with Stars.');
  const r = await fetch(`${apiBase()}/api/telegram/invoice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData, plan }),
  });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(data.error || 'Could not create invoice');
  return data.url as string;
}

export interface SentinelTargetClient {
  id: string;
  domain: string;
  brandName: string;
  keywords?: string[];
  lastStatus?: string;
  reauditCadence?: string;
  competitorNames?: string[];
}

export async function registerSentinelTarget(input: {
  domain: string;
  brandName?: string;
  keywords?: string[];
  competitorNames?: string[];
  reauditCadence?: string;
}): Promise<SentinelTargetClient> {
  const base = apiBase();
  if (!base) throw new Error('API unavailable');
  const r = await workerFetchWithAuthRetry(`${base}/api/sentinel/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) {
    throw new Error(data.error || `Sentinel register failed (${r.status})`);
  }
  return data.target as SentinelTargetClient;
}

export async function fetchSentinelStatus(): Promise<{ ok: boolean; targets: SentinelTargetClient[] }> {
  const base = apiBase();
  if (!base) return { ok: false, targets: [] };
  const r = await workerFetchWithAuthRetry(`${base}/api/sentinel/status`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) return { ok: false, targets: [] };
  return { ok: true, targets: (data.targets || []) as SentinelTargetClient[] };
}
