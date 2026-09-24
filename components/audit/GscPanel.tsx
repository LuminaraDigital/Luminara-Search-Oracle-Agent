import React, { useState } from 'react';
import { gscAnalyticsService, type GscSummary } from '../../services/mcp/gscAnalyticsService';

type Props = {
  domain: string;
};

function labsSimulateEnabled(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem('luminara_labs_gsc_simulate') === '1';
}

export const GscPanel: React.FC<Props> = ({ domain }) => {
  const host = domain.replace(/^https?:\/\//i, '').split('/')[0] || domain;
  const [summary, setSummary] = useState<GscSummary | null>(() =>
    gscAnalyticsService.getSavedDataset(host),
  );
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    const text = await file.text();
    try {
      const parsed = gscAnalyticsService.parseGscCsv(text, host, {
        allowSimulate: labsSimulateEnabled(),
      });
      if (!parsed) {
        setError('Could not parse GSC CSV. Export Performance → Queries CSV from Search Console.');
        return;
      }
      gscAnalyticsService.saveDataset(parsed);
      setSummary(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GSC parse failed');
    }
  };

  return (
    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
      <p className="text-xs font-bold text-gray-200">Search Console</p>
      {!summary && (
        <p className="text-[11px] text-gray-500">
          Not connected. Upload a GSC Queries CSV. Simulated data is Labs-only (`luminara_labs_gsc_simulate=1`).
        </p>
      )}
      {error && <p className="text-[11px] text-warning-400">{error}</p>}
      {summary && (
        <dl className="grid grid-cols-2 gap-1 text-[11px] font-mono text-gray-300">
          <dt>Clicks</dt>
          <dd>{summary.totalClicks}</dd>
          <dt>Impressions</dt>
          <dd>{summary.totalImpressions}</dd>
          <dt>Avg CTR</dt>
          <dd>{summary.avgCtr}%</dd>
          <dt>Avg position</dt>
          <dd>{summary.avgPosition}</dd>
        </dl>
      )}
      <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] text-gold-light">
        <span className="px-2 py-1 rounded-lg border border-white/10">Upload CSV</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => void onFile(e.target.files?.[0] || null)}
        />
      </label>
    </div>
  );
};
