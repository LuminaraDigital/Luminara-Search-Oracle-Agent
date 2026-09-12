import React, { useState } from 'react';
import { BusinessDNA } from '../../types';
import { geminiService } from '../../services/geminiService';
import { ICONS } from '../../constants';
import { renderMarkdown } from '../../utils/markdown';
import { SynthesisSkeleton } from '../ui/Skeleton';

interface ResearchViewProps {
  dna: BusinessDNA | null;
}

export const ResearchView: React.FC<ResearchViewProps> = ({ dna }) => {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'web' | 'local'>('web');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ text: string; chunks: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleResearch = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setResult(null);

    let location: { lat: number; lng: number } | undefined = undefined;
    if (mode === 'local' && navigator.geolocation) {
      try {
        const pos: GeolocationPosition = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch (e) {
        console.warn('Geolocation unavailable or denied');
      }
    }

    setError(null);
    try {
      const data = await geminiService.marketResearch(query, mode, dna, location);
      setResult(data);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Research failed. Check your API keys in Settings.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gold/10 border border-gold/30 mb-4">
          <ICONS.Research className="w-4 h-4 text-gold-light" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-light">Market Research</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold gold-text tracking-tight mb-3">
          Global Grounding Engine
        </h1>
        <p className="text-sm text-gray-400 max-w-xl mx-auto leading-relaxed">
          Ground market research with live web and local Google Maps data.
        </p>
      </div>

      {dna && (
        <div className="mb-6 glass-morphism rounded-xl px-4 py-3 border border-success-500/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-success-400"></span>
            <span className="text-gray-300">Grounding with DNA Context: <strong className="text-white">{dna.name}</strong></span>
          </div>
          <span className="text-[10px] font-mono text-success-400 uppercase tracking-widest">Active</span>
        </div>
      )}

      <div className="glass-morphism rounded-2xl border border-gold/30 p-6 sm:p-8 mb-8 shadow-2xl space-y-6">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-300">Grounding Source:</span>
            <button
              type="button"
              aria-pressed={mode === 'web'}
              onClick={() => setMode('web')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                mode === 'web' 
                  ? 'bg-gradient-to-r from-gold to-gold-dark text-black shadow-lg shadow-gold/20' 
                  : 'glass-morphism border border-white/10 text-gray-400 hover:text-white'
              }`}
            >
              Google Search
            </button>
            <button
              type="button"
              aria-pressed={mode === 'local'}
              onClick={() => setMode('local')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                mode === 'local' 
                  ? 'bg-gradient-to-r from-gold to-gold-dark text-black shadow-lg shadow-gold/20' 
                  : 'glass-morphism border border-white/10 text-gray-400 hover:text-white'
              }`}
            >
              Google Maps (Local)
            </button>
          </div>

          <div className="relative">
            <label htmlFor="research-query-input" className="sr-only">Research Query</label>
            <input
              id="research-query-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === 'web' ? "e.g., 'Competitor pricing strategies in generative AI search tools 2026'" : "e.g., 'Top digital marketing agencies near me with highest rating'"}
              onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl py-3.5 pl-4 pr-32 text-sm text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none transition-all shadow-inner"
            />
            <button
              type="button"
              onClick={handleResearch}
              disabled={loading || !query.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2 rounded-lg bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-[10px] tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              {loading ? 'Grounding...' : 'Research'}
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="mb-8">
          <SynthesisSkeleton />
        </div>
      )}

      {error && (
        <div className="mb-6 glass-morphism rounded-2xl border border-danger-500/30 bg-danger-950/20 px-5 py-4 text-sm text-danger-200 flex items-start gap-3" role="alert">
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-danger-400 mt-0.5 shrink-0">Error</span>
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="glass-morphism rounded-2xl border border-gold/40 p-6 sm:p-8 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4 mb-6">
              <div className="w-2.5 h-2.5 rounded-full bg-gold"></div>
              <h3 className="text-base font-bold uppercase tracking-widest text-gold-light">Grounded Intelligence Brief</h3>
            </div>
            <div 
              className="markdown-content max-w-none text-sm leading-relaxed space-y-4"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(result.text) }}
            />
          </div>

          {result.chunks && result.chunks.length > 0 && (
            <div className="glass-morphism rounded-2xl border border-white/10 p-6">
              <h4 className="text-xs font-bold uppercase tracking-widest text-gold-light mb-4">Grounded Citations & Locations</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {result.chunks.map((c, i) => {
                  const item = c.web || c.maps;
                  if (!item) return null;
                  return (
                    <a
                      key={i}
                      href={item.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-3 rounded-xl bg-black/60 border border-white/5 hover:border-gold/40 flex items-center justify-between text-xs text-gray-300 hover:text-white transition-all group"
                    >
                      <span className="truncate pr-2 font-mono">{item.title || item.uri}</span>
                      <ICONS.ExternalLink className="w-3.5 h-3.5 text-gold shrink-0" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
