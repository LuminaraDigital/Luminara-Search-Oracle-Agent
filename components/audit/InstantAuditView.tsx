import React, { useState, useRef, useEffect } from 'react';
import { ReportFocus, BusinessDNA } from '../../types';
import { geminiService } from '../../services/geminiService';
import { AUDIT_LENSES, inferLenses, type AuditLens } from '../../services/skills/seoPlaybooks';
import { contextGraphService } from '../../services/contextGraph/contextGraphService';
import { ICONS } from '../../constants';
import { ReportDisplay } from './ReportDisplay';

interface InstantAuditViewProps {
  dna: BusinessDNA | null;
  onNavigateDNA?: () => void;
}

export const InstantAuditView: React.FC<InstantAuditViewProps> = ({ dna, onNavigateDNA }) => {
  const [url, setUrl] = useState('');
  const [focus, setFocus] = useState<ReportFocus>('SEO');
  const [lenses, setLenses] = useState<AuditLens[]>(() => inferLenses(dna));
  const toggleLens = (id: AuditLens) => setLenses(prev => (prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]));
  const [loading, setLoading] = useState(false);
  const [progressStage, setProgressStage] = useState('');
  const [report, setReport] = useState<{ text: string; sources: Array<{ uri: string; title: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (stageTimerRef.current) clearInterval(stageTimerRef.current); }, []);

  const handleExecuteAudit = async (targetUrl: string, targetFocus: ReportFocus) => {
    if (!targetUrl.trim() || loading) return;
    setError(null);
    setLoading(true);
    setProgressStage('Reading your website…');

    const stages = [
      'Checking live search results…',
      'Looking at your competitors…',
      'Writing your report…',
      'Almost done…'
    ];

    let sIdx = 0;
    if (stageTimerRef.current) clearInterval(stageTimerRef.current);
    const interval = setInterval(() => {
      sIdx++;
      if (sIdx < stages.length) {
        setProgressStage(stages[sIdx]);
      }
    }, 1800);
    stageTimerRef.current = interval;

    try {
      const formattedUrl = targetUrl.includes('://') ? targetUrl : `https://${targetUrl}`;
      const result = await geminiService.generateAuditReport(formattedUrl, targetFocus, dna, lenses);
      clearInterval(interval);
      setReport(result);

      // Persist + ingest into Luminara Context Graph (decision provenance)
      try {
        const payload = {
          url: formattedUrl,
          focus: targetFocus,
          text: result.text,
          sources: result.sources,
          dnaName: dna?.name
        };
        contextGraphService.saveLastAudit(payload);
        contextGraphService.ingestAudit(payload);
      } catch {
        /* graph ingest is best-effort */
      }
    } catch (err: any) {
      clearInterval(interval);
      setError(err?.message || 'Failed to complete the audit. Please verify your Gemini API key and try again.');
    } finally {
      if (stageTimerRef.current) {
        clearInterval(stageTimerRef.current);
        stageTimerRef.current = null;
      }
      setLoading(false);
      setProgressStage('');
    }
  };

  const handleReset = () => {
    setReport(null);
    setError(null);
    setUrl('');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      {/* Header Banner */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#BF953F]/10 border border-[#BF953F]/30 mb-4">
          <ICONS.Radar className="w-4 h-4 text-[#FCF6BA]" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#FCF6BA]">Website audit</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold gold-text tracking-tight mb-3">
          How does your site show up?
        </h1>
        <p className="text-sm text-gray-400 max-w-xl mx-auto leading-relaxed">
          Paste your website address. In about a minute you get a report on Google rankings, AI answers, competitors and what to fix first.
        </p>
      </div>

      {/* DNA Link Alert */}
      {dna ? (
        <div className="mb-6 glass-morphism rounded-xl px-4 py-3 border border-emerald-500/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-gray-300">Tailored to <strong className="text-white">{dna.name}</strong></span>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider">USP Reinforced</span>
        </div>
      ) : (
        <div className="mb-6 glass-morphism rounded-xl px-4 py-3 border border-white/5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#BF953F]"></span>
            <span className="text-gray-400">Add your business profile and the report will be tailored to what you sell and who you compete with.</span>
          </div>
          {onNavigateDNA && (
            <button onClick={onNavigateDNA} className="text-[10px] font-bold uppercase tracking-wider text-[#FCF6BA] hover:underline">
              Add my business &rarr;
            </button>
          )}
        </div>
      )}

      {/* Controls Card */}
      {!report && (
        <div className="glass-morphism rounded-2xl border border-[#BF953F]/30 p-6 sm:p-8 mb-8 shadow-2xl">
          <div className="flex flex-col gap-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                Target Website Domain / URL
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="e.g., luminaradigital.io or yourbrand.com"
                  onKeyDown={(e) => e.key === 'Enter' && handleExecuteAudit(url, focus)}
                  className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl py-3.5 pl-4 pr-32 text-sm text-white font-mono placeholder:text-gray-600 focus:outline-none transition-all shadow-inner"
                />
                <button
                  onClick={() => handleExecuteAudit(url, focus)}
                  disabled={loading || !url.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2 rounded-lg bg-gradient-to-r from-[#BF953F] to-[#AA771C] text-black font-black uppercase text-[10px] tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-30"
                >
                  {loading ? 'Scanning...' : 'Run Audit'}
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4 border-t border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Report type:</span>
                {(['SEO', 'AEO', 'GEO'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFocus(f)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                      focus === f 
                        ? 'bg-gradient-to-br from-[#BF953F] to-[#AA771C] text-black shadow-lg shadow-[#BF953F]/20' 
                        : 'glass-morphism border border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-gray-500 font-mono">
                {focus === 'SEO' && 'SEO: how you rank in Google'}
                {focus === 'AEO' && 'AEO: whether AI answers mention you'}
                {focus === 'GEO' && 'GEO: whether AI summaries quote your content'}
              </span>
            </div>

            <div className="pt-4 border-t border-white/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Also check:</span>
                <span className="text-[10px] text-gray-600">Optional. Each adds a specialist checklist to the report.</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {AUDIT_LENSES.map(l => {
                  const on = lenses.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => toggleLens(l.id)}
                      title={l.hint}
                      aria-pressed={on}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all border ${
                        on ? 'bg-[#BF953F]/20 border-[#BF953F]/60 text-[#FCF6BA]' : 'border-white/10 text-gray-400 hover:text-white hover:border-white/30'
                      }`}
                    >
                      {on ? '✓ ' : ''}{l.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="glass-morphism rounded-2xl border border-[#BF953F]/40 p-8 text-center space-y-6 animate-pulse">
          <div className="w-12 h-12 rounded-full border-2 border-[#BF953F]/20 border-t-[#BF953F] animate-spin mx-auto"></div>
          <div>
            <h3 className="text-lg font-bold text-white uppercase tracking-wider mb-1">Oracle Agent Analyzing Domain</h3>
            <p className="text-xs text-[#FCF6BA] font-mono">{progressStage}</p>
          </div>
          <div className="max-w-md mx-auto h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
            <div className="h-full progress-gold w-full"></div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="glass-morphism rounded-xl border border-red-500/40 p-5 mb-8 flex items-center justify-between text-xs text-red-200">
          <div className="flex items-center gap-3">
            <ICONS.AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => handleExecuteAudit(url, focus)}
            className="px-4 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 uppercase font-bold text-[10px] tracking-wider transition-colors shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Audit Report Result */}
      {report && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 glass-morphism rounded-xl border border-[#BF953F]/30">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 font-mono">Regenerate Focus:</span>
              {(['SEO', 'AEO', 'GEO'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setFocus(f);
                    handleExecuteAudit(url, f);
                  }}
                  disabled={loading}
                  className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${
                    focus === f 
                      ? 'bg-[#BF953F] text-black' 
                      : 'border border-white/10 text-gray-400 hover:text-white'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <button
              onClick={handleReset}
              className="px-4 py-1.5 rounded-lg glass-morphism border border-white/10 text-xs text-gray-300 hover:text-white uppercase tracking-wider font-bold transition-all"
            >
              New Audit
            </button>
          </div>

          <ReportDisplay markdownText={report.text} sources={report.sources} />
        </div>
      )}
    </div>
  );
};
