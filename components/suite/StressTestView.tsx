import React, { useState } from 'react';
import { BusinessDNA } from '../../types';
import { geminiService } from '../../services/geminiService';
import { ICONS } from '../../constants';
import { renderMarkdown } from '../../utils/markdown';

interface StressTestViewProps {
  dna: BusinessDNA | null;
}

export const StressTestView: React.FC<StressTestViewProps> = ({ dna }) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleTest = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const response = await geminiService.stressTest(input, dna);
      setResult(response);
    } catch (err: any) {
      setResult("Red Team simulation interrupted. Please check API key and network connectivity.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gold/10 border border-gold/30 mb-4">
          <ICONS.Stress className="w-4 h-4 text-gold-light" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-light">Adversarial Reasoning Node</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold gold-text tracking-tight mb-3">
          Red Team Stress Test
        </h1>
        <p className="text-sm text-gray-400 max-w-xl mx-auto leading-relaxed">
          "An idea is not a strategy until it survives a predator." Stress-test your business model against aggressive adversarial logic and real market friction.
        </p>
      </div>

      {dna && (
        <div className="mb-6 glass-morphism rounded-xl px-4 py-3 border border-success-500/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-success-400"></span>
            <span className="text-gray-300">Evaluating against DNA Profile: <strong className="text-white">{dna.name}</strong></span>
          </div>
          <span className="text-[10px] font-mono text-success-400 uppercase tracking-widest">USP & Gaps Active</span>
        </div>
      )}

      <div className="glass-morphism rounded-2xl border border-gold/30 p-6 sm:p-8 mb-8 shadow-2xl space-y-6">
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-gray-300 mb-2">
            Describe Your Business Strategy, Pricing, or Product Launch
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Provide full context: your target market, proposed pricing, acquisition channels, key assumptions, and competitive differentiators..."
            rows={6}
            className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl p-4 text-sm text-white font-sans placeholder:text-gray-600 focus:outline-none transition-all shadow-inner leading-relaxed resize-y"
          />
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-2">
          <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
            Engine: Gemini 3 Pro (32k Thinking Budget)
          </span>
          <button
            onClick={handleTest}
            disabled={loading || !input.trim()}
            className="w-full sm:w-auto px-8 py-3 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-xs tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-30 shadow-lg shadow-gold/20 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                <span>Executing Red Team Protocol...</span>
              </>
            ) : (
              <>
                <ICONS.Sparkle className="w-4 h-4" />
                <span>Execute Stress Test</span>
              </>
            )}
          </button>
        </div>
      </div>

      {result && (
        <div className="glass-morphism rounded-2xl border border-gold/40 p-6 sm:p-8 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center gap-3 border-b border-white/10 pb-4 mb-6">
            <div className="w-2.5 h-2.5 rounded-full bg-gold"></div>
            <h3 className="text-base font-bold uppercase tracking-widest text-gold-light">Red Team Findings & Mitigations</h3>
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
