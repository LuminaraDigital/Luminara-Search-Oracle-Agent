import React, { useEffect } from 'react';
import { ICONS } from '../constants';
import { MarketingNav } from './MarketingNav';

interface WhyLuminaraPageProps {
  onBack: () => void;
  onTerminal: () => void;
  onNavigateInfrastructure: () => void;
  onNavigateIntelligence: () => void;
  onNavigatePricing: () => void;
}

const WhyLuminaraPage: React.FC<WhyLuminaraPageProps> = ({ onBack, onTerminal, onNavigateInfrastructure, onNavigateIntelligence, onNavigatePricing }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const features = [
    {
      title: 'Instant AI Audits',
      desc: 'The tool checks your whole site in seconds. It finds things humans miss. It gives you a clear list of what to fix.',
      benefit: 'Get a full report in minutes, not weeks.'
    },
    {
      title: 'AI Answer Visibility',
      desc: 'The tool tests how you show up in ChatGPT. It helps you change your text so AI recommends your brand.',
      benefit: 'Win the 68% of customers who use AI to find info.'
    },
    {
      title: 'Competitor Tracking',
      desc: 'Our software scans up to 5 rivals at once. It shows you their gaps so you can take their traffic.',
      benefit: 'Be smarter than your rivals with less effort.'
    },
    {
      title: 'Plain English Reports',
      desc: 'No confusing tech words. The app explains everything simply. You can give these reports to your team to start work.',
      benefit: 'Save time on calls and long meetings.'
    }
  ];

  const metrics = [
    { metric: 'Audit Speed', baseline: '10+ Days', luminara: '5 Minutes', source: 'Software Automation' },
    { metric: 'AI Accuracy', baseline: 'Guessing', luminara: 'Data-Backed', source: 'Search Grounding' },
    { metric: 'Task Priority', baseline: 'Random', luminara: 'Impact-Based', source: 'ROI Algorithm' },
    { metric: 'Cost', baseline: '$1,000+', luminara: '$49/mo', source: 'App Subscription' }
  ];

  return (
    <div className="min-h-[100dvh] bg-black text-white selection:bg-gold selection:text-black font-['Outfit'] antialiased overflow-x-clip">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-0 w-[50%] h-[50%] bg-gold/5 blur-[200px] rounded-full"></div>
        <div className="absolute bottom-0 right-0 w-[50%] h-[50%] bg-gold-dark/5 blur-[200px] rounded-full"></div>
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.1] mix-blend-overlay"></div>
      </div>

      <MarketingNav
        brandLabel="Why Us"
        onBrandClick={onBack}
        links={[
          { label: 'Return', onClick: onBack },
          { label: 'How It Works', onClick: onNavigateInfrastructure },
          { label: 'Our AI', onClick: onNavigateIntelligence },
          { label: 'Pricing', onClick: onNavigatePricing },
        ]}
        primaryCta={{ label: 'Start check', onClick: onTerminal }}
      />

      <main className="relative z-10 pt-28 sm:pt-36 pb-20 sm:pb-32">
        <section className="px-4 sm:px-6 md:px-20 mb-20 sm:mb-40 max-w-7xl mx-auto text-center">
          <div className="inline-block px-4 py-1.5 rounded-full border border-gold/20 bg-gold/5 mb-8 sm:mb-10">
            <span className="text-[9px] font-black uppercase tracking-[0.35em] sm:tracking-[0.6em] gold-text">Better Than Manual SEO</span>
          </div>
          <h1 className="text-[clamp(2rem,8vw,5.5rem)] font-light tracking-tighter leading-[1.05] mb-8 sm:mb-10 [overflow-wrap:anywhere]">
            Stop Guessing. <br />
            <span className="gold-text animate-title-shimmer bg-size-200 font-medium tracking-tighter">Start Auditing.</span>
          </h1>
          <p className="max-w-4xl mx-auto text-base sm:text-xl md:text-2xl text-gray-400 font-light leading-relaxed mb-10 sm:mb-16">
            Luminara Search gives you a professional marketing audit in minutes. No more paying thousands for slow human reports. Our AI finds the gaps and shows you how to win.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-6">
            <button
              type="button"
              onClick={onTerminal}
              className="w-full sm:w-auto whitespace-nowrap min-h-12 px-8 sm:px-12 py-4 sm:py-6 bg-gold text-black font-black uppercase tracking-[0.22em] text-[10px] rounded-2xl hover:scale-105 transition-all shadow-xl focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              Audit My Site
            </button>
            <button
              type="button"
              onClick={onNavigatePricing}
              className="w-full sm:w-auto whitespace-nowrap min-h-12 px-8 sm:px-12 py-4 sm:py-6 glass-morphism border border-white/10 text-white font-black uppercase tracking-[0.22em] text-[10px] rounded-2xl hover:bg-white/5 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              View Pricing
            </button>
          </div>
        </section>

        <section className="px-4 sm:px-6 md:px-20 mb-24 sm:mb-48 max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
             <div className="space-y-8 sm:space-y-12 min-w-0">
               <h2 className="text-[clamp(1.75rem,6vw,3.75rem)] font-light [overflow-wrap:anywhere]">Built for <br /><span className="gold-text font-bold uppercase tracking-wider">Fast Results.</span></h2>
               <div className="space-y-6 sm:space-y-8">
                  <div className="p-6 sm:p-8 glass-morphism rounded-[24px] sm:rounded-[32px] border-white/5">
                    <p className="text-gray-300 leading-relaxed font-light text-base sm:text-lg">
                      Why wait weeks for a consultant? Our app gives you a full plan to fix your Google and AI presence right now. It saves you thousands in agency fees.
                    </p>
                  </div>
                  <p className="text-gray-400 text-base sm:text-lg font-light leading-relaxed">
                    Solo founders and small teams use our app to act like a big brand. We give you the same tools the experts use, but for a fraction of the cost.
                  </p>
               </div>
             </div>
             <div className="relative min-w-0">
                <div className="absolute inset-0 bg-gold/10 blur-[100px] rounded-full"></div>
                <div className="relative p-8 sm:p-12 glass-morphism rounded-[28px] sm:rounded-[64px] border-gold/20 text-center space-y-6 sm:space-y-8">
                  <ICONS.LuminaraLogo className="w-28 h-28 sm:w-40 sm:h-40 mx-auto" isThinking={true} />
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.35em] sm:tracking-[1em] gold-text mb-4">Software Advantage</div>
                    <p className="text-xl sm:text-2xl font-light text-white">Better Growth Data</p>
                  </div>
                </div>
             </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 md:px-20 mb-24 sm:mb-48 max-w-7xl mx-auto">
          <div className="mb-12 sm:mb-20">
             <h3 className="text-2xl sm:text-3xl font-light uppercase tracking-widest border-l-4 border-gold pl-5 sm:pl-8">Software <span className="gold-text font-black">Benefits.</span></h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-8">
            {features.map((f, i) => (
              <div key={i} className="group p-6 sm:p-10 md:p-12 glass-morphism rounded-[28px] sm:rounded-[40px] border border-white/5 hover:border-gold/30 transition-all duration-700 min-w-0">
                <div className="text-[10px] font-black gold-text uppercase tracking-[0.3em] mb-6 sm:mb-8">APP FEATURE {(i + 1).toString().padStart(2, '0')}</div>
                <h4 className="text-xl sm:text-2xl font-bold uppercase tracking-tight mb-4 group-hover:text-gold-light transition-colors">{f.title}</h4>
                <p className="text-gray-400 text-sm font-light leading-relaxed mb-6 sm:mb-8">{f.desc}</p>
                <div className="pt-6 sm:pt-8 border-t border-white/5">
                  <span className="text-[11px] text-gold font-black uppercase tracking-[0.22em]">The Software Win:</span>
                  <p className="text-white text-[13px] font-medium mt-2">{f.benefit}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="px-4 sm:px-6 md:px-20 mb-24 sm:mb-48 max-w-7xl mx-auto">
          <div className="text-center mb-12 sm:mb-24">
            <h2 className="text-[clamp(1.75rem,6vw,3.75rem)] font-light mb-6 sm:mb-8 [overflow-wrap:anywhere]">Data <span className="gold-text font-bold uppercase tracking-wider">Comparison.</span></h2>
            <p className="text-gray-400 text-base sm:text-lg font-light max-w-3xl mx-auto">
              Our app is faster and cheaper than traditional SEO audits. See for yourself.
            </p>
          </div>
          
          <div className="overflow-hidden rounded-[24px] sm:rounded-[40px] border border-white/10 glass-morphism shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[36rem]">
                <thead>
                  <tr className="bg-gold/10 border-b border-white/10">
                    <th className="p-4 sm:p-8 text-[11px] font-black uppercase tracking-[0.22em] gold-text">Metric</th>
                    <th className="p-4 sm:p-8 text-[11px] font-black uppercase tracking-[0.22em] text-gray-400">Manual Method</th>
                    <th className="p-4 sm:p-8 text-[11px] font-black uppercase tracking-[0.22em] text-white">Luminara App</th>
                    <th className="p-4 sm:p-8 text-[11px] font-black uppercase tracking-[0.22em] text-gray-400">The Winner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {metrics.map((m, i) => (
                    <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 sm:p-8 text-sm sm:text-lg font-bold uppercase tracking-tight text-gray-200">{m.metric}</td>
                      <td className="p-4 sm:p-8 text-gray-400 font-light text-sm sm:text-base">{m.baseline}</td>
                      <td className="p-4 sm:p-8 text-gold-light font-bold text-sm sm:text-base">{m.luminara}</td>
                      <td className="p-4 sm:p-8 text-gray-400 text-xs">{m.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 md:px-20 text-center max-w-7xl mx-auto">
          <div className="p-8 sm:p-16 md:p-24 glass-morphism rounded-[28px] sm:rounded-[56px] md:rounded-[80px] border border-gold/20 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-gold/40 to-transparent"></div>
            <div className="relative z-10 space-y-8 sm:space-y-12">
              <h2 className="text-[clamp(1.75rem,7vw,4.5rem)] font-light [overflow-wrap:anywhere]">Start Your First <br /><span className="gold-text font-bold uppercase tracking-wider">Software Audit.</span></h2>
              <p className="text-base sm:text-xl text-gray-400 font-light max-w-2xl mx-auto leading-relaxed">
                Join thousands of brands using our tool to stay ahead. Try it for free today.
              </p>
              <div className="pt-4 sm:pt-8">
                <button 
                  type="button"
                  onClick={onTerminal}
                  className="w-full sm:w-auto whitespace-nowrap min-h-12 px-10 sm:px-16 py-5 sm:py-8 bg-gradient-to-br from-gold to-gold-dark text-black font-black uppercase tracking-[0.22em] text-[10px] rounded-2xl sm:rounded-3xl shadow-2xl hover:scale-105 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                >
                  Launch App
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="py-16 sm:py-24 px-4 sm:px-6 md:px-20 flex flex-col items-center gap-10 sm:gap-12 relative z-10 bg-black" style={{ paddingBottom: 'max(3.5rem, env(safe-area-inset-bottom, 0px))' }}>
        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/5 to-transparent"></div>
        <p className="text-[9px] text-gray-400 uppercase tracking-[0.35em] sm:tracking-[0.8em] text-center">&copy; 2025 Audit App. Status: Optimized.</p>
      </footer>
    </div>
  );
};

export default WhyLuminaraPage;