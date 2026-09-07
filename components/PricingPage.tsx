import { isInTelegram } from '../services/telegram/tma';
import { TelegramAccountPanel } from './telegram/TelegramAccountPanel';
import React, { useEffect } from 'react';
import { ICONS } from '../constants';

interface PricingPageProps {
  onBack: () => void;
  onTerminal: () => void;
  onNavigateInfrastructure: () => void;
  onNavigateIntelligence: () => void;
  onNavigateWhy: () => void;
}

const PricingPage: React.FC<PricingPageProps> = ({ onBack, onTerminal, onNavigateInfrastructure, onNavigateIntelligence, onNavigateWhy }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const features = [
    {
      title: 'Connect 1 or 2 Sites',
      desc: 'Perfect for your main store and a landing page. You can run checks on both.'
    },
    {
      title: 'Full Monthly Audits',
      desc: 'Our software checks your site speed, SEO, and AI errors every month.'
    },
    {
      title: 'AI Answer Simulations',
      desc: 'See how your brand shows up in ChatGPT and Gemini answers.'
    },
    {
      title: 'Branded Reports',
      desc: 'Get clean PDF or Google Doc reports to share with your team or developers.'
    },
    {
      title: 'Smart Task Priority',
      desc: 'The tool shows you the easiest ways to grow your sales and traffic first.'
    }
  ];

  return (
    <div className="min-h-screen bg-black text-white selection:bg-[#BF953F] selection:text-black font-['Outfit'] antialiased">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 right-1/4 w-[60%] h-[60%] bg-[#BF953F]/5 blur-[250px] rounded-full"></div>
        <div className="absolute bottom-0 left-1/4 w-[40%] h-[40%] bg-[#AA771C]/5 blur-[200px] rounded-full"></div>
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.08] mix-blend-overlay"></div>
      </div>

      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-6 backdrop-blur-md bg-black/20 border-b border-white/[0.03]">
        <div className="flex items-center gap-4 group cursor-pointer" onClick={onBack}>
          <ICONS.LuminaraLogo className="w-8 h-8" />
          <div className="flex flex-col leading-none">
            <span className="text-lg font-bold tracking-[0.4em] uppercase gold-text">APP PRICING</span>
          </div>
        </div>
        
        <div className="flex items-center gap-6 md:gap-10">
          <button onClick={onBack} className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors">Return</button>
          <button onClick={onNavigateWhy} className="hidden md:block text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors">Why Us</button>
          <button onClick={onNavigateInfrastructure} className="hidden md:block text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors">How It Works</button>
          <button 
            onClick={onTerminal}
            className="px-6 py-2.5 bg-gradient-to-br from-[#BF953F] to-[#AA771C] text-black text-[9px] font-black uppercase tracking-[0.2em] rounded-full hover:scale-105 active:scale-95 transition-all shadow-2xl"
          >
            Launch Terminal
          </button>
        </div>
      </nav>

      <main className="relative z-10 pt-44 pb-32 max-w-7xl mx-auto px-6">
        <section className="text-center mb-40">
          <div className="inline-block px-5 py-2 rounded-full border border-[#BF953F]/30 bg-[#BF953F]/5 mb-12">
            <span className="text-[10px] font-black uppercase tracking-[0.6em] gold-text">Audit Subscription</span>
          </div>
          <h1 className="text-5xl md:text-8xl font-light tracking-tighter leading-none mb-10">
            Starter Plan – AI Audits <br />
            <span className="gold-text italic animate-title-shimmer bg-size-200 font-medium not-italic tracking-tighter">For Your Growth.</span>
          </h1>
          <p className="max-w-4xl mx-auto text-xl md:text-2xl text-gray-400 font-light leading-relaxed mb-16">
            Get the professional audit tool experts use. US$49 per month for up to 2 sites. Start your free trial today.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-6">
            <button onClick={onTerminal} className="px-12 py-6 bg-[#BF953F] text-black font-black uppercase tracking-[0.4em] text-[10px] rounded-2xl hover:scale-105 transition-all shadow-xl">Start 14-Day Free Trial</button>
            <button onClick={onTerminal} className="px-12 py-6 glass-morphism border border-white/10 text-white font-black uppercase tracking-[0.4em] text-[10px] rounded-2xl hover:bg-white/5 transition-all">Try The App Free</button>
          </div>
        </section>

        <section className="mb-48 flex justify-center">
          <div className="w-full max-w-2xl p-12 glass-morphism rounded-[64px] border-[#BF953F]/30 relative shadow-3xl">
             <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-8 py-3 bg-gradient-to-br from-[#BF953F] to-[#AA771C] text-black text-[11px] font-black uppercase tracking-[0.4em] rounded-2xl shadow-xl">App Subscription</div>
             
             <div className="text-center mb-16">
                <div className="text-gray-500 uppercase tracking-[0.3em] font-black text-[10px] mb-4">Starter Software Plan</div>
                <div className="flex items-baseline justify-center gap-2">
                   <span className="text-7xl font-light">US$49</span>
                   <span className="text-gray-500 uppercase tracking-widest text-xs">/ Month</span>
                </div>
             </div>

             <div className="space-y-10">
                <div className="grid grid-cols-1 gap-8">
                  {features.map((f, i) => (
                    <div key={i} className="flex gap-6 items-start group">
                       <div className="shrink-0 w-8 h-8 rounded-lg bg-[#BF953F]/10 border border-[#BF953F]/20 flex items-center justify-center text-[#BF953F] group-hover:bg-[#BF953F] group-hover:text-black transition-all">
                          <ICONS.Check className="w-4 h-4" />
                       </div>
                       <div className="space-y-1">
                          <h4 className="text-lg font-bold tracking-tight text-white uppercase group-hover:text-[#FCF6BA] transition-colors">{f.title}</h4>
                          <p className="text-sm text-gray-500 font-light leading-relaxed">{f.desc}</p>
                       </div>
                    </div>
                  ))}
                </div>
             </div>

             <div className="mt-20">
                {isInTelegram() ? (
                  <TelegramAccountPanel />
                ) : (
                <button onClick={onTerminal} className="w-full py-8 rounded-3xl bg-white text-black font-black uppercase tracking-[0.5em] text-[11px] hover:bg-[#FCF6BA] transition-all transform hover:-translate-y-1 shadow-2xl">
                   Start My $49/month Plan
                </button>
                )}
                <p className="text-center text-gray-600 text-[10px] uppercase tracking-widest mt-6">
                  Cancel anytime. Unlimited audits for your sites.
                </p>
             </div>
          </div>
        </section>

        <section className="mb-48 border-t border-white/5 pt-32">
           <div className="text-center mb-24">
              <h2 className="text-4xl md:text-6xl font-light italic mb-8">Better <span className="gold-text font-bold uppercase not-italic tracking-wider">Software Value.</span></h2>
           </div>
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="p-10 rounded-[40px] border border-white/5 bg-white/[0.02] space-y-6">
                 <div className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-600">DIY Audit Tools</div>
                 <div className="text-3xl font-bold">$30–$50/mo</div>
                 <p className="text-gray-500 text-sm font-light leading-relaxed">Basic tools that only check old SEO. They miss AI answers and search grounding.</p>
              </div>
              <div className="p-10 rounded-[40px] border border-[#BF953F]/40 bg-[#BF953F]/5 space-y-6 scale-105 shadow-2xl z-10">
                 <div className="text-[10px] font-black uppercase tracking-[0.3em] gold-text">Luminara Audit App</div>
                 <div className="text-3xl font-bold gold-text">$49/mo</div>
                 <p className="text-gray-300 text-sm font-light leading-relaxed">The only tool that simulates Google, Perplexity, and ChatGPT in one place.</p>
              </div>
              <div className="p-10 rounded-[40px] border border-white/5 bg-white/[0.02] space-y-6">
                 <div className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-600">Hiring Consultants</div>
                 <div className="text-3xl font-bold">$1,000+/mo</div>
                 <p className="text-gray-500 text-sm font-light leading-relaxed">Expensive human help. You pay for their time, not always for your results.</p>
              </div>
           </div>
           <div className="mt-20 text-center">
              <p className="text-gray-400 text-xl font-light italic max-w-3xl mx-auto">
                "Our app acts like a top expert at a fraction of the price. Get professional audits every single month automatically."
              </p>
           </div>
        </section>
      </main>

      <footer className="py-24 px-6 md:px-20 flex flex-col items-center gap-12 relative z-10 bg-black">
        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/5 to-transparent"></div>
        <p className="text-[9px] text-gray-700 uppercase tracking-[0.8em]">&copy; 2025 Audit Software. Plan: Active.</p>
      </footer>
    </div>
  );
};

export default PricingPage;