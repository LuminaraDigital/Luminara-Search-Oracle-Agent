import React, { useEffect } from 'react';
import { ICONS } from '../constants';

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
    <div className="min-h-screen bg-black text-white selection:bg-gold selection:text-black font-['Outfit'] antialiased">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 right-0 w-[40%] h-[40%] bg-gold/10 blur-[150px] rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-gold-dark/5 blur-[150px] rounded-full"></div>
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.1] mix-blend-overlay"></div>
      </div>

      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-6 backdrop-blur-md bg-black/20 border-b border-white/[0.03]">
        <button
          type="button"
          className="flex items-center gap-4 group cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded-lg"
          onClick={onBack}
          aria-label="Return to previous page"
        >
          <ICONS.LuminaraLogo className="w-8 h-8" />
          <div className="flex flex-col leading-none">
            <span className="text-lg font-bold tracking-[0.4em] uppercase gold-text">APP MODULES</span>
          </div>
        </button>
        
        <div className="flex items-center gap-6 md:gap-10">
          <button
            type="button"
            onClick={onBack}
            className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded"
          >
            Return
          </button>
          <button
            type="button"
            onClick={onNavigateIntelligence}
            className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded"
          >
            Our AI
          </button>
          <button
            type="button"
            onClick={onNavigateWhy}
            className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded"
          >
            Why Us
          </button>
          <button
            type="button"
            onClick={onNavigatePricing}
            className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded"
          >
            Pricing
          </button>
          <button 
            type="button"
            onClick={onTerminal}
            className="px-6 py-2.5 bg-gradient-to-br from-gold to-gold-dark text-black text-[9px] font-black uppercase tracking-[0.2em] rounded-full hover:scale-105 active:scale-95 transition-all shadow-2xl focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            Launch Terminal
          </button>
        </div>
      </nav>

      <main className="relative z-10 pt-40 pb-32 px-6 md:px-20 max-w-7xl mx-auto">
        <header className="mb-32">
          <div className="inline-block px-4 py-1 rounded-full border border-gold/20 bg-gold/5 mb-8">
            <span className="text-[8px] font-black uppercase tracking-[0.5em] gold-text">Audit Technology</span>
          </div>
          <h1 className="text-5xl md:text-8xl font-light tracking-tighter leading-none mb-10">
            Engineered for <br />
            <span className="gold-text italic animate-title-shimmer bg-size-200 font-medium not-italic tracking-tighter">Fast Audits.</span>
          </h1>
          <p className="max-w-3xl text-xl text-gray-400 font-light leading-relaxed">
            Luminara Search is a professional audit tool. It finds why your site is losing traffic and how to fix it using smart AI simulations.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {pillars.map((p, idx) => (
            <div key={idx} className="group p-10 glass-morphism rounded-[40px] border border-white/[0.05] hover:border-gold/30 transition-all duration-700 hover:-translate-y-2">
              <div className="flex justify-between items-start mb-12">
                <div className="text-[10px] font-black text-gold/60 tracking-[0.5em]">MODULE {(idx + 1).toString().padStart(2, '0')}</div>
                <div className="w-10 h-10 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center text-gold group-hover:scale-110 group-hover:bg-gold/10 transition-all duration-500">
                  <ICONS.Sparkle />
                </div>
              </div>
              <h3 className="text-2xl font-bold uppercase tracking-tight mb-4 text-gray-100 group-hover:text-white transition-colors">{p.title}</h3>
              <p className="text-gray-400 text-sm font-light leading-relaxed mb-6">{p.desc}</p>
              <div className="pt-6 border-t border-white/[0.05] opacity-0 group-hover:opacity-100 transition-opacity duration-700">
                <p className="text-[11px] text-gold font-medium leading-relaxed italic">{p.detail}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="mt-48 py-32 border-y border-white/[0.05]">
          <div className="text-center max-w-4xl mx-auto space-y-12">
            <h2 className="text-4xl md:text-6xl font-light italic">Automatic <span className="gold-text font-bold uppercase not-italic tracking-[0.1em]">Intelligence.</span></h2>
            <p className="text-gray-400 text-lg font-light leading-relaxed">
              Our software uses the Vaticinator Core to run thousands of search checks. It builds a roadmap for your growth without you needing to be a pro.
            </p>
            <div className="pt-8">
              <button 
                type="button"
                onClick={onTerminal}
                className="px-16 py-6 border border-gold text-gold-light font-black uppercase tracking-[0.4em] text-[10px] rounded-2xl hover:bg-gold/10 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                Run Your First Audit
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="py-24 px-6 md:px-20 flex flex-col items-center gap-12 relative z-10 bg-black">
        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/5 to-transparent"></div>
        <p className="text-[9px] text-gray-400 uppercase tracking-[0.8em]">&copy; 2025 Luminara Audit Tool. Software: Active.</p>
      </footer>
    </div>
  );
};

export default InfrastructurePage;