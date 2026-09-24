/**
 * Worker-native DataForSEO HTTP client (allowlisted paths only).
 */
import {
  dataForSeoBasicAuthHeader,
  envHasDataForSeo,
  hasDataForSeoCredentials,
} from '../services/config/runtimeKeys';
import type { Env } from './env';

/** Prefixes MCP paid tools and browser relay may call. */
export const DATAFORSEO_ALLOWED_PREFIXES = [
  '/v3/ai_optimization',
  '/v3/serp',
  '/v3/dataforseo_labs',
  '/v3/backlinks',
  '/v3/domain_analytics',
  '/v3/keywords_data',
] as const;

const DFS_BASE = 'https://api.dataforseo.com';
const DEFAULT_TIMEOUT_MS = 45_000;

export function isDataForSeoPathAllowed(path: string): boolean {
  const p = path.startsWith('/') ? path : `/${path}`;
  return DATAFORSEO_ALLOWED_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export type DataForSeoClientOptions = {
  /** Combined login:password (BYOK). When null, use hosted env secrets. */
  credential?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type DataForSeoCallResult = {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
  code?: string;
};

function resolveAuthHeader(env: Env, credential?: string | null): string | null {
  if (credential && hasDataForSeoCredentials({ luminara_dataforseo_key: credential })) {
    return dataForSeoBasicAuthHeader(credential);
  }
  if (envHasDataForSeo(env)) {
    return dataForSeoBasicAuthHeader(
      `${String(env.DATAFORSEO_LOGIN).trim()}:${String(env.DATAFORSEO_PASSWORD).trim()}`,
    );
  }
  return null;
}

/**
 * POST JSON to an allowlisted DataForSEO path.
 */
export async function dataForSeoPost(
  env: Env,
  path: string,
  payload: unknown,
  opts: DataForSeoClientOptions = {},
): Promise<DataForSeoCallResult> {
  const subPath = path.startsWith('/') ? path : `/${path}`;
  if (!isDataForSeoPathAllowed(subPath)) {
    return {
      ok: false,
      status: 403,
      body: null,
      error: `Path not allowed for DataForSEO: ${subPath}`,
      code: 'DFS_PATH_FORBIDDEN',
    };
  }

  const auth = resolveAuthHeader(env, opts.credential);
  if (!auth) {
    return {
      ok: false,
      status: 401,
      body: null,
      error: 'DataForSEO credentials missing. Pass BYOK x-provider-key (login:password) or configure hosted secrets.',
      code: 'DFS_AUTH_MISSING',
    };
  }

  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${DFS_BASE}${subPath}`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        body,
        error: `DataForSEO HTTP ${res.status}`,
        code: 'DFS_HTTP_ERROR',
      };
    }
    return { ok: true, status: res.status, body };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      body: null,
      error: aborted
        ? `DataForSEO request timed out after ${timeoutMs}ms`
        : e instanceof Error
          ? e.message
          : 'DataForSEO request failed',
      code: aborted ? 'DFS_TIMEOUT' : 'DFS_NETWORK_ERROR',
    };
  } finally {
    clearTimeout(timer);
  }
}

export { dfsFirstResult } from '../services/tools/dfsParse';
