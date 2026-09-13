import { isInTelegram } from '../services/telegram/tma';
import { TelegramAccountPanel } from './telegram/TelegramAccountPanel';
import React, { useEffect } from 'react';
import { ICONS } from '../constants';
import { openPaywallModal } from '../services/apiClient';
import { MarketingNav } from './MarketingNav';

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
    <div className="min-h-[100dvh] bg-black text-white selection:bg-gold selection:text-black font-['Outfit'] antialiased overflow-x-clip">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 right-1/4 w-[60%] h-[60%] bg-gold/5 blur-[250px] rounded-full"></div>
        <div className="absolute bottom-0 left-1/4 w-[40%] h-[40%] bg-gold-dark/5 blur-[200px] rounded-full"></div>
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.08] mix-blend-overlay"></div>
      </div>

      <MarketingNav
        brandLabel="Pricing"
        onBrandClick={onBack}
        links={[
          { label: 'Return', onClick: onBack },
          { label: 'Why Us', onClick: onNavigateWhy },
          { label: 'How It Works', onClick: onNavigateInfrastructure },
          { label: 'Our AI', onClick: onNavigateIntelligence },
        ]}
        primaryCta={{ label: 'Open app', onClick: onTerminal }}
      />

      <main className="relative z-10 pt-28 sm:pt-36 pb-20 sm:pb-32 max-w-7xl mx-auto px-4 sm:px-6">
        <section className="text-center mb-20 sm:mb-40">
          <div className="inline-block px-4 sm:px-5 py-2 rounded-full border border-gold/30 bg-gold/5 mb-8 sm:mb-12">
            <span className="text-[10px] font-black uppercase tracking-[0.35em] sm:tracking-[0.6em] gold-text">Audit Subscription</span>
          </div>
          <h1 className="text-[clamp(2rem,8vw,5.5rem)] font-light tracking-tighter leading-[1.05] mb-8 sm:mb-10 min-w-0 [overflow-wrap:anywhere]">
            Starter Plan: AI Audits <br />
            <span className="gold-text animate-title-shimmer bg-size-200 font-medium tracking-tighter">For Your Growth.</span>
          </h1>
          <p className="max-w-4xl mx-auto text-base sm:text-xl md:text-2xl text-gray-400 font-light leading-relaxed mb-10 sm:mb-16">
            Get the professional audit tool experts use. US$49 per month for up to 2 sites. Start your free trial today.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-6">
            <button type="button" onClick={onTerminal} className="w-full sm:w-auto whitespace-nowrap min-h-12 px-8 sm:px-12 py-4 sm:py-6 bg-gold text-black font-black uppercase tracking-[0.22em] text-[10px] rounded-2xl hover:scale-105 transition-all shadow-xl focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none">Start free trial</button>
            <button type="button" onClick={onTerminal} className="w-full sm:w-auto whitespace-nowrap min-h-12 px-8 sm:px-12 py-4 sm:py-6 glass-morphism border border-white/10 text-white font-black uppercase tracking-[0.22em] text-[10px] rounded-2xl hover:bg-white/5 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none">Try the app</button>
          </div>
        </section>

        <section className="mb-24 sm:mb-48 flex justify-center">
          <div className="w-full max-w-2xl p-6 sm:p-10 md:p-12 glass-morphism rounded-[28px] sm:rounded-[48px] md:rounded-[64px] border-gold/30 relative shadow-3xl">
             <div className="absolute -top-5 left-1/2 -translate-x-1/2 px-5 sm:px-8 py-2.5 sm:py-3 bg-gradient-to-br from-gold to-gold-dark text-black text-[10px] sm:text-[11px] font-black uppercase tracking-[0.22em] sm:tracking-[0.4em] rounded-2xl shadow-xl whitespace-nowrap">App Subscription</div>
             
             <div className="text-center mb-10 sm:mb-16 pt-4">
                <div className="text-gray-400 uppercase tracking-[0.22em] font-black text-[10px] mb-4">Starter Software Plan</div>
                <div className="flex items-baseline justify-center gap-2">
                   <span className="text-5xl sm:text-7xl font-light">US$49</span>
                   <span className="text-gray-400 uppercase tracking-widest text-xs">/ Month</span>
                </div>
             </div>

             <div className="space-y-10">
                <div className="grid grid-cols-1 gap-8">
                  {features.map((f, i) => (
                    <div key={i} className="flex gap-6 items-start group">
                       <div className="shrink-0 w-8 h-8 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center text-gold group-hover:bg-gold group-hover:text-black transition-all">
                          <ICONS.Check className="w-4 h-4" />
                       </div>
                       <div className="space-y-1">
                          <h4 className="text-lg font-bold tracking-tight text-white uppercase group-hover:text-gold-light transition-colors">{f.title}</h4>
                          <p className="text-sm text-gray-400 font-light leading-relaxed">{f.desc}</p>
                       </div>
                    </div>
                  ))}
                </div>
             </div>

              <div className="mt-20">
                {isInTelegram() ? (
                  <TelegramAccountPanel />
                ) : (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => openPaywallModal('Choose Telegram Stars or TON for 1-click subscription activation.')}
                      className="w-full min-h-12 py-5 sm:py-8 rounded-2xl sm:rounded-3xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase tracking-[0.22em] sm:tracking-[0.35em] text-[11px] hover:scale-[1.02] active:scale-[0.98] transition-all transform hover:-translate-y-1 shadow-2xl focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none whitespace-nowrap"
                    >
                      Subscribe: Stars or TON
                    </button>
                    <div className="pt-2">
                      <TelegramAccountPanel compact />
                    </div>
                  </div>
                )}
                <p className="text-center text-gray-400 text-[10px] uppercase tracking-widest mt-6">
                  Cancel anytime. Unlimited audits for your sites.
                </p>
              </div>
          </div>
        </section>

        <section className="mb-24 sm:mb-48 border-t border-white/5 pt-16 sm:pt-32">
           <div className="text-center mb-12 sm:mb-24">
              <h2 className="text-[clamp(1.75rem,6vw,3.75rem)] font-light mb-8 [overflow-wrap:anywhere]">Better <span className="gold-text font-bold uppercase tracking-wider">Software Value.</span></h2>
           </div>
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-8">
              <div className="p-6 sm:p-10 rounded-[24px] sm:rounded-[40px] border border-white/5 bg-white/[0.02] space-y-6">
                 <div className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400">DIY Audit Tools</div>
                 <div className="text-2xl sm:text-3xl font-bold">$30-$50/mo</div>
                 <p className="text-gray-400 text-sm font-light leading-relaxed">Basic tools that only check old SEO. They miss AI answers and search grounding.</p>
              </div>
              <div className="p-6 sm:p-10 rounded-[24px] sm:rounded-[40px] border border-gold/40 bg-gold/5 space-y-6 lg:scale-105 shadow-2xl z-10">
                 <div className="text-[10px] font-black uppercase tracking-[0.3em] gold-text">Luminara Audit App</div>
                 <div className="text-2xl sm:text-3xl font-bold gold-text">$49/mo</div>
                 <p className="text-gray-300 text-sm font-light leading-relaxed">The only tool that simulates Google, Perplexity, and ChatGPT in one place.</p>
              </div>
              <div className="p-6 sm:p-10 rounded-[24px] sm:rounded-[40px] border border-white/5 bg-white/[0.02] space-y-6">
                 <div className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400">Hiring Consultants</div>
                 <div className="text-2xl sm:text-3xl font-bold">$1,000+/mo</div>
                 <p className="text-gray-400 text-sm font-light leading-relaxed">Expensive human help. You pay for their time, not always for your results.</p>
              </div>
           </div>
           <div className="mt-12 sm:mt-20 text-center">
              <p className="text-gray-400 text-base sm:text-xl font-light max-w-3xl mx-auto">
                Our app acts like a top expert at a fraction of the price. Get professional audits every single month automatically.
              </p>
           </div>
        </section>
      </main>

      <footer className="py-16 sm:py-24 px-4 sm:px-6 md:px-20 flex flex-col items-center gap-10 sm:gap-12 relative z-10 bg-black" style={{ paddingBottom: 'max(3.5rem, env(safe-area-inset-bottom, 0px))' }}>
        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/5 to-transparent"></div>
        <p className="text-[9px] text-gray-400 uppercase tracking-[0.35em] sm:tracking-[0.8em] text-center">&copy; 2025 Audit Software. Plan: Active.</p>
      </footer>
    </div>
  );
};

export default PricingPage;