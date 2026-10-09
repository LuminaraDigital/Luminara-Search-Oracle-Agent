import React, { useEffect, useMemo, useState } from 'react';
import { ICONS } from '../../constants';
import type { BoardFinding } from '../../services/audit/findingBoardService';
import { patchFindingStatus } from '../../services/audit/findingBoardService';
import { sampleAiSaidFixtures } from '../../services/audit/sampleAiSaidFixtures';
import type { ShipCommitment } from '../../services/audit/shipCommitmentService';
import { upsertWeeklyDecision } from '../../services/privacy/privacyClient';
import { honestyChipLabel, normalizeMeasurementStatus } from '../../services/wdl/liveHonesty';

import type { EmpiricalEvidence } from '../../services/audit/empiricalCitationService';
import { MindshareRadarCard } from '../visibility/MindshareRadarCard';
import { PerceptionMatrix } from '../visibility/PerceptionMatrix';

interface WeeklyDecisionCardProps {
  domain: string;
  primary: BoardFinding | null;
  findings: BoardFinding[];
  commitment: ShipCommitment | null;
  onFindingUpdated?: (f: BoardFinding) => void;
  evidence?: EmpiricalEvidence[];
  rawSources?: Array<{ uri: string; title: string }>;
  onSelectAction?: (actionId: string, label: string) => void;
}

/**
 * One weekly decision: action, Why (Sample AI-said or finding), verify hint.
 * When signed in, commits also persist to D1 via /api/weekly-decisions.
 */
export const WeeklyDecisionCard: React.FC<WeeklyDecisionCardProps> = ({
  domain,
  primary,
  findings,
  commitment,
  onFindingUpdated,
  evidence,
  rawSources,
  onSelectAction,
}) => {
  const [busy, setBusy] = useState(false);
  const [persistNote, setPersistNote] = useState<string | null>(null);
  const aiSaid = useMemo(() => sampleAiSaidFixtures(domain), [domain]);
  const verifyBy = useMemo(() => {
    const base = commitment?.committedAt || Date.now();
    return new Date(base + 14 * 24 * 60 * 60 * 1000).toLocaleDateString();
  }, [commitment?.committedAt]);

  const mappedEvidence: EmpiricalEvidence[] = useMemo(() => {
    if (evidence && evidence.length > 0) return evidence;
    return [];
  }, [evidence]);

  useEffect(() => {
    if (!commitment || !domain) return;
    let cancelled = false;
    void (async () => {
      const statuses = aiSaid.map((r) => normalizeMeasurementStatus(r.measurementStatus));
      const hasMeasured = statuses.some((s) => s === 'measured');
      const row = await upsertWeeklyDecision({
        domain,
        title: commitment.label,
        whyText: primary?.description || '',
        findingId: primary?.id,
        commitment,
        dataFreshness: hasMeasured ? 'mixed' : 'sample',
        evidence: aiSaid.slice(0, 5),
      });
      if (!cancelled) {
        setPersistNote(row ? 'Saved to account' : 'Session only (sign in to sync)');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commitment?.actionId, commitment?.committedAt, domain, primary?.id, primary?.description, aiSaid]);

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
        {persistNote && (
          <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500 ml-auto">
            {persistNote}
          </span>
        )}
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

      <MindshareRadarCard
        domain={domain}
        evidence={mappedEvidence}
        rawSources={rawSources}
        onSelectAction={onSelectAction}
      />

      <PerceptionMatrix
        domain={domain}
        evidence={mappedEvidence}
        onTakeAction={onSelectAction}
      />

      <div className="mb-4">
        <h3 className="text-[11px] font-mono uppercase tracking-wider text-gray-500 mb-3">
          Why (Sample AI said)
        </h3>
        <ul className="space-y-3">
          {aiSaid.map((row) => {
            const status = normalizeMeasurementStatus(row.measurementStatus);
            return (
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
                    {honestyChipLabel(status)}
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
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500 font-mono">
        <span className="inline-flex items-center gap-1.5">
          <ICONS.Radar className="w-3.5 h-3.5 text-gold/80" />
          Verify by {verifyBy}
        </span>
        <span>
          {findings.length} finding{findings.length === 1 ? '' : 's'} on board
        </span>
      </div>
    </section>
  );
};
