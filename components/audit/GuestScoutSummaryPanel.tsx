import React from 'react';
import type { GuestScoutSummary } from '../../services/audit/guestScoutSummary';

const badgeClass: Record<string, string> = {
  measured: 'border-gold/40 text-gold-light bg-gold/10',
  estimated: 'border-white/20 text-gray-200 bg-white/5',
  not_measured: 'border-white/15 text-gray-400 bg-transparent',
  pass: 'border-gold/40 text-gold-light bg-gold/10',
  fail: 'border-white/20 text-gray-200 bg-white/5',
};

interface GuestScoutSummaryPanelProps {
  summary: GuestScoutSummary;
  shareNote?: string | null;
  onShare?: () => void;
  onCopy?: () => void;
  sharing?: boolean;
}

export const GuestScoutSummaryPanel: React.FC<GuestScoutSummaryPanelProps> = ({
  summary,
  shareNote,
  onShare,
  onCopy,
  sharing = false,
}) => {
  return (
    <section
      aria-label="Scout summary"
      className="mb-8 rounded-2xl border border-white/10 bg-black px-5 py-6 sm:px-8 sm:py-8 shadow-2xl"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold-light">Instant Scout</p>
      <h2 className="mt-3 text-[clamp(1.6rem,4vw,2.4rem)] font-semibold tracking-tight text-white [overflow-wrap:anywhere]">
        {summary.domain}
      </h2>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-gray-200">{summary.verdict}</p>
      <p className="mt-3 text-[11px] text-gray-500">
        Signals are measured, estimated, or not measured. This scout does not invent scores.
      </p>

      <div className="mt-8 grid gap-8 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Your next move</h3>
          <p className="mt-2 text-sm leading-relaxed text-white">{summary.topFix}</p>
          <p className="mt-3 text-sm leading-relaxed text-gray-400">{summary.nextStep}</p>
        </div>
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Evidence used</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-300">{summary.evidenceUsed}</p>
        </div>
      </div>

      <h3 className="mt-8 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Signals</h3>
      <ul className="mt-3 flex flex-wrap gap-2">
        {summary.badges.map((badge) => (
          <li
            key={badge.label}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide ${badgeClass[badge.status] || badgeClass.not_measured}`}
          >
            {badge.label}: {badge.status === 'not_measured' ? 'not measured' : badge.value || badge.status}
          </li>
        ))}
      </ul>

      {summary.crawlerChecks.length > 0 && (
        <>
          <h3 className="mt-6 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">LLM crawler readiness</h3>
          <ul className="mt-3 space-y-2">
            {summary.crawlerChecks.map((check) => (
              <li key={check.id} className="text-sm text-gray-300">
                <span className={`mr-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass[check.status] || badgeClass.not_measured}`}>
                  {check.status === 'not_measured' ? 'not measured' : check.status}
                </span>
                <span className="text-gray-200">{check.label}.</span>{' '}
                <span className="text-gray-400">{check.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {summary.failed.length > 0 && (
        <>
          <h3 className="mt-8 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">What failed</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-300">
            {summary.failed.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        {onShare && (
          <button
            type="button"
            onClick={onShare}
            disabled={sharing}
            className="min-h-11 rounded-lg bg-gradient-to-r from-gold to-gold-dark px-4 py-2 text-[11px] font-black uppercase tracking-widest text-black disabled:opacity-50"
          >
            {sharing ? 'Sharing...' : 'Share teaser'}
          </button>
        )}
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            disabled={sharing}
            className="min-h-11 rounded-lg border border-white/15 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-gray-200"
          >
            Copy link
          </button>
        )}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
        The teaser is a redacted summary and a link back to the Mini App. It is not a full branded share report. Those stay on Growth and Agency.
      </p>
      {shareNote && <p className="mt-2 text-[12px] text-gold-light">{shareNote}</p>}
    </section>
  );
};
