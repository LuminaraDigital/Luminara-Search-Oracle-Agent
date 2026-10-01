import React, { useEffect } from 'react';
import { MarketingPageShell } from './marketing/MarketingPageShell';

interface InfrastructurePageProps {
  onTerminal: () => void;
  onNavigateMethodology: () => void;
}

const pillars = [
  {
    title: 'Site crawl',
    desc: 'Checks titles, meta, mobile readiness and obvious technical blockers that keep pages from ranking.',
  },
  {
    title: 'AI visibility',
    desc: 'Tests whether answer engines can find and use your brand context when people ask for services like yours.',
  },
  {
    title: 'Citation gaps',
    desc: 'Looks for missing facts, thin pages and entity clarity that stop AI tools from treating you as a source.',
  },
  {
    title: 'Content quality',
    desc: 'Scores readability and depth so you know which pages need substance before you rewrite everything.',
  },
  {
    title: 'Schema mapping',
    desc: 'Finds structured-data gaps and names the types that help search engines understand the business.',
  },
  {
    title: 'Impact ranking',
    desc: 'Orders fixes by likely leverage so you start with the work that changes visibility soonest.',
  },
  {
    title: 'Competitor scan',
    desc: 'Compares rivals on the same checks so you can see where they win and where you can take ground.',
  },
  {
    title: 'Progress tracking',
    desc: 'Keeps audits and priorities in your workspace so the next run is not starting from zero.',
  },
] as const;

const InfrastructurePage: React.FC<InfrastructurePageProps> = ({
  onTerminal,
  onNavigateMethodology,
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <MarketingPageShell
      brandSub="How"
      footerStatement="From crawl to a prioritized plan."
      wide
    >
      <header className="mb-14 sm:mb-20 max-w-3xl">
        <h1 className="font-display text-[length:var(--text-display)] tracking-tight leading-[1.05] mb-6 [overflow-wrap:anywhere]">
          What runs when you audit a site
        </h1>
        <p className="text-lg text-[var(--color-ink-2)] leading-relaxed">
          A fixed set of checks across search and AI answers, then a ranked list of fixes in plain English.
          Every run covers the same surfaces, labels its evidence, and ends in one ship action.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10 mb-20">
        {pillars.map((p, idx) => (
          <div key={p.title} className="min-w-0 border-t border-[var(--color-rule)] pt-5">
            <p className="text-[12px] font-mono text-[var(--color-accent)] mb-3">
              {(idx + 1).toString().padStart(2, '0')}
            </p>
            <h2 className="text-xl font-medium text-[var(--color-ink)] mb-2">{p.title}</h2>
            <p className="mkt-body">{p.desc}</p>
          </div>
        ))}
      </section>

      <section className="border-t border-[var(--color-rule)] pt-14 sm:pt-20 max-w-2xl">
        <h2 className="font-display text-[length:var(--text-display-s)] tracking-tight mb-4 [overflow-wrap:anywhere]">
          From crawl to a prioritized plan
        </h2>
        <p className="mkt-body mb-8">
          Enter a URL, choose SEO, AEO, or GEO focus, and the app grounds findings in live search where
          credentials allow. You get a short action list, not a 40-page PDF.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button type="button" onClick={onTerminal} className="mkt-cta-primary">
            Open Instant Audit
          </button>
          <button type="button" onClick={onNavigateMethodology} className="mkt-cta-secondary">
            How we measure
          </button>
        </div>
      </section>
    </MarketingPageShell>
  );
};

export default InfrastructurePage;
