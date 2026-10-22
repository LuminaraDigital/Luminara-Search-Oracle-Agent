import React, { useEffect } from 'react';
import { EvidenceGlyph, MarketingPageHeader, MarketingPageShell } from './marketing/MarketingPageShell';
import { MarketingFaq } from './marketing/MarketingFaq';
import { LIVE_ANSWER_CHECKS } from '../services/marketing/engineCoverage';

interface MethodologyPageProps {
  onTerminal: () => void;
  onNavigateSample: () => void;
  onSignUp?: () => void;
  isAuthenticated?: boolean;
}

const ENUMS = [
  {
    title: 'Measured',
    body: 'Live evidence from a run. Your own keys on this device work without signing in. Hosted keys need a sign-in. Tied to the engines and prompts in that audit. Shown only when data was actually collected.',
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

  const startAudit = () => {
    if (isAuthenticated) onTerminal();
    else if (onSignUp) onSignUp();
    else onTerminal();
  };

  return (
    <MarketingPageShell
      footerStatement="Measured when we can. Labeled when we cannot."
      closing={{
        eyebrow: 'Start free',
        title: (
          <>
            See the labels on <span className="italic lx-gold-text pr-[0.08em]">your own site.</span>
          </>
        ),
        body: 'Every engine result in your audit is labeled Measured, Estimated, or Not measured.',
        cta: { label: isAuthenticated ? 'Open Instant Audit' : 'Create free account', onClick: startAudit },
        links: [{ label: 'View sample report', onClick: onNavigateSample }],
      }}
    >
      <MarketingPageHeader
        eyebrow="Methodology"
        title={
          <>
            How we measure <span className="italic lx-gold-text pr-[0.08em]">AI visibility.</span>
          </>
        }
        lede={`AI answers change by prompt, location, model, and time. Every engine result is labeled so an example never looks like a live measurement. ${LIVE_ANSWER_CHECKS}`}
      />

      <section aria-labelledby="labels-heading" className="mt-28 border-t pt-24 lx-hairline sm:mt-36 sm:pt-28">
        <h2 id="labels-heading" className="lx-eyebrow" data-reveal>
          The labels
        </h2>
        <ul className="m-0 mt-12 grid list-none gap-12 p-0 md:grid-cols-3 md:gap-10">
          {ENUMS.map((item, idx) => (
            <li key={item.title} className="min-w-0" data-reveal style={{ transitionDelay: `${idx * 90}ms` }}>
              <h3 className="flex items-center gap-4 font-serif text-3xl leading-tight text-[var(--color-ink)]">
                <EvidenceGlyph state={item.title} large />
                {item.title}
              </h3>
              <div aria-hidden className="mt-6 h-px w-full bg-gradient-to-r from-gold/60 to-transparent" />
              <p className="mt-6 leading-relaxed text-[var(--color-ink-2)]">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="sample-live-heading"
        className="mt-28 grid gap-10 border-t pt-24 lx-hairline sm:mt-36 sm:pt-28 md:grid-cols-12 md:gap-12"
      >
        <div className="md:col-span-5" data-reveal>
          <p className="lx-eyebrow">Two kinds of rows</p>
          <h2 id="sample-live-heading" className="lx-display lx-h3 mt-5">
            Sample <span className="italic lx-gold-text pr-[0.08em]">versus Live.</span>
          </h2>
        </div>
        <p className="lx-lede md:col-span-7 md:pt-12" data-reveal>
          The live crawl check on the landing page reads robots.txt and llms.txt for the domain you type, and
          keeps the four engine rows Not measured. Instant Audit measures answer engines after you create a free
          account (hosted daily allowance) or sign in. Public share previews never invent scores.
        </p>
      </section>

      <MarketingFaq embedded className="mt-28 !pt-24 sm:mt-36 sm:!pt-28" />
    </MarketingPageShell>
  );
};

export default MethodologyPage;
