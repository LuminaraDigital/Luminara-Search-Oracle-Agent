import React, { useEffect, useState } from 'react';
import { ICONS } from '../../constants';
import { AppView, BusinessDNA } from '../../types';
import { dreamingClient, type DreamStatusResult } from '../../services/dreaming/dreamingClient';

interface DreamingDashboardCardProps {
  domain?: string;
  dna?: BusinessDNA | null;
  onNavigate: (view: AppView) => void;
}

export const DreamingDashboardCard: React.FC<DreamingDashboardCardProps> = ({
  domain,
  dna,
  onNavigate,
}) => {
  const [status, setStatus] = useState<DreamStatusResult | null>(null);

  const targetDomain = domain
    ? domain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase()
    : dna?.name ? dna.name.toLowerCase().replace(/\s+/g, '') + '.com' : '';

  useEffect(() => {
    if (!targetDomain) return;
    dreamingClient
      .getStatus(targetDomain)
      .then((s) => setStatus(s))
      .catch(() => {});
  }, [targetDomain]);

  if (!status || (status.activeMemoriesCount === 0 && status.pendingProposalsCount === 0 && !status.lastRun)) {
    return null;
  }

  const pendingCount = status.pendingProposalsCount;
  const activeCount = status.activeMemoriesCount;
  const lastRun = status.lastRun;

  return (
    <div className="mb-8 rounded-xl bg-gradient-to-r from-gold/10 via-[var(--color-paper-2)] to-gold/5 border border-gold/40 p-4 sm:p-5 shadow-lg relative overflow-hidden transition-all hover:border-gold/60">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gold/15 text-gold-light border border-gold/30 shrink-0">
            <ICONS.DNA className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-gold-light">
                Luminara Dreaming
              </span>
              {pendingCount > 0 ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold animate-pulse">
                  {pendingCount} awaiting approval
                </span>
              ) : (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {activeCount} memories active
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-gray-200 mt-1">
              {lastRun
                ? `Consolidated: ${lastRun.proposalsCount} insights recorded across audits and recommendations.`
                : 'Your Business DNA memory layer is active and learning from every audit.'}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Your next audit will personalize against this updated Business DNA.
            </p>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2 self-end sm:self-center">
          <button
            onClick={() => onNavigate(AppView.BRAND_MEMORY)}
            className="px-3.5 py-1.5 rounded-lg bg-gold/20 hover:bg-gold/30 border border-gold/40 text-gold-light text-xs font-semibold transition-all active:scale-95 shadow"
          >
            {pendingCount > 0 ? 'Review Proposals →' : 'View Memory →'}
          </button>
        </div>
      </div>
    </div>
  );
};
