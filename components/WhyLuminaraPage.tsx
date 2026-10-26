import React, { useEffect } from 'react';
import { MarketingPageHeader, MarketingPageShell } from './marketing/MarketingPageShell';
import { MarketingSellPoints } from './marketing/MarketingSellPoints';
import { MarketingCompareTable } from './marketing/MarketingCompareTable';
import { HUB_PAGES } from '../services/marketing/seoHubPages';

interface WhyLuminaraPageProps {
  onTerminal: () => void;
  onNavigatePricing: () => void;
}

const contrasts = [
  { label: 'Delivery', them: 'Weeks of back-and-forth', us: 'Audit in the app when you need it' },
  { label: 'Evidence', them: 'Slide decks and opinion', us: 'Search-grounded where keys allow' },
  { label: 'Priority', them: 'Long unordered lists', us: 'Impact-ordered actions' },
  { label: 'Cost model', them: 'Retainer or project fees', us: 'Subscription or your own AI keys' },
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
        lede="Luminara Suite is for real estate agencies that need a clear plan for Google and AI answers, without buying a full consultancy engagement or rebuilding their website."
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

        <MarketingCompareTable themLabel="Manual project" usLabel="Luminara Suite" rows={contrasts} />
      </section>

      <section aria-labelledby="hub-heading" className="mt-16 border-t pt-16 lx-hairline">
        <h2 id="hub-heading" className="lx-display lx-h3">Compared to other tools</h2>
        <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[15px] text-[var(--color-ink-2)]">
          {HUB_PAGES.map((page) => (
            <li key={page.path}>
              <a href={page.path} className="lx-link">{page.label}</a>
            </li>
          ))}
        </ul>
      </section>
    </MarketingPageShell>
  );
};

export default WhyLuminaraPage;
