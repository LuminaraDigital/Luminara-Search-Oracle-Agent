/**
 * Client helper for anonymous landing Probe crawl (robots / llms / ai.txt).
 */
export type ProbeCrawlClientResult =
  | {
      ok: true;
      host: string;
      crawl: {
        status: 'measured' | 'not_measured';
        note: string;
        robotsPresent: boolean;
        llmsPresent: boolean;
        aiTxtPresent: boolean;
      };
    }
  | { ok: false; error: string; code?: string };

export async function fetchProbeCrawl(pageUrl: string): Promise<ProbeCrawlClientResult> {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  try {
    const res = await fetch(
      `${base}/api/visibility/probe-crawl?url=${encodeURIComponent(pageUrl)}`,
      { method: 'GET', credentials: 'omit' },
    );
    const data = (await res.json()) as ProbeCrawlClientResult & { error?: string; code?: string };
    if (!res.ok || !data || data.ok !== true) {
      return {
        ok: false,
        error: (data && 'error' in data && data.error) || `Probe crawl failed (${res.status})`,
        code: data && 'code' in data ? data.code : undefined,
      };
    }
    return data;
  } catch {
    return { ok: false, error: 'Probe crawl unavailable.', code: 'NETWORK' };
  }
}
