import React, { useEffect } from 'react';
import { MarketingPageHeader, MarketingPageShell } from './marketing/MarketingPageShell';

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
    desc: 'A signed-in audit can order fixes by likely leverage. A guest run leaves this Not measured.',
  },
  {
    title: 'Competitor scan',
    desc: 'A signed-in audit can compare rivals you name in your business profile. A guest run leaves this Not measured.',
  },
  {
    title: 'Progress tracking',
    desc: 'A signed-in account keeps earlier audits so the next run is not starting from zero. Guests do not get a saved history.',
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
      footerStatement="From crawl to a prioritized plan."
      wide
      closing={{
        eyebrow: 'From crawl to plan',
        title: (
          <>
            Run it on <span className="italic lx-gold-text pr-[0.08em]">your own site.</span>
          </>
        ),
        body: 'Enter a URL, choose SEO, AEO, or GEO focus, and the app grounds findings in live search where credentials allow. You get a short action list, not a 40-page PDF.',
        cta: { label: 'Open Instant Audit', onClick: onTerminal },
        links: [{ label: 'How we measure', onClick: onNavigateMethodology }],
      }}
    >
      <MarketingPageHeader
        eyebrow="How it works"
        title={
          <>
            What runs when <span className="italic lx-gold-text pr-[0.08em]">you audit a site.</span>
          </>
        }
        lede="A fixed set of checks across search and AI answers, then a short list of fixes in plain English. Guest runs leave competitor scan, impact ranking, and saved progress as Not measured until you sign in."
      />

      <section
        aria-labelledby="checks-heading"
        className="mt-28 grid gap-14 border-t pt-24 lx-hairline sm:mt-36 sm:pt-28 lg:grid-cols-12 lg:gap-16"
      >
        <div className="lg:col-span-4" data-reveal>
          <div className="lg:sticky lg:top-32">
            <p className="lx-eyebrow">What it checks</p>
            <h2 id="checks-heading" className="lx-display lx-h3 mt-5">
              Same surfaces, <span className="italic lx-gold-text pr-[0.08em]">every run.</span>
            </h2>
          </div>
        </div>
        <ol className="m-0 grid list-none gap-x-10 gap-y-14 p-0 sm:grid-cols-2 lg:col-span-8">
          {pillars.map((p, idx) => (
            <li key={p.title} className="min-w-0" data-reveal style={{ transitionDelay: `${(idx % 2) * 90}ms` }}>
              <span aria-hidden className="font-serif text-4xl leading-none lx-gold-text">
                {(idx + 1).toString().padStart(2, '0')}
              </span>
              <div aria-hidden className="mt-5 h-px w-full bg-gradient-to-r from-gold/60 to-transparent" />
              <h3 className="mt-5 text-xl font-medium text-[var(--color-ink)]">{p.title}</h3>
              <p className="mt-3 leading-relaxed text-[var(--color-ink-2)]">{p.desc}</p>
            </li>
          ))}
        </ol>
      </section>
    </MarketingPageShell>
  );
};

export default InfrastructurePage;
