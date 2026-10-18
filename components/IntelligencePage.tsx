import React, { useEffect } from 'react';
import { MarketingPageHeader, MarketingPageShell } from './marketing/MarketingPageShell';

interface IntelligencePageProps {
  onTerminal: () => void;
  onNavigateInfrastructure: () => void;
}

const nodes = [
  {
    title: 'Live search',
    desc: 'Reads the public page and a search sample, so the audit can quote what is online now.',
  },
  {
    title: 'Your models',
    desc: 'Connect a model in Settings, or use the hosted allowance on a plan. If one provider fails, the next one you saved takes over.',
  },
  {
    title: 'Three checks',
    desc: 'SEO, AEO, and GEO stay separate: search, answer engines, and AI answers. They are not mixed into one score.',
  },
  {
    title: 'A follow-up',
    desc: 'Ask a question in chat when you want to understand one finding.',
  },
] as const;

const IntelligencePage: React.FC<IntelligencePageProps> = ({
  onTerminal,
  onNavigateInfrastructure,
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <MarketingPageShell
      footerStatement="Facts before advice."
      closing={{
        eyebrow: 'Your stack',
        title: (
          <>
            Connect a model, <span className="italic lx-gold-text pr-[0.08em]">then run an audit.</span>
          </>
        ),
        body: 'Add a model in Settings, or use the hosted allowance on a plan. The report only states what that run collected. If a figure was not collected, it says Not measured.',
        cta: { label: 'Open Instant Audit', onClick: onTerminal },
        links: [{ label: 'How it works', onClick: onNavigateInfrastructure }],
      }}
    >
      <MarketingPageHeader
        eyebrow="The AI"
        title={
          <>
            The models check the page <span className="italic lx-gold-text pr-[0.08em]">before they advise.</span>
          </>
        }
        lede="An audit uses live search and the models you connect in Settings. If a number was not collected, the report says Not measured."
      />

      <section aria-labelledby="ai-heading" className="mt-16 border-t pt-16 lx-hairline">
        <h2 id="ai-heading" className="lx-eyebrow" data-reveal>
          What powers it
        </h2>
        <ul className="m-0 mt-12 grid list-none gap-x-12 gap-y-14 p-0 md:grid-cols-2">
          {nodes.map((node, idx) => (
            <li key={node.title} className="min-w-0" data-reveal style={{ transitionDelay: `${(idx % 2) * 90}ms` }}>
              <span aria-hidden className="font-serif text-4xl leading-none lx-gold-text">{`0${idx + 1}`}</span>
              <div aria-hidden className="mt-5 h-px w-full bg-gradient-to-r from-gold/60 to-transparent" />
              <h3 className="mt-5 font-serif text-3xl leading-tight text-[var(--color-ink)]">{node.title}</h3>
              <p className="mt-3 leading-relaxed text-[var(--color-ink-2)]">{node.desc}</p>
            </li>
          ))}
        </ul>
      </section>
    </MarketingPageShell>
  );
};

export default IntelligencePage;
