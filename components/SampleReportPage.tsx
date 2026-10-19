import React, { useEffect } from 'react';
import { EvidenceGlyph, MarketingPageHeader, MarketingPageShell } from './marketing/MarketingPageShell';
import { LIVE_SAMPLE_SNAPSHOT, type LiveSampleRow } from '../services/marketing/liveSampleSnapshot';
import type { EvidenceState } from './marketing/earth/globeStory';
import type { AuditHandoff } from '../services/activation/auditHandoff';
import { LIVE_ANSWER_CHECKS } from '../services/marketing/engineCoverage';

interface SampleReportPageProps {
  onOpenAudit: (handoff?: AuditHandoff) => void;
  onNavigatePricing: () => void;
  onNavigateMethodology: () => void;
  onSignUp?: () => void;
  isAuthenticated?: boolean;
}

function statusCopy(status: LiveSampleRow['status'] | 'estimated'): EvidenceState {
  switch (status) {
    case 'measured':
      return 'Measured';
    case 'estimated':
      return 'Estimated';
    case 'not_measured':
      return 'Not measured';
  }
}

const SampleReportPage: React.FC<SampleReportPageProps> = ({
  onOpenAudit,
  onNavigatePricing,
  onNavigateMethodology,
  onSignUp,
  isAuthenticated,
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const openLive = () => onOpenAudit();
  const primary = () => {
    if (isAuthenticated) openLive();
    else if (onSignUp) onSignUp();
    else openLive();
  };

  return (
    <MarketingPageShell
      footerStatement="Know where AI recommends you. Fix what matters first."
      closing={{
        eyebrow: 'Your turn',
        title: (
          <>
            See what AI says <span className="italic lx-gold-text pr-[0.08em]">about you.</span>
          </>
        ),
        body: `Run Instant Audit on your own site. It checks your site and live web search. ${LIVE_ANSWER_CHECKS}`,
        cta: { label: isAuthenticated ? 'Open Instant Audit' : 'Create free account', onClick: primary },
        links: [
          { label: 'Methodology', onClick: onNavigateMethodology },
          { label: 'Pricing', onClick: onNavigatePricing },
        ],
      }}
    >
      <MarketingPageHeader
        eyebrow="Sample report"
        title={
          <>
            What an example report <span className="italic lx-gold-text pr-[0.08em]">looks like.</span>
          </>
        }
        lede={`Example report for luminarasuite.com, a snapshot from 2 Oct 2026. Crawl readiness is Measured. ${LIVE_ANSWER_CHECKS} No invented KPI scores.`}
      />

      <figure className="lx-glass mx-auto mb-0 mt-20 max-w-4xl rounded-3xl p-6 sm:mt-24 sm:p-10" data-reveal>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-ink-2)]">Focus {LIVE_SAMPLE_SNAPSHOT.focus}</p>
            <p className="mt-2 truncate font-serif text-2xl text-[var(--color-ink)] sm:text-3xl">{LIVE_SAMPLE_SNAPSHOT.domain}</p>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--color-rule)] px-3 py-1 text-xs text-[var(--gold-light)]">
            {LIVE_SAMPLE_SNAPSHOT.label}
          </span>
        </div>

        <ul className="m-0 mt-7 list-none divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)] p-0">
          {LIVE_SAMPLE_SNAPSHOT.rows.map((row) => {
            const state = statusCopy(row.status);
            return (
              <li
                key={row.id}
                className="grid grid-cols-[minmax(0,9rem)_minmax(0,8rem)_1fr] items-center gap-3 py-4 max-sm:grid-cols-2"
              >
                <span className="text-sm text-[var(--color-ink)]">{row.label}</span>
                <span className="flex items-center gap-2 text-[13px] text-[var(--gold-light)]">
                  <EvidenceGlyph state={state} />
                  {state}
                </span>
                <span className="text-[13px] leading-snug text-[var(--color-ink-2)] max-sm:col-span-2">{row.note}</span>
              </li>
            );
          })}
        </ul>

        <p className="mt-7 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
          <span className="text-[var(--color-ink)]">Verdict. </span>
          {LIVE_SAMPLE_SNAPSHOT.verdict}
        </p>

        <div className="mt-7 rounded-2xl border border-gold/45 bg-gold/10 p-5 sm:p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-[var(--gold-light)]">Next</p>
          <p className="mt-2 font-serif text-xl leading-snug text-[var(--color-ink)] sm:text-2xl">
            {LIVE_SAMPLE_SNAPSHOT.shipAction}
          </p>
        </div>

        <figcaption className="mt-6 text-xs leading-relaxed text-[var(--color-ink-2)]">
          Static dated snapshot at /sample-report. Answer-engine Live runs happen in Instant Audit.
        </figcaption>
      </figure>
    </MarketingPageShell>
  );
};

export default SampleReportPage;
