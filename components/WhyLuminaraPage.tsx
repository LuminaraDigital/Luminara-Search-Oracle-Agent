import React, { useEffect } from 'react';
import { MarketingPageHeader, MarketingPageShell } from './marketing/MarketingPageShell';
import { MarketingSellPoints } from './marketing/MarketingSellPoints';

interface WhyLuminaraPageProps {
  onTerminal: () => void;
  onNavigatePricing: () => void;
}

const contrasts = [
  { label: 'Delivery', manual: 'Weeks of back-and-forth', luminara: 'Audit in the app when you need it' },
  { label: 'Evidence', manual: 'Slide decks and opinion', luminara: 'Search-grounded where keys allow' },
  { label: 'Priority', manual: 'Long unordered lists', luminara: 'Impact-ordered actions' },
  { label: 'Cost model', manual: 'Retainer or project fees', luminara: 'Subscription or your own AI keys' },
] as const;

const MANUAL_LABEL = 'Manual project';
const LUMINARA_LABEL = 'Luminara Suite';

const WhyLuminaraPage: React.FC<WhyLuminaraPageProps> = ({
  onTerminal,
  onNavigatePricing,
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <MarketingPageShell
      footerStatement="Measure when we can. Label when we cannot."
      wide
      closing={{
        eyebrow: 'Start free',
        title: (
          <>
            Start with one <span className="italic lx-gold-text pr-[0.08em]">site audit.</span>
          </>
        ),
        body: 'Run Instant Audit on the URL that matters most. Create a free account to save results and use the hosted daily allowance, or bring your own AI keys as a guest.',
        cta: { label: 'Create free account', onClick: onTerminal },
      }}
    >
      <MarketingPageHeader
        eyebrow="Why Luminara"
        title={
          <>
            Replace tool sprawl with <span className="italic lx-gold-text pr-[0.08em]">one clear plan.</span>
          </>
        }
        lede="Luminara Suite is for founders and small teams who need a clear plan for Google and AI answers without buying a full agency engagement or rebuilding their stack. Audit, labeled evidence, one next action, and optional IDE access when you grow into Growth."
      >
        <button type="button" onClick={onTerminal} className="lx-btn lx-btn-gold">
          Create free account
        </button>
        <button type="button" onClick={onNavigatePricing} className="lx-link text-sm">
          View pricing
        </button>
      </MarketingPageHeader>

      <MarketingSellPoints className="mt-16 border-t pt-16 lx-hairline" />

      <section aria-labelledby="compare-heading" className="mt-16 border-t pt-16 lx-hairline">
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">The difference</p>
          <h2 id="compare-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
            Compared to a <span className="italic lx-gold-text pr-[0.08em]">manual SEO project</span>
          </h2>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-2)]">
            Qualitative differences only. We do not invent conversion rates or customer counts.
          </p>
        </div>

        <div className="lx-glass mt-12 rounded-3xl px-6 py-2 sm:px-8" data-reveal>
          <table className="block w-full text-left md:table">
            <thead className="hidden md:table-header-group">
              <tr>
                <th scope="col" className="py-5 pr-6 text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--color-ink-2)]">
                  Dimension
                </th>
                <th scope="col" className="py-5 pr-6 text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--color-ink-2)]">
                  {MANUAL_LABEL}
                </th>
                <th scope="col" className="py-5 text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--gold-light)]">
                  {LUMINARA_LABEL}
                </th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group">
              {contrasts.map((row) => (
                <tr
                  key={row.label}
                  className="block border-t py-6 lx-hairline first:border-t-0 md:table-row md:py-0 md:first:border-t"
                >
                  <th
                    scope="row"
                    className="block font-serif text-2xl font-normal leading-tight text-[var(--color-ink)] md:table-cell md:w-[24%] md:py-6 md:pr-6 md:align-top md:text-xl"
                  >
                    {row.label}
                  </th>
                  <td className="mt-4 block text-[15px] leading-relaxed text-[var(--color-ink-2)] md:mt-0 md:table-cell md:w-[36%] md:py-6 md:pr-6 md:align-top">
                    <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] md:hidden">{MANUAL_LABEL}</span>
                    {row.manual}
                  </td>
                  <td className="mt-4 block text-[15px] leading-relaxed text-[var(--color-ink)] md:mt-0 md:table-cell md:py-6 md:align-top">
                    <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-[var(--gold-light)] md:hidden">
                      {LUMINARA_LABEL}
                    </span>
                    <span className="flex gap-3">
                      <span aria-hidden className="mt-[0.5em] h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" />
                      {row.luminara}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </MarketingPageShell>
  );
};

export default WhyLuminaraPage;
