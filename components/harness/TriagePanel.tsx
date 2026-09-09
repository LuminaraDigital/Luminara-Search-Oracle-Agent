import React, { useState, useEffect } from 'react';
import { triageService, SAMPLE_CRASH_SCENARIOS } from '../../services/harness/triageService';
import { TriageReport } from '../../types';

export const TriagePanel: React.FC = () => {
  const [reports, setReports] = useState<TriageReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [customErrorTitle, setCustomErrorTitle] = useState('');
  const [customTrace, setCustomTrace] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [copiedDiff, setCopiedDiff] = useState(false);

  useEffect(() => {
    const update = () => {
      const all = triageService.getReports();
      setReports(all);
      if (!selectedReportId && all.length > 0) {
        setSelectedReportId(all[0].id);
      }
    };
    update();
    return triageService.subscribe(update);
  }, [selectedReportId]);

  const activeReport = reports.find(r => r.id === selectedReportId) || reports[0];

  const handleAnalyzeCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTrace.trim()) return;

    setIsAnalyzing(true);
    setTimeout(() => {
      const rep = triageService.analyzeError(
        customErrorTitle || 'Custom Runtime Incident',
        customTrace,
        'User Diagnostic Console'
      );
      setSelectedReportId(rep.id);
      setCustomErrorTitle('');
      setCustomTrace('');
      setIsAnalyzing(false);
    }, 600);
  };

  const handleLoadSample = (sample: typeof SAMPLE_CRASH_SCENARIOS[0]) => {
    setCustomErrorTitle(sample.title);
    setCustomTrace(sample.trace);
  };

  const handleCopyDiff = () => {
    if (activeReport?.codeDiff) {
      navigator.clipboard.writeText(activeReport.codeDiff);
      setCopiedDiff(true);
      setTimeout(() => setCopiedDiff(false), 2000);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner */}
      <div className="glass-morphism rounded-2xl border border-gold/30 p-6 bg-black/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-[0.3em] px-2.5 py-0.5 rounded-full bg-gold/20 text-gold-light border border-gold/40 font-black">
            AUTONOMOUS TRIAGE
          </span>
          <h2 className="text-2xl font-bold gold-text tracking-tight mt-2">
            Crash Diagnosis & Self-Healing Core
          </h2>
          <p className="text-gray-400 text-xs mt-1 max-w-2xl">
            Derived from Omarchy's systemd crash capture and AI triage loop (<code>omarchy agent crash &lt;pid&gt;</code>). Ingest runtime exceptions, tracebacks, or malformed schemas, and let Luminara generate Plain English explanations, technical root causes, and verifiable code diff patches.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-400">Incidents:</span>
          <span className="text-sm font-bold text-white font-mono">{reports.length}</span>
        </div>
      </div>

      {/* Main Grid: Reports List + Diagnostic Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Triage History & Incident Cards */}
        <div className="lg:col-span-4 space-y-4">
          <div className="text-xs font-mono uppercase tracking-wider text-gray-400 px-1 flex items-center justify-between">
            <span>Incident Log</span>
            <span className="text-[10px] text-gold">
              {reports.filter(r => r.status === 'open').length} Open
            </span>
          </div>

          <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
            {reports.map(rep => {
              const isSelected = rep.id === selectedReportId;
              return (
                <div
                  key={rep.id}
                  onClick={() => setSelectedReportId(rep.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-gold/15 border-gold shadow-[0_0_15px_rgba(191,149,63,0.15)]'
                      : 'glass-morphism border-white/5 hover:border-gold/30 bg-black/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-bold text-white truncate">{rep.errorTitle}</div>
                    <span
                      className={`text-[8px] font-mono uppercase px-1.5 py-0.5 rounded font-bold shrink-0 ${
                        rep.severity === 'critical'
                          ? 'bg-danger-500/20 text-danger-400 border border-danger-500/30'
                          : rep.severity === 'high'
                          ? 'bg-warning-500/20 text-warning-400 border border-warning-500/30'
                          : 'bg-white/5 text-gray-400'
                      }`}
                    >
                      {rep.severity}
                    </span>
                  </div>

                  <div className="text-[10px] font-mono text-gray-400 mt-1 flex items-center justify-between">
                    <span>{rep.source}</span>
                    <span>{new Date(rep.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* New Incident Submission Box */}
          <form onSubmit={handleAnalyzeCustom} className="p-4 rounded-xl glass-morphism border border-white/10 bg-black/60 space-y-3">
            <div className="text-xs font-bold text-gray-200">Submit New Incident / Trace</div>
            
            <input
              type="text"
              value={customErrorTitle}
              onChange={e => setCustomErrorTitle(e.target.value)}
              placeholder="Incident Title (optional)"
              className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white font-mono focus:outline-none focus:border-gold"
            />

            <textarea
              value={customTrace}
              onChange={e => setCustomTrace(e.target.value)}
              placeholder="Paste stack trace, CUDA OOM error, JSON parse error, or API response..."
              rows={3}
              className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white font-mono focus:outline-none focus:border-gold"
            />

            <div className="space-y-1.5">
              <div className="text-[9px] font-mono text-gray-500 uppercase">Load Pre-Configured Crash Sample:</div>
              <div className="flex flex-wrap gap-1">
                {SAMPLE_CRASH_SCENARIOS.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleLoadSample(s)}
                    className="px-2 py-0.5 rounded bg-white/5 hover:bg-gold/20 text-[9px] font-mono text-gray-400 hover:text-gold-light border border-white/5"
                  >
                    Sample #{i + 1}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={isAnalyzing || !customTrace.trim()}
              className="w-full py-2 rounded-lg bg-gold hover:bg-gold-dark text-black font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40"
            >
              {isAnalyzing ? 'Analyzing Root Cause...' : 'Diagnose & Generate Patch'}
            </button>
          </form>
        </div>

        {/* Right Column: Deep Diagnostic Inspection */}
        <div className="lg:col-span-8 space-y-4">
          {activeReport ? (
            <div className="glass-morphism rounded-2xl border border-gold/30 p-6 bg-black/80 space-y-6">
              {/* Header */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white">{activeReport.errorTitle}</h3>
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-danger-500/20 text-danger-400 border border-danger-500/30 uppercase font-bold">
                      {activeReport.severity}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-gray-400 mt-0.5">
                    Source: <span className="text-gold-light">{activeReport.source}</span> | Timestamp: {new Date(activeReport.timestamp).toLocaleString()}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {activeReport.status === 'open' ? (
                    <button
                      onClick={() => triageService.resolveReport(activeReport.id)}
                      className="px-3 py-1.5 rounded-lg border border-success-500/40 bg-success-500/10 hover:bg-success-500/20 text-[10px] font-mono text-success-400 uppercase tracking-wider transition-all"
                    >
                      Mark Resolved
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 rounded-lg border border-success-500/20 bg-success-500/5 text-[10px] font-mono text-success-400 uppercase tracking-wider">
                      ✓ Resolved
                    </span>
                  )}
                </div>
              </div>

              {/* Plain English Root Cause (8th-Grade Reading Level) */}
              <div className="p-4 rounded-xl border border-gold/30 bg-gold/10 space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-gold-light font-bold">
                  Plain English Summary (8th-Grade Level)
                </div>
                <p className="text-xs text-white leading-relaxed">
                  {activeReport.rootCausePlain}
                </p>
              </div>

              {/* Technical Breakdown */}
              <div className="space-y-1.5">
                <div className="text-xs font-mono uppercase tracking-wider text-gray-400">
                  Technical Root-Cause Analysis
                </div>
                <div className="p-3.5 rounded-xl border border-white/5 bg-white/[0.02] text-xs font-mono text-gray-300 leading-relaxed">
                  {activeReport.rootCauseTechnical}
                </div>
              </div>

              {/* Recommended Fix */}
              <div className="space-y-1.5">
                <div className="text-xs font-mono uppercase tracking-wider text-gray-400">
                  Recommended Architectural Remediation
                </div>
                <div className="p-3.5 rounded-xl border border-white/5 bg-white/[0.02] text-xs font-mono text-success-300 leading-relaxed">
                  {activeReport.recommendedFix}
                </div>
              </div>

              {/* Code Diff Patch */}
              {activeReport.codeDiff && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-wider text-gray-400">
                      Proposed Code Patch Diff
                    </span>
                    <button
                      onClick={handleCopyDiff}
                      className="px-2.5 py-1 rounded bg-white/5 hover:bg-gold/20 border border-white/10 text-[10px] font-mono text-gold-light transition-all"
                    >
                      {copiedDiff ? 'Copied Diff!' : 'Copy Diff'}
                    </button>
                  </div>
                  <div className="p-3.5 rounded-xl border border-white/10 bg-black/95 font-mono text-xs text-gray-300 overflow-x-auto select-text leading-relaxed">
                    {activeReport.codeDiff}
                  </div>
                </div>
              )}

              {/* Raw Trace Log */}
              <details className="text-xs font-mono text-gray-400 cursor-pointer">
                <summary className="hover:text-white transition-colors">View Raw Stack Trace</summary>
                <div className="mt-2 p-3 rounded-xl bg-black/90 border border-white/5 text-[10px] text-gray-400 font-mono overflow-x-auto whitespace-pre-wrap select-text">
                  {activeReport.rawTrace}
                </div>
              </details>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500 font-mono text-xs">
              No diagnostic incident selected.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
