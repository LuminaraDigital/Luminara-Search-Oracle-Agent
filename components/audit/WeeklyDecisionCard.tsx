import React, { useMemo, useState } from 'react';
import { ICONS } from '../../constants';
import type { BoardFinding } from '../../services/audit/findingBoardService';
import { patchFindingStatus } from '../../services/audit/findingBoardService';
import { sampleAiSaidFixtures } from '../../services/audit/sampleAiSaidFixtures';
import type { ShipCommitment } from '../../services/audit/shipCommitmentService';

interface WeeklyDecisionCardProps {
  domain: string;
  primary: BoardFinding | null;
  findings: BoardFinding[];
  commitment: ShipCommitment | null;
  onFindingUpdated?: (f: BoardFinding) => void;
}

/**
 * One weekly decision: action, Why (Sample AI-said or finding), verify hint.
 */
export const WeeklyDecisionCard: React.FC<WeeklyDecisionCardProps> = ({
  domain,
  primary,
  findings,
  commitment,
  onFindingUpdated,
}) => {
  const [busy, setBusy] = useState(false);
  const aiSaid = useMemo(() => sampleAiSaidFixtures(domain), [domain]);
  const verifyBy = useMemo(() => {
    const base = commitment?.committedAt || Date.now();
    return new Date(base + 14 * 24 * 60 * 60 * 1000).toLocaleDateString();
  }, [commitment?.committedAt]);

  const markInProgress = async () => {
    if (!primary || busy) return;
    setBusy(true);
    try {
      const updated = await patchFindingStatus(domain, primary.id, 'in_progress');
      if (updated) onFindingUpdated?.(updated);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="mb-8 rounded-2xl border border-gold/40 bg-black/70 p-6 sm:p-8 shadow-2xl"
      aria-label="Weekly decision"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
        <span className="text-[10px] font-black uppercase tracking-[0.35em] text-gold-light">
          This week
        </span>
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2">
        {commitment?.label || primary?.title || 'Pick one ship move'}
      </h2>
      <p className="text-sm text-gray-400 max-w-2xl leading-relaxed mb-6">
        {primary
          ? primary.description
          : 'Commit to one fix from Instant Audit. Sample AI-said rows below explain the Why until Live probes are connected.'}
      </p>

      {primary && (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-gold-light">
              {primary.severity}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">
              {primary.category}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">
              {primary.status}
            </span>
            {!primary.synced && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400/90">
                Local until signed in
              </span>
            )}
          </div>
          <p className="text-gray-300 text-xs leading-relaxed">{primary.title}</p>
          <button
            type="button"
            disabled={busy || primary.status === 'in_progress' || primary.status === 'done'}
            onClick={markInProgress}
            className="mt-3 px-3 py-1.5 rounded-lg border border-gold/40 text-[11px] font-bold uppercase tracking-wider text-gold-light disabled:opacity-40"
          >
            Mark in progress
          </button>
        </div>
      )}

      <div className="mb-4">
        <h3 className="text-[11px] font-mono uppercase tracking-wider text-gray-500 mb-3">
          Why (Sample AI said)
        </h3>
        <ul className="space-y-3">
          {aiSaid.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-white/10 px-4 py-3 text-xs text-gray-300 leading-relaxed"
            >
              <div className="flex flex-wrap gap-2 mb-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-amber-300/90">
                  {row.label}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">
                  {row.engine}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">
                  {row.measurementStatus}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">
                  {row.presence}
                </span>
              </div>
              <p className="text-gray-400 mb-1">
                <span className="text-gray-500">Prompt:</span> {row.prompt}
              </p>
              <p className="text-gray-300 mb-1">{row.excerpt}</p>
              <p className="text-[11px] text-gray-500">{row.note}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500 font-mono">
        <span className="inline-flex items-center gap-1.5">
          <ICONS.Radar className="w-3.5 h-3.5 text-gold/80" />
          Verify by {verifyBy}
        </span>
        <span>{findings.length} finding{findings.length === 1 ? '' : 's'} on board</span>
      </div>
    </section>
  );
};
