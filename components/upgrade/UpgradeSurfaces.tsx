import React, { useEffect, useState } from 'react';
import type { BoardFinding } from '../../services/audit/findingBoardService';
import { brandNameFor } from '../../services/audit/brandName';
import { listAudits } from '../../services/audit/auditHistoryService';
import { productTelemetry } from '../../services/analytics/productTelemetry';
import { getCurrentQuotaSync, openPaywallModal, subscribeQuota } from '../../services/apiClient';
import { requestRecheck } from '../../services/upgrade/recheckFixClient';
import {
  UPGRADE_DISMISS_KEY,
  competitorRankLine,
  dismissPrompt,
  easyFix,
  fixProgress,
  isPromptDismissed,
  lockedFeatures,
  lockedSample,
  markPromptShown,
  recheckCelebration,
  recheckTarget,
  upgradePrompt,
  type LockedFeature,
  type UpgradePromptKind,
} from '../../services/upgrade/upgradeJourney';

const buttonClass = 'min-h-11 rounded-lg px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold';

function PromptCard({
  kind,
  onDismiss,
}: {
  kind: UpgradePromptKind;
  onDismiss: () => void;
}) {
  const copy = upgradePrompt(kind);
  useEffect(() => {
    if (markPromptShown(kind)) productTelemetry.track('upgrade_prompt_shown', { prompt: kind });
  }, [kind]);
  return (
    <section aria-label={copy.title} className="rounded-2xl border border-white/15 bg-white/5 px-4 py-4">
      <h3 className="text-lg font-semibold text-white">{copy.title}</h3>
      <p className="mt-2 max-w-[70ch] text-base leading-relaxed text-gray-100">{copy.body}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={`${buttonClass} bg-gold text-black hover:bg-gold-light`}
          onClick={() => {
            productTelemetry.track('upgrade_prompt_clicked', { prompt: kind });
            openPaywallModal(copy.body);
          }}
        >
          See plans
        </button>
        <button
          type="button"
          className={`${buttonClass} border border-white/20 text-gray-100 hover:bg-white/5`}
          onClick={() => {
            productTelemetry.track('upgrade_prompt_dismissed', { prompt: kind });
            dismissPrompt(kind);
            onDismiss();
          }}
        >
          Not now
        </button>
      </div>
    </section>
  );
}

function LockedCard({ feature, onTry }: { feature: LockedFeature; onTry?: () => void }) {
  const sample = lockedSample(feature);
  return (
    <article className="rounded-2xl border border-dashed border-white/25 bg-black px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-white">{sample.title}</h3>
        <span className="rounded-full border border-white/20 px-2 py-0.5 text-xs font-semibold tracking-wide text-gray-100">SAMPLE</span>
      </div>
      <ul className="mt-3 space-y-1 text-base leading-relaxed text-gray-200">
        {sample.rows.map((row) => <li key={row}>{row}</li>)}
      </ul>
      {onTry && (
        <button type="button" className={`${buttonClass} mt-3 border border-white/20 text-gold-light hover:bg-white/5`} onClick={onTry}>
          {feature === 'competitor' ? 'Compare competitors' : feature === 'white_label' ? 'Preview the export' : 'See what this unlocks'}
        </button>
      )}
    </article>
  );
}

function dismissedNow(kind: UpgradePromptKind): boolean {
  try {
    return isPromptDismissed(kind, localStorage.getItem(UPGRADE_DISMISS_KEY));
  } catch {
    return false;
  }
}

export function UpgradePrompt({ kind }: { kind: UpgradePromptKind }) {
  const [open, setOpen] = useState(() => !dismissedNow(kind));
  if (!open) return null;
  return <div className="mb-6"><PromptCard kind={kind} onDismiss={() => setOpen(false)} /></div>;
}

export function UpgradeSurfaces({
  domain,
  findings,
  whiteLabelAsk,
  onCloseWhiteLabel,
}: {
  domain?: string;
  findings: BoardFinding[];
  whiteLabelAsk?: boolean;
  onCloseWhiteLabel?: () => void;
}) {
  const [planId, setPlanId] = useState<string | null>(() => getCurrentQuotaSync()?.plan ?? null);
  const [asked, setAsked] = useState<UpgradePromptKind | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => subscribeQuota((quota) => setPlanId(quota?.plan ?? null)), []);
  const [busy, setBusy] = useState(false);
  const progress = fixProgress(findings);
  const fix = easyFix(findings);
  const prior = domain ? listAudits({ domain }).length : 0;
  const locks = lockedFeatures(planId);
  const showTracking = prior >= 2 && locks.includes('tracking') && !dismissedNow('tracking') && asked !== 'tracking';
  const active = whiteLabelAsk ? 'white_label' : asked;

  const runRecheck = async () => {
    if (!fix || !domain || busy) return;
    const target = recheckTarget(fix, brandNameFor(domain));
    if (!target) {
      setNote('Not measured. This check was not rechecked.');
      return;
    }
    setBusy(true);
    const result = await requestRecheck({ domain, checkId: target.checkId, expect: target.expect });
    setBusy(false);
    if (result.code === 'PAYWALL_EXCEEDED') setAsked('quota');
    setNote(recheckCelebration(result));
  };

  return (
    <div className="mb-8 max-w-[70ch] space-y-4">
      <p className="text-sm text-gray-200">{progress.label}</p>
      <p className="text-sm text-gray-200">{competitorRankLine()}</p>
      {prior <= 1 && fix && (
        <section className="rounded-2xl border border-gold bg-black px-4 py-4">
          <p className="text-xs font-semibold tracking-wide text-gold-light">One easy fix</p>
          <h3 className="mt-1 text-lg font-semibold text-white">{fix.title}</h3>
          <p className="mt-2 text-base leading-relaxed text-gray-100">{fix.description}</p>
          <button type="button" className={`${buttonClass} mt-3 bg-gold text-black hover:bg-gold-light`} onClick={() => void runRecheck()} disabled={busy}>
            {busy ? 'Rechecking…' : 'Recheck this fix'}
          </button>
          {note && <p className="mt-3 text-base leading-relaxed text-gray-100" role="status">{note}</p>}
        </section>
      )}
      {showTracking && <PromptCard kind="tracking" onDismiss={() => setAsked('tracking')} />}
      {active && (
        <PromptCard kind={active} onDismiss={() => { setAsked(null); onCloseWhiteLabel?.(); }} />
      )}
      <div className="grid gap-3">
        {locks.map((feature) => (
          <LockedCard
            key={feature}
            feature={feature}
            onTry={feature === 'competitor' || feature === 'white_label' || feature === 'tracking'
              ? () => setAsked(feature === 'tracking' ? 'tracking' : feature)
              : undefined}
          />
        ))}
      </div>
    </div>
  );
}
