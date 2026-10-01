import React, { useEffect } from 'react';
import { MarketingPageShell } from './marketing/MarketingPageShell';
import { MarketingSellPoints } from './marketing/MarketingSellPoints';

interface WhyLuminaraPageProps {
  onTerminal: () => void;
  onNavigatePricing: () => void;
}

const contrasts = [
  { label: 'Delivery', manual: 'Weeks of back-and-forth', luminara: 'Audit in the app when you need it' },
  { label: 'Evidence', manual: 'Slide decks and opinion', luminara: 'Search-grounded where keys allow' },
  { label: 'Priority', manual: 'Long unordered lists', luminara: 'Impact-ordered actions' },
  { label: 'Cost model', manual: 'Retainer or project fees', luminara: 'Subscription or BYOK usage' },
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
          Replace tool sprawl with one operator loop.
        </h1>
        <p className="text-lg text-[var(--color-ink-2)] leading-relaxed mb-8">
          Luminara Suite is for founders and small teams who need a clear plan for Google and AI answers
          without buying a full agency engagement or rebuilding their stack. One loop: audit, labeled
          evidence, one next action, and MCP access from the tools you already use.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button type="button" onClick={onTerminal} className="mkt-cta-primary">
            Open Instant Audit
          </button>
          <button type="button" onClick={onNavigatePricing} className="mkt-cta-secondary">
            View pricing
          </button>
        </div>
      </header>

      <MarketingSellPoints className="mb-20 sm:mb-28" />

      <section className="mb-20 sm:mb-28">
        <h2 className="font-display text-[length:var(--text-display-s)] tracking-tight mb-3 [overflow-wrap:anywhere]">
          Compared to a manual SEO project
        </h2>
        <p className="text-sm text-[var(--color-ink-2)] font-light mb-8 max-w-2xl">
          Qualitative differences only. We do not invent conversion rates or customer counts.
        </p>
        <div className="overflow-x-auto border border-[var(--color-rule)] bg-[var(--color-paper)]/70">
          <table className="w-full text-left min-w-[32rem]">
            <thead>
              <tr className="border-b border-[var(--color-rule)]">
                <th className="p-4 sm:p-5 text-[11px] font-mono text-[var(--gold-light)]">Dimension</th>
                <th className="p-4 sm:p-5 text-[11px] font-mono text-[var(--color-ink-2)]">Manual project</th>
                <th className="p-4 sm:p-5 text-[11px] font-mono text-[var(--color-ink)]">Luminara Suite</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-rule)]">
              {contrasts.map((row) => (
                <tr key={row.label}>
                  <td className="p-4 sm:p-5 text-sm text-[var(--color-ink)]">{row.label}</td>
                  <td className="p-4 sm:p-5 text-sm text-[var(--color-ink-2)] font-light">{row.manual}</td>
                  <td className="p-4 sm:p-5 text-sm text-[var(--gold-light)] font-light">{row.luminara}</td>
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
          Run Instant Audit on the URL that matters most. Sign in to save the result, or bring your own
          AI keys as a guest.
        </p>
        <button type="button" onClick={onTerminal} className="mkt-cta-primary">
          Open Instant Audit
        </button>
      </section>
    </MarketingPageShell>
  );
};

export default WhyLuminaraPage;
