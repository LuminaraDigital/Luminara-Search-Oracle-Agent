import React, { useEffect } from 'react';
import { MarketingPageShell } from './marketing/MarketingPageShell';
import { LIVE_SAMPLE_SNAPSHOT } from '../services/marketing/liveSampleSnapshot';
import type { AuditHandoff } from '../services/activation/auditHandoff';

interface SampleReportPageProps {
  onOpenAudit: (handoff?: AuditHandoff) => void;
  onNavigatePricing: () => void;
  onNavigateMethodology: () => void;
  onSignUp?: () => void;
  isAuthenticated?: boolean;
}

function statusCopy(status: string): string {
  switch (status) {
    case 'measured':
      return 'Measured';
    case 'estimated':
      return 'Estimated';
    case 'not_measured':
      return 'Not measured';
    default:
      return status;
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
      brandSub="Sample"
      footerStatement="Know where AI recommends you. Fix what matters first."
    >
      <header className="mb-12 max-w-3xl">
        <h1 className="font-display text-[length:var(--text-display)] tracking-tight leading-[1.05] mb-5 [overflow-wrap:anywhere]">
          What a Live crawl report looks like
        </h1>
        <p className="text-lg text-[var(--color-ink-2)] leading-relaxed">
          Dated Live crawl of luminarasuite.com ({LIVE_SAMPLE_SNAPSHOT.measuredAt}). Crawl readiness is
          Measured. Answer engines stay Not measured until Instant Audit. No invented KPI scores.
        </p>
      </header>

      <figure className="border border-[var(--color-rule)] bg-[var(--color-paper)]/80 mb-10">
        <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3 border-b border-[var(--color-rule)]">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--color-ink)] truncate">{LIVE_SAMPLE_SNAPSHOT.domain}</p>
            <p className="text-[12px] text-[var(--color-ink-2)] mt-0.5">Focus {LIVE_SAMPLE_SNAPSHOT.focus}</p>
          </div>
          <p className="shrink-0 text-[12px] font-mono text-[var(--color-accent)]">
            {LIVE_SAMPLE_SNAPSHOT.label} · {LIVE_SAMPLE_SNAPSHOT.measuredAt}
          </p>
        </div>

        <ul className="divide-y divide-[var(--color-rule)]">
          {LIVE_SAMPLE_SNAPSHOT.rows.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-sm text-[var(--color-ink)]">{row.label}</p>
                <p className="text-[13px] text-[var(--color-ink-2)] mt-0.5 leading-snug">{row.note}</p>
              </div>
              <span className="shrink-0 text-[12px] font-mono tracking-wide text-[var(--color-ink)]">
                {statusCopy(row.status)}
              </span>
            </li>
          ))}
        </ul>

        <div className="border-t border-[var(--color-rule)] px-5 py-4 space-y-2">
          <p className="text-sm text-[var(--color-ink)] leading-relaxed">{LIVE_SAMPLE_SNAPSHOT.verdict}</p>
          <p className="text-sm text-[var(--color-ink-2)]">
            <span className="text-[var(--color-ink)] font-medium">Next: </span>
            {LIVE_SAMPLE_SNAPSHOT.shipAction}
          </p>
        </div>

        <figcaption className="px-5 pb-4 text-[13px] text-[var(--color-ink-2)]">
          Static dated snapshot at /sample-report. Answer-engine Live runs happen in Instant Audit.
        </figcaption>
      </figure>

      <div className="flex flex-col sm:flex-row flex-wrap gap-3">
        <button type="button" className="mkt-cta-primary" onClick={primary}>
          {isAuthenticated ? 'Open Instant Audit' : 'Create free account'}
        </button>
        <button type="button" className="mkt-cta-secondary" onClick={onNavigateMethodology}>
          Methodology
        </button>
        <button type="button" className="mkt-cta-secondary" onClick={onNavigatePricing}>
          Pricing
        </button>
      </div>
    </MarketingPageShell>
  );
};

export default SampleReportPage;
