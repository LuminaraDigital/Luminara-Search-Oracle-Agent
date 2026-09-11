import React, { useState, useEffect } from 'react';
import { ICONS } from '../../constants';
import { EmpiricalCitationSummary, QueryIntent } from '../../services/audit/empiricalCitationService';
import type { CitationIntegrityResult } from '../../services/audit/citationIntegrityService';

interface EmpiricalEvidenceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  summary?: EmpiricalCitationSummary;
  integrity?: CitationIntegrityResult;
}

export const EmpiricalEvidenceDrawer: React.FC<EmpiricalEvidenceDrawerProps> = ({
  isOpen,
  onClose,
  summary,
  integrity,
}) => {
  const [filter, setFilter] = useState<'all' | QueryIntent>('all');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !summary) return null;

  const filteredEvidence = summary.evidenceList.filter((e) => {
    if (filter === 'all') return true;
    return e.intent === filter;
  });

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="relative w-full max-w-2xl h-full glass-morphism border-l border-gold/40 shadow-2xl flex flex-col bg-black/95 overflow-hidden animate-in slide-in-from-right duration-300"
        role="dialog"
        aria-modal="true"
        aria-label="Empirical Multi-LLM Citation Proof"
      >
        
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 bg-black/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gold/10 border border-gold/30 text-gold-light">
              <ICONS.Radar className="w-5 h-5 text-gold-light" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                Empirical Multi-LLM Citation Proof
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-gold/20 text-gold-light border border-gold/30">
                  Live SERP Grounded
                </span>
              </h3>
              <p className="text-xs text-gray-400">
                {summary.targetDomain} &bull; Probed across {summary.totalQueriesTested} strategic query vectors
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ICONS.X className="w-5 h-5" />
          </button>
        </div>

        {/* Top Summary Metrics Bar */}
        <div className={`grid gap-3 p-4 bg-black/40 border-b border-white/5 ${integrity ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
          <div className="glass-morphism p-3 rounded-xl border border-white/10 text-center">
            <span className="block text-[10px] uppercase font-mono text-gray-400">Citation Rate</span>
            <span className={`text-xl font-bold font-mono ${summary.citationRatePercent >= 60 ? 'text-success-400' : 'text-warning-400'}`}>
              {summary.citationRatePercent}%
            </span>
            <span className="text-[9px] text-gray-500">{summary.queriesCitedCount}/{summary.totalQueriesTested} queries cited</span>
          </div>

          <div className="glass-morphism p-3 rounded-xl border border-white/10 text-center">
            <span className="block text-[10px] uppercase font-mono text-gray-400">Entity Clarity</span>
            <span className="text-xl font-bold font-mono text-gold-light">
              {summary.entityClarityScore}/100
            </span>
            <span className="text-[9px] text-gray-500">Knowledge graph strength</span>
          </div>

          <div className="glass-morphism p-3 rounded-xl border border-white/10 text-center">
            <span className="block text-[10px] uppercase font-mono text-gray-400">Top Competitor</span>
            <span className="text-xs font-bold font-mono text-danger-300 truncate block mt-1" title={summary.topCitedCompetitor || 'None'}>
              {summary.topCitedCompetitor || 'None detected'}
            </span>
            <span className="text-[9px] text-gray-500">Highest AEO citation share</span>
          </div>

          {integrity && (
            <div className="glass-morphism p-3 rounded-xl border border-white/10 text-center">
              <span className="block text-[10px] uppercase font-mono text-gray-400">Integrity</span>
              <span className={`text-xl font-bold font-mono ${integrity.integrityScore >= 60 ? 'text-success-400' : 'text-warning-400'}`}>
                {integrity.integrityScore}/100
              </span>
              <span className="text-[9px] text-gray-500">
                spoof {integrity.spoofRisk} · dead {integrity.deadCitationCount}
              </span>
            </div>
          )}
        </div>

        {/* Filter Navigation */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-white/5 bg-black/20 text-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Filter:</span>
          {(['all', 'informational', 'commercial', 'comparative'] as const).map((intent) => (
            <button
              key={intent}
              onClick={() => setFilter(intent)}
              className={`px-3 py-1 rounded-md text-[11px] font-mono capitalize transition-all ${
                filter === intent
                  ? 'bg-gold text-black font-bold shadow-sm shadow-gold/20'
                  : 'text-gray-400 hover:text-white glass-morphism'
              }`}
            >
              {intent}
            </button>
          ))}
        </div>

        {/* Evidence Cards List */}
        <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-surface-1">
          {filteredEvidence.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-xs font-mono">
              No evidence matching selected intent filter.
            </div>
          ) : (
            filteredEvidence.map((ev) => (
              <div
                key={ev.id}
                className="glass-morphism rounded-xl border border-white/10 p-4 space-y-3 hover:border-gold/40 transition-all"
              >
                {/* Top Row: Intent & Citation Status */}
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-white/5 text-gray-300 border border-white/10">
                    {ev.intent}
                  </span>
                  
                  {ev.brandCited ? (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase tracking-wider bg-success-500/20 text-success-300 border border-success-500/40 flex items-center gap-1">
                      <ICONS.CheckCircle className="w-3 h-3 text-success-400" />
                      Cited {ev.brandRank ? `#${ev.brandRank}` : ''}
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase tracking-wider bg-danger-500/20 text-danger-300 border border-danger-500/40 flex items-center gap-1">
                      <ICONS.AlertTriangle className="w-3 h-3 text-danger-400" />
                      Zero Citation Gap
                    </span>
                  )}
                </div>

                {/* Query */}
                <div>
                  <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest block">Probed Query</span>
                  <p className="text-xs font-semibold text-white font-mono mt-0.5">
                    &ldquo;{ev.query}&rdquo;
                  </p>
                </div>

                {/* Live Snippet / Grounding Proof */}
                {ev.snippet && (
                  <div className="p-2.5 rounded-lg bg-black/60 border border-white/5 text-xs text-gray-300 font-mono leading-relaxed select-text">
                    <span className="text-[9px] uppercase tracking-wider text-gold-light block mb-1 font-bold">
                      Extracted SERP / AI Grounding Proof
                    </span>
                    &ldquo;{ev.snippet}&rdquo;
                  </div>
                )}

                {/* Competitors and Confidence */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5 text-[11px] text-gray-400">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-500">Competitors:</span>
                    {ev.competitorsCited.length > 0 ? (
                      ev.competitorsCited.map((comp, ci) => (
                        <span key={ci} className="px-1.5 py-0.5 rounded bg-white/5 text-danger-300 text-[10px] font-mono">
                          {comp}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-gray-600 italic">None detected</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 font-mono">
                      Conf: {ev.citationConfidence}%
                    </span>
                    {ev.citedUrl && (
                      <a
                        href={ev.citedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gold-light hover:underline flex items-center gap-1 text-[11px]"
                      >
                        Source <ICONS.ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

              </div>
            ))
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-white/10 bg-black/80 flex items-center justify-between">
          <span className="text-[11px] text-gray-500 font-mono">
            Audited {new Date(summary.lastAudited).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl glass-morphism border border-white/10 text-xs font-bold text-gray-300 hover:text-white uppercase tracking-wider transition-colors"
          >
            Close Drawer
          </button>
        </div>

      </div>
    </div>
  );
};
