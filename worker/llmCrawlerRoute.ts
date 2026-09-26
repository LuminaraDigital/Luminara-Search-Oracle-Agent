/**
 * Bounded fetch of /robots.txt and /llms.txt for an Instant Audit target.
 * Identity required. Private hosts and redirects are not followed.
 */
import type { Env } from './env';
import { identify, json } from './workerUtils';
import { resolvesToPublicAddress, safePublicUrl, type DohFetch } from './security';
import type { LlmCrawlerSnapshot } from '../services/audit/llmCrawlerReadiness';

const MAX_BYTES = 64_000;
const FETCH_MS = 5_000;

async function readCapped(res: Response): Promise<string> {
  const text = await res.text();
  return text.slice(0, MAX_BYTES);
}

async function fetchOne(url: string, fetcher: typeof fetch): Promise<{ status: number | null; body: string | null }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const res = await fetcher(url, {
      method: 'GET',
      redirect: 'manual',
      signal: ac.signal,
      headers: { accept: 'text/plain, text/markdown, */*' },
    });
    if (res.status >= 300 && res.status < 400) {
      return { status: res.status, body: null };
    }
    if (res.status === 404) return { status: 404, body: '' };
    if (!res.ok) return { status: res.status, body: null };
    return { status: res.status, body: await readCapped(res) };
  } catch {
    return { status: null, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadCrawlerSnapshot(
  pageUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; snapshot: LlmCrawlerSnapshot } | { ok: false; error: string; code: string }> {
  const raw = String(pageUrl || '').trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const page = safePublicUrl(withScheme);
  if (!page) return { ok: false, error: 'URL is not a public http(s) host.', code: 'UNSAFE_URL' };
  const publicHost = await resolvesToPublicAddress(page.hostname, fetcher as DohFetch);
  if (!publicHost) {
    return { ok: false, error: 'Host did not resolve to a public address.', code: 'UNSAFE_HOST' };
  }
  const origin = `${page.protocol}//${page.host}`;
  const [llms, robots] = await Promise.all([
    fetchOne(`${origin}/llms.txt`, fetcher),
    fetchOne(`${origin}/robots.txt`, fetcher),
  ]);
  const snapshot: LlmCrawlerSnapshot = {
    llmsTxt: llms.body,
    llmsHttpStatus: llms.status,
    robotsTxt: robots.body,
    robotsHttpStatus: robots.status,
  };
  return { ok: true, snapshot };
}

export async function handleLlmCrawlerRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  const who = await identify(request, env);
  if (!who.user) {
    return json({ ok: false, error: who.error || 'Sign in required', code: 'AUTH_REQUIRED' }, 401);
  }
  const url = new URL(request.url);
  const target = url.searchParams.get('url') || '';
  const loaded = await loadCrawlerSnapshot(target);
  if (!loaded.ok) {
    return json({ ok: false, error: loaded.error, code: loaded.code, snapshot: null }, 400);
  }
  return json({ ok: true, snapshot: loaded.snapshot });
}
