import React, { useEffect } from 'react';
import { MarketingPageShell } from './marketing/MarketingPageShell';
import { MarketingFaq } from './marketing/MarketingFaq';

interface MethodologyPageProps {
  onTerminal: () => void;
  onNavigateSample: () => void;
  onSignUp?: () => void;
  isAuthenticated?: boolean;
}

const ENUMS = [
  {
    title: 'Measured',
    body: 'Live evidence from a run you signed in for (or paid for). Tied to the engines and prompts in that audit. Shown only when data was actually collected.',
  },
  {
    title: 'Estimated',
    body: 'Directional signal only. Useful for prioritising work. Never sold as a hard KPI or a composite visibility score.',
  },
  {
    title: 'Not measured',
    body: 'Missing data is labeled honestly. We do not invent SEO metrics, citation percentages, or AI visibility scores to fill gaps.',
  },
] as const;

const MethodologyPage: React.FC<MethodologyPageProps> = ({
  onTerminal,
  onNavigateSample,
  onSignUp,
  isAuthenticated,
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <MarketingPageShell
      brandSub="Methodology"
      footerStatement="Measured when we can. Labeled when we cannot."
    >
      <header className="mb-14 sm:mb-20 max-w-3xl">
        <h1 className="font-display text-[length:var(--text-display)] tracking-tight leading-[1.05] mb-5 [overflow-wrap:anywhere]">
          How we measure AI visibility
        </h1>
        <p className="text-lg text-[var(--color-ink-2)] leading-relaxed">
          AI answers change by prompt, location, model, and time. Every engine result is labeled so Sample
          never masquerades as Live evidence.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-8 mb-16">
        {ENUMS.map((item) => (
          <div key={item.title} className="border-t border-[var(--color-rule)] pt-4 min-w-0">
            <h2 className="text-xl text-[var(--color-ink)] font-medium mb-2">{item.title}</h2>
            <p className="mkt-body">{item.body}</p>
          </div>
        ))}
      </section>

      <section className="border-t border-[var(--color-rule)] pt-12 mb-16 max-w-2xl space-y-4">
        <h2 className="font-display text-[length:var(--text-display-s)] tracking-tight leading-tight [overflow-wrap:anywhere]">
          Sample versus Live
        </h2>
        <p className="mkt-body">
          The landing Probe shows Sample engine rows (always Not measured) and may add a Live crawl check
          for robots.txt and llms.txt. Instant Audit measures answer engines after you create a free
          account (hosted daily allowance) or sign in. Public share previews never invent scores.
        </p>
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 pt-2">
          <button type="button" className="mkt-cta-primary" onClick={onNavigateSample}>
            View sample report
          </button>
          <button
            type="button"
            className="mkt-cta-secondary"
            onClick={() => {
              if (isAuthenticated) onTerminal();
              else if (onSignUp) onSignUp();
              else onTerminal();
            }}
          >
            {isAuthenticated ? 'Open Instant Audit' : 'Create free account'}
          </button>
        </div>
      </section>

      <MarketingFaq embedded />
    </MarketingPageShell>
  );
};

export default MethodologyPage;
