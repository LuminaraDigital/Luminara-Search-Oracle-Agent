import React from 'react';
import type { GuestScoutSummary } from '../../services/audit/guestScoutSummary';
import { GUEST_FULL_AUDIT_CTA } from '../../services/audit/hostedScoutRail';
import { renderMarkdown } from '../../utils/markdown';
import { ActionableFixList } from '../retention/ActionableFixList';
import { DailyStreakCard } from '../retention/DailyStreakCard';

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
  /** Guest degraded result: primary sign-in. Omitted for signed-in rails. */
  onSignIn?: () => void;
}

export const GuestScoutSummaryPanel: React.FC<GuestScoutSummaryPanelProps> = ({
  summary,
  shareNote,
  onShare,
  onCopy,
  sharing = false,
  onSignIn,
}) => {
  return (
    <section
      aria-label="Scout summary"
      className="mb-8 rounded-2xl border border-white/10 bg-black px-5 py-6 sm:px-8 sm:py-8 shadow-2xl"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold-light">Instant Audit</p>
      <h2 className="mt-3 text-[clamp(1.6rem,4vw,2.4rem)] font-semibold tracking-tight text-white [overflow-wrap:anywhere]">
        {summary.brand || summary.domain}
      </h2>
      {summary.brand && summary.brand.toLowerCase() !== summary.domain.toLowerCase() && (
        <p className="mt-1 text-sm text-gray-400 [overflow-wrap:anywhere]">{summary.domain}</p>
      )}
      <div
        id="tour-audit-result"
        className="markdown-content scout-brief mt-4 max-w-2xl text-[15px] leading-relaxed text-gray-200"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(summary.verdictMarkdown || summary.verdict) }}
      />
      {summary.banner && (
        <p role="status" className="mt-4 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm leading-relaxed text-gray-200">
          {summary.banner}
        </p>
      )}
      {summary.banner && onSignIn && (
        <div className="mt-3 flex flex-col items-start gap-1">
          <button
            type="button"
            onClick={onSignIn}
            className="flex min-h-11 w-full items-center justify-center rounded-lg bg-gold px-4 text-[11px] font-semibold tracking-wide text-black hover:bg-gold-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:w-auto"
          >
            {GUEST_FULL_AUDIT_CTA}
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('luminara-open-settings'))}
            className="min-h-11 px-1 text-left text-sm text-gray-400 underline-offset-2 hover:text-gray-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            Or add your own keys in Settings.
          </button>
        </div>
      )}
      <p className="mt-3 text-[11px] text-gray-500">
        Signals are measured, estimated, or not measured. This scout does not invent scores.
      </p>

      <div className="mt-8 grid gap-8 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div id="tour-top-fix">
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
            {badge.label}: {badge.status === 'not_measured' ? badge.value || 'not measured' : badge.value || badge.status}
          </li>
        ))}
      </ul>

      {summary.crawlerChecks.length > 0 && (
        <>
          <h3 className="mt-6 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">LLM crawler readiness</h3>
          <p className="mt-2 text-[11px] text-gray-500">Each row is pass, fail, or not measured. Structure hints are not a score.</p>
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

      {/* Actionable Fix List with copyable code diffs: shown only when live evidence was measured */}
      {!summary.evidenceEmpty && !summary.degraded && (
        <ActionableFixList
          domain={summary.domain}
          crawlerChecks={summary.crawlerChecks}
          findings={summary.failed.map((failText, idx) => ({
            id: `finding-scout-${idx}`,
            title: failText,
            description: `Finding identified during scout: ${failText}`,
          }))}
        />
      )}

      {/* Retention: Daily Verification Streak Card */}
      <DailyStreakCard domain={summary.domain} />

      {!summary.degraded && !summary.evidenceEmpty && (onShare || onCopy) && (
        <>
          <div className="mt-8 flex flex-col gap-2 sm:flex-row">
            {onShare && (
              <button
                type="button"
                onClick={onShare}
                disabled={sharing}
                className="min-h-11 rounded-lg bg-gradient-to-r from-gold to-gold-dark px-4 py-2 text-[11px] font-black uppercase tracking-widest text-black disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sharing ? 'Sharing...' : 'Share teaser'}
              </button>
            )}
            {onCopy && (
              <button
                type="button"
                onClick={onCopy}
                disabled={sharing}
                className="min-h-11 rounded-lg border border-white/15 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Copy link
              </button>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
            The teaser is a redacted summary and a link back to the Mini App. It is not a full branded share report. Those stay on Growth and Agency.
          </p>
        </>
      )}
      {shareNote && <p className="mt-2 text-[12px] text-gold-light">{shareNote}</p>}
    </section>
  );
};
