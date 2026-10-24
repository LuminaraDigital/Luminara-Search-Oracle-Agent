import React, { useMemo } from 'react';
import { ICONS } from '../../constants';
import type { EmpiricalEvidence } from '../../services/audit/empiricalCitationService';
import { NOT_MEASURED } from '../../services/audit/reportBlocks';
import { quotedQuery, type RadarCitationRow, type RadarStatus } from '../audit/VisibilityRadar';
import { buildBrandMindshare, type MindshareHistoryPoint } from '../../services/visibility/mindshareService';
import { extractCitationDrivers } from '../../services/visibility/citationDriverService';
import { scoutAuthoritySources } from '../../services/visibility/authorityScoutService';

interface MindshareRadarCardProps {
  domain: string;
  evidence: EmpiricalEvidence[];
  rawSources?: Array<{ uri: string; title: string }>;
  /** The visibility radar's query rows. Names and citation status come from here. */
  radarRows?: readonly RadarCitationRow[];
  /** Earlier mindshare percents. With none, there is no trend to show. */
  history?: readonly MindshareHistoryPoint[];
  onSelectAction?: (actionId: string, label: string) => void;
}

const CITATION_STATUS: Record<RadarStatus, string> = {
  cited: 'Cited',
  not_cited: 'Not cited',
  not_measured: NOT_MEASURED,
};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

type ShareRow = { id: string; name: string; status: string; rivals: string; percent: number | null };

export const MindshareRadarCard: React.FC<MindshareRadarCardProps> = ({
  domain,
  evidence,
  rawSources,
  radarRows,
  history,
  onSelectAction,
}) => {
  const mindshare = useMemo(() => {
    return buildBrandMindshare({ domain, evidence, history: history ? [...history] : undefined });
  }, [domain, evidence, history]);

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

  const shareRows = useMemo((): ShareRow[] => {
    if (radarRows && radarRows.length > 0) {
      const byName = new Map(mindshare.narratives.map((cluster) => [cluster.name.toLowerCase(), cluster]));
      return radarRows.map((row, index) => ({
        id: `${row.query}-${index}`,
        name: quotedQuery(row.query),
        status: CITATION_STATUS[row.status],
        rivals: row.competitors,
        percent: byName.get(row.query.toLowerCase())?.brandMindsharePercent ?? null,
      }));
    }
    return mindshare.narratives.map((cluster) => ({
      id: cluster.id,
      name: quotedQuery(cluster.name),
      status: cluster.brandMindsharePercent == null ? NOT_MEASURED : `Mindshare: ${cluster.brandMindsharePercent}%`,
      rivals: cluster.topCompetitor ? `${cluster.topCompetitor.name} (${cluster.topCompetitor.citations} cites)` : '',
      percent: cluster.brandMindsharePercent,
    }));
  }, [radarRows, mindshare.narratives]);

  if (!evidence || evidence.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/60 p-5 shadow-xl mb-6">
        <div className="flex items-center justify-between text-xs font-mono text-gray-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gray-500" />
            <span className="font-black uppercase tracking-[0.2em] text-white" title="Mindshare radar">Who gets named</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">{NOT_MEASURED}</span>
        </div>
        <p className="text-xs text-gray-400 mt-3">Live search citation evidence is required to calculate brand attention share. Sample scans do not invent mindshare scores.</p>
      </div>
    );
  }

  const trendKnown = Boolean(history && history.length > 0 && mindshare.overallMindsharePercent != null);
  const trendLabel = !trendKnown
    ? 'First audit, no trend yet'
    : mindshare.velocityPercentWoW > 0
      ? 'surging'
      : mindshare.velocityPercentWoW < 0
        ? 'decaying'
        : 'stable';
  const velocityLabel = mindshare.velocityPercentWoW !== 0
    ? (mindshare.velocityPercentWoW > 0 ? `+${mindshare.velocityPercentWoW}% WoW` : `${mindshare.velocityPercentWoW}% WoW`)
    : 'Baseline';
  const rivalList = [...new Set((radarRows || []).flatMap((row) => (
    row.competitors ? row.competitors.split(',').map((part) => part.trim()).filter(Boolean) : []
  )))];

  return (
    <div className="rounded-2xl border border-white/10 bg-black/60 p-6 shadow-xl mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <h3 className="text-xs font-black uppercase tracking-[0.25em] text-white">
            <span title="Mindshare radar">Who gets named</span>
          </h3>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">
            {mindshare.hasCompetitorEvidence ? 'Observed' : 'Baseline'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          {mindshare.overallMindsharePercent == null ? (
            <span className="text-gray-400">Mindshare not measured</span>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
      {mindshare.source && (
        <p className="text-xs text-gray-400 mb-4">Source: {mindshare.source}</p>
      )}
      {mindshare.overallMindsharePercent == null && (
        <p className="text-xs text-gray-400 mb-4">
          {rivalList.length > 0
            ? `Rivals named in the radar: ${joinNames(rivalList)}. A mindshare percent is not shown.`
            : 'This search sample did not name a competitor, so a mindshare percent is not shown.'}
        </p>
      )}

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

      {shareRows.length > 0 && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        {shareRows.map((cluster) => (
          <div
            key={cluster.id}
            className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-semibold text-gray-200">{cluster.name}</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${trendKnown ? 'uppercase' : ''} ${
                  trendLabel === 'surging'
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                    : trendLabel === 'decaying'
                    ? 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                    : 'bg-gray-800 text-gray-400 border border-white/5'
                }`}>
                  {trendLabel}
                </span>
              </div>
              {cluster.percent != null && (
              <div className="w-full bg-white/5 rounded-full h-1.5 mb-2 overflow-hidden">
                <div
                  className="bg-gold h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, cluster.percent)}%` }}
                />
              </div>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] text-gray-400 font-mono">
              <span>{cluster.status}</span>
              {cluster.rivals && (
                <span className="text-gray-500 text-[10px]">
                  Rival: {cluster.rivals}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      )}

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
