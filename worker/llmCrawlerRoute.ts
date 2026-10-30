/**
 * Bounded fetch of /robots.txt, /llms.txt, and optional /ai.txt for an Instant Audit target.
 * Open to guests on purpose (the guest Instant Audit reads it); only a signed-in caller gets a
 * scout receipt. Private hosts are refused. A same-site 301/302/303/307/308 is followed
 * after the next host is checked again. A redirect to another site is not followed.
 * Crawl files on this Worker's own Custom Domains are read in-process (same-zone fetch returns 522).
 */
import type { Env } from './env';
import { billingId, identify, json } from './workerUtils';
import { resolvesToPublicAddress, safePublicHostname, safePublicUrl, type DohFetch } from './security';
import { sameSiteHost } from '../services/audit/sameSiteHost';
import { mintScoutReceipt } from './referrals';
import { readCapped } from './domainVerification';
import { readServedCrawlFile } from './crawlDocuments';
import { responseBlocked, type LlmCrawlerSnapshot } from '../services/audit/llmCrawlerReadiness';

const MAX_BYTES = 64_000;
const FETCH_MS = 5_000;
const MAX_REDIRECTS = 3;
const FOLLOW_REDIRECT = new Set([301, 302, 303, 307, 308]);

/**
 * A soft 404: the site answered with a web page or an API error (often its homepage,
 * after a redirect) instead of the text file. A 200 alone is not proof the file exists.
 * Crawler files are plain text and never open with a tag or a JSON object. The body
 * decides, not the content type: servers often label real text files text/html.
 */
export function servedWebPage(body: string): boolean {
  const text = body.trimStart().replace(/^(?:<!--[\s\S]*?-->\s*)+/, '');
  return /^[<{]/.test(text);
}

async function fetchOne(
  url: string,
  fetcher: typeof fetch,
  serveHost?: string,
): Promise<{ status: number | null; body: string | null }> {
  let current = url;
  let originHost = '';
  try {
    originHost = new URL(url).hostname;
  } catch {
    return { status: null, body: null };
  }
  const seen = new Set<string>();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (seen.has(current)) return { status: null, body: null };
    seen.add(current);
    if (serveHost) {
      const local = readServedCrawlFile(serveHost, current);
      if (local) return local;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_MS);
    try {
      const res = await fetcher(current, {
        method: 'GET',
        redirect: 'manual',
        signal: ac.signal,
        headers: { accept: 'text/plain, text/markdown, */*' },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('Location') || res.headers.get('location');
        if (!loc || hop === MAX_REDIRECTS || !FOLLOW_REDIRECT.has(res.status)) {
          return { status: res.status, body: null };
        }
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          return { status: res.status, body: null };
        }
        if ((next.protocol !== 'http:' && next.protocol !== 'https:') || !sameSiteHost(originHost, next.hostname)) {
          return { status: res.status, body: null };
        }
        if (!(await resolvesToPublicAddress(next.hostname, fetcher as DohFetch))) {
          return { status: res.status, body: null };
        }
        current = next.toString();
        continue;
      }
      if (res.status === 404) return { status: 404, body: '' };
      if (!res.ok) return { status: res.status, body: null };
      const body = await readCapped(res, MAX_BYTES);
      // A bot challenge stays as served, so readers report it as blocked. Any other web page is
      // recorded as a 404 so every reader, including the Android client, sees the file as missing.
      if (!responseBlocked(res.status, body) && servedWebPage(body)) {
        return { status: 404, body: '' };
      }
      return { status: res.status, body };
    } catch {
      return { status: null, body: null };
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: null, body: null };
}

export async function loadCrawlerSnapshot(
  pageUrl: string,
  fetcher: typeof fetch = fetch,
  serveHost?: string,
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
  const [llms, robots, aiTxt] = await Promise.all([
    fetchOne(`${origin}/llms.txt`, fetcher, serveHost),
    fetchOne(`${origin}/robots.txt`, fetcher, serveHost),
    fetchOne(`${origin}/ai.txt`, fetcher, serveHost),
  ]);
  const snapshot: LlmCrawlerSnapshot = {
    llmsTxt: llms.body,
    llmsHttpStatus: llms.status,
    robotsTxt: robots.body,
    robotsHttpStatus: robots.status,
    aiTxt: aiTxt.body,
    aiHttpStatus: aiTxt.status,
  };
  return { ok: true, snapshot };
}

export async function handleLlmCrawlerRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  const who = await identify(request, env);
  const url = new URL(request.url);
  const target = url.searchParams.get('url') || '';
  const loaded = await loadCrawlerSnapshot(target, fetch, url.hostname);
  if (!loaded.ok) {
    return json({ ok: false, error: loaded.error, code: loaded.code, snapshot: null }, 400);
  }
  const sawFile = [loaded.snapshot.llmsTxt, loaded.snapshot.robotsTxt, loaded.snapshot.aiTxt].some(
    (text) => typeof text === 'string' && text.trim().length > 0,
  );
  const host = safePublicHostname(target);
  let receipt: string | null = null;
  if (sawFile && host && who.user) {
    try {
      receipt = await mintScoutReceipt(env, billingId(who.user), host);
    } catch {
      receipt = null;
    }
  }
  return json({ ok: true, snapshot: loaded.snapshot }, 200, receipt ? { 'X-Scout-Receipt': receipt } : {});
}
