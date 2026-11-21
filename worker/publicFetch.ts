/**
 * Bounded page fetch for server-side checks (Allora 3.8). Wraps fetchPublicUrl and adds:
 * one overall deadline over DNS and every hop, at most 3 redirects that stay on the target
 * host or its www twin, default ports only, the Worker's own hosts refused, HTML and plain
 * text only, and a 512 KB cap on decompressed bytes. GET with fixed headers; it keeps no state.
 * The text it returns is for checks inside the Worker only and is never sent to a client.
 */
import { fetchPublicUrl, safePublicUrl, type DohFetch } from './security';

export const PUBLIC_FETCH_DEADLINE_MS = 5_000;
export const PUBLIC_FETCH_MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'LuminaraOracle/1.0 (+https://luminarasuite.com)';

export type PublicFetchCode =
  | 'invalid_url'
  | 'own_host'
  | 'non_default_port'
  | 'not_public'
  | 'redirect_off_domain'
  | 'too_many_redirects'
  | 'timeout'
  | 'fetch_failed'
  | 'http_status'
  | 'unsupported_type';

export type PublicFetchResult =
  | { ok: true; status: number; finalUrl: string; kind: 'html' | 'text'; text: string; truncated: boolean }
  | { ok: false; code: PublicFetchCode; status?: number };

export type PublicFetchEnv = { WEBAPP_URL?: string; ALLOWED_ORIGINS?: string };

export type PublicFetchOptions = {
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  dohFetcher?: DohFetch;
  /** Tests only: shortens the 5 s deadline. */
  deadlineMs?: number;
};

function bareHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

function ownHosts(env: PublicFetchEnv): Set<string> {
  const hosts = new Set<string>();
  for (const raw of [env.WEBAPP_URL || '', ...(env.ALLOWED_ORIGINS || '').split(',')]) {
    try {
      if (raw.trim()) hosts.add(bareHost(new URL(raw.trim()).hostname));
    } catch {
      /* not a URL: nothing to refuse */
    }
  }
  return hosts;
}

function isOwnHost(host: string, own: Set<string>): boolean {
  const bare = bareHost(host);
  return own.has(bare) || bare === 'workers.dev' || bare.endsWith('.workers.dev');
}

/** Same host, or its www twin, on the default port. */
function sameSite(url: URL, targetBare: string): boolean {
  return !url.port && bareHost(url.hostname) === targetBare;
}

const FETCH_ERRORS: Record<string, PublicFetchCode> = {
  'URL is not a public http(s) target': 'invalid_url',
  'hostname does not resolve to a public address': 'not_public',
  'redirect refused': 'redirect_off_domain',
  'redirect target is not a public http(s) URL': 'redirect_off_domain',
  'too many redirects': 'too_many_redirects',
};

function contentKind(contentType: string | null): 'html' | 'text' | null {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  if (type === 'text/html') return 'html';
  if (type === 'text/plain') return 'text';
  return null;
}

async function readCapped(
  res: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  aborted.catch(() => {});
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      if (size + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - size));
        size = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    if (truncated || signal.aborted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), truncated };
}

export async function fetchPublicPage(
  input: string,
  env: PublicFetchEnv,
  opts: PublicFetchOptions = {},
): Promise<PublicFetchResult> {
  const target = safePublicUrl(input);
  if (!target) return { ok: false, code: 'invalid_url' };
  if (target.port) return { ok: false, code: 'non_default_port' };
  if (isOwnHost(target.hostname, ownHosts(env))) return { ok: false, code: 'own_host' };

  const targetBare = bareHost(target.hostname);
  const signal = AbortSignal.timeout(opts.deadlineMs ?? PUBLIC_FETCH_DEADLINE_MS);
  const result = await fetchPublicUrl(
    target.toString(),
    {
      method: 'GET',
      // Workers send no cookies on outbound fetch; no caller-supplied init reaches this call.
      headers: { 'user-agent': USER_AGENT, accept: 'text/html, text/plain;q=0.9' },
    },
    {
      fetcher: opts.fetcher,
      dohFetcher: opts.dohFetcher,
      maxRedirects: MAX_REDIRECTS,
      signal,
      allowRedirect: (next) => sameSite(next, targetBare),
    },
  );
  if (!result.ok) {
    if (signal.aborted) return { ok: false, code: 'timeout' };
    return { ok: false, code: FETCH_ERRORS[result.error] ?? 'fetch_failed' };
  }

  const res = result.response;
  if (res.status < 200 || res.status >= 300) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, code: 'http_status', status: res.status };
  }
  const kind = contentKind(res.headers.get('content-type'));
  if (!kind) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, code: 'unsupported_type', status: res.status };
  }
  try {
    const { text, truncated } = await readCapped(res, PUBLIC_FETCH_MAX_BYTES, signal);
    return { ok: true, status: res.status, finalUrl: result.finalUrl, kind, text, truncated };
  } catch {
    return { ok: false, code: signal.aborted ? 'timeout' : 'fetch_failed' };
  }
}
