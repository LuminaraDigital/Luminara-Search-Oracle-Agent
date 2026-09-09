/**
 * Talks to the Luminara Cloudflare Worker (/api/*).
 *
 * "Proxy mode" means provider calls go through the Worker, which injects the real API keys.
 * It is on automatically when the app is served by the Worker (luminarasuite.com or `wrangler dev`)
 * and can be forced for local Vite dev with VITE_API_BASE=http://localhost:8787.
 */
import { getInitDataRaw } from './telegram/tma';
import { getFirebaseIdTokenSync } from './auth/firebaseAuthService';

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
  Object.entries(authHeaders()).forEach(([k, v]) => headers.set(k, v));
  return fetch(`${apiBase()}/api/sidecars/${id}${path}`, { ...init, headers });
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const initData = getInitDataRaw();
  if (initData) headers['x-telegram-init-data'] = initData;
  const idToken = getFirebaseIdTokenSync();
  if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
  return headers;
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
  if (relayOwnKey) {
    headers.set('x-provider-key', opts.userKey as string);
  } else {
    Object.entries(authHeaders()).forEach(([k, v]) => headers.set(k, v));
  }
  return fetch(`${apiBase()}/api/providers/${providerId}${path}`, { ...init, headers });
}

export function geminiProxyHttpOptions(): { baseUrl: string; headers: Record<string, string> } {
  return { baseUrl: `${apiBase()}/api/providers/gemini`, headers: authHeaders() };
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
