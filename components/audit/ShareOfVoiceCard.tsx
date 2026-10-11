import React from 'react';
import { ICONS } from '../../constants';
import type { ShareOfVoiceSummary } from '../../services/visibility/shareOfVoiceService';

interface ShareOfVoiceCardProps {
  summary?: ShareOfVoiceSummary | null;
}

const kindColor = (kind: string) => {
  if (kind === 'brand') return 'bg-gold/80';
  return 'bg-cyan-500/70';
};

/** A whole number of rows, no more than the rows sampled. Anything else is not a count. */
function isRowCount(value: unknown, total: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= total;
}

/**
 * Shows counts from the audit's search sample: how many sampled queries named the
 * brand and each competitor. No percentage and no bar. With nothing to count it
 * does not render.
 */
export const ShareOfVoiceCard: React.FC<ShareOfVoiceCardProps> = ({ summary }) => {
  if (!summary) return null;
  const total = summary.totalPrompts;
  if (!Number.isInteger(total) || total <= 0 || !Array.isArray(summary.slices)) return null;
  // A stored summary from before this change can hold a slice for rows where nobody was named.
  const slices = summary.slices.filter(
    (slice) => (slice.kind === 'brand' || slice.kind === 'competitor') && isRowCount(slice.mentionCount, total),
  );
  if (!slices.some((slice) => slice.kind === 'brand')) return null;

  return (
    <div className="glass-morphism rounded-2xl border border-gold/40 p-5 bg-gradient-to-br from-black via-black/90 to-black/80 shadow-2xl">
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gold/10 border border-gold/30">
            <ICONS.ChartBar className="w-5 h-5 text-gold-light" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Share of Voice</h3>
            <p className="text-xs text-gray-400">
              Counted from this audit&apos;s search sample: a name found in the sampled results. Not re-fetched.
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="block text-[10px] font-mono text-gray-500 uppercase">Queries sampled</span>
          <span className="text-lg font-bold font-mono text-gold-light">{total}</span>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {slices.slice(0, 6).map((s) => (
          <li key={`${s.kind}-${s.label}`} className="flex items-center justify-between text-xs text-gray-300">
            <span className="flex items-center gap-2 truncate pr-2">
              <span className={`w-2 h-2 rounded-full ${kindColor(s.kind)}`} />
              <span className="truncate">{s.label}</span>
              <span className="text-[9px] font-mono text-gray-500 uppercase">{s.kind}</span>
            </span>
            <span className="font-mono text-gold-light shrink-0">mentioned in {s.mentionCount} of {total} sampled queries</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
