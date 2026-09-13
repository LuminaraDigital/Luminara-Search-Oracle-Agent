import React, { useEffect } from 'react';
import { ICONS } from '../constants';
import { MarketingNav } from './MarketingNav';

interface InfrastructurePageProps {
  onBack: () => void;
  onTerminal: () => void;
  onNavigateIntelligence: () => void;
  onNavigateWhy: () => void;
  onNavigatePricing: () => void;
}

const InfrastructurePage: React.FC<InfrastructurePageProps> = ({ onBack, onTerminal, onNavigateIntelligence, onNavigateWhy, onNavigatePricing }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const pillars = [
    { title: 'Google Scan Module', desc: 'This tool simulates a site crawl. It finds SEO errors that stop you from ranking high.', detail: 'The software checks your meta data, speed, and mobile readiness in seconds.' },
    { title: 'AI Visibility Check', desc: 'This module checks if tools like ChatGPT and Gemini can see your brand.', detail: 'It tests how well your content can be read and used by AI answer engines.' },
    { title: 'Source Audit', desc: 'The app sees if you are cited as a source by generative AI. It helps you become an authority.', detail: 'Our logic finds gaps in your data that keep AI from trusting your site.' },
    { title: 'Content Quality Sim', desc: 'The tool scans your text for readability and depth. It helps you create better blogs.', detail: 'It scores your content based on how likely it is to win the Featured Snippet.' },
    { title: 'Schema Mapping', desc: 'We check your code for "Schema" gaps. This helps Google understand your business.', detail: 'The audit shows exactly what code to add to help search engines find you.' },
    { title: 'Impact Scoring', desc: 'The software ranks tasks from high to low impact. You fix what matters most.', detail: 'We prioritize your to-do list so you grow your revenue as fast as possible.' },
    { title: 'Competitor Bench', desc: 'The app scans your rivals too. It shows you how to beat them in search.', detail: 'See where your competitors are winning and find the path to dominate them.' },
    { title: 'Metric Tracking', desc: 'Our dashboard shows your growth. We track ROI and conversion lifts from our audits.', detail: 'See the real dollar value of fixing your search and AI visibility.' }
  ];

  return (
    <div className="min-h-[100dvh] bg-black text-white selection:bg-gold selection:text-black font-['Outfit'] antialiased overflow-x-clip">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 right-0 w-[40%] h-[40%] bg-gold/10 blur-[150px] rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-gold-dark/5 blur-[150px] rounded-full"></div>
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.1] mix-blend-overlay"></div>
      </div>

      <MarketingNav
        brandLabel="Modules"
        onBrandClick={onBack}
        links={[
          { label: 'Return', onClick: onBack },
          { label: 'Our AI', onClick: onNavigateIntelligence },
          { label: 'Why Us', onClick: onNavigateWhy },
          { label: 'Pricing', onClick: onNavigatePricing },
        ]}
        primaryCta={{ label: 'Open app', onClick: onTerminal }}
      />

      <main className="relative z-10 pt-28 sm:pt-36 pb-20 sm:pb-32 px-4 sm:px-6 md:px-20 max-w-7xl mx-auto">
        <header className="mb-16 sm:mb-32">
          <div className="inline-block px-4 py-1 rounded-full border border-gold/20 bg-gold/5 mb-6 sm:mb-8">
            <span className="text-[8px] font-black uppercase tracking-[0.35em] sm:tracking-[0.5em] gold-text">Audit Technology</span>
          </div>
          <h1 className="text-[clamp(2rem,8vw,5.5rem)] font-light tracking-tighter leading-[1.05] mb-8 sm:mb-10 [overflow-wrap:anywhere]">
            Engineered for <br />
            <span className="gold-text animate-title-shimmer bg-size-200 font-medium tracking-tighter">Fast Audits.</span>
          </h1>
          <p className="max-w-3xl text-base sm:text-xl text-gray-400 font-light leading-relaxed">
            Luminara Search is a professional audit tool. It finds why your site is losing traffic and how to fix it using smart AI simulations.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-8">
          {pillars.map((p, idx) => (
            <div key={idx} className="group p-6 sm:p-10 glass-morphism rounded-[24px] sm:rounded-[40px] border border-white/[0.05] hover:border-gold/30 transition-all duration-700 min-w-0">
              <div className="flex justify-between items-start mb-8 sm:mb-12 gap-3">
                <div className="text-[10px] font-black text-gold/60 tracking-[0.3em]">MODULE {(idx + 1).toString().padStart(2, '0')}</div>
                <div className="w-10 h-10 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center text-gold group-hover:scale-110 group-hover:bg-gold/10 transition-all duration-500 shrink-0">
                  <ICONS.Sparkle />
                </div>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold uppercase tracking-tight mb-4 text-gray-100 group-hover:text-white transition-colors">{p.title}</h3>
              <p className="text-gray-400 text-sm font-light leading-relaxed mb-6">{p.desc}</p>
              <div className="pt-6 border-t border-white/[0.05] sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-700">
                <p className="text-[11px] text-gold font-medium leading-relaxed">{p.detail}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="mt-20 sm:mt-48 py-16 sm:py-32 border-y border-white/[0.05]">
          <div className="text-center max-w-4xl mx-auto space-y-8 sm:space-y-12">
            <h2 className="text-[clamp(1.75rem,6vw,3.75rem)] font-light [overflow-wrap:anywhere]">Automatic <span className="gold-text font-bold uppercase tracking-[0.08em]">Intelligence.</span></h2>
            <p className="text-gray-400 text-base sm:text-lg font-light leading-relaxed">
              Our software uses the Vaticinator Core to run thousands of search checks. It builds a roadmap for your growth without you needing to be a pro.
            </p>
            <div className="pt-4 sm:pt-8">
              <button 
                type="button"
                onClick={onTerminal}
                className="w-full sm:w-auto whitespace-nowrap min-h-12 px-8 sm:px-16 py-5 sm:py-6 border border-gold text-gold-light font-black uppercase tracking-[0.22em] text-[10px] rounded-2xl hover:bg-gold/10 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                Run Your First Audit
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="py-16 sm:py-24 px-4 sm:px-6 md:px-20 flex flex-col items-center gap-10 sm:gap-12 relative z-10 bg-black" style={{ paddingBottom: 'max(3.5rem, env(safe-area-inset-bottom, 0px))' }}>
        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/5 to-transparent"></div>
        <p className="text-[9px] text-gray-400 uppercase tracking-[0.35em] sm:tracking-[0.8em] text-center">&copy; 2025 Luminara Audit Tool. Software: Active.</p>
      </footer>
    </div>
  );
};

export default InfrastructurePage;