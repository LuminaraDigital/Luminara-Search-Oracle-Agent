/**
 * Anonymous landing Probe crawl: robots.txt / llms.txt / ai.txt plus one read of the homepage head.
 * No auth. No DFS/PSI/oracle. No scout receipt that implies engine Measured.
 * The homepage read returns parsed head fields only, never the page HTML
 * (docs/plans/conversion-honesty-ship.md, amended for G1c). Engines stay Not measured.
 */
import type { Env } from './env';
import { json } from './workerUtils';
import { defaultPortFetcher, fetchPublicUrl, safePublicHostname, type DohFetch } from './security';
import { loadCrawlerSnapshot } from './llmCrawlerRoute';
import { readCapped } from './domainVerification';
import { readPageHead, servedHomepageHead } from './pageHead';
import { safeLog } from './logRedaction';
import { BLOCKED_CHECK, responseBlocked, type LlmCrawlerSnapshot } from '../services/audit/llmCrawlerReadiness';
import type { HomepageHead, HomepageReadFailure } from '../services/marketing/homepageSnippet';

const HOMEPAGE_BYTES = 256_000;
const HOMEPAGE_MS = 5_000;
const HOMEPAGE_MAX_REDIRECTS = 3;
const PROBE_UA = 'LuminaraProbe/1.0 (+https://www.luminarasuite.com/methodology)';
/** Repeat checks of one host inside this window reuse the result, so a shared link cannot hammer the site. */
const PROBE_CACHE_SECONDS = 120;

export type ProbeCrawlStatus = 'measured' | 'not_measured';

export type ProbeCrawlResult = {
  ok: true;
  host: string;
  crawl: {
    status: ProbeCrawlStatus;
    note: string;
    robotsPresent: boolean;
    llmsPresent: boolean;
    aiTxtPresent: boolean;
  };
  snapshot: Pick<LlmCrawlerSnapshot, 'robotsHttpStatus' | 'llmsHttpStatus' | 'aiHttpStatus'>;
  /** Head fields read from the homepage, or null with `pageReason`. */
  page: HomepageHead | null;
  pageReason: HomepageReadFailure | null;
};

type HomepageRead = { page: HomepageHead; pageReason: null } | { page: null; pageReason: HomepageReadFailure };

const failed = (pageReason: HomepageReadFailure): HomepageRead => ({ page: null, pageReason });

/**
 * One GET of the homepage: public host and default port on every hop (fetchPublicUrl), 5 seconds
 * for the whole read including the body, 256 KB, HTML only, no cookies.
 */
export async function readHomepage(pageUrl: string, fetcher: typeof fetch = fetch): Promise<HomepageRead> {
  const fetched = await fetchPublicUrl(
    pageUrl,
    {
      method: 'GET',
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': PROBE_UA },
      signal: AbortSignal.timeout(HOMEPAGE_MS),
    },
    { fetcher: defaultPortFetcher(fetcher), dohFetcher: fetcher as DohFetch, maxRedirects: HOMEPAGE_MAX_REDIRECTS },
  );
  if (!fetched.ok) return failed('unreachable');
  const res = fetched.response;
  try {
    if (!res.ok) {
      const body = res.status === 403 || res.status === 429 ? null : await readCapped(res, 4_000);
      return failed(responseBlocked(res.status, body) ? 'blocked' : 'http_error');
    }
    if (!/html/i.test(res.headers.get('content-type') || '')) return failed('not_html');
    const html = await readCapped(res, HOMEPAGE_BYTES);
    if (responseBlocked(res.status, html)) return failed('blocked');
    const head = readPageHead(html);
    const headerNoindex = /\b(noindex|none)\b/i.test(res.headers.get('x-robots-tag') || '');
    return {
      page: { status: res.status, finalUrl: fetched.finalUrl, ...head, noindex: head.noindex || headerNoindex },
      pageReason: null,
    };
  } catch {
    return failed('unreachable');
  } finally {
    await res.body?.cancel().catch(() => undefined);
  }
}

/** This Worker's own homepage is read from what it serves; any other host is fetched. */
async function readOwnOrRemoteHomepage(serveHost: string, host: string, homepageUrl: string): Promise<HomepageRead> {
  if (!host) return failed('unreachable');
  const own = servedHomepageHead(serveHost, host);
  return own ? { page: own, pageReason: null } : readHomepage(homepageUrl);
}

function present(body: string | null | undefined, status: number | null | undefined): boolean {
  return status === 200 && typeof body === 'string' && body.trim().length > 0;
}

function fileNote(label: string, body: string | null | undefined, status: number | null | undefined): string {
  if (responseBlocked(status, body)) return `${label}: ${BLOCKED_CHECK}`;
  if (present(body, status)) return `${label} found`;
  if (status == null || status === 404) return `${label} missing`;
  return `${label}: Not measured`;
}

function fileSettled(body: string | null | undefined, status: number | null | undefined): boolean {
  if (responseBlocked(status, body)) return false;
  return present(body, status) || status == null || status === 404;
}

export function summarizeProbeCrawl(
  host: string,
  snapshot: LlmCrawlerSnapshot,
): ProbeCrawlResult['crawl'] {
  const robotsPresent = present(snapshot.robotsTxt, snapshot.robotsHttpStatus);
  const llmsPresent = present(snapshot.llmsTxt, snapshot.llmsHttpStatus);
  const aiTxtPresent = present(snapshot.aiTxt, snapshot.aiHttpStatus);
  const parts: string[] = [];
  parts.push(fileNote('robots.txt', snapshot.robotsTxt, snapshot.robotsHttpStatus));
  parts.push(fileNote('llms.txt', snapshot.llmsTxt, snapshot.llmsHttpStatus));
  const aiStatus = snapshot.aiHttpStatus;
  if (aiTxtPresent || (aiStatus != null && aiStatus !== 404)) {
    parts.push(fileNote('ai.txt', snapshot.aiTxt, aiStatus));
  }
  const settled = fileSettled(snapshot.robotsTxt, snapshot.robotsHttpStatus)
    && fileSettled(snapshot.llmsTxt, snapshot.llmsHttpStatus)
    && (aiStatus == null || aiStatus === 404 || aiTxtPresent || fileSettled(snapshot.aiTxt, aiStatus));
  return {
    status: settled ? 'measured' : 'not_measured',
    note: `Live crawl · ${parts.join('; ')}. Engines still need Instant Audit.`,
    robotsPresent,
    llmsPresent,
    aiTxtPresent,
  };
}

export async function handleProbeCrawlRoute(request: Request, _env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  const url = new URL(request.url);
  const target = url.searchParams.get('url') || '';
  const hostHint = safePublicHostname(target);
  if (!hostHint && !String(target || '').trim()) {
    return json({ ok: false, error: 'Enter a domain or URL.', code: 'MISSING_URL' }, 400);
  }
  const host = safePublicHostname(target) || hostHint || '';
  const cacheKey = host ? new Request(`https://probe-cache.invalid/v1/${encodeURIComponent(host)}`) : null;
  if (cacheKey) {
    try {
      const hit = await caches.default.match(cacheKey);
      if (hit) return hit;
    } catch {
      /* local tests have no Cache API */
    }
  }

  const raw = String(target).trim();
  const homepageUrl = `${raw.toLowerCase().startsWith('http://') ? 'http' : 'https'}://${host}/`;
  const [loaded, homepage] = await Promise.all([
    loadCrawlerSnapshot(target, fetch, url.hostname),
    readOwnOrRemoteHomepage(url.hostname, host, homepageUrl),
  ]);
  if (!loaded.ok) {
    return json({ ok: false, error: loaded.error, code: loaded.code }, 400);
  }
  if (!host) {
    return json({ ok: false, error: 'URL is not a public http(s) host.', code: 'UNSAFE_URL' }, 400);
  }
  // Outcome only, never the host: tells us what share of homepages the probe can read.
  safeLog('probe_homepage_read', { outcome: homepage.pageReason ?? 'read' });
  const crawl = summarizeProbeCrawl(host, loaded.snapshot);
  const body: ProbeCrawlResult = {
    ok: true,
    host,
    crawl,
    snapshot: {
      robotsHttpStatus: loaded.snapshot.robotsHttpStatus,
      llmsHttpStatus: loaded.snapshot.llmsHttpStatus,
      aiHttpStatus: loaded.snapshot.aiHttpStatus ?? null,
    },
    page: homepage.page,
    pageReason: homepage.pageReason,
  };
  const response = json(body, 200, { 'cache-control': `public, max-age=${PROBE_CACHE_SECONDS}` });
  if (cacheKey) {
    try {
      await caches.default.put(cacheKey, response.clone());
    } catch {
      /* local tests have no Cache API */
    }
  }
  return response;
}
