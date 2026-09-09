import React, { useEffect } from 'react';
import { ICONS } from '../constants';

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
    <div className="min-h-screen bg-black text-white selection:bg-gold selection:text-black font-['Outfit'] antialiased">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-1/4 left-0 w-[60%] h-[60%] bg-gold/5 blur-[200px] rounded-full"></div>
        <div className="absolute bottom-1/4 right-0 w-[40%] h-[40%] bg-gold-dark/10 blur-[180px] rounded-full"></div>
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.12] mix-blend-overlay"></div>
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[pulse_4s_infinite]" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[pulse_6s_infinite]" />
        </div>
      </div>

      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-6 backdrop-blur-md bg-black/20 border-b border-white/[0.03]">
        <div className="flex items-center gap-4 group cursor-pointer" onClick={onBack}>
          <ICONS.LuminaraLogo className="w-8 h-8" />
          <div className="flex flex-col leading-none">
            <span className="text-lg font-bold tracking-[0.4em] uppercase gold-text">OUR AI ENGINE</span>
          </div>
        </div>
        
        <div className="flex items-center gap-6 md:gap-10">
          <button onClick={onBack} className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors">Return</button>
          <button onClick={onNavigateInfrastructure} className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors">How It Works</button>
          <button onClick={onNavigateWhy} className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors">Why Us</button>
          <button onClick={onNavigatePricing} className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors">Pricing</button>
          <button 
            onClick={onTerminal}
            className="px-6 py-2.5 bg-gradient-to-br from-gold to-gold-dark text-black text-[9px] font-black uppercase tracking-[0.2em] rounded-full hover:scale-105 active:scale-95 transition-all shadow-2xl"
          >
            Launch Terminal
          </button>
        </div>
      </nav>

      <main className="relative z-10 pt-40 pb-32 px-6 md:px-20">
        <div className="max-w-7xl mx-auto">
          <header className="mb-48 flex flex-col items-center text-center">
             <div className="inline-block px-5 py-2 rounded-full border border-gold/30 bg-gold/10 mb-12">
               <span className="text-[10px] font-black uppercase tracking-[0.8em] gold-text">App Intelligence Engine</span>
             </div>
             <h1 className="text-6xl md:text-9xl font-light tracking-tighter leading-none mb-12">
               Smart Tech. <br />
               <span className="gold-text italic animate-title-shimmer bg-size-200 font-medium not-italic tracking-tighter">Simple Insights.</span>
             </h1>
             <p className="max-w-3xl text-2xl text-gray-400 font-light leading-relaxed">
               The app uses a mix of real-time search and deep AI reasoning. It doesn't just guess; it checks the facts to help you grow.
             </p>
          </header>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-20 mb-60">
             <div className="space-y-16">
                <h2 className="text-4xl font-light italic border-b border-white/5 pb-8">AI <span className="gold-text font-bold uppercase not-italic tracking-wider">Features.</span></h2>
                <div className="space-y-12">
                  {agenticNodes.map((node, i) => (
                    <div key={i} className="group flex gap-8 p-8 rounded-[32px] hover:bg-white/[0.02] border border-transparent hover:border-white/[0.05] transition-all duration-700">
                      <div className="shrink-0 w-16 h-16 rounded-2xl glass-morphism border border-gold/20 flex items-center justify-center text-gold group-hover:scale-110 transition-transform">
                        {node.icon}
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center gap-4">
                           <h3 className="text-xl font-bold uppercase tracking-widest">{node.title}</h3>
                        </div>
                        <p className="text-[10px] text-gold font-black uppercase tracking-[0.4em]">{node.desc}</p>
                        <p className="text-gray-400 text-sm font-light leading-relaxed">{node.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
             </div>

             <div className="relative flex items-center justify-center p-12">
                <div className="absolute inset-0 bg-gold/5 blur-[120px] rounded-full" />
                <div className="relative w-full aspect-square glass-morphism rounded-[64px] border border-white/[0.03] flex flex-col items-center justify-center p-12 shadow-3xl overflow-hidden">
                   <div className="absolute inset-0 opacity-20">
                      <div className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay" />
                   </div>
                   <ICONS.LuminaraLogo className="w-64 h-64 mb-16" isThinking={true} />
                   <div className="text-center z-10">
                      <p className="text-[11px] font-black uppercase tracking-[1em] gold-text mb-4">Neural Engine: Active</p>
                      <p className="text-3xl font-light text-white tracking-tight">Vaticinator <span className="italic">AI Logic</span></p>
                   </div>
                </div>
             </div>
          </section>

          <section className="py-48 px-12 glass-morphism rounded-[80px] border border-gold/10 text-center relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
            <div className="max-w-4xl mx-auto space-y-12">
               <h2 className="text-5xl font-light tracking-tight">Software That <br /><span className="gold-text italic">Thinks for You.</span></h2>
               <p className="text-xl text-gray-400 font-light leading-relaxed">
                 Our tool performs real-time market simulations. It sees trends before they happen. Use our AI to stay ahead of the game every single day.
               </p>
               <div className="pt-8 flex flex-wrap justify-center gap-8">
                  <button 
                    onClick={onTerminal}
                    className="px-20 py-8 bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase tracking-[0.5em] text-[10px] rounded-3xl shadow-2xl hover:scale-105 transition-all"
                  >
                    Engage AI Engine
                  </button>
                  <button 
                    onClick={onNavigateInfrastructure}
                    className="px-20 py-8 glass-morphism border border-white/10 text-white font-black uppercase tracking-[0.5em] text-[10px] rounded-3xl hover:bg-white/5 transition-all"
                  >
                    View All Modules
                  </button>
               </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="py-24 px-6 md:px-20 flex flex-col items-center gap-12 relative z-10 bg-black">
        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/5 to-transparent"></div>
        <p className="text-[9px] text-gray-700 uppercase tracking-[0.8em]">&copy; 2025 AI Logic Engine. Processing: Stable.</p>
      </footer>
    </div>
  );
};

export default IntelligencePage;