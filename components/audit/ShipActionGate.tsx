import React, { useMemo, useState } from 'react';
import { ICONS } from '../../constants';
import {
  fingerprintReport,
  writeShipCommitment,
  type ShipCommitment,
} from '../../services/audit/shipCommitmentService';

export type { ShipCommitment };
export { readShipCommitment, writeShipCommitment } from '../../services/audit/shipCommitmentService';

const ACTIONS: Array<{ id: string; label: string; detail: string }> = [
  {
    id: 'deploy-schema',
    label: 'Ship schema / structured data',
    detail: 'Add or fix Schema.org so AI and Google understand your brand entity.',
  },
  {
    id: 'rewrite-answer',
    label: 'Ship one answer-ready page rewrite',
    detail: 'Rewrite the page most likely to be cited in AI answers this week.',
  },
  {
    id: 'citation-gap',
    label: 'Close one citation gap',
    detail: 'Publish or strengthen the proof (FAQ, comparison, or source page) rivals already win on.',
  },
];

interface Props {
  domain?: string;
  markdownText: string;
  hasEvidence: boolean;
  sourceCount: number;
  onCommitted: (commitment: ShipCommitment) => void;
  onDeploy?: () => void;
}

/**
 * Level 4 "shake" mechanic: the full report unlocks only after the founder
 * commits to one concrete ship action (or opens 1-click deploy).
 */
export const ShipActionGate: React.FC<Props> = ({
  domain,
  markdownText,
  hasEvidence,
  sourceCount,
  onCommitted,
  onDeploy,
}) => {
  const [selected, setSelected] = useState(ACTIONS[0].id);
  const fp = useMemo(() => fingerprintReport(markdownText), [markdownText]);

  const commit = (actionId: string, label: string) => {
    const commitment: ShipCommitment = { actionId, label, committedAt: Date.now() };
    writeShipCommitment(domain || 'unknown', markdownText, commitment);
    onCommitted(commitment);
  };

  const selectedAction = ACTIONS.find((a) => a.id === selected) || ACTIONS[0];

  return (
    <div className="mb-8 glass-morphism rounded-2xl border border-gold/50 p-6 sm:p-8 bg-black/70 shadow-2xl">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
        <span className="text-[10px] font-black uppercase tracking-[0.35em] text-gold-light">
          Fog clearing: pick one move
        </span>
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2">
        What will you ship this week?
      </h2>
      <p className="text-sm text-gray-400 max-w-2xl leading-relaxed mb-6">
        Reading the full report without a next step is the snooze button. Choose one
        action to unlock the rest of the audit. Evidence chips stay visible either way.
      </p>

      <div
        className={`mb-6 rounded-xl px-4 py-3 text-xs border flex items-start gap-3 ${
          hasEvidence
            ? 'border-success-500/40 bg-success-500/5 text-success-200'
            : 'border-warning-500/40 bg-warning-500/5 text-warning-200'
        }`}
      >
        <ICONS.Radar className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          {hasEvidence ? (
            <span>
              Cite-or-silence: {sourceCount} live source{sourceCount === 1 ? '' : 's'} attached.
              Treat any score without a source chip as <strong>not verified</strong>.
            </span>
          ) : (
            <span>
              Cite-or-silence: no live sources on this run. Treat ranks and percentages as{' '}
              <strong>not verified</strong> until you re-run with search grounding.
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3 mb-6">
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelected(a.id)}
            className={`w-full text-left rounded-xl border p-4 transition-all ${
              selected === a.id
                ? 'border-gold/60 bg-gold/10'
                : 'border-white/10 bg-black/40 hover:border-white/25'
            }`}
          >
            <div className="text-sm font-bold text-white mb-1">{a.label}</div>
            <div className="text-xs text-gray-400 leading-relaxed">{a.detail}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={() => commit(selectedAction.id, selectedAction.label)}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-[10px] tracking-[0.25em] hover:scale-[1.02] active:scale-95 transition-all"
        >
          I will ship this
        </button>
        {onDeploy && (
          <button
            type="button"
            onClick={() => {
              commit('deploy-schema', 'Ship schema / structured data');
              onDeploy();
            }}
            className="px-6 py-3 rounded-xl glass-morphism border border-gold/40 text-gold-light font-black uppercase text-[10px] tracking-[0.25em] hover:bg-gold/10 transition-all flex items-center justify-center gap-2"
          >
            <ICONS.Zap className="w-4 h-4" />
            Open 1-click deploy
          </button>
        )}
      </div>
      <p className="mt-4 text-[10px] text-gray-500 font-mono tracking-wide">
        Domain: {domain || 'unknown'} · Gate key {fp}
      </p>
    </div>
  );
};
