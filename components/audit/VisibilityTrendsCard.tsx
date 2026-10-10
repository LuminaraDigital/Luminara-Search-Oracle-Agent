import React, { useMemo } from 'react';
import { ICONS } from '../../constants';
import {
  visibilityHistoryService,
  type VisibilityTrendSeries,
} from '../../services/visibility/visibilityHistoryService';

interface VisibilityTrendsCardProps {
  domain: string;
  /** Optional precomputed series; otherwise loaded from local history. */
  series?: VisibilityTrendSeries;
}

function sparkPath(values: number[], width: number, height: number): string {
  if (values.length === 0) return '';
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const span = Math.max(1, max - min);
  return values
    .map((v, i) => {
      const x = values.length === 1 ? width / 2 : (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 8) - 4;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export const VisibilityTrendsCard: React.FC<VisibilityTrendsCardProps> = ({ domain, series: seriesProp }) => {
  const series = useMemo(
    () => seriesProp || visibilityHistoryService.getTrend(domain),
    [domain, seriesProp]
  );

  const citationSeries = series.points.map((p) => p.citationRatePercent);
  const pathCite = sparkPath(citationSeries, 280, 64);

  const latest = series.points[series.points.length - 1];
  // Share of voice is shown as the latest audit's two counts. A snapshot stored
  // before counts were kept has none, and then the tile is left out.
  const latestMentions =
    latest &&
    typeof latest.brandMentionCount === 'number' &&
    Number.isInteger(latest.brandMentionCount) &&
    Number.isInteger(latest.promptCount) &&
    latest.promptCount > 0 &&
    latest.brandMentionCount >= 0 &&
    latest.brandMentionCount <= latest.promptCount
      ? { mentioned: latest.brandMentionCount, total: latest.promptCount }
      : null;

  return (
    <div className="glass-morphism rounded-2xl border border-gold/40 p-5 bg-gradient-to-br from-black via-black/90 to-black/80 shadow-2xl">
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gold/10 border border-gold/30">
            <ICONS.TrendUp className="w-5 h-5 text-gold-light" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Visibility Trends</h3>
            <p className="text-xs text-gray-400">
              Citation rate from your Luminara audits over time (stored in this browser).
            </p>
          </div>
        </div>
        {latest && (
          <div className="text-right">
            <span className="block text-[10px] font-mono text-gray-500 uppercase">Latest cite rate</span>
            <span className="text-lg font-bold font-mono text-gold-light">{latest.citationRatePercent}%</span>
          </div>
        )}
      </div>

      {series.points.length === 0 ? (
        <p className="text-xs text-gray-400 mt-4">
          No history yet. Run Instant Audit again later to build a trend line for this domain.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 pt-4">
            <div className="glass-morphism rounded-xl p-3 border border-white/10">
              <span className="text-[10px] font-mono text-gray-400 uppercase">Citation delta</span>
              <span className="block text-base font-bold font-mono text-success-400">
                {series.deltaCitationRate === null
                  ? 'n/a'
                  : `${series.deltaCitationRate > 0 ? '+' : ''}${series.deltaCitationRate} pts`}
              </span>
            </div>
            {latestMentions && (
              <div className="glass-morphism rounded-xl p-3 border border-white/10">
                <span className="text-[10px] font-mono text-gray-400 uppercase">Share of voice, latest audit</span>
                <span className="block text-xs font-bold font-mono text-cyan-300">
                  mentioned in {latestMentions.mentioned} of {latestMentions.total} sampled queries
                </span>
              </div>
            )}
          </div>

          <div className="mt-4 overflow-x-auto">
            <svg viewBox="0 0 280 64" className="w-full h-16" role="img" aria-label="Citation rate trend">
              <path d={pathCite} fill="none" stroke="currentColor" className="text-gold-light" strokeWidth="2" />
            </svg>
            <div className="flex gap-4 text-[10px] font-mono text-gray-500 mt-1">
              <span className="text-gold-light">Line: citation rate</span>
              <span>{series.points.length} snapshots</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
