import React, { useEffect, useState } from 'react';
import type { OracleApprovalCardData, OracleStep } from '../../types';

/**
 * Under an Oracle answer: the steps it took (code-built receipts from the server) and any approval
 * cards. A card's text is rendered by the server from the stored action, never written by the model.
 */

const DECIDED_COPY: Record<string, string> = {
  approved_done: 'Done.',
  denied: 'Rejected. Nothing was changed.',
  failed: 'Not done.',
  expired: 'This card expired. Nothing was changed. Ask Oracle again if you still want it.',
  failed_unknown: 'We could not confirm this ran. Check before trying again.',
  already_decided: 'This card was already decided.',
};

function minutesLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 60000));
}

export function OracleSteps({ steps }: { steps: OracleStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3" aria-label="What Oracle checked">
      <div className="text-[10px] font-semibold tracking-wide text-gold mb-2">What Oracle checked</div>
      <ul className="space-y-1 text-xs text-gray-300">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className={step.status === 'ok' ? 'text-success-400' : 'text-gray-500'}>
              {step.status === 'ok' ? '✓' : '•'}
            </span>
            <span>
              {step.summary}
              {step.measured ? <span className="ml-2 text-[10px] text-gold-light">measured</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OracleApprovalCard({
  card,
  onDecide,
}: {
  card: OracleApprovalCardData;
  onDecide?: (actionId: string, approved: boolean) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (card.status !== 'pending') return;
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [card.status]);

  const pending = card.status === 'pending' && card.expiresAt > now;
  const shownStatus = card.status === 'pending' && !pending ? 'expired' : card.status;
  const decide = (approved: boolean) => {
    if (!onDecide || busy) return;
    setBusy(true);
    onDecide(card.actionId, approved);
  };

  return (
    <div className="mt-4 rounded-xl border border-gold/30 bg-gold/5 px-4 py-4" role="group" aria-label="Needs your approval">
      <div className="text-[10px] font-semibold tracking-wide text-gold mb-2">Needs your approval</div>
      <pre className="whitespace-pre-wrap font-sans text-sm text-gray-200 leading-relaxed">{card.preview}</pre>
      {card.costNote && <p className="mt-2 text-xs text-gray-400">{card.costNote}</p>}
      {card.tainted && (
        <p className="mt-2 text-xs text-warning-400">
          Oracle suggested this after reading outside content. Check the details before you approve.
        </p>
      )}
      {pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !onDecide}
            onClick={() => decide(true)}
            className="rounded-lg border border-gold/50 bg-gold/20 px-4 py-1.5 text-xs font-semibold text-gold-light hover:bg-gold/30 disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy || !onDecide}
            onClick={() => decide(false)}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-gray-300 hover:text-white disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            Reject
          </button>
          <span className="text-[11px] text-gray-500">Expires in {minutesLeft(card.expiresAt, now)} min</span>
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-300" role="status">
          {card.summary || DECIDED_COPY[shownStatus] || 'Decided.'}
        </p>
      )}
    </div>
  );
}

export function OracleTurnExtras({
  steps,
  cards,
  onDecide,
}: {
  steps?: OracleStep[];
  cards?: OracleApprovalCardData[];
  onDecide?: (actionId: string, approved: boolean) => void;
}) {
  if (!steps?.length && !cards?.length) return null;
  return (
    <>
      {cards?.map((card) => <OracleApprovalCard key={card.actionId} card={card} onDecide={onDecide} />)}
      {steps && steps.length > 0 && <OracleSteps steps={steps} />}
    </>
  );
}
