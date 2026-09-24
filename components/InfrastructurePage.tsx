import React, { useEffect } from 'react';
import { MarketingNav } from './MarketingNav';
import { PremiumAtmosphere } from './ui/PremiumAtmosphere';

interface InfrastructurePageProps {
  onBack: () => void;
  onTerminal: () => void;
  onNavigateIntelligence: () => void;
  onNavigateWhy: () => void;
  onNavigatePricing: () => void;
}

const InfrastructurePage: React.FC<InfrastructurePageProps> = ({
  onBack,
  onTerminal,
  onNavigateIntelligence,
  onNavigateWhy,
  onNavigatePricing,
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

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
  ];

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] text-white selection:bg-gold selection:text-black font-sans antialiased overflow-x-clip">
      <PremiumAtmosphere intensity="subtle" />
      <MarketingNav
        brandLabel="Luminara Suite"
        brandSub="How it works"
        onBrandClick={onBack}
        links={[
          { label: 'Home', onClick: onBack },
          { label: 'Our AI', onClick: onNavigateIntelligence },
          { label: 'Why Us', onClick: onNavigateWhy },
          { label: 'Pricing', onClick: onNavigatePricing },
        ]}
        primaryCta={{ label: 'Open app', onClick: onTerminal }}
      />

      <main className="relative z-10 pt-28 sm:pt-36 pb-20 sm:pb-32 px-4 sm:px-6 md:px-20 max-w-7xl mx-auto">
        <header className="mb-16 sm:mb-24 max-w-3xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold mb-6">Audit workflow</p>
          <h1 className="font-display text-[clamp(2rem,7vw,4.5rem)] font-normal tracking-tight leading-[1.05] mb-8 [overflow-wrap:anywhere]">
            What runs when you audit a site.
          </h1>
          <p className="text-base sm:text-xl text-gray-400 font-light leading-relaxed">
            Luminara Suite runs a fixed set of checks across search and AI answers, then returns a ranked list of fixes in plain English.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10 sm:gap-y-14">
          {pillars.map((p, idx) => (
            <div key={p.title} className="min-w-0 border-t border-white/[0.08] pt-6">
              <div className="text-[10px] font-bold text-gold/70 tracking-[0.28em] mb-3">
                {(idx + 1).toString().padStart(2, '0')}
              </div>
              <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-gray-100 mb-3">{p.title}</h2>
              <p className="text-gray-400 text-sm font-light leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </section>

        <section className="mt-20 sm:mt-28 py-14 sm:py-20 border-y border-white/[0.06]">
          <div className="max-w-3xl space-y-8">
            <h2 className="font-display text-[clamp(1.75rem,5vw,3rem)] leading-tight [overflow-wrap:anywhere]">
              From crawl to a prioritized plan.
            </h2>
            <p className="text-gray-400 text-base sm:text-lg font-light leading-relaxed">
              You enter a URL, choose a focus (SEO, AEO or GEO), and the app grounds findings in live search where credentials allow. The output is a short action list, not a 40-page PDF.
            </p>
            <button
              type="button"
              onClick={onTerminal}
              className="mkt-cta-secondary w-full sm:w-auto"
            >
              Run your first audit
            </button>
          </div>
        </section>
      </main>

      <footer
        className="py-12 px-4 sm:px-6 md:px-20 flex flex-col sm:flex-row items-center justify-between gap-6 relative z-10 border-t border-white/[0.06]"
        style={{ paddingBottom: 'max(3rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <p className="text-[10px] text-gray-500 tracking-wide text-center sm:text-left">
          &copy; {new Date().getFullYear()} Luminara Suite
        </p>
        <div className="flex flex-wrap justify-center gap-6">
          <a href="/privacy" className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-gold">Privacy</a>
          <a href="/terms" className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-gold">Terms</a>
          <a href="/docs/mcp.html" className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-gold">MCP</a>
        </div>
      </footer>
    </div>
  );
};

export default InfrastructurePage;
