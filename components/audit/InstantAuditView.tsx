import React, { useState, useRef, useEffect } from 'react';
import { ReportFocus, BusinessDNA } from '../../types';
import { geminiService } from '../../services/geminiService';
import { AUDIT_LENSES, inferLenses, type AuditLens } from '../../services/skills/seoPlaybooks';
import { contextGraphService } from '../../services/contextGraph/contextGraphService';
import { freeLlmModalitiesService } from '../../services/freellm/modalitiesService';
import { ICONS } from '../../constants';
import { ReportDisplay } from './ReportDisplay';
import { useConfirm } from '../ui/ConfirmModal';

interface InstantAuditViewProps {
  dna: BusinessDNA | null;
  onNavigateDNA?: () => void;
}

export const InstantAuditView: React.FC<InstantAuditViewProps> = ({ dna, onNavigateDNA }) => {
  const [url, setUrl] = useState('');
  const [focus, setFocus] = useState<ReportFocus>('AEO');
  const [lenses, setLenses] = useState<AuditLens[]>(() => inferLenses(dna));
  const toggleLens = (id: AuditLens) => setLenses(prev => (prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]));
  const [loading, setLoading] = useState(false);
  const [progressStage, setProgressStage] = useState('');
  const [report, setReport] = useState<Awaited<ReturnType<typeof geminiService.generateAuditReport>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState(false);
  const isFullAudit = Boolean(dna);

  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (stageTimerRef.current) clearInterval(stageTimerRef.current); }, []);

  const handleExecuteAudit = async (targetUrl: string, targetFocus: ReportFocus) => {
    if (!targetUrl.trim() || loading) return;
    setError(null);
    setLoading(true);
    setProgressStage(isFullAudit ? 'Reading your website…' : 'Running a quick scout…');

    const stages = isFullAudit
      ? [
          'Reading your website…',
          'Checking how your pages read…',
          'Checking live search results…',
          'Reading your traffic…',
          'Looking at your competitors…',
          'Writing your one-move brief…',
          'Almost done…',
        ]
      : [
          'Running a quick scout…',
          'Checking live search results…',
          'Writing a short verdict…',
          'Almost done…',
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
      setError(err?.message || 'Failed to complete the audit. Check your AI keys in Settings and try again.');
    } finally {
      if (stageTimerRef.current) {
        clearInterval(stageTimerRef.current);
        stageTimerRef.current = null;
      }
      setLoading(false);
      setProgressStage('');
    }
  };

  const { requestConfirm, confirmModal } = useConfirm();

  const handleReset = () => {
    const reset = () => {
      setReport(null);
      setError(null);
      setUrl('');
    };
    // Only ask when there is a report to lose.
    if (!report) {
      reset();
      return;
    }
    requestConfirm(
      {
        title: 'Start a new audit?',
        description: 'The current report will be discarded. Export or copy anything you need first.',
        confirmLabel: 'Discard and start new',
        variant: 'danger',
      },
      reset,
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      {confirmModal}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gold/10 border border-gold/30 mb-4">
          <ICONS.Radar className="w-4 h-4 text-gold-light" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-light">
            {isFullAudit ? 'Full audit' : 'Quick scout'}
          </span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold gold-text tracking-tight mb-3">
          Will AI mention your brand?
        </h1>
        <p className="text-sm text-gray-400 max-w-xl mx-auto leading-relaxed">
          Paste your site. Get a plain verdict, evidence chips, and one move to ship this week.
        </p>
      </div>

      {dna ? (
        <div className="mb-6 glass-morphism rounded-xl px-4 py-3 border border-success-500/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-success-400 animate-pulse"></span>
            <span className="text-gray-300">Full audit locked to <strong className="text-white">{dna.name}</strong></span>
          </div>
          <span className="text-[10px] font-mono text-success-400 uppercase tracking-wider">Profile linked</span>
        </div>
      ) : (
        <div className="mb-6 glass-morphism rounded-xl px-4 py-3 border border-warning-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-gold"></span>
            <span className="text-gray-300">
              No business profile yet. You can still run a <strong className="text-white">Quick scout</strong>.
              Set your profile to unlock a full, USP-aware audit.
            </span>
          </div>
          {onNavigateDNA && (
            <button type="button" onClick={onNavigateDNA} className="text-[10px] font-bold uppercase tracking-wider text-gold-light hover:underline shrink-0">
              Set up profile →
            </button>
          )}
        </div>
      )}

      {/* Controls Card */}
      {!report && (
        <div className="glass-morphism rounded-2xl border border-gold/30 p-6 sm:p-8 mb-8 shadow-2xl">
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
                  className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl py-3.5 pl-4 pr-32 text-sm text-white font-mono placeholder:text-gray-600 focus:outline-none transition-all shadow-inner"
                />
                <button
                  onClick={() => handleExecuteAudit(url, focus)}
                  disabled={loading || !url.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2 rounded-lg bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-[10px] tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-30"
                >
                  {loading ? 'Scanning...' : isFullAudit ? 'Run full audit' : 'Run quick scout'}
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
                        ? 'bg-gradient-to-br from-gold to-gold-dark text-black shadow-lg shadow-gold/20' 
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
                        on ? 'bg-gold/20 border-gold/60 text-gold-light' : 'border-white/10 text-gray-400 hover:text-white hover:border-white/30'
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
        <div className="glass-morphism rounded-2xl border border-gold/40 p-8 text-center space-y-6 animate-pulse">
          <div className="w-12 h-12 rounded-full border-2 border-gold/20 border-t-gold animate-spin mx-auto"></div>
          <div>
            <h3 className="text-lg font-bold text-white uppercase tracking-wider mb-1">
              {isFullAudit ? 'Clearing the fog…' : 'Quick scout in progress…'}
            </h3>
            <p className="text-xs text-gold-light font-mono">{progressStage}</p>
          </div>
          <div className="max-w-md mx-auto h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
            <div className="h-full progress-gold w-full"></div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="glass-morphism rounded-xl border border-danger-500/40 p-5 mb-8 flex items-center justify-between text-xs text-danger-200">
          <div className="flex items-center gap-3">
            <ICONS.AlertCircle className="w-5 h-5 text-danger-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => handleExecuteAudit(url, focus)}
            className="px-4 py-1.5 rounded-lg bg-danger-500/20 hover:bg-danger-500/30 text-danger-200 uppercase font-bold text-[10px] tracking-wider transition-colors shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Audit Report Result */}
      {report && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 glass-morphism rounded-xl border border-gold/30">
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
                      ? 'bg-gold text-black' 
                      : 'border border-white/10 text-gray-400 hover:text-white'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                if (!report?.text || briefing) return;
                if (!freeLlmModalitiesService.isAvailable()) {
                  setError('Configure FreeLLMAPI in Settings → LLM to enable audit voice briefings.');
                  return;
                }
                setBriefing(true);
                setError(null);
                try {
                  const summary = report.text.replace(/[#*`>_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
                  await freeLlmModalitiesService.briefAloud(
                    `Audit briefing for ${url}. Focus ${focus}. ${summary}`,
                  );
                } catch (e: any) {
                  setError(e?.message || 'Voice briefing failed. Check FreeLLMAPI speech models.');
                } finally {
                  setBriefing(false);
                }
              }}
              disabled={briefing || loading}
              className="px-4 py-1.5 rounded-lg glass-morphism border border-gold/30 text-xs text-gold-light hover:text-white uppercase tracking-wider font-bold transition-all disabled:opacity-50"
              title="Speak a short audit briefing via FreeLLMAPI TTS"
            >
              {briefing ? 'Speaking…' : 'Brief aloud'}
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-1.5 rounded-lg glass-morphism border border-white/10 text-xs text-gray-300 hover:text-white uppercase tracking-wider font-bold transition-all"
            >
              New Audit
            </button>
            </div>
          </div>

          <ReportDisplay
            markdownText={report.text}
            sources={report.sources}
            empiricalSummary={report.empiricalSummary}
            remediationPayload={report.remediationPayload}
            unifiedDiff={report.unifiedDiff}
            targetDomain={url}
            dnaName={dna?.name}
            enrichedEntity={report.enrichedEntity}
            writingQuality={report.writingQuality}
            trafficImpact={report.trafficImpact}
            citationIntegrity={report.citationIntegrity || report.integrity}
            trustPack={report.trustPack}
            shareOfVoice={report.shareOfVoice}
            sourceGraph={report.sourceGraph}
            enterpriseTrust={report.enterpriseTrust}
          />
        </div>
      )}
    </div>
  );
};
