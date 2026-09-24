import React, { useEffect } from 'react';
import { ICONS } from '../constants';
import { MarketingNav } from './MarketingNav';
import { PremiumAtmosphere } from './ui/PremiumAtmosphere';

interface WhyLuminaraPageProps {
  onBack: () => void;
  onTerminal: () => void;
  onNavigateInfrastructure: () => void;
  onNavigateIntelligence: () => void;
  onNavigatePricing: () => void;
}

const WhyLuminaraPage: React.FC<WhyLuminaraPageProps> = ({
  onBack,
  onTerminal,
  onNavigateInfrastructure,
  onNavigateIntelligence,
  onNavigatePricing,
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const features = [
    {
      title: 'Instant audits',
      desc: 'Run a focused check on a URL and leave with a ranked list of fixes instead of waiting on a long consulting cycle.',
      benefit: 'Same day priorities you can hand to a developer.',
    },
    {
      title: 'AI answer visibility',
      desc: 'See whether ChatGPT, Perplexity and AI Overviews mention you when the data path is connected. Gaps show as not measured, not invented.',
      benefit: 'Honest AEO signal, not theatrical scores.',
    },
    {
      title: 'Competitor context',
      desc: 'Compare nearby rivals on the same checks so you know where they outrank or out-cite you.',
      benefit: 'A short map of where to push next.',
    },
    {
      title: 'Plain-English reports',
      desc: 'Findings are written for owners and operators. Share them without translating agency jargon.',
      benefit: 'Less time explaining, more time shipping fixes.',
    },
  ];

  const contrasts = [
    { label: 'Delivery', manual: 'Weeks of back-and-forth', luminara: 'Audit in the app when you need it' },
    { label: 'Evidence', manual: 'Slide decks and opinion', luminara: 'Search-grounded where keys allow' },
    { label: 'Priority', manual: 'Long unordered lists', luminara: 'Impact-ordered actions' },
    { label: 'Cost model', manual: 'Retainer or project fees', luminara: 'Subscription or BYOK usage' },
  ];

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] text-white selection:bg-gold selection:text-black font-sans antialiased overflow-x-clip">
      <PremiumAtmosphere intensity="subtle" />
      <MarketingNav
        brandLabel="Luminara Suite"
        brandSub="Why us"
        onBrandClick={onBack}
        links={[
          { label: 'Home', onClick: onBack },
          { label: 'How It Works', onClick: onNavigateInfrastructure },
          { label: 'Our AI', onClick: onNavigateIntelligence },
          { label: 'Pricing', onClick: onNavigatePricing },
        ]}
        primaryCta={{ label: 'Start check', onClick: onTerminal }}
      />

      <main className="relative z-10 pt-28 sm:pt-36 pb-20 sm:pb-32">
        <section className="px-4 sm:px-6 md:px-20 mb-16 sm:mb-24 max-w-7xl mx-auto">
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold mb-6">For operators</p>
          <h1 className="font-display text-[clamp(2rem,7vw,4.5rem)] tracking-tight leading-[1.05] mb-8 max-w-4xl [overflow-wrap:anywhere]">
            Stop guessing which search fix matters first.
          </h1>
          <p className="max-w-3xl text-base sm:text-xl text-gray-400 font-light leading-relaxed mb-10">
            Luminara Suite is built for owners who need a clear plan for Google and AI answers without buying a full agency engagement.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onTerminal}
              className="mkt-cta-primary w-full sm:w-auto"
            >
              Audit my site
            </button>
            <button
              type="button"
              onClick={onNavigatePricing}
              className="mkt-cta-secondary w-full sm:w-auto"
            >
              View pricing
            </button>
          </div>
        </section>

        <section className="px-4 sm:px-6 md:px-20 mb-20 sm:mb-28 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-start">
          <div className="space-y-6 min-w-0">
            <h2 className="font-display text-[clamp(1.75rem,5vw,3rem)] [overflow-wrap:anywhere]">
              Built for people who ship fixes.
            </h2>
            <p className="text-gray-400 text-base sm:text-lg font-light leading-relaxed">
              Solo founders and small teams use the suite to see search and AI gaps the same week they ask. You keep your own AI keys if you want; hosted quota is available on plan.
            </p>
          </div>
          <div className="border border-white/[0.08] rounded-2xl p-8 bg-black/40 text-center space-y-4">
            <ICONS.LuminaraLogo className="w-16 h-16 mx-auto" />
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold">Product stance</p>
            <p className="text-lg text-white font-light">Measure when we can. Label when we cannot.</p>
          </div>
        </section>

        <section className="px-4 sm:px-6 md:px-20 mb-20 sm:mb-28 max-w-7xl mx-auto">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-10 border-l-2 border-gold pl-5">
            What you get
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 sm:gap-10">
            {features.map((f) => (
              <div key={f.title} className="min-w-0 border-t border-white/[0.08] pt-6">
                <h3 className="text-lg font-semibold mb-3">{f.title}</h3>
                <p className="text-gray-400 text-sm font-light leading-relaxed mb-4">{f.desc}</p>
                <p className="text-[12px] text-gold tracking-wide">{f.benefit}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-4 sm:px-6 md:px-20 mb-20 sm:mb-28 max-w-7xl mx-auto">
          <h2 className="font-display text-[clamp(1.75rem,5vw,3rem)] mb-4 [overflow-wrap:anywhere]">
            Compared to a manual SEO project
          </h2>
          <p className="text-gray-400 text-base font-light mb-10 max-w-2xl">
            Qualitative differences only. We do not invent conversion rates or customer counts.
          </p>
          <div className="overflow-x-auto border border-white/10 rounded-2xl">
            <table className="w-full text-left min-w-[32rem]">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02]">
                  <th className="p-4 sm:p-6 text-[11px] font-bold uppercase tracking-[0.18em] text-gold">Dimension</th>
                  <th className="p-4 sm:p-6 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Manual project</th>
                  <th className="p-4 sm:p-6 text-[11px] font-bold uppercase tracking-[0.18em] text-white">Luminara Suite</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {contrasts.map((row) => (
                  <tr key={row.label}>
                    <td className="p-4 sm:p-6 text-sm font-semibold text-gray-200">{row.label}</td>
                    <td className="p-4 sm:p-6 text-sm text-gray-500 font-light">{row.manual}</td>
                    <td className="p-4 sm:p-6 text-sm text-gold-light">{row.luminara}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="px-4 sm:px-6 md:px-20 max-w-7xl mx-auto">
          <div className="border border-gold/25 rounded-2xl p-8 sm:p-14 max-w-3xl">
            <h2 className="font-display text-[clamp(1.75rem,5vw,3rem)] mb-6 [overflow-wrap:anywhere]">
              Start with one site audit.
            </h2>
            <p className="text-gray-400 font-light leading-relaxed mb-8">
              Create an account, connect providers if you use BYOK, and run Instant Audit on the URL that matters most.
            </p>
            <button
              type="button"
              onClick={onTerminal}
              className="mkt-cta-primary w-full sm:w-auto"
            >
              Launch app
            </button>
          </div>
        </section>
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

export default WhyLuminaraPage;
