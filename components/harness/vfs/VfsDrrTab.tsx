import React, { useState } from 'react';
import { VfsRetrievalResult } from '../../../types';
import { copyToClipboard } from '../../../utils/clipboard';

interface VfsDrrTabProps {
  drrQuery: string;
  setDrrQuery: (q: string) => void;
  drrBudget: number;
  setDrrBudget: (b: number) => void;
  drrResult: VfsRetrievalResult | null;
  isRetrieving: boolean;
  onRunDrr: () => void;
}

export const VfsDrrTab: React.FC<VfsDrrTabProps> = ({
  drrQuery,
  setDrrQuery,
  drrBudget,
  setDrrBudget,
  drrResult,
  isRetrieving,
  onRunDrr,
}) => {
  const [copiedContext, setCopiedContext] = useState(false);

  const handleCopyContext = async () => {
    if (!drrResult?.assembledContext) return;
    await copyToClipboard(drrResult.assembledContext);
    setCopiedContext(true);
    setTimeout(() => setCopiedContext(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="glass-morphism rounded-2xl border border-white/10 p-6 space-y-4">
        <div>
          <h3 className="text-lg font-bold text-white">
            Directory Recursive Retrieval (DRR) & Observable Trajectory
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Simulates OpenViking's hierarchical directory traversal. Rather than performing opaque flat vector matching, DRR navigates directory branches, evaluates relevance, dynamically picks L0/L1/L2 layers to honor token budgets, and records an audit trajectory.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-8">
            <label className="text-[10px] font-mono text-gray-400 uppercase">Search Query</label>
            <input
              type="text"
              value={drrQuery}
              onChange={e => setDrrQuery(e.target.value)}
              placeholder="e.g. Stripe AEO benchmark, Competitor weaknesses, Schema template..."
              className="w-full mt-1 px-4 py-2.5 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-gold"
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-[10px] font-mono text-gray-400 uppercase">Token Budget: {drrBudget}</label>
            <input
              type="range"
              min="400"
              max="4000"
              step="200"
              value={drrBudget}
              onChange={e => setDrrBudget(parseInt(e.target.value, 10))}
              className="w-full mt-2 accent-gold"
            />
          </div>

          <div className="md:col-span-2 flex items-end">
            <button
              onClick={onRunDrr}
              disabled={isRetrieving}
              aria-busy={isRetrieving}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-bold text-xs font-mono hover:opacity-90 transition-all shadow-md flex items-center justify-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:opacity-50"
            >
              {isRetrieving ? (
                <span className="animate-spin">⚙</span>
              ) : (
                <span>▶ Run DRR</span>
              )}
            </button>
          </div>
        </div>

        {/* Quick suggestions */}
        <div className="flex items-center gap-2 flex-wrap pt-2">
          <span className="text-[10px] font-mono text-gray-500 uppercase">Quick Scenarios:</span>
          {[
            'Stripe AEO benchmark',
            'Competitor weaknesses and gaps',
            'FAQPage schema JSON-LD template',
            'Luminara brand DNA and USP'
          ].map(q => (
            <button
              key={q}
              onClick={() => { setDrrQuery(q); }}
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-[10px] font-mono text-gray-300 hover:text-white transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Results & Trajectory */}
      {drrResult && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Observable Trajectory Steps */}
          <div className="lg:col-span-6 glass-morphism rounded-2xl border border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono uppercase text-gold-light font-bold">
                  Observable Audit Trajectory
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-gray-400">
                  {drrResult.trajectory.length} steps in {drrResult.executionTimeMs}ms
                </span>
              </div>
            </div>

            <div className="space-y-3 font-mono text-xs">
              {drrResult.trajectory.map((step) => {
                const isPrune = step.action === 'prune';
                const isResolution = step.action === 'layer_resolution';
                const isAssembly = step.action === 'context_assembly';

                return (
                  <div
                    key={step.stepIndex}
                    className={`p-3 rounded-xl border transition-all ${
                      isResolution 
                        ? 'bg-gold/10 border-gold/40 text-gold-light'
                        : isPrune
                        ? 'bg-danger-500/5 border-danger-500/20 text-danger-300'
                        : isAssembly
                        ? 'bg-success-500/10 border-success-500/30 text-success-300'
                        : 'bg-black/40 border-white/5 text-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/10 font-bold">
                          #{step.stepIndex}
                        </span>
                        <span className="font-bold uppercase text-[10px] tracking-wider">
                          {step.action.replace('_', ' ')}
                        </span>
                      </div>
                      {step.score !== undefined && (
                        <span className="text-[10px] text-gray-400 font-mono">
                          score: {(step.score * 100).toFixed(0)}%
                        </span>
                      )}
                      {step.layerSelected && (
                        <span className="text-[10px] px-2 py-0.2 rounded bg-gold text-black font-bold">
                          {step.layerSelected} Layer
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-gray-400 truncate mt-1">
                      ↳ {step.targetUri}
                    </div>
                    <div className="text-xs text-gray-200 mt-1 leading-normal">
                      {step.rationale}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Retrieved Context Assembly */}
          <div className="lg:col-span-6 glass-morphism rounded-2xl border border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div>
                <span className="text-xs font-mono uppercase text-success-400 font-bold">
                  Assembled Context Output
                </span>
                <span className="text-[10px] text-gray-400 font-mono ml-2">
                  ({drrResult.tokensUsed} / {drrResult.tokenBudget} tokens)
                </span>
              </div>
              <span className="text-xs font-mono text-success-400 font-bold bg-success-500/10 px-2.5 py-0.5 rounded-full border border-success-500/30">
                +{drrResult.tokenSavingsPct}% Savings vs L2
              </span>
            </div>

            <div className="p-4 rounded-xl bg-black/60 border border-white/10 font-mono text-xs text-gray-200 max-h-[500px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {drrResult.assembledContext || 'No relevant context matched threshold.'}
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[10px] font-mono text-gray-500">
                Automatically injected into Oracle Agent prompt stream
              </span>
              <button
                onClick={handleCopyContext}
                className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-gray-300"
              >
                {copiedContext ? 'Copied!' : 'Copy Assembled Context'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
