import React, { useEffect } from 'react';
import { ICONS } from '../constants';
import { MarketingNav } from './MarketingNav';
import { PremiumAtmosphere } from './ui/PremiumAtmosphere';

interface IntelligencePageProps {
  onBack: () => void;
  onTerminal: () => void;
  onNavigateInfrastructure: () => void;
  onNavigateWhy: () => void;
  onNavigatePricing: () => void;
}

const IntelligencePage: React.FC<IntelligencePageProps> = ({
  onBack,
  onTerminal,
  onNavigateInfrastructure,
  onNavigateWhy,
  onNavigatePricing,
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const nodes = [
    {
      title: 'Live search grounding',
      desc: 'Connects to search and scrape providers so audits can cite what is on the web now, not only model memory.',
      icon: <ICONS.Search />,
    },
    {
      title: 'Your keys or hosted',
      desc: 'Bring Groq, NVIDIA NIM, Ollama or OpenRouter keys, or use hosted quota on a plan. Failover follows your settings.',
      icon: <ICONS.Sparkle />,
    },
    {
      title: 'Structured checks',
      desc: 'Runs playbook-style checks for SEO, AEO and GEO instead of a single free-form chat reply.',
      icon: <ICONS.List />,
    },
    {
      title: 'Voice and chat',
      desc: 'Ask follow-ups in the Oracle chat or by voice when you want to dig into a finding without leaving the app.',
      icon: <ICONS.Mic />,
    },
  ];

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] text-white selection:bg-gold selection:text-black font-sans antialiased overflow-x-clip">
      <PremiumAtmosphere intensity="subtle" />
      <MarketingNav
        brandLabel="Luminara Suite"
        brandSub="Our AI"
        onBrandClick={onBack}
        links={[
          { label: 'Home', onClick: onBack },
          { label: 'How It Works', onClick: onNavigateInfrastructure },
          { label: 'Why Us', onClick: onNavigateWhy },
          { label: 'Pricing', onClick: onNavigatePricing },
        ]}
        primaryCta={{ label: 'Open app', onClick: onTerminal }}
      />

      <main className="relative z-10 pt-28 sm:pt-36 pb-20 sm:pb-32 px-4 sm:px-6 md:px-20">
        <div className="max-w-7xl mx-auto">
          <header className="mb-16 sm:mb-24 max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold mb-6">Providers and grounding</p>
            <h1 className="font-display text-[clamp(2rem,7vw,4.5rem)] tracking-tight leading-[1.05] mb-8 [overflow-wrap:anywhere]">
              AI that checks facts before it advises.
            </h1>
            <p className="text-base sm:text-xl text-gray-400 font-light leading-relaxed">
              The suite pairs live search with the models you choose. Findings stay tied to evidence when data is available; otherwise the UI marks them as not measured.
            </p>
          </header>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 mb-20 sm:mb-28">
            <div className="space-y-10">
              {nodes.map((node) => (
                <div key={node.title} className="flex gap-5 sm:gap-6 min-w-0">
                  <div className="shrink-0 w-12 h-12 rounded-xl border border-gold/25 bg-gold/5 flex items-center justify-center text-gold">
                    {node.icon}
                  </div>
                  <div className="min-w-0 space-y-2">
                    <h2 className="text-lg font-semibold tracking-tight">{node.title}</h2>
                    <p className="text-gray-400 text-sm font-light leading-relaxed">{node.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center min-w-0">
              <div className="w-full max-w-md border border-white/[0.08] rounded-2xl p-8 sm:p-10 bg-black/40">
                <ICONS.LuminaraLogo className="w-16 h-16 mb-8" />
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold mb-3">Supported today</p>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Groq, NVIDIA NIM, Ollama, OpenRouter, Firecrawl, Tavily and Google-oriented APIs where you connect them in Settings.
                </p>
              </div>
            </div>
          </section>

          <section className="border border-white/[0.08] rounded-2xl p-8 sm:p-12 max-w-3xl">
            <h2 className="font-display text-[clamp(1.75rem,5vw,2.75rem)] mb-6 [overflow-wrap:anywhere]">
              Use the stack you already trust.
            </h2>
            <p className="text-gray-400 text-base font-light leading-relaxed mb-8">
              No invented engine names. Configure providers once, then run audits and chat against that setup.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={onTerminal}
                className="mkt-cta-primary w-full sm:w-auto"
              >
                Open the app
              </button>
              <button
                type="button"
                onClick={onNavigateInfrastructure}
                className="mkt-cta-secondary w-full sm:w-auto"
              >
                How it works
              </button>
            </div>
          </section>
        </div>
      </main>

      <footer
        className="py-12 px-4 sm:px-6 md:px-20 flex flex-col sm:flex-row items-center justify-between gap-6 border-t border-white/[0.06]"
        style={{ paddingBottom: 'max(3rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <p className="text-[10px] text-gray-500 tracking-wide">&copy; {new Date().getFullYear()} Luminara Suite</p>
        <div className="flex flex-wrap justify-center gap-6">
          <a href="/privacy" className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-gold">Privacy</a>
          <a href="/terms" className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-gold">Terms</a>
          <a href="/docs/mcp.html" className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-gold">MCP</a>
        </div>
      </footer>
    </div>
  );
};

export default IntelligencePage;
