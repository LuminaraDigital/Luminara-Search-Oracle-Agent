import type { Env } from './env';
import { stripUpstreamHeaders } from './security';
import { identify, json, fetchWithTimeout, isAbortError } from './workerUtils';

export type SidecarId = 'languagetool' | 'umami';

export const SIDECAR_LABEL: Record<SidecarId, string> = {
  languagetool: 'Writing check',
  umami: 'Results tracking',
};
export const SIDECAR_TIMEOUT_MS = 15_000;
export const UMAMI_TOKEN_KV_KEY = 'umami:token';
export const UMAMI_TOKEN_TTL_SEC = 12 * 3600;

/** Read-only Umami API surface: the website list and per-website stats/metrics/pageviews/sessions. */
export const UMAMI_PATH_RE = /^\/api\/websites(\/[A-Za-z0-9-]+\/(stats|metrics|pageviews|sessions))?$/;

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
  try {
    host = new URL(root).hostname.toLowerCase();
  } catch {
    host = '';
  }
  const path = host === 'api.umami.is' ? subPath.replace(/^\/api(?=\/|\?|$)/, '/v1') : subPath;
  return root + path;
}

export function sidecarNotConfigured(id: SidecarId): Response {
  return json({ error: `${SIDECAR_LABEL[id]} is not set up on the server. Add a URL in Settings or ask your admin.` }, 503);
}

export function isSidecarConfigured(env: Env, id: SidecarId): boolean {
  if (id === 'languagetool') return Boolean(env.LANGUAGETOOL_URL);
  return Boolean(env.UMAMI_URL && (env.UMAMI_API_KEY || (env.UMAMI_USERNAME && env.UMAMI_PASSWORD)));
}

/** Copies an upstream response for the browser, dropping headers that no longer apply after re-framing. */
export function relayResponse(res: Response): Response {
  const out = new Headers(res.headers);
  stripUpstreamHeaders(out);
  return new Response(res.body, { status: res.status, headers: out });
}

/** Logs into self-hosted Umami and caches the bearer token in KV. Returns null on failure. */
export async function umamiLogin(env: Env): Promise<string | null> {
  if (!env.UMAMI_URL || !env.UMAMI_USERNAME || !env.UMAMI_PASSWORD) return null;
  try {
    const res = await fetchWithTimeout(
      `${env.UMAMI_URL.replace(/\/+$/, '')}/api/auth/login`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: env.UMAMI_USERNAME, password: env.UMAMI_PASSWORD }),
      },
      SIDECAR_TIMEOUT_MS
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { token?: string };
    if (!data.token) return null;
    try {
      if (env.LUMINARA_KV) await env.LUMINARA_KV.put(UMAMI_TOKEN_KV_KEY, data.token, { expirationTtl: UMAMI_TOKEN_TTL_SEC });
    } catch {
      /* KV optional in dev */
    }
    return data.token;
  } catch {
    return null;
  }
}

export async function proxySidecar(request: Request, env: Env, id: SidecarId, subPath: string): Promise<Response> {
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
      const res = await fetchWithTimeout(
        upstream,
        {
          method: request.method,
          headers,
          body: request.method === 'GET' ? undefined : await request.text(),
        },
        SIDECAR_TIMEOUT_MS
      );
      return relayResponse(res);
    } catch (e) {
      return json({ error: isAbortError(e) ? timeoutMessage : unreachableMessage }, isAbortError(e) ? 504 : 502);
    }
  }

  // umami
  const upstream = umamiUpstreamPath(env.UMAMI_URL!, subPath) + url.search;
  const accept = request.headers.get('accept');
  const baseHeaders: Record<string, string> = { accept: accept || 'application/json' };

  const send = (token: string) =>
    fetchWithTimeout(
      upstream,
      {
        method: 'GET',
        // Umami Cloud reads x-umami-api-key; self-hosted Umami reads a bearer token. Each ignores the other.
        headers: { ...baseHeaders, 'x-umami-api-key': token, authorization: `Bearer ${token}` },
      },
      SIDECAR_TIMEOUT_MS
    );

  try {
    if (env.UMAMI_API_KEY) return relayResponse(await send(env.UMAMI_API_KEY));

    let cached: string | null = null;
    try {
      cached = env.LUMINARA_KV ? await env.LUMINARA_KV.get(UMAMI_TOKEN_KV_KEY) : null;
    } catch {
      cached = null;
    }
    let token = cached || (await umamiLogin(env));
    if (!token) return json({ error: `${SIDECAR_LABEL[id]} sign-in failed on the server. Ask your admin to check the username and password.` }, 502);

    let res = await send(token);
    if (res.status === 401 && cached) {
      // The cached token expired or was revoked: log in again once and retry.
      try {
        if (env.LUMINARA_KV) await env.LUMINARA_KV.delete(UMAMI_TOKEN_KV_KEY);
      } catch {
        /* ignore */
      }
      token = await umamiLogin(env);
      if (!token) return json({ error: `${SIDECAR_LABEL[id]} sign-in failed on the server. Ask your admin to check the username and password.` }, 502);
      res = await send(token);
    }
    return relayResponse(res);
  } catch (e) {
    return json({ error: isAbortError(e) ? timeoutMessage : unreachableMessage }, isAbortError(e) ? 504 : 502);
  }
}
