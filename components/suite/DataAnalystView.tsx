import React, { useState } from 'react';
import { BusinessDNA } from '../../types';
import { geminiService } from '../../services/geminiService';
import { ICONS } from '../../constants';
import { renderMarkdown } from '../../utils/markdown';

interface DataAnalystViewProps {
  dna: BusinessDNA | null;
  onRouteToTimesFM?: (data: string) => void;
}

export const DataAnalystView: React.FC<DataAnalystViewProps> = ({ dna, onRouteToTimesFM }) => {
  const [dataContext, setDataContext] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setDataContext(content);
    };
    reader.readAsText(file);
  };

  const handleAnalyze = async () => {
    if (!dataContext.trim() || !query.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const report = await geminiService.analyzeData(dataContext, query, dna);
      setResult(report);
    } catch (err: any) {
      setResult(`**Analysis failed.** ${err?.message || 'Verify file size and API connection.'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#BF953F]/10 border border-[#BF953F]/30 mb-4">
          <ICONS.Analyst className="w-4 h-4 text-[#FCF6BA]" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#FCF6BA]">Quantitative Intelligence</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold gold-text tracking-tight mb-3">
          Deep Data Analyst
        </h1>
        <p className="text-sm text-gray-400 max-w-xl mx-auto leading-relaxed">
          Upload metrics, CRM exports, or analytics CSVs to extract actionable anomalies, revenue trajectories, and executive KPI summaries.
        </p>
      </div>

      {dna && (
        <div className="mb-6 glass-morphism rounded-xl px-4 py-3 border border-emerald-500/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span className="text-gray-300">Evaluating against DNA Profile: <strong className="text-white">{dna.name}</strong></span>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest">KPI Context Enabled</span>
        </div>
      )}

      <div className="glass-morphism rounded-2xl border border-[#BF953F]/30 p-6 sm:p-8 mb-8 shadow-2xl space-y-6">
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-bold uppercase tracking-widest text-gray-300">
              Dataset Context (Paste CSV / JSON / Metrics)
            </label>
            <label className="cursor-pointer text-[10px] font-mono text-[#FCF6BA] hover:underline flex items-center gap-1">
              <ICONS.FileText className="w-3.5 h-3.5" />
              <span>Upload File</span>
              <input type="file" accept=".csv,.json,.txt,.tsv" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
          <textarea
            value={dataContext}
            onChange={(e) => setDataContext(e.target.value)}
            placeholder="Paste your numbers, tables, or conversion metrics here..."
            rows={6}
            className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl p-4 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none transition-all shadow-inner leading-relaxed resize-y"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-gray-300 mb-2">
            Analysis Directive
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g., 'Identify anomalies in customer acquisition cost and calculate ROI trends'"
            onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
            className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-3 text-sm text-white font-sans placeholder:text-gray-600 focus:outline-none transition-all shadow-inner"
          />
        </div>

        <div className="flex flex-col sm:flex-row justify-end items-center gap-3 pt-2">
          {onRouteToTimesFM && dataContext.trim() && (
            <button
              onClick={() => onRouteToTimesFM(dataContext)}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#BF953F]/10 hover:bg-[#BF953F]/20 border border-[#BF953F]/40 text-[#FCF6BA] font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2"
            >
              <ICONS.TimeSeries className="w-4 h-4" />
              <span>Forecast with TimesFM</span>
            </button>
          )}

          <button
            onClick={handleAnalyze}
            disabled={loading || !dataContext.trim() || !query.trim()}
            className="w-full sm:w-auto px-8 py-3 rounded-xl bg-gradient-to-r from-[#BF953F] to-[#AA771C] text-black font-black uppercase text-xs tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-30 shadow-lg shadow-[#BF953F]/20 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                <span>Executing Python & Statistical Models...</span>
              </>
            ) : (
              <>
                <ICONS.Sparkle className="w-4 h-4" />
                <span>Synthesize Data</span>
              </>
            )}
          </button>
        </div>
      </div>

      {result && (
        <div className="glass-morphism rounded-2xl border border-[#BF953F]/40 p-6 sm:p-8 shadow-2xl animate-in fade-in duration-500">
          <div className="flex items-center gap-3 border-b border-white/10 pb-4 mb-6">
            <div className="w-2.5 h-2.5 rounded-full bg-[#BF953F]"></div>
            <h3 className="text-base font-bold uppercase tracking-widest text-[#FCF6BA]">Executive Data Synthesis</h3>
          </div>
          <div 
            className="markdown-content max-w-none text-sm leading-relaxed space-y-4"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }}
          />
        </div>
      )}
    </div>
  );
};
