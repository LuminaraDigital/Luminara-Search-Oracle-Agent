import React, { useMemo } from 'react';
import { ICONS } from '../../constants';
import type { EmpiricalEvidence } from '../../services/audit/empiricalCitationService';
import { buildBrandMindshare } from '../../services/visibility/mindshareService';
import { extractCitationDrivers } from '../../services/visibility/citationDriverService';
import { scoutAuthoritySources } from '../../services/visibility/authorityScoutService';

interface MindshareRadarCardProps {
  domain: string;
  evidence: EmpiricalEvidence[];
  rawSources?: Array<{ uri: string; title: string }>;
  onSelectAction?: (actionId: string, label: string) => void;
}

export const MindshareRadarCard: React.FC<MindshareRadarCardProps> = ({
  domain,
  evidence,
  rawSources,
  onSelectAction,
}) => {
  const mindshare = useMemo(() => {
    return buildBrandMindshare({ domain, evidence });
  }, [domain, evidence]);

  const drivers = useMemo(() => {
    const combinedSnippet = evidence.map((e) => e.snippet || '').join(' ');
    const brandCited = evidence.some((e) => e.brandCited);
    return extractCitationDrivers({
      domain,
      brandCited,
      snippet: combinedSnippet,
    });
  }, [domain, evidence]);

  const authorityScout = useMemo(() => {
    return scoutAuthoritySources({
      targetDomain: domain,
      evidence,
      rawSources,
    });
  }, [domain, evidence, rawSources]);

  if (!evidence || evidence.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/60 p-5 shadow-xl mb-6">
        <div className="flex items-center justify-between text-xs font-mono text-gray-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gray-500" />
            <span className="font-black uppercase tracking-[0.2em] text-white">AEO Mindshare Radar</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">Not measured</span>
        </div>
        <p className="text-xs text-gray-400 mt-3">Live search citation evidence is required to calculate brand attention share. Sample scans do not invent mindshare scores.</p>
      </div>
    );
  }

  const velocityLabel = mindshare.velocityPercentWoW !== 0
    ? (mindshare.velocityPercentWoW > 0 ? `+${mindshare.velocityPercentWoW}% WoW` : `${mindshare.velocityPercentWoW}% WoW`)
    : 'Baseline';

  return (
    <div className="rounded-2xl border border-white/10 bg-black/60 p-6 shadow-xl mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <h3 className="text-xs font-black uppercase tracking-[0.25em] text-white">
            AEO Mindshare & Attention Radar
          </h3>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">
            Observed
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div>
            <span className="text-gray-500 mr-1.5">Brand Mindshare:</span>
            <span className="font-bold text-gold-light text-sm">
              {mindshare.overallMindsharePercent}%
            </span>
          </div>
          <div>
            <span className="text-gray-500 mr-1.5">Velocity:</span>
            <span className={`font-bold ${mindshare.velocityPercentWoW >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {velocityLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Primary Citation Driver Banner */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3.5 mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-amber-300 font-bold uppercase tracking-wider mb-1">
            <ICONS.Sparkle className="w-3.5 h-3.5 text-amber-400" />
            Key Citation Driver: {drivers.primaryDriver.type.replace(/_/g, ' ')}
          </div>
          <p className="text-xs text-gray-300 leading-relaxed">
            {drivers.primaryDriver.label}. {drivers.primaryDriver.actionHint}
          </p>
        </div>
        {drivers.primaryDriver.recommendedActionId && onSelectAction && (
          <button
            type="button"
            onClick={() => onSelectAction(
              drivers.primaryDriver.recommendedActionId!,
              drivers.primaryDriver.actionHint
            )}
            className="px-3 py-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20 text-[11px] font-mono text-amber-200 uppercase tracking-wider transition-colors shrink-0"
          >
            Commit Fix
          </button>
        )}
      </div>

      {/* Narrative Clusters Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        {mindshare.narratives.map((cluster) => (
          <div
            key={cluster.id}
            className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-semibold text-gray-200">{cluster.name}</span>
                <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                  cluster.velocityStatus === 'surging'
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                    : cluster.velocityStatus === 'decaying'
                    ? 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                    : 'bg-gray-800 text-gray-400 border border-white/5'
                }`}>
                  {cluster.velocityStatus}
                </span>
              </div>
              <div className="w-full bg-white/5 rounded-full h-1.5 mb-2 overflow-hidden">
                <div
                  className="bg-gold h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, cluster.brandMindsharePercent)}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-gray-400 font-mono">
              <span>Mindshare: {cluster.brandMindsharePercent}%</span>
              {cluster.topCompetitor && (
                <span className="text-gray-500 text-[10px]">
                  Rival: {cluster.topCompetitor.name} ({cluster.topCompetitor.citations} cites)
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Untapped Authority Citation Hubs */}
      {authorityScout.topUntappedHub && (
        <div className="rounded-xl border border-white/10 bg-white/[0.01] p-3.5 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2">
            <ICONS.Search className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-gray-400">
              High-leverage citation hub in category:
              <strong className="text-white font-mono ml-1.5">
                {authorityScout.topUntappedHub.domain}
              </strong>
            </span>
          </div>
          <span className="text-[11px] text-cyan-300 font-mono">
            {authorityScout.topUntappedHub.actionRecommendation}
          </span>
        </div>
      )}
    </div>
  );
};
