/**
 * Anonymous landing Probe crawl: robots.txt / llms.txt / ai.txt plus one read of the homepage head.
 * No auth. No DFS/PSI/oracle. No scout receipt that implies engine Measured.
 * The homepage read returns parsed head fields only, never the page HTML
 * (docs/plans/conversion-honesty-ship.md, amended for G1c). Engines stay Not measured.
 */
import type { Env } from './env';
import { json } from './workerUtils';
import { defaultPortFetcher, fetchPublicUrl, safePublicUrl, type DohFetch } from './security';
import { loadCrawlerSnapshot } from './llmCrawlerRoute';
import { readCapped } from './domainVerification';
import { readPageHead, robotsSaysNoindex } from './pageHead';
import { applyMarketingDocument } from './marketingShell';
import { isStagingCrawlHost, servesOwnHost } from './crawlDocuments';
import { MARKETING_ORIGIN, MARKETING_SHELL_BY_PATH } from '../services/marketing/pageMeta';
import { safeLog } from './logRedaction';
import { BLOCKED_CHECK, responseBlocked, type LlmCrawlerSnapshot } from '../services/audit/llmCrawlerReadiness';
import type { HomepageHead, HomepageReadFailure } from '../services/marketing/homepageSnippet';

const HOMEPAGE_BYTES = 256_000;
const HOMEPAGE_MS = 5_000;
const HOMEPAGE_MAX_REDIRECTS = 3;
const PROBE_UA = 'LuminaraProbe/1.0 (+https://www.luminarasuite.com/methodology)';
/** Repeat checks of one host inside this window reuse the result, so a shared link cannot hammer the site. */
const PROBE_CACHE_SECONDS = 120;
/** Seen only on a challenge page served instead of the site. */
const CHALLENGE_MARKERS = /sucuri_cloudproxy|captcha-delivery\.com|px-captcha/i;
/** Bot-wall vendors whose scripts also sit in normal pages: a sign of a wall only on a page with no title or description. */
const FIREWALL_VENDORS = /_incapsula_resource|awswaf|datadome|ddos-guard/i;
/** Failed reads the edge may reuse briefly, so a widely shared link to a walled site is not refetched on every view. */
const PROBE_FAILURE_CACHE_SECONDS = 30;

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
  /** When this result was read. A cached result keeps its original time. */
  checkedAt: string;
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
    const sample = html.slice(0, 20_000);
    if (responseBlocked(res.status, html) || CHALLENGE_MARKERS.test(sample)) return failed('blocked');
    const head = readPageHead(html);
    const headerNoindex = robotsSaysNoindex(res.headers.get('x-robots-tag'));
    // A bot wall answers 200 with no title or description, often with noindex or a vendor script.
    // Reporting that as the owner's own page (or own noindex) would be a false finding.
    const bare = !head.title && !head.description;
    if (bare && (head.noindex || headerNoindex || FIREWALL_VENDORS.test(sample))) return failed('blocked');
    return {
      page: { finalUrl: fetched.finalUrl, ...head, noindex: head.noindex || headerNoindex },
      pageReason: null,
    };
  } catch {
    return failed('unreachable');
  } finally {
    await res.body?.cancel().catch(() => undefined);
  }
}

/**
 * This Worker's own homepage, parsed from the page it serves (assets plus the same meta injection a
 * visitor gets), because a fetch of its own Custom Domain returns 522. Null for any other host.
 */
async function readOwnHomepage(env: Env, serveHost: string, host: string): Promise<HomepageRead | null> {
  if (!servesOwnHost(serveHost, host) || !env.ASSETS) return null;
  try {
    const shell = await env.ASSETS.fetch(new Request(`https://${host}/`));
    if (!shell.ok) return failed('http_error');
    const head = readPageHead(applyMarketingDocument(await shell.text(), MARKETING_SHELL_BY_PATH['/']));
    const staging = isStagingCrawlHost(host, undefined);
    return {
      page: {
        finalUrl: staging ? `https://${host}/` : `${MARKETING_ORIGIN}/`,
        ...head,
        // Staging answers with X-Robots-Tag: noindex (applyHostRobots).
        noindex: head.noindex || staging,
      },
      pageReason: null,
    };
  } catch {
    return failed('unreachable');
  }
}

function present(body: string | null | undefined, status: number | null | undefined): boolean {
  return status === 200 && typeof body === 'string' && body.trim().length > 0;
}

/** A null status means the fetch failed (timeout, TLS, refused redirect): Not measured, never "missing". */
function fileNote(label: string, body: string | null | undefined, status: number | null | undefined): string {
  if (responseBlocked(status, body)) return `${label}: ${BLOCKED_CHECK}`;
  if (present(body, status)) return `${label} found`;
  if (status === 404) return `${label} missing`;
  return `${label}: Not measured`;
}

function fileSettled(body: string | null | undefined, status: number | null | undefined): boolean {
  if (responseBlocked(status, body)) return false;
  return present(body, status) || status === 404;
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

export async function handleProbeCrawlRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  const url = new URL(request.url);
  const target = String(url.searchParams.get('url') || '').trim();
  if (!target) return json({ ok: false, error: 'Enter a domain or URL.', code: 'MISSING_URL' }, 400);
  // One parse decides the host for every read, the cache key and the reply, so they always agree.
  const page = safePublicUrl(/^https?:\/\//i.test(target) ? target : `https://${target}`);
  if (!page) return json({ ok: false, error: 'URL is not a public http(s) host.', code: 'UNSAFE_URL' }, 400);
  if (page.port) {
    return json({ ok: false, error: "Use the site's normal address, without a port number.", code: 'UNSAFE_URL' }, 400);
  }
  // A trailing dot names the same site; dropping it keeps one cache entry and one reported host.
  const host = page.hostname.replace(/\.$/, '');
  const origin = `${page.protocol}//${host}`;

  // One entry per serving host, scheme and target host; the typed path does not change what is read.
  const cacheKey = new Request(
    `https://probe-cache.invalid/v3/${url.hostname}/${page.protocol.slice(0, -1)}/${encodeURIComponent(host)}`,
  );
  try {
    const hit = await caches.default.match(cacheKey);
    // A cached Response has immutable headers; withCors must be able to set them.
    if (hit) return new Response(hit.body, hit);
  } catch {
    /* local tests have no Cache API */
  }

  const [loaded, homepage] = await Promise.all([
    loadCrawlerSnapshot(origin, fetch, url.hostname),
    readOwnHomepage(env, url.hostname, host).then((own) => own ?? readHomepage(`${origin}/`)),
  ]);
  if (!loaded.ok) {
    return json({ ok: false, error: loaded.error, code: loaded.code }, 400);
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
    checkedAt: new Date().toISOString(),
  };
  // A good read is reused for 2 minutes. A site that turned the check away (blocked, error) is
  // reused for 30 seconds, so a shared link to it is not refetched on every view. An unreachable
  // read is never cached, so "try again" really tries again.
  const seconds = homepage.page
    ? PROBE_CACHE_SECONDS
    : homepage.pageReason === 'blocked' || homepage.pageReason === 'http_error'
      ? PROBE_FAILURE_CACHE_SECONDS
      : 0;
  const response = json(body, 200, { 'cache-control': seconds ? `public, max-age=${seconds}` : 'no-store' });
  if (seconds) {
    try {
      await caches.default.put(cacheKey, response.clone());
    } catch {
      /* local tests have no Cache API */
    }
  }
  return response;
}
