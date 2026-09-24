import React, { useState } from 'react';
import { fetchPagespeedInsights, type PagespeedMetrics } from '../../services/technical/pageSpeedService';
import { configService } from '../../services/configService';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';
import { Button } from '../ui/Button';
import { PsiEmptyState } from './psiGscEmptyStates';

type Props = {
  url: string;
};

export const PageSpeedPanel: React.FC<Props> = ({ url }) => {
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<PagespeedMetrics | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const byok = configService.getPagespeedKey()?.trim() || '';
      if (byok) {
        setMetrics(await fetchPagespeedInsights({ url, apiKey: byok }));
        return;
      }

      // Signed-in path: Worker uses hosted PAGESPEED_API_KEY when present.
      const base = apiBase();
      if (base) {
        const r = await workerFetchWithAuthRetry(`${base}/api/pagespeed`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url, strategy: 'mobile' }),
        });
        const data = (await r.json()) as { metrics?: PagespeedMetrics; error?: string; code?: string };
        if (data.metrics) {
          setMetrics(data.metrics);
          return;
        }
        const authBlocked = data.code === 'AUTH_REQUIRED' || r.status === 401;
        setMetrics({
          url,
          measurementStatus: 'not_measured',
          strategy: 'mobile',
          lcpMs: null,
          cls: null,
          inpMs: null,
          performanceScore: null,
          measuredAt: Date.now(),
          source: 'pagespeed_insights',
          errorReason: authBlocked
            ? data.error ||
              'Sign in to use hosted PageSpeed, or add a Google PSI key in Settings (Search tab).'
            : data.error || `PageSpeed proxy failed (${r.status})`,
          code: data.code || (authBlocked ? 'AUTH_REQUIRED' : 'PSI_PROXY_ERROR'),
        });
        return;
      }

      setMetrics(
        await fetchPagespeedInsights({ url, apiKey: null }),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-gray-200">PageSpeed / CWV</p>
        <Button variant="secondary" size="xs" loading={loading} onClick={run} className="normal-case tracking-normal">
          {loading ? 'Measuring…' : 'Measure'}
        </Button>
      </div>
      {!metrics && <PsiEmptyState />}
      {metrics && metrics.measurementStatus === 'not_measured' && (
        <p className="text-[11px] text-warning-400">{metrics.errorReason || 'Not measured'}</p>
      )}
      {metrics && metrics.measurementStatus === 'measured' && (
        <dl className="grid grid-cols-2 gap-1 text-[11px] font-mono text-gray-300">
          <dt>Score</dt>
          <dd>{metrics.performanceScore ?? 'n/a'}</dd>
          <dt>LCP</dt>
          <dd>{metrics.lcpMs != null ? `${metrics.lcpMs}ms` : 'n/a'}</dd>
          <dt>CLS</dt>
          <dd>{metrics.cls ?? 'n/a'}</dd>
          <dt>INP</dt>
          <dd>{metrics.inpMs != null ? `${metrics.inpMs}ms` : 'n/a'}</dd>
        </dl>
      )}
    </div>
  );
};
