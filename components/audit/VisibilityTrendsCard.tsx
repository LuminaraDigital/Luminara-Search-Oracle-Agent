import React, { useMemo } from 'react';
import { ICONS } from '../../constants';
import {
  visibilityHistoryService,
  type VisibilityHistoryPoint,
  type VisibilityTrendSeries,
} from '../../services/visibility/visibilityHistoryService';

interface VisibilityTrendsCardProps {
  domain: string;
  /** Optional precomputed series; otherwise loaded from local history. */
  series?: VisibilityTrendSeries;
}

/** The two counts of one stored audit, or null when the snapshot does not hold them. */
function mentionCounts(point: VisibilityHistoryPoint): { mentioned: number; total: number } | null {
  const mentioned = point.brandMentionCount;
  const total = point.promptCount;
  if (typeof mentioned !== 'number' || !Number.isInteger(mentioned) || !Number.isInteger(total)) return null;
  if (total <= 0 || mentioned < 0 || mentioned > total) return null;
  return { mentioned, total };
}

/**
 * Lists what each stored audit counted: sampled queries whose results name the brand.
 * It shows no percentage, no line and no change between audits, because two audits
 * sample different queries. A snapshot stored before the counts were kept holds only
 * a percentage, and is not shown.
 */
export const VisibilityTrendsCard: React.FC<VisibilityTrendsCardProps> = ({ domain, series: seriesProp }) => {
  const series = useMemo(
    () => seriesProp || visibilityHistoryService.getTrend(domain),
    [domain, seriesProp]
  );

  const counted = series.points
    .map((point) => ({ point, counts: mentionCounts(point) }))
    .filter((entry): entry is { point: VisibilityHistoryPoint; counts: { mentioned: number; total: number } } => entry.counts !== null);
  const latestFirst = counted.slice(-6).reverse();

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
              Brand mentions counted in the search sample of each Luminara audit (stored in this browser).
            </p>
          </div>
        </div>
        {counted.length > 0 && (
          <div className="text-right">
            <span className="block text-[10px] font-mono text-gray-500 uppercase">Audits counted</span>
            <span className="text-lg font-bold font-mono text-gold-light">{counted.length}</span>
          </div>
        )}
      </div>

      {latestFirst.length === 0 ? (
        <p className="text-xs text-gray-400 mt-4">
          No history yet. Run Instant Audit again later to build a history for this domain.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {latestFirst.map(({ point, counts }) => (
            <li key={point.id} className="flex items-center justify-between gap-3 text-xs text-gray-300">
              <span className="font-mono text-gray-500 shrink-0">
                {new Date(point.measuredAt).toISOString().slice(0, 10)} · {point.focus}
              </span>
              <span className="font-mono text-gold-light text-right">
                mentioned in {counts.mentioned} of {counts.total} sampled queries
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
