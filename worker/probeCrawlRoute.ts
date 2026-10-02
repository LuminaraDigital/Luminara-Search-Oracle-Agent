/**
 * Anonymous landing Probe crawl: robots.txt / llms.txt / ai.txt only.
 * No auth. No DFS/PSI/oracle. No scout receipt that implies engine Measured.
 */
import type { Env } from './env';
import { json } from './workerUtils';
import { safePublicHostname } from './security';
import { loadCrawlerSnapshot } from './llmCrawlerRoute';
import type { LlmCrawlerSnapshot } from '../services/audit/llmCrawlerReadiness';

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
};

function present(body: string | null | undefined, status: number | null | undefined): boolean {
  return status === 200 && typeof body === 'string' && body.trim().length > 0;
}

export function summarizeProbeCrawl(
  host: string,
  snapshot: LlmCrawlerSnapshot,
): ProbeCrawlResult['crawl'] {
  const robotsPresent = present(snapshot.robotsTxt, snapshot.robotsHttpStatus);
  const llmsPresent = present(snapshot.llmsTxt, snapshot.llmsHttpStatus);
  const aiTxtPresent = present(snapshot.aiTxt, snapshot.aiHttpStatus);
  const parts: string[] = [];
  parts.push(robotsPresent ? 'robots.txt found' : 'robots.txt missing');
  parts.push(llmsPresent ? 'llms.txt found' : 'llms.txt missing');
  if (aiTxtPresent) parts.push('ai.txt found');
  return {
    status: 'measured',
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
  const loaded = await loadCrawlerSnapshot(target);
  if (!loaded.ok) {
    return json({ ok: false, error: loaded.error, code: loaded.code }, 400);
  }
  const host = safePublicHostname(target) || hostHint || '';
  if (!host) {
    return json({ ok: false, error: 'URL is not a public http(s) host.', code: 'UNSAFE_URL' }, 400);
  }
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
  };
  return json(body, 200);
}
