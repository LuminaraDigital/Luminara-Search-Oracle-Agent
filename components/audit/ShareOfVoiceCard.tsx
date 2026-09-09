import React from 'react';
import { ICONS } from '../../constants';
import type { ShareOfVoiceSummary } from '../../services/visibility/shareOfVoiceService';

interface ShareOfVoiceCardProps {
  summary?: ShareOfVoiceSummary | null;
}

const kindColor = (kind: string) => {
  if (kind === 'brand') return 'bg-gold/80';
  if (kind === 'competitor') return 'bg-cyan-500/70';
  return 'bg-gray-500/60';
};

export const ShareOfVoiceCard: React.FC<ShareOfVoiceCardProps> = ({ summary }) => {
  if (!summary) return null;

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
              Observed from this audit&apos;s prompt panel (mention vs citation coverage).
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="block text-[10px] font-mono text-gray-500 uppercase">Brand citation share</span>
          <span className="text-lg font-bold font-mono text-gold-light">{summary.brandCitationSharePercent}%</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 pt-4">
        <div className="glass-morphism rounded-xl p-3 border border-white/10 text-center">
          <span className="block text-[10px] uppercase font-mono text-gray-400">Prompts</span>
          <span className="text-base font-bold font-mono text-white">{summary.totalPrompts}</span>
        </div>
        <div className="glass-morphism rounded-xl p-3 border border-white/10 text-center">
          <span className="block text-[10px] uppercase font-mono text-gray-400">Mention cov.</span>
          <span className="text-base font-bold font-mono text-success-400">{summary.mentionCoveragePercent}%</span>
        </div>
        <div className="glass-morphism rounded-xl p-3 border border-white/10 text-center">
          <span className="block text-[10px] uppercase font-mono text-gray-400">Citation cov.</span>
          <span className="text-base font-bold font-mono text-cyan-300">{summary.citationCoveragePercent}%</span>
        </div>
      </div>

      <div className="mt-4 h-3 rounded-full overflow-hidden flex border border-white/10">
        {summary.slices.map((s) => (
          <div
            key={`${s.kind}-${s.label}`}
            className={`${kindColor(s.kind)} h-full`}
            style={{ width: `${Math.max(s.citationSharePercent, s.citationSharePercent === 0 ? 0 : 2)}%` }}
            title={`${s.label}: ${s.citationSharePercent}%`}
          />
        ))}
      </div>

      <ul className="mt-3 space-y-1.5">
        {summary.slices.slice(0, 6).map((s) => (
          <li key={`${s.kind}-${s.label}`} className="flex items-center justify-between text-xs text-gray-300">
            <span className="flex items-center gap-2 truncate pr-2">
              <span className={`w-2 h-2 rounded-full ${kindColor(s.kind)}`} />
              <span className="truncate">{s.label}</span>
              <span className="text-[9px] font-mono text-gray-500 uppercase">{s.kind}</span>
            </span>
            <span className="font-mono text-gold-light shrink-0">{s.citationSharePercent}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
