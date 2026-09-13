import React, { useEffect } from 'react';
import { ICONS } from '../constants';
import { MarketingNav } from './MarketingNav';

interface IntelligencePageProps {
  onBack: () => void;
  onTerminal: () => void;
  onNavigateInfrastructure: () => void;
  onNavigateWhy: () => void;
  onNavigatePricing: () => void;
}

const IntelligencePage: React.FC<IntelligencePageProps> = ({ onBack, onTerminal, onNavigateInfrastructure, onNavigateWhy, onNavigatePricing }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const agenticNodes = [
    {
      title: 'Vaticinator Core',
      desc: 'The Main AI Brain',
      detail: 'This is the power behind our tool. It natively harnesses the NVIDIA NIM, Groq LPU, and Ollama Sovereign SLM trinity with instant auto-failover to reason through complex marketing problems.',
      icon: <ICONS.Sparkle />
    },
    {
      title: 'Live Search Node',
      desc: 'Real-Time Web Checks',
      detail: 'Our tool connects to Google Search in real-time. It sees what is happening on the web right now to give you fresh data.',
      icon: <ICONS.Search />
    },
    {
      title: 'Logic Processor',
      desc: 'Python Data Analysis',
      detail: 'The app writes and runs its own code to check your site metrics. It uses math and logic to verify every strategy.',
      icon: <ICONS.List />
    },
    {
      title: 'Voice Interface',
      desc: 'Talk to Your Data',
      detail: 'You can talk to the Vaticinator using our live voice core. It listens to your goals and gives expert advice back.',
      icon: <ICONS.Mic />
    }
  ];

  return (
    <div className="min-h-[100dvh] bg-black text-white selection:bg-gold selection:text-black font-['Outfit'] antialiased overflow-x-clip">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-1/4 left-0 w-[60%] h-[60%] bg-gold/5 blur-[200px] rounded-full"></div>
        <div className="absolute bottom-1/4 right-0 w-[40%] h-[40%] bg-gold-dark/10 blur-[180px] rounded-full"></div>
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.12] mix-blend-overlay"></div>
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[pulse_4s_infinite]" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[pulse_6s_infinite]" />
        </div>
      </div>

      <MarketingNav
        brandLabel="Our AI"
        onBrandClick={onBack}
        links={[
          { label: 'Return', onClick: onBack },
          { label: 'How It Works', onClick: onNavigateInfrastructure },
          { label: 'Why Us', onClick: onNavigateWhy },
          { label: 'Pricing', onClick: onNavigatePricing },
        ]}
        primaryCta={{ label: 'Open app', onClick: onTerminal }}
      />

      <main className="relative z-10 pt-28 sm:pt-36 pb-20 sm:pb-32 px-4 sm:px-6 md:px-20">
        <div className="max-w-7xl mx-auto">
          <header className="mb-20 sm:mb-40 md:mb-48 flex flex-col items-center text-center">
             <div className="inline-block px-4 sm:px-5 py-2 rounded-full border border-gold/30 bg-gold/10 mb-8 sm:mb-12">
               <span className="text-[10px] font-black uppercase tracking-[0.35em] sm:tracking-[0.8em] gold-text">App Intelligence Engine</span>
             </div>
             <h1 className="text-[clamp(2.25rem,10vw,7rem)] font-light tracking-tighter leading-[1.02] mb-8 sm:mb-12 [overflow-wrap:anywhere]">
               Smart Tech. <br />
               <span className="gold-text animate-title-shimmer bg-size-200 font-medium tracking-tighter">Simple Insights.</span>
             </h1>
             <p className="max-w-3xl text-base sm:text-xl md:text-2xl text-gray-400 font-light leading-relaxed">
               The app uses a mix of real-time search and deep AI reasoning. It doesn't just guess; it checks the facts to help you grow.
             </p>
          </header>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 mb-24 sm:mb-40 md:mb-60">
             <div className="space-y-10 sm:space-y-16 min-w-0">
                <h2 className="text-[clamp(1.75rem,5vw,2.5rem)] font-light border-b border-white/5 pb-6 sm:pb-8">AI <span className="gold-text font-bold uppercase tracking-wider">Features.</span></h2>
                <div className="space-y-6 sm:space-y-12">
                  {agenticNodes.map((node, i) => (
                    <div key={i} className="group flex flex-col sm:flex-row gap-5 sm:gap-8 p-5 sm:p-8 rounded-[24px] sm:rounded-[32px] hover:bg-white/[0.02] border border-transparent hover:border-white/[0.05] transition-all duration-700 min-w-0">
                      <div className="shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-2xl glass-morphism border border-gold/20 flex items-center justify-center text-gold group-hover:scale-110 transition-transform">
                        {node.icon}
                      </div>
                      <div className="space-y-3 min-w-0">
                        <h3 className="text-lg sm:text-xl font-bold uppercase tracking-widest">{node.title}</h3>
                        <p className="text-[10px] text-gold font-black uppercase tracking-[0.3em]">{node.desc}</p>
                        <p className="text-gray-400 text-sm font-light leading-relaxed">{node.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
             </div>

             <div className="relative flex items-center justify-center p-4 sm:p-12 min-w-0">
                <div className="absolute inset-0 bg-gold/5 blur-[120px] rounded-full" />
                <div className="relative w-full max-w-md aspect-square glass-morphism rounded-[28px] sm:rounded-[64px] border border-white/[0.03] flex flex-col items-center justify-center p-8 sm:p-12 shadow-3xl overflow-hidden">
                   <div className="absolute inset-0 opacity-20">
                      <div className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay" />
                   </div>
                   <ICONS.LuminaraLogo className="w-32 h-32 sm:w-48 sm:h-48 md:w-64 md:h-64 mb-8 sm:mb-16" isThinking={true} />
                   <div className="text-center z-10 px-2">
                      <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.35em] sm:tracking-[1em] gold-text mb-4">Neural Engine: Active</p>
                      <p className="text-xl sm:text-3xl font-light text-white tracking-tight">Vaticinator AI Logic</p>
                   </div>
                </div>
             </div>
          </section>

          <section className="py-14 sm:py-24 md:py-48 px-5 sm:px-8 md:px-12 glass-morphism rounded-[28px] sm:rounded-[56px] md:rounded-[80px] border border-gold/10 text-center relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
            <div className="max-w-4xl mx-auto space-y-8 sm:space-y-12">
               <h2 className="text-[clamp(1.75rem,7vw,3.25rem)] font-light tracking-tight [overflow-wrap:anywhere]">Software That <br /><span className="gold-text">Thinks for You.</span></h2>
               <p className="text-base sm:text-xl text-gray-400 font-light leading-relaxed">
                 Our tool performs real-time market simulations. It sees trends before they happen. Use our AI to stay ahead of the game every single day.
               </p>
                <div className="pt-4 sm:pt-8 flex flex-col sm:flex-row flex-wrap justify-center gap-3 sm:gap-6">
                  <button 
                    type="button"
                    onClick={onTerminal}
                    className="w-full sm:w-auto whitespace-nowrap min-h-12 px-8 sm:px-16 py-5 sm:py-8 bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase tracking-[0.22em] text-[10px] rounded-2xl sm:rounded-3xl shadow-2xl hover:scale-105 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    Engage AI Engine
                  </button>
                  <button 
                    type="button"
                    onClick={onNavigateInfrastructure}
                    className="w-full sm:w-auto whitespace-nowrap min-h-12 px-8 sm:px-16 py-5 sm:py-8 glass-morphism border border-white/10 text-white font-black uppercase tracking-[0.22em] text-[10px] rounded-2xl sm:rounded-3xl hover:bg-white/5 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    View All Modules
                  </button>
                </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="py-16 sm:py-24 px-4 sm:px-6 md:px-20 flex flex-col items-center gap-10 sm:gap-12 relative z-10 bg-black" style={{ paddingBottom: 'max(3.5rem, env(safe-area-inset-bottom, 0px))' }}>
        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/5 to-transparent"></div>
        <p className="text-[9px] text-gray-400 uppercase tracking-[0.35em] sm:tracking-[0.8em] text-center">&copy; 2025 AI Logic Engine. Processing: Stable.</p>
      </footer>
    </div>
  );
};

export default IntelligencePage;