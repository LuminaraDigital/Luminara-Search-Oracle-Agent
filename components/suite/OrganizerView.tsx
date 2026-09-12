import React, { useState } from 'react';
import { BusinessDNA, OrganizerFormat, OrganizerSchema } from '../../types';
import { geminiService } from '../../services/geminiService';
import { ICONS } from '../../constants';
import { renderMarkdown } from '../../utils/markdown';
import { SynthesisSkeleton } from '../ui/Skeleton';

interface OrganizerViewProps {
  dna: BusinessDNA | null;
}

export const OrganizerView: React.FC<OrganizerViewProps> = ({ dna }) => {
  const [thoughts, setThoughts] = useState('');
  const [format, setFormat] = useState<OrganizerFormat>(OrganizerFormat.BUSINESS_PLAN);
  const [loading, setLoading] = useState(false);
  const [organized, setOrganized] = useState<OrganizerSchema | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOrganize = async () => {
    if (!thoughts.trim() || loading) return;
    setLoading(true);
    setOrganized(null);
    setError(null);
    try {
      const result = await geminiService.organizeThoughts(thoughts, format, dna);
      setOrganized(result);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'The organizer could not reach a language model. Check your API keys in Settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyAll = () => {
    if (!organized) return;
    const text = organized.sections.map(s => `## ${s.title}\n\n${s.content}`).join('\n\n');
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gold/10 border border-gold/30 mb-4">
          <ICONS.Organizer className="w-4 h-4 text-gold-light" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-light">Documentation</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold gold-text tracking-tight mb-3">
          Strategic Thought Organizer
        </h1>
        <p className="text-sm text-gray-400 max-w-xl mx-auto leading-relaxed">
          Structure your raw notes, transcripts, or strategy ideas into executive documentation.
        </p>
      </div>

      <div className="glass-morphism rounded-2xl border border-gold/30 p-6 sm:p-8 mb-8 shadow-2xl space-y-6">
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-gray-300 mb-2">
            Target Documentation Schema
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { id: OrganizerFormat.BUSINESS_PLAN, label: 'Business Plan', desc: 'Strategy, Market, Financials' },
              { id: OrganizerFormat.MARKETING_BRIEF, label: 'Marketing Brief', desc: 'Positioning, AEO, Angles' },
              { id: OrganizerFormat.PROJECT_TIMELINE, label: 'Project Roadmap', desc: 'Phases, Milestones, Sprints' }
            ].map(item => (
              <button
                key={item.id}
                type="button"
                aria-pressed={format === item.id}
                onClick={() => setFormat(item.id)}
                className={`p-4 rounded-xl text-left border transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                  format === item.id 
                    ? 'glass-morphism border-gold bg-gold/10 shadow-lg shadow-gold/10' 
                    : 'glass-morphism border-white/5 hover:border-white/20'
                }`}
              >
                <div className={`text-xs font-bold uppercase tracking-wider ${format === item.id ? 'text-gold-light' : 'text-white'}`}>
                  {item.label}
                </div>
                <div className="text-[10px] text-gray-400 mt-1">{item.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="organizer-notes-input" className="block text-xs font-bold uppercase tracking-widest text-gray-300 mb-2">
            Unstructured Thoughts / Raw Notes
          </label>
          <textarea
            id="organizer-notes-input"
            value={thoughts}
            onChange={(e) => setThoughts(e.target.value)}
            placeholder="Type or paste your unstructured notes, meeting memos, or strategy ideas..."
            rows={7}
            className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl p-4 text-sm text-white placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none transition-all shadow-inner leading-relaxed resize-y font-sans"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleOrganize}
            disabled={loading || !thoughts.trim()}
            className="w-full sm:w-auto px-8 py-3 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-xs tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-30 shadow-lg shadow-gold/20 flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                <span>Structuring document…</span>
              </>
            ) : (
              <>
                <ICONS.Sparkle className="w-4 h-4" />
                <span>Structure Document</span>
              </>
            )}
          </button>
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

      {organized && organized.sections && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="flex justify-between items-center px-2">
            <span className="text-xs font-bold uppercase tracking-widest text-gold-light">Structured Output</span>
            <button
              type="button"
              aria-label="Copy all markdown sections to clipboard"
              onClick={handleCopyAll}
              className="px-4 py-1.5 rounded-lg glass-morphism border border-white/10 text-xs text-gray-300 hover:text-white uppercase tracking-wider font-bold transition-all flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              {copied ? <ICONS.Check className="w-3.5 h-3.5 text-success-400" /> : <ICONS.Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy All Markdown'}</span>
            </button>
          </div>

          <div className="grid gap-4">
            {organized.sections.map((sec, sIdx) => (
              <div key={sIdx} className="glass-morphism rounded-xl border border-white/10 p-6 space-y-3">
                <h3 className="text-base font-bold text-gold-light uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gold"></span>
                  <span>{sec.title}</span>
                </h3>
                <div 
                  className="markdown-content text-xs sm:text-sm text-gray-300 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(sec.content) }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
