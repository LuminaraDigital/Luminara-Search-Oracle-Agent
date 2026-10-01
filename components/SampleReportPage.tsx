import React, { useEffect } from 'react';
import { MarketingPageShell } from './marketing/MarketingPageShell';
import { SAMPLE_FIXTURE } from './marketing/demo/demoFixtures';
import type { AuditHandoff } from '../services/activation/auditHandoff';

interface SampleReportPageProps {
  onOpenAudit: (handoff?: AuditHandoff) => void;
  onNavigatePricing: () => void;
  onNavigateMethodology: () => void;
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
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // The fixture domain is ours, not the visitor's: open Instant Audit empty.
  const openLive = () => onOpenAudit();

  return (
    <MarketingPageShell
      brandSub="Sample"
      footerStatement="Know where AI recommends you. Fix what matters first."
    >
      <header className="mb-12 max-w-3xl">
        <h1 className="font-display text-[length:var(--text-display)] tracking-tight leading-[1.05] mb-5 [overflow-wrap:anywhere]">
          What a scout report looks like
        </h1>
        <p className="text-lg text-[var(--color-ink-2)] leading-relaxed">
          Labeled Sample fixture only. Same shape as Instant Audit: per-engine status, verdict, and one
          ship action. Not live data. No invented KPI scores.
        </p>
      </header>

      <figure className="border border-[var(--color-rule)] bg-[var(--color-paper)]/80 mb-10">
        <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3 border-b border-[var(--color-rule)]">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--color-ink)] truncate">{SAMPLE_FIXTURE.domain}</p>
            <p className="text-[12px] text-[var(--color-ink-2)] mt-0.5">Focus {SAMPLE_FIXTURE.focus}</p>
          </div>
          <p className="shrink-0 text-[11px] font-mono text-[var(--color-ink-2)]">Sample</p>
        </div>

        <ul className="divide-y divide-[var(--color-rule)]">
          {SAMPLE_FIXTURE.engines.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-sm text-[var(--color-ink)]">{row.label}</p>
                <p className="text-[12px] text-[var(--color-ink-2)] mt-0.5 leading-snug">{row.note}</p>
              </div>
              <span className="shrink-0 text-[11px] font-mono tracking-wide text-[var(--color-ink-2)]">
                {statusCopy(row.status)}
              </span>
            </li>
          ))}
        </ul>

        <div className="border-t border-[var(--color-rule)] px-5 py-4 space-y-2">
          <p className="text-sm text-[var(--color-ink)] leading-relaxed">{SAMPLE_FIXTURE.verdict}</p>
          <p className="text-sm text-[var(--color-ink-2)]">
            <span className="text-[var(--color-ink)] font-medium">Next: </span>
            {SAMPLE_FIXTURE.shipAction}
          </p>
        </div>

        <figcaption className="px-5 pb-4 text-[12px] text-[var(--color-ink-2)]">
          Crawlable sample at /sample-report. Live Growth shares use tokenized /share links.
        </figcaption>
      </figure>

      <div className="flex flex-col sm:flex-row flex-wrap gap-3">
        <button type="button" className="mkt-cta-primary" onClick={openLive}>
          Open Instant Audit
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
