import React from 'react';
import { GRPORolloutItem } from '../../../types';
import { ICONS } from '../../../constants';
import { renderMarkdown } from '../../../utils/markdown';

interface GrpoReasoningTabProps {
  handleRunGRPO: () => void;
  grpoRollout: GRPORolloutItem | null;
}

export const GrpoReasoningTab: React.FC<GrpoReasoningTabProps> = ({
  handleRunGRPO,
  grpoRollout,
}) => {
  return (
    <div className="space-y-6">
      <div className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-gold-light flex items-center gap-2">
              <ICONS.Brain className="w-4 h-4 text-gold" />
              <span>Group Relative Policy Optimization (GRPO)</span>
            </h3>
            <p className="text-xs text-gray-400 mt-1 max-w-2xl leading-relaxed">
              Evaluates G=4 candidate rollouts per prompt, scores them with verifiable domain reward functions (Schema validation, Citation grounding, and Format compliance), and computes relative advantages without a critic network.
            </p>
          </div>

          <button
            onClick={handleRunGRPO}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black text-xs uppercase tracking-wider hover:opacity-95 transition-all flex items-center gap-2 shrink-0"
          >
            <ICONS.Sparkle className="w-3.5 h-3.5 text-black" />
            <span>Resample Group Rollout</span>
          </button>
        </div>

        {/* GRPO Math Explanation Banner */}
        <div className="mt-4 p-3 rounded-xl bg-white/[0.02] border border-white/5 flex flex-wrap items-center justify-between text-xs font-mono text-gray-400 gap-2">
          <span>Advantage Formula: <strong className="text-gold-light">A_i = (R_i - mean(R)) / std(R)</strong></span>
          <span>Group Size: <strong className="text-white">G = 4</strong></span>
          <span>Policy Loss: <strong className="text-success-400">{grpoRollout?.policyLoss || '0.218'}</strong></span>
          <span>Mean Group Reward: <strong className="text-sky-400">{grpoRollout?.meanReward || '0.741'}</strong></span>
        </div>
      </div>

      {/* Candidates Grid */}
      {grpoRollout && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {grpoRollout.candidates.map((cand, idx) => {
            const isWinner = idx === 0;
            return (
              <div
                key={cand.id}
                className={`glass-morphism rounded-2xl p-5 border transition-all flex flex-col justify-between ${
                  isWinner
                    ? 'border-gold bg-gold/10 shadow-[0_0_30px_rgba(191,149,63,0.15)]'
                    : 'border-white/10 bg-black/60'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-200">Candidate #{idx + 1}</span>
                      {isWinner && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-gold text-black font-black uppercase tracking-wider">
                          Winning Policy
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-mono">
                      Advantage: <strong className={cand.advantage >= 0 ? 'text-success-400' : 'text-danger-400'}>
                        {cand.advantage >= 0 ? `+${cand.advantage}` : cand.advantage}
                      </strong>
                    </div>
                  </div>

                  {/* Reasoning Snippet */}
                  <div className="p-3 rounded-xl bg-black/60 border border-white/5 text-[11px] font-mono text-gray-400">
                    <span className="text-gold-light font-bold block mb-1">&lt;think&gt;</span>
                    <p className="line-clamp-3 leading-relaxed">{cand.reasoning}</p>
                    <span className="text-gold-light font-bold block mt-1">&lt;/think&gt;</span>
                  </div>

                  {/* Response Output */}
                  <div className="text-xs text-gray-300 leading-relaxed overflow-hidden">
                    <div
                      className="prose prose-invert max-w-none text-xs"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(cand.response) }}
                    />
                  </div>
                </div>

                {/* Reward Breakdown Footprint */}
                <div className="mt-4 pt-3 border-t border-white/5 grid grid-cols-3 gap-2 text-center text-[10px] font-mono">
                  <div className="p-1.5 rounded-lg bg-white/5">
                    <span className="text-gray-500 block">Schema</span>
                    <span className="font-bold text-white">{(cand.schemaReward * 100).toFixed(0)}%</span>
                  </div>
                  <div className="p-1.5 rounded-lg bg-white/5">
                    <span className="text-gray-500 block">Citation</span>
                    <span className="font-bold text-white">{(cand.citationReward * 100).toFixed(0)}%</span>
                  </div>
                  <div className="p-1.5 rounded-lg bg-white/5">
                    <span className="text-gray-500 block">Total R</span>
                    <span className="font-bold text-gold-light">{(cand.totalReward * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
