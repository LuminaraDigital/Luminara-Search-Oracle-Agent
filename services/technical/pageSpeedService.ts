/**
 * Google PageSpeed Insights v5 (W5).
 */
export type PagespeedMetrics = {
  url: string;
  measurementStatus: 'measured' | 'not_measured';
  strategy: 'mobile' | 'desktop';
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
  performanceScore: number | null;
  measuredAt: number;
  source: 'pagespeed_insights';
  errorReason?: string;
  code?: string;
};

export async function fetchPagespeedInsights(opts: {
  url: string;
  apiKey?: string | null;
  strategy?: 'mobile' | 'desktop';
  fetchImpl?: typeof fetch;
}): Promise<PagespeedMetrics> {
  const measuredAt = Date.now();
  const strategy = opts.strategy || 'mobile';
  const target = opts.url.trim();
  if (!/^https?:\/\//i.test(target)) {
    return {
      url: target,
      measurementStatus: 'not_measured',
      strategy,
      lcpMs: null,
      cls: null,
      inpMs: null,
      performanceScore: null,
      measuredAt,
      source: 'pagespeed_insights',
      errorReason: 'URL must be http(s)',
      code: 'BAD_URL',
    };
  }
  if (!opts.apiKey?.trim()) {
    return {
      url: target,
      measurementStatus: 'not_measured',
      strategy,
      lcpMs: null,
      cls: null,
      inpMs: null,
      performanceScore: null,
      measuredAt,
      source: 'pagespeed_insights',
      errorReason: 'PageSpeed API key missing (set PAGESPEED_API_KEY or BYOK)',
      code: 'PSI_KEY_MISSING',
    };
  }

  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', target);
  endpoint.searchParams.set('strategy', strategy);
  endpoint.searchParams.set('category', 'performance');
  endpoint.searchParams.set('key', opts.apiKey.trim());

  try {
    const fetchImpl = opts.fetchImpl || fetch;
    const res = await fetchImpl(endpoint.toString(), { method: 'GET' });
    if (!res.ok) {
      const text = await res.text();
      return {
        url: target,
        measurementStatus: 'not_measured',
        strategy,
        lcpMs: null,
        cls: null,
        inpMs: null,
        performanceScore: null,
        measuredAt,
        source: 'pagespeed_insights',
        errorReason: `PSI HTTP ${res.status}: ${text.slice(0, 160)}`,
        code: 'PSI_HTTP_ERROR',
      };
    }
    const data = (await res.json()) as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number } };
        audits?: Record<string, { numericValue?: number; displayValue?: string }>;
      };
    };
    const audits = data.lighthouseResult?.audits || {};
    const lcp = audits['largest-contentful-paint']?.numericValue ?? null;
    const cls = audits['cumulative-layout-shift']?.numericValue ?? null;
    const inp =
      audits['interaction-to-next-paint']?.numericValue ??
      audits['experimental-interaction-to-next-paint']?.numericValue ??
      null;
    const scoreRaw = data.lighthouseResult?.categories?.performance?.score;
    return {
      url: target,
      measurementStatus: 'measured',
      strategy,
      lcpMs: typeof lcp === 'number' ? Math.round(lcp) : null,
      cls: typeof cls === 'number' ? Number(cls.toFixed(3)) : null,
      inpMs: typeof inp === 'number' ? Math.round(inp) : null,
      performanceScore: typeof scoreRaw === 'number' ? Math.round(scoreRaw * 100) : null,
      measuredAt,
      source: 'pagespeed_insights',
      code: 'OK',
    };
  } catch (e) {
    return {
      url: target,
      measurementStatus: 'not_measured',
      strategy,
      lcpMs: null,
      cls: null,
      inpMs: null,
      performanceScore: null,
      measuredAt,
      source: 'pagespeed_insights',
      errorReason: e instanceof Error ? e.message : 'PSI request failed',
      code: 'PSI_NETWORK_ERROR',
    };
  }
}
