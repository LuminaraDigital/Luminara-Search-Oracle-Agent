/**
 * Talks to the Luminara Cloudflare Worker (/api/*).
 *
 * "Proxy mode" means provider calls go through the Worker, which injects the real API keys.
 * It is on automatically when the app is served by the Worker (luminarasuite.com or `wrangler dev`)
 * and can be forced for local Vite dev with VITE_API_BASE=http://localhost:8787.
 */
import { getInitDataRaw } from './telegram/tma';
import { getFirebaseIdToken, getFirebaseIdTokenSync } from './auth/firebaseAuthService';

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

let healthCache: ServerHealth | null = null;
let healthPromise: Promise<ServerHealth> | null = null;

export function apiBase(): string {
  const forced = (import.meta as any).env?.VITE_API_BASE as string | undefined;
  if (forced) return forced.replace(/\/$/, '');
  if (typeof window === 'undefined' || !window.location) return '';
  const host = window.location.hostname || '';
  // Vite dev server (port 3000) has no /api; everything else served by the Worker does.
  const isViteDev = (host === 'localhost' || host === '127.0.0.1') && window.location.port === '3000';
  return isViteDev ? '' : (window.location.origin || '');
}

export function isProxyMode(): boolean {
  return Boolean(apiBase()) && healthCache?.ok === true;
}

/** True when a Worker is reachable that can relay a request using the caller's own key. */
export function canRelayWithOwnKey(providerId: string): boolean {
  return Boolean(apiBase()) && healthCache?.ok === true && (healthCache.byok ?? []).includes(providerId);
}

/** Fetches /api/health once; safe to call often. */
export async function loadServerHealth(): Promise<ServerHealth> {
  if (healthCache) return healthCache;
  if (!apiBase()) { healthCache = EMPTY_HEALTH; return healthCache; }
  if (!healthPromise) {
    healthPromise = fetch(`${apiBase()}/api/health`)
      .then(r => (r.ok ? r.json() : EMPTY_HEALTH))
      .then((h: ServerHealth) => { healthCache = h; return h; })
      .catch(() => { healthCache = EMPTY_HEALTH; return EMPTY_HEALTH; });
  }
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
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('luminara-open-paywall', {
          detail: {
            reason: body.error || 'Daily free limit reached',
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

/** Product memory + optional BYOK bag stored per linked account in D1/KV. */
export type WorkspacePayload = {
  storage?: Record<string, string>;
  keys?: Record<string, string>;
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

export function openPaywallModal(reason?: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('luminara-open-paywall', { detail: { reason } }));
  }
}

// ---- Telegram account endpoints -------------------------------------------------------------

export interface TelegramSession {
  user: { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string; is_premium?: boolean };
  subscription: { plan: string; expiresAt: number; startedAt: number } | null;
  startParam?: string;
}

export async function telegramAuth(): Promise<TelegramSession | null> {
  const initData = getInitDataRaw();
  if (!initData || !apiBase()) return null;
  const r = await fetch(`${apiBase()}/api/telegram/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data.ok ? data : null;
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
