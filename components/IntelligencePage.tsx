import React, { useEffect } from 'react';
import { MarketingPageShell } from './marketing/MarketingPageShell';

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
    >
      <header className="mb-14 sm:mb-20 max-w-3xl">
        <h1 className="font-display text-[length:var(--text-display)] tracking-tight leading-[1.05] mb-6 [overflow-wrap:anywhere]">
          AI that checks facts before it advises
        </h1>
        <p className="text-lg text-[var(--color-ink-2)] leading-relaxed">
          Live search paired with the models you choose. Findings stay tied to evidence when data is
          available; otherwise the UI marks them as not measured.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10 mb-20">
        {nodes.map((node) => (
          <div key={node.title} className="min-w-0 border-t border-[var(--color-rule)] pt-5">
            <h2 className="text-xl font-medium text-[var(--color-ink)] mb-2">{node.title}</h2>
            <p className="mkt-body">{node.desc}</p>
          </div>
        ))}
      </section>

      <section className="border-t border-[var(--color-rule)] pt-14 sm:pt-20 max-w-2xl">
        <h2 className="font-display text-[length:var(--text-display-s)] tracking-tight mb-4 [overflow-wrap:anywhere]">
          Use the stack you already trust
        </h2>
        <p className="mkt-body mb-3">
          Groq, NVIDIA NIM, Ollama, OpenRouter, Firecrawl, Tavily, and Google-oriented APIs where you
          connect them in Settings. No invented engine names.
        </p>
        <p className="mkt-body mb-8">
          Configure providers once, then run audits and chat against that setup.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button type="button" onClick={onTerminal} className="mkt-cta-primary">
            Open Instant Audit
          </button>
          <button type="button" onClick={onNavigateInfrastructure} className="mkt-cta-secondary">
            How it works
          </button>
        </div>
      </section>
    </MarketingPageShell>
  );
};

export default IntelligencePage;
