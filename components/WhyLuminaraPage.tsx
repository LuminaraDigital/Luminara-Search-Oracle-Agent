import React, { useEffect } from 'react';
import { MarketingPageShell } from './marketing/MarketingPageShell';
import { MarketingSellPoints } from './marketing/MarketingSellPoints';

interface WhyLuminaraPageProps {
  onTerminal: () => void;
  onNavigatePricing: () => void;
}

const contrasts = [
  {
    label: 'Primary Focus',
    legacy: '10 Blue links, keyword search volume, backlink spam metrics',
    trackers: 'Scraping prompt mentions and sentiment across LLMs',
    luminara: 'Closed-loop discovery across Google, AI Overviews, ChatGPT, and Perplexity',
  },
  {
    label: 'Actionability',
    legacy: '10,000 raw keyword rows and complex data tables',
    trackers: 'Passive alerts ("You are missing from 65% of prompts")',
    luminara: 'Ordered 1-3 Fix List: Schema entity graph, 40-60 word answer units, and llms.txt',
  },
  {
    label: 'Developer Workflow',
    legacy: 'Siloed web dashboard; CSV exports',
    trackers: 'Siloed web dashboard or read-only BI connectors',
    luminara: 'Native MCP server for Cursor, Claude Code, and Windsurf to write fixes directly into code',
  },
  {
    label: 'Evidence Integrity',
    legacy: 'Proprietary vanity metrics (Domain Authority, Keyword Difficulty)',
    trackers: 'Synthetic 0-100 composite scores from small prompt samples',
    luminara: 'Evidence-bound labels: Measured, Estimated, or Not measured. Zero score theater',
  },
  {
    label: 'Pricing & Cost Model',
    legacy: '$139 to $499/mo with seat add-ons and annual commitments',
    trackers: '$99 to $500+/mo, plus $35 to $85/mo per extra engine add-on',
    luminara: 'Flat 30-day tiers ($49 Starter, $149 Growth). All core engines included, no lock-in',
  },
] as const;

const WhyLuminaraPage: React.FC<WhyLuminaraPageProps> = ({
  onTerminal,
  onNavigatePricing,
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <MarketingPageShell
      brandSub="Why"
      footerStatement="Measure when we can. Label when we cannot."
      wide
    >
      <header className="mb-14 sm:mb-20 max-w-3xl">
        <h1 className="font-display text-[length:var(--text-display)] tracking-tight leading-[1.05] mb-6 [overflow-wrap:anywhere]">
          Replace tool sprawl with one clear plan.
        </h1>
        <p className="text-lg text-[var(--color-ink-2)] leading-relaxed mb-8">
          Luminara Suite is for founders, modern engineering teams, and agencies who need to be recommended
          by Google and AI answer engines without hiring an expensive retainer or rebuilding their stack.
          Audit, labeled evidence, an actionable 1-3 fix list, and native IDE access via MCP.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button type="button" onClick={onTerminal} className="mkt-cta-primary">
            Create free account
          </button>
          <button type="button" onClick={onNavigatePricing} className="mkt-cta-secondary">
            View pricing
          </button>
        </div>
      </header>

      <MarketingSellPoints className="mb-20 sm:mb-28" />

      <section className="mb-20 sm:mb-28">
        <h2 className="font-display text-[length:var(--text-display-s)] tracking-tight mb-3 [overflow-wrap:anywhere]">
          How Luminara compares
        </h2>
        <p className="text-sm text-[var(--color-ink-2)] font-light mb-8 max-w-2xl">
          Architectural and qualitative comparison. We do not invent customer numbers or speculative ROI.
        </p>
        <div className="overflow-x-auto border border-[var(--color-rule)] bg-[var(--color-paper)]/70">
          <table className="w-full text-left min-w-[48rem]">
            <thead>
              <tr className="border-b border-[var(--color-rule)]">
                <th className="p-4 sm:p-5 text-[11px] font-mono text-[var(--gold-light)] w-1/5">Dimension</th>
                <th className="p-4 sm:p-5 text-[11px] font-mono text-[var(--color-ink-2)] w-1/4">Legacy SEO (Semrush/Ahrefs)</th>
                <th className="p-4 sm:p-5 text-[11px] font-mono text-[var(--color-ink-2)] w-1/4">Passive AI Trackers</th>
                <th className="p-4 sm:p-5 text-[11px] font-mono text-[var(--color-ink)] w-3/10">Luminara Suite</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-rule)]">
              {contrasts.map((row) => (
                <tr key={row.label}>
                  <td className="p-4 sm:p-5 text-sm font-medium text-[var(--color-ink)] align-top">{row.label}</td>
                  <td className="p-4 sm:p-5 text-sm text-[var(--color-ink-2)] font-light align-top">{row.legacy}</td>
                  <td className="p-4 sm:p-5 text-sm text-[var(--color-ink-2)] font-light align-top">{row.trackers}</td>
                  <td className="p-4 sm:p-5 text-sm text-[var(--gold-light)] font-light align-top">{row.luminara}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t border-[var(--color-rule)] pt-14 sm:pt-20 max-w-2xl">
        <h2 className="font-display text-[length:var(--text-display-s)] tracking-tight mb-4 [overflow-wrap:anywhere]">
          Start with one site audit
        </h2>
        <p className="mkt-body mb-8">
          Run Instant Audit on the URL that matters most. Create a free account to save results and use the
          hosted daily allowance, or bring your own AI keys as a guest.
        </p>
        <button type="button" onClick={onTerminal} className="mkt-cta-primary">
          Create free account
        </button>
      </section>
    </MarketingPageShell>
  );
};

export default WhyLuminaraPage;
