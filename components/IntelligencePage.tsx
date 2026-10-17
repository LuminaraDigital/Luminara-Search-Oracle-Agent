import React, { useEffect } from 'react';
import { MarketingPageHeader, MarketingPageShell } from './marketing/MarketingPageShell';

interface IntelligencePageProps {
  onTerminal: () => void;
  onNavigateInfrastructure: () => void;
}

const nodes = [
  {
    title: 'Live search grounding',
    desc: 'Connects to search and scrape providers so audits can cite what is on the web now, not only model memory.',
  },
  {
    title: 'Your keys or hosted',
    desc: 'Bring Groq, NVIDIA NIM, Ollama, or OpenRouter keys, or use hosted quota on a plan. Failover follows your settings.',
  },
  {
    title: 'Structured checks',
    desc: 'Runs playbook-style checks for SEO, AEO, and GEO instead of a single free-form chat reply.',
  },
  {
    title: 'Ask, by text or voice',
    desc: 'Use Ask, by text or voice, when you want to dig into a finding without leaving the app.',
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
      brandSub="AI"
      footerStatement="Facts before advice."
      closing={{
        eyebrow: 'Your stack',
        title: (
          <>
            Use the stack <span className="italic lx-gold-text pr-[0.08em]">you already trust.</span>
          </>
        ),
        body: (
          <>
            Groq, NVIDIA NIM, Ollama, OpenRouter, Firecrawl, Tavily, and Google-oriented APIs where you connect
            them in Settings. No invented engine names. Configure providers once, then run audits and chat against
            that setup.
          </>
        ),
        cta: { label: 'Open Instant Audit', onClick: onTerminal },
        links: [{ label: 'How it works', onClick: onNavigateInfrastructure }],
      }}
    >
      <MarketingPageHeader
        eyebrow="The AI"
        title={
          <>
            AI that checks facts <span className="italic lx-gold-text pr-[0.08em]">before it advises.</span>
          </>
        }
        lede="Live search paired with the models you choose. Findings stay tied to evidence when data is available; otherwise the UI marks them as not measured."
      />

      <section aria-labelledby="ai-heading" className="mt-28 border-t pt-24 lx-hairline sm:mt-36 sm:pt-28">
        <h2 id="ai-heading" className="lx-eyebrow" data-reveal>
          What powers it
        </h2>
        <ul className="m-0 mt-12 grid list-none gap-x-12 gap-y-14 p-0 md:grid-cols-2">
          {nodes.map((node, idx) => (
            <li key={node.title} className="min-w-0" data-reveal style={{ transitionDelay: `${(idx % 2) * 90}ms` }}>
              <span aria-hidden className="font-serif text-4xl leading-none lx-gold-text">{`0${idx + 1}`}</span>
              <div aria-hidden className="mt-5 h-px w-full bg-gradient-to-r from-[var(--color-accent)]/60 to-transparent" />
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
