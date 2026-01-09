import React from 'react';
import { ICONS } from '../constants';

interface LandingPageProps {
  onEnter: () => void;
  onNavigateInfrastructure: () => void;
  onNavigateIntelligence: () => void;
  onNavigateWhy: () => void;
  onNavigatePricing: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onEnter, onNavigateInfrastructure, onNavigateIntelligence, onNavigateWhy, onNavigatePricing }) => {
  return (
    <div className="min-h-screen bg-black text-white selection:bg-[#BF953F] selection:text-black font-['Outfit'] antialiased">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/4 w-[50%] h-[50%] bg-[#BF953F]/5 blur-[180px] rounded-full animate-pulse"></div>
        <div className="absolute bottom-0 right-1/4 w-[50%] h-[50%] bg-[#AA771C]/5 blur-[180px] rounded-full animate-pulse delay-1000"></div>
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.15] mix-blend-overlay"></div>
      </div>

      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-6 backdrop-blur-md bg-black/20 border-b border-white/[0.03]">
        <div className="flex items-center gap-4 group cursor-pointer" onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}>
          <ICONS.LuminaraLogo className="w-8 h-8 group-hover:scale-110 transition-transform duration-700" />
          <div className="flex flex-col leading-none">
            <span className="text-lg font-bold tracking-[0.4em] uppercase gold-text">LUMINARA SEARCH</span>
            <span className="text-[7px] text-gray-500 tracking-[0.6em] font-black uppercase mt-1">Grow Your Brand</span>
          </div>
        </div>
        
        <div className="flex items-center gap-6 md:gap-10">
          <button onClick={onNavigateInfrastructure} className="hidden md:block text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors">How It Works</button>
          <button onClick={onNavigateIntelligence} className="hidden md:block text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors">Our AI</button>
          <button onClick={onNavigateWhy} className="hidden md:block text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors">Why Us</button>
          <button onClick={onNavigatePricing} className="hidden md:block text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors">Pricing</button>
          <button 
            onClick={onEnter}
            className="px-6 py-2.5 bg-gradient-to-br from-[#BF953F] to-[#AA771C] text-black text-[9px] font-black uppercase tracking-[0.2em] rounded-full hover:scale-105 active:scale-95 transition-all shadow-2xl"
          >
            Launch Terminal
          </button>
        </div>
      </nav>

      <section className="relative pt-60 pb-40 px-6 flex flex-col items-center text-center z-10 overflow-hidden">
        <div className="inline-block px-5 py-1.5 rounded-full border border-[#BF953F]/20 bg-[#BF953F]/5 mb-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <span className="text-[9px] font-black uppercase tracking-[0.7em] gold-text">Build Your Own Success</span>
        </div>
        
        <h1 className="text-5xl md:text-8xl lg:text-[10rem] font-light tracking-tighter leading-[0.85] mb-12 animate-in fade-in slide-in-from-bottom-6 duration-1000 delay-100">
          Search to <br />
          <span className="gold-text italic animate-title-shimmer bg-size-200 font-medium not-italic tracking-tighter">Win.</span>
        </h1>
        
        <p className="max-w-3xl text-lg md:text-2xl text-gray-400 leading-relaxed font-light mb-20 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-200 px-4">
          Luminara Digital helps you beat other brands. We offer smart AI search tools. Get the best results without paying big fees to agencies every month.
        </p>

        <div className="flex flex-col md:flex-row gap-6 animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-300">
          <button 
            onClick={() => window.open('https://luminara.digital/', '_blank')}
            className="px-12 py-6 bg-white text-black font-black uppercase tracking-[0.4em] text-[9px] rounded-xl hover:bg-[#FCF6BA] transition-all hover:-translate-y-1"
          >
            Visit Website
          </button>
          <button 
            onClick={onEnter}
            className="px-12 py-6 glass-morphism border border-[#BF953F]/30 text-[#FCF6BA] font-black uppercase tracking-[0.4em] text-[9px] rounded-xl hover:bg-[#BF953F]/10 transition-all hover:-translate-y-1"
          >
            Start Oracle AI
          </button>
        </div>
      </section>

      {/* The Death of the Retainer Section */}
      <section className="relative py-48 px-6 md:px-20 z-10 bg-black/40 border-y border-white/[0.05]">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-24">
          <div className="lg:w-1/2 space-y-12">
            <h2 className="text-4xl md:text-6xl font-light italic leading-tight">
              Stop Paying Big <br />
              <span className="gold-text font-bold uppercase not-italic tracking-wider">Monthly Fees.</span>
            </h2>
            <p className="text-gray-400 text-lg leading-relaxed font-light">
              Small businesses spend a lot on marketing. But many lose money on things that do not work. Luminara Search works like a top expert. It shows you what to fix to make more money. You do not need to pay a big agency every month.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
              <div className="space-y-2">
                <div className="text-2xl font-bold text-white">Up to 45%</div>
                <div className="text-[10px] text-[#BF953F] uppercase font-black tracking-[0.2em]">More Money Back</div>
                <div className="text-[11px] text-gray-500">Better results in just 3 months.</div>
              </div>
              <div className="space-y-2">
                <div className="text-2xl font-bold text-white">-41%</div>
                <div className="text-[10px] text-[#BF953F] uppercase font-black tracking-[0.2em]">Lower Costs</div>
                <div className="text-[11px] text-gray-500">Stop wasting money on ads that fail.</div>
              </div>
            </div>
            <button 
              onClick={onNavigateWhy}
              className="px-12 py-5 bg-[#BF953F] text-black font-black uppercase tracking-[0.4em] text-[9px] rounded-xl hover:scale-105 transition-all shadow-xl"
            >
              Learn More
            </button>
          </div>
          <div className="lg:w-1/2">
             <div className="p-12 glass-morphism rounded-[48px] border-[#BF953F]/20 relative">
                <div className="absolute -top-6 -left-6 px-6 py-2 bg-gradient-to-br from-[#BF953F] to-[#AA771C] text-black text-[9px] font-black uppercase tracking-[0.3em] rounded-xl">Your Expert AI</div>
                <div className="space-y-6">
                   <div className="flex items-center gap-4 border-b border-white/5 pb-6">
                      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-[#BF953F]"><ICONS.Search /></div>
                      <div className="space-y-1">
                         <div className="text-xs font-bold uppercase tracking-widest text-white">AI Search Audit</div>
                         <div className="text-[10px] text-gray-500 uppercase">Find Growth Fast</div>
                      </div>
                   </div>
                   <div className="space-y-4">
                      <div className="flex justify-between text-[11px] uppercase tracking-widest">
                         <span className="text-gray-500">Big Agencies</span>
                         <span className="text-red-500 font-bold">$120k / Year</span>
                      </div>
                      <div className="flex justify-between text-[11px] uppercase tracking-widest">
                         <span className="text-gray-500">Luminara AI</span>
                         <span className="gold-text font-bold">Pay Less, Get More</span>
                      </div>
                   </div>
                   <button onClick={onEnter} className="w-full py-5 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase tracking-[0.3em] text-[10px] hover:bg-white/10 transition-all">Start Now</button>
                </div>
             </div>
          </div>
        </div>
      </section>

      <section id="sectors" className="relative py-32 px-6 md:px-20 z-10">
        <div className="max-w-6xl mx-auto flex flex-col items-center text-center mb-24">
          <h2 className="text-3xl md:text-5xl font-light mb-6 tracking-tight italic">Tools for <span className="gold-text font-bold uppercase not-italic tracking-wider">Top Leaders.</span></h2>
          <div className="w-12 h-px bg-[#BF953F]/40 mb-6"></div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 max-w-7xl mx-auto">
          {[
            { name: 'Dentists', desc: 'Get More Patients' },
            { name: 'Brokers', desc: 'Find Better Leads' },
            { name: 'E-commerce', desc: 'Sell More Online' },
            { name: 'Retail', desc: 'Own the Market' },
            { name: 'Wellness', desc: 'Be the Expert' }
          ].map((sector, i) => (
            <div key={i} className="group p-8 rounded-[32px] border border-white/[0.03] bg-white/[0.01] hover:bg-white/[0.03] transition-all text-center">
              <h3 className="text-[10px] font-black gold-text uppercase tracking-[0.3em] mb-3">{sector.name}</h3>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest">{sector.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="services" className="py-48 px-6 md:px-20 relative z-10 bg-black">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-baseline justify-between mb-32 gap-12 border-b border-white/[0.05] pb-12">
            <h2 className="text-5xl md:text-7xl font-semibold tracking-tighter">How We <span className="gold-text italic">Help You.</span></h2>
            <p className="text-gray-500 text-xs font-bold uppercase tracking-[0.5em]">Modern Marketing Tools</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-16 gap-y-24">
            {[
              { title: 'SEO Growth', desc: 'Help people find your site on Google easily.' },
              { title: 'AI Answers', desc: 'Make sure AI like ChatGPT shows your brand.' },
              { title: 'Local Search', desc: 'Help nearby customers find you fast.' },
              { title: 'Smart Content', desc: 'Create videos and blogs that people love.' },
              { title: 'Social Ads', desc: 'Run ads on TikTok and Instagram that work.' },
              { title: 'Email Plans', desc: 'Send emails that turn people into buyers.' },
              { title: 'Paid Ads', desc: 'Get more sales with Google and Bing ads.' },
              { title: 'Track Success', desc: 'See how much money your site is making.' },
              { title: 'AI Tools', desc: 'Use our special AI to find new customers.' },
              { title: 'Learn AI', desc: 'We teach your team how to use AI for work.' },
              { title: 'Ready Assets', desc: 'Get plans and reports you can use right away.' },
              { title: 'AI Chatbots', desc: 'Let AI talk to your customers and sell things.' },
              { title: 'Google AI', desc: 'Use the latest Google AI to grow your shop.' }
            ].map((s, idx) => (
              <div key={idx} className="group relative">
                <div className="text-[10px] font-black text-[#BF953F]/40 mb-4 tracking-[0.4em] transition-all group-hover:text-[#BF953F]">{(idx + 1).toString().padStart(2, '0')}</div>
                <h4 className="text-xl font-bold uppercase tracking-[0.1em] mb-4 text-gray-200 group-hover:text-white transition-colors">{s.title}</h4>
                <p className="text-gray-500 text-sm leading-relaxed font-light group-hover:text-gray-400 transition-colors">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-20 text-center">
            <button 
              onClick={onNavigateInfrastructure}
              className="px-12 py-5 border border-[#BF953F]/30 text-[#FCF6BA] font-black uppercase tracking-[0.4em] text-[9px] rounded-xl hover:bg-[#BF953F]/10 transition-all"
            >
              See All Services
            </button>
          </div>
        </div>
      </section>

      <section id="workflow" className="py-48 px-6 md:px-20 relative z-10 border-t border-white/[0.05]">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-32">
          <div className="lg:w-1/2">
            <h3 className="text-5xl font-light italic mb-12">How Our <br /><span className="gold-text font-bold uppercase not-italic tracking-[0.1em]">AI Works.</span></h3>
            <p className="text-gray-400 text-lg font-light leading-relaxed mb-16">
              We use the newest AI tools to help you win. Our systems are fast and very smart.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-10 gap-x-12 mb-16">
              {[
                'Google Studios', 'Canva Pro', 'Replit', 'Make', 'n8n', 'OpenAI', 'GPT Agents', 'Google Gems'
              ].map((tool, i) => (
                <div key={i} className="flex items-center gap-4 group">
                  <span className="text-[10px] font-black text-white/20 group-hover:text-[#BF953F] transition-colors">{i+1}</span>
                  <span className="text-[11px] font-bold tracking-[0.3em] uppercase text-gray-500 group-hover:text-white transition-colors">{tool}</span>
                </div>
              ))}
            </div>
            <button 
              onClick={onNavigateIntelligence}
              className="px-12 py-5 bg-[#BF953F] text-black font-black uppercase tracking-[0.4em] text-[9px] rounded-xl hover:scale-105 transition-all"
            >
              Learn More
            </button>
          </div>
          
          <div className="lg:w-1/2 flex items-center justify-center">
             <div className="relative w-full aspect-square max-w-md group">
                <div className="absolute inset-0 bg-gradient-to-br from-[#BF953F]/20 to-transparent rounded-[64px] blur-3xl opacity-0 group-hover:opacity-40 transition-opacity duration-1000"></div>
                <div className="relative h-full glass-morphism rounded-[80px] border border-white/[0.03] flex flex-col items-center justify-center p-16 shadow-[0_40px_100px_rgba(0,0,0,0.6)]">
                   <ICONS.LuminaraLogo className="w-32 h-32 mb-12" isThinking={true} />
                   <div className="text-center space-y-4">
                     <div className="text-[9px] font-black uppercase tracking-[1em] text-[#BF953F]">AI is Running</div>
                     <p className="text-2xl font-light text-gray-400">Help You <span className="text-white">Be The Best</span></p>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </section>

      <section className="relative py-72 px-6 md:px-20 z-10 text-center overflow-hidden">
        <div className="max-w-4xl mx-auto space-y-20">
          <h2 className="text-6xl md:text-[11rem] font-light tracking-tighter leading-none italic">
            Win the <br />
            <span className="gold-text animate-title-shimmer bg-size-200 font-medium not-italic">Market.</span>
          </h2>
          <p className="text-xl md:text-3xl text-gray-500 font-light leading-relaxed px-6">
            Luminara Digital is the best choice for your brand. We help you grow fast.
          </p>
          <div className="pt-12 flex flex-col md:flex-row justify-center items-center gap-10">
            <button 
              className="px-20 py-8 bg-gradient-to-r from-[#BF953F] to-[#AA771C] text-black font-black uppercase tracking-[0.5em] text-[10px] rounded-2xl shadow-[0_60px_120px_rgba(191,149,63,0.3)] transition-all hover:scale-105"
              onClick={() => window.open('https://luminara.digital/', '_blank')}
            >
              Talk to Us
            </button>
            <div className="flex flex-col items-start text-left gap-2 border-l border-white/[0.1] pl-10">
              <span className="text-[10px] uppercase tracking-[0.4em] font-black text-[#BF953F]">Place</span>
              <span className="text-lg font-bold tracking-[0.2em] text-white uppercase">Melbourne</span>
            </div>
          </div>
        </div>
      </section>

      <footer className="py-24 px-6 md:px-20 border-t border-white/[0.05] flex flex-col items-center gap-16 relative z-10 bg-black">
        <div className="flex flex-col lg:flex-row justify-between w-full items-center gap-12">
          <div className="flex items-center gap-6">
            <ICONS.LuminaraLogo className="w-12 h-12" />
            <div className="flex flex-col">
              <span className="text-2xl font-bold tracking-[0.5em] uppercase gold-text leading-none">LUMINARA SEARCH</span>
              <span className="text-[9px] text-gray-700 uppercase tracking-widest mt-2">Grow Your Brand Today</span>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-12">
            {['Privacy', 'Terms', 'Your Growth'].map(link => (
              <a key={link} href="#" className="text-[9px] text-gray-600 uppercase tracking-widest hover:text-[#BF953F] transition-colors">{link}</a>
            ))}
          </div>
        </div>
        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/5 to-transparent"></div>
        <p className="text-[9px] text-gray-800 uppercase tracking-[0.8em]">&copy; 2025 Luminara Digital. Built to help you win.</p>
      </footer>
    </div>
  );
};

export default LandingPage;
