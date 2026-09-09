import React from 'react';
import { ICONS } from '../constants';
import { PremiumAtmosphere } from './ui/PremiumAtmosphere';

interface LandingPageProps {
  onEnter: () => void;
  onNavigateAudit?: () => void;
  onNavigateSuite?: () => void;
  onNavigateInfrastructure: () => void;
  onNavigateIntelligence: () => void;
  onNavigateWhy: () => void;
  onNavigatePricing: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({
  onEnter,
  onNavigateAudit,
  onNavigateSuite,
  onNavigateInfrastructure,
  onNavigateIntelligence,
  onNavigateWhy,
  onNavigatePricing,
}) => {
  return (
    <div className="min-h-screen bg-black text-white selection:bg-gold selection:text-black font-sans antialiased relative">
      <PremiumAtmosphere intensity="full" />

      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-5 backdrop-blur-xl bg-black/35 border-b border-white/[0.04]">
        <div
          className="flex items-center gap-4 group cursor-pointer"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <ICONS.LuminaraLogo className="w-9 h-9 group-hover:scale-110 transition-transform duration-700" />
          <div className="flex flex-col leading-none">
            <span className="text-lg font-bold tracking-[0.35em] uppercase gold-text">LUMINARA SUITE</span>
            <span className="text-[7px] text-gray-500 tracking-[0.55em] font-semibold uppercase mt-1.5">
              AI search visibility
            </span>
          </div>
        </div>

        <div className="flex items-center gap-5 md:gap-8">
          {onNavigateAudit && (
            <button onClick={onNavigateAudit} className="hidden lg:block text-[9px] uppercase tracking-[0.28em] font-bold text-gray-400 hover:text-gold-light transition-colors">
              Instant Audit
            </button>
          )}
          {onNavigateSuite && (
            <button onClick={onNavigateSuite} className="hidden lg:block text-[9px] uppercase tracking-[0.28em] font-bold text-gray-400 hover:text-gold-light transition-colors">
              All tools
            </button>
          )}
          <button onClick={onNavigateInfrastructure} className="hidden md:block text-[9px] uppercase tracking-[0.28em] font-bold text-gray-500 hover:text-white transition-colors">
            How It Works
          </button>
          <button onClick={onNavigateIntelligence} className="hidden md:block text-[9px] uppercase tracking-[0.28em] font-bold text-gray-500 hover:text-white transition-colors">
            Our AI
          </button>
          <button onClick={onNavigateWhy} className="hidden md:block text-[9px] uppercase tracking-[0.28em] font-bold text-gray-500 hover:text-white transition-colors">
            Why Us
          </button>
          <button onClick={onNavigatePricing} className="hidden md:block text-[9px] uppercase tracking-[0.28em] font-bold text-gray-500 hover:text-white transition-colors">
            Pricing
          </button>
          <button
            onClick={onEnter}
            className="px-6 py-2.5 bg-gradient-to-br from-gold to-gold-dark text-black text-[9px] font-black uppercase tracking-[0.2em] rounded-full hover:scale-[1.03] active:scale-95 transition-all shadow-[0_12px_40px_rgba(191,149,63,0.25)]"
          >
            Open the app
          </button>
        </div>
      </nav>

      {/* Hero: brand + one line + CTAs + product stage */}
      <section className="relative min-h-[100svh] pt-28 pb-20 px-6 flex flex-col justify-center z-10 overflow-hidden">
        <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-14 lg:gap-10 items-center">
          <div className="lg:col-span-6 text-center lg:text-left space-y-8">
            <p className="font-display text-5xl sm:text-6xl md:text-7xl text-white/95 tracking-tight leading-[0.95]">
              Luminara
            </p>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-light tracking-tight leading-[1.05] text-gray-200">
              Show up where{' '}
              <span className="gold-text animate-title-shimmer font-medium tracking-tight">customers ask.</span>
            </h1>
            <p className="max-w-xl mx-auto lg:mx-0 text-base md:text-lg text-gray-400 font-light leading-relaxed">
              See how your business appears in Google, AI Overviews, ChatGPT and Perplexity. Get a plain-English list of what to fix first.
            </p>
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3 pt-2">
              <button
                onClick={onEnter}
                className="px-9 py-4 bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase tracking-[0.28em] text-[10px] rounded-xl hover:scale-[1.03] active:scale-95 transition-all shadow-[0_20px_60px_rgba(191,149,63,0.28)]"
              >
                Open the app
              </button>
              {onNavigateAudit && (
                <button
                  onClick={onNavigateAudit}
                  className="px-9 py-4 glass-premium text-gold-light font-black uppercase tracking-[0.28em] text-[10px] rounded-xl hover:border-gold/60 transition-all"
                >
                  Audit my website
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-600 tracking-wide">
              Produced by{' '}
              <a
                href="https://luminaradigital.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gold/75 hover:text-gold transition-colors"
              >
                Luminara Digital
              </a>
            </p>
          </div>

          <div className="lg:col-span-6 relative">
            <div className="absolute -inset-8 bg-gold/10 blur-[90px] rounded-full opacity-70" />
            <div className="relative glass-premium rounded-[28px] p-5 sm:p-7 overflow-hidden">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <ICONS.LuminaraLogo className="w-8 h-8" isThinking />
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.35em] gold-text">Live audit stage</div>
                    <div className="text-[11px] text-gray-500 mt-1">What you open inside the app</div>
                  </div>
                </div>
                <span className="text-[9px] uppercase tracking-[0.25em] text-success-400/90 font-bold">Ready</span>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Google + AI Overviews', score: '72', tone: 'text-gold-light' },
                  { label: 'ChatGPT citations', score: '41', tone: 'text-warning-300' },
                  { label: 'Perplexity presence', score: '58', tone: 'text-gold' },
                ].map((row) => (
                  <div key={row.label} className="rounded-2xl border border-white/[0.06] bg-black/40 px-4 py-3.5 flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-gray-400">{row.label}</span>
                    <span className={`text-sm font-semibold tabular-nums ${row.tone}`}>{row.score}</span>
                  </div>
                ))}
              </div>
              <div className="mt-5 h-px premium-hairline" />
              <p className="mt-5 text-sm text-gray-400 font-light leading-relaxed">
                Prioritized fixes, competitor map, and schema gaps in one calm workspace. Built for owners, not agency decks.
              </p>
              {onNavigateSuite && (
                <button
                  onClick={onNavigateSuite}
                  className="mt-5 text-[10px] font-black uppercase tracking-[0.3em] text-gold/80 hover:text-gold transition-colors"
                >
                  See all tools →
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="relative py-28 md:py-40 px-6 md:px-20 z-10 border-y border-white/[0.05] bg-black/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-16 lg:gap-24">
          <div className="lg:w-1/2 space-y-10">
            <h2 className="font-display text-4xl md:text-6xl leading-[1.05] text-white">
              Clarity without the{' '}
              <span className="gold-text font-sans font-semibold uppercase tracking-wider text-3xl md:text-5xl align-middle">
                retainer tax.
              </span>
            </h2>
            <p className="text-gray-400 text-lg leading-relaxed font-light max-w-xl">
              Many owners pay heavily for marketing that never shows what to fix. Luminara Suite reads search and AI answers like an expert, then ranks the moves that matter.
            </p>
            <div className="flex flex-wrap gap-10">
              <div>
                <div className="text-3xl font-light text-white">4</div>
                <div className="text-[10px] text-gold uppercase font-black tracking-[0.22em] mt-2">Answer engines</div>
                <p className="text-[12px] text-gray-500 mt-2 max-w-[12rem]">Google, AI Overviews, ChatGPT, Perplexity.</p>
              </div>
              <div>
                <div className="text-3xl font-light text-white">BYOK</div>
                <div className="text-[10px] text-gold uppercase font-black tracking-[0.22em] mt-2">Your AI keys</div>
                <p className="text-[12px] text-gray-500 mt-2 max-w-[12rem]">Groq, NIM, Ollama. Or hosted keys behind plan.</p>
              </div>
            </div>
            <button
              onClick={onNavigateWhy}
              className="px-10 py-4 bg-gold text-black font-black uppercase tracking-[0.35em] text-[9px] rounded-xl hover:scale-[1.03] transition-all"
            >
              Why Luminara
            </button>
          </div>
          <div className="lg:w-1/2 w-full">
            <div className="glass-premium rounded-[32px] p-8 md:p-10 relative">
              <div className="absolute -top-4 left-8 px-5 py-2 bg-gradient-to-br from-gold to-gold-dark text-black text-[9px] font-black uppercase tracking-[0.28em] rounded-lg">
                Inside the app
              </div>
              <div className="flex items-center gap-4 border-b border-white/[0.06] pb-6 mt-2">
                <div className="w-12 h-12 rounded-xl bg-gold/10 border border-gold/25 flex items-center justify-center text-gold">
                  <ICONS.Search />
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-white">Instant Audit</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">Plain-English priorities</div>
                </div>
              </div>
              <div className="space-y-4 pt-6">
                <div className="flex justify-between text-[11px] uppercase tracking-widest">
                  <span className="text-gray-500">Typical agency year</span>
                  <span className="text-danger-400 font-bold">$120k+</span>
                </div>
                <div className="flex justify-between text-[11px] uppercase tracking-widest">
                  <span className="text-gray-500">Luminara Suite</span>
                  <span className="gold-text font-bold">Owner-first clarity</span>
                </div>
              </div>
              <button
                onClick={onEnter}
                className="mt-8 w-full py-4 rounded-xl border border-gold/30 bg-gold/10 text-gold-light font-black uppercase tracking-[0.3em] text-[10px] hover:bg-gold/15 transition-all"
              >
                Enter workspace
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="sectors" className="relative py-24 px-6 md:px-20 z-10">
        <div className="max-w-5xl mx-auto text-center mb-14">
          <h2 className="font-display text-3xl md:text-5xl text-white tracking-tight">
            Built for operators who lead.
          </h2>
          <div className="w-14 h-px mx-auto mt-6 bg-gold/50" />
        </div>
        <div className="max-w-5xl mx-auto flex flex-wrap justify-center gap-x-10 gap-y-6">
          {[
            { name: 'Dentists', desc: 'More patients' },
            { name: 'Brokers', desc: 'Better leads' },
            { name: 'E-commerce', desc: 'Sell more' },
            { name: 'Retail', desc: 'Own demand' },
            { name: 'Wellness', desc: 'Be cited' },
          ].map((sector) => (
            <div key={sector.name} className="text-center min-w-[7rem]">
              <div className="text-[11px] font-black gold-text uppercase tracking-[0.28em]">{sector.name}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-[0.2em] mt-2">{sector.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="services" className="relative py-28 md:py-36 px-6 md:px-20 z-10 border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16 border-b border-white/[0.06] pb-10">
            <h2 className="font-display text-4xl md:text-6xl text-white tracking-tight">
              What the suite does.
            </h2>
            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-[0.4em] md:pb-2">Product capabilities</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-12">
            {[
              { title: 'SEO growth', desc: 'Find the gaps that block rankings and fix the highest-leverage pages first.' },
              { title: 'AI answers', desc: 'See whether ChatGPT, Perplexity and AI Overviews mention you, and why not.' },
              { title: 'Local presence', desc: 'Help nearby customers discover you when they ask for services like yours.' },
              { title: 'Action brief', desc: 'Leave with a ranked list, not a 40-page PDF nobody opens.' },
              { title: 'Your keys or ours', desc: 'Bring your own AI keys, or use hosted keys with free daily quota and paid plans.' },
              { title: 'Saved workspace', desc: 'DNA, audits and settings follow your account when you sign back in.' },
            ].map((s, idx) => (
              <div key={s.title} className="group">
                <div className="text-[10px] font-black text-gold/50 mb-3 tracking-[0.35em] group-hover:text-gold transition-colors">
                  {(idx + 1).toString().padStart(2, '0')}
                </div>
                <h3 className="text-lg font-semibold tracking-wide text-gray-100 mb-2">{s.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed font-light">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-16 text-center">
            <button
              onClick={onNavigateInfrastructure}
              className="px-10 py-4 border border-gold/30 text-gold-light font-black uppercase tracking-[0.35em] text-[9px] rounded-xl hover:bg-gold/10 transition-all"
            >
              How it works
            </button>
          </div>
        </div>
      </section>

      <section id="workflow" className="relative py-28 md:py-36 px-6 md:px-20 z-10 border-t border-white/[0.05] bg-black/40">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-16 lg:gap-24 items-center">
          <div className="lg:w-1/2">
            <h3 className="font-display text-4xl md:text-5xl text-white mb-8 leading-tight">
              Calm intelligence,{' '}
              <span className="gold-text font-sans font-semibold uppercase tracking-wider text-2xl md:text-3xl">on demand.</span>
            </h3>
            <p className="text-gray-400 text-lg font-light leading-relaxed mb-12 max-w-lg">
              The app pairs live search grounding with your chosen AI engines so every audit stays factual, readable, and actionable.
            </p>
            <div className="flex flex-wrap gap-x-8 gap-y-4 mb-12">
              {['Groq', 'NVIDIA NIM', 'Ollama', 'OpenRouter', 'Firecrawl', 'Tavily'].map((tool) => (
                <span key={tool} className="text-[11px] font-bold tracking-[0.22em] uppercase text-gray-500 hover:text-gold transition-colors">
                  {tool}
                </span>
              ))}
            </div>
            <button
              onClick={onNavigateIntelligence}
              className="px-10 py-4 bg-gold text-black font-black uppercase tracking-[0.35em] text-[9px] rounded-xl hover:scale-[1.03] transition-all"
            >
              Our AI
            </button>
          </div>
          <div className="lg:w-1/2 flex justify-center w-full">
            <div className="relative w-full max-w-md aspect-square">
              <div className="absolute inset-0 bg-gold/15 blur-3xl rounded-full" />
              <div className="relative h-full glass-premium rounded-[40px] flex flex-col items-center justify-center p-12">
                <ICONS.LuminaraLogo className="w-28 h-28 mb-10" isThinking />
                <div className="text-[9px] font-black uppercase tracking-[0.55em] text-gold mb-3">Suite online</div>
                <p className="font-display text-2xl text-gray-300 text-center">Your visibility, composed.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="produced-by" className="relative py-28 md:py-36 px-6 md:px-20 z-10 border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-14 lg:gap-20 items-start">
          <div className="lg:col-span-5 space-y-7">
            <p className="text-[9px] font-black uppercase tracking-[0.5em] text-gold">Produced by</p>
            <h2 className="font-display text-4xl md:text-5xl text-white tracking-tight leading-tight">
              Luminara Digital
            </h2>
            <p className="text-gray-400 text-base md:text-lg leading-relaxed font-light">
              An Australian AI growth studio. We help businesses show up in Google and AI answers, then we built this suite so owners can run that clarity themselves.
            </p>
            <a
              href="https://luminaradigital.io"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex px-9 py-3.5 border border-gold/30 text-gold-light font-black uppercase tracking-[0.3em] text-[9px] rounded-xl hover:bg-gold/10 transition-all"
            >
              Visit luminaradigital.io
            </a>
          </div>
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-5">
            {[
              { title: 'SEO, AEO and GEO', desc: 'Visibility across classic search and AI-generated answers.' },
              { title: 'Sites and systems', desc: 'AI-ready sites, CRM, content and managed infrastructure.' },
              { title: 'Built for owners', desc: 'Plain-English priorities you can act on this week.' },
              { title: 'Australia-wide', desc: 'Melbourne operations with remote delivery nationally.' },
            ].map((item) => (
              <div key={item.title} className="p-7 rounded-2xl border border-white/[0.05] bg-white/[0.02] hover:border-gold/25 transition-colors">
                <h3 className="text-[11px] font-black uppercase tracking-[0.22em] text-white mb-3">{item.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed font-light">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative py-36 md:py-48 px-6 md:px-20 z-10 text-center overflow-hidden border-t border-white/[0.05]">
        <div className="max-w-4xl mx-auto space-y-12">
          <h2 className="font-display text-5xl md:text-8xl text-white tracking-tight leading-[0.95]">
            Win the{' '}
            <span className="gold-text animate-title-shimmer font-sans font-medium">market.</span>
          </h2>
          <p className="text-lg md:text-2xl text-gray-500 font-light leading-relaxed px-4">
            Built by Luminara Digital for business owners who want clearer search and AI visibility.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              className="px-12 py-5 bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase tracking-[0.35em] text-[10px] rounded-2xl shadow-[0_40px_100px_rgba(191,149,63,0.28)] transition-all hover:scale-[1.03]"
              onClick={onEnter}
            >
              Open the app
            </button>
            {onNavigateAudit && (
              <button
                className="px-12 py-5 glass-premium text-gold-light font-black uppercase tracking-[0.35em] text-[10px] rounded-2xl hover:border-gold/50 transition-all"
                onClick={onNavigateAudit}
              >
                Audit my website
              </button>
            )}
            <a
              href="https://luminaradigital.io"
              target="_blank"
              rel="noopener noreferrer"
              className="px-12 py-5 border border-white/10 text-gray-300 font-black uppercase tracking-[0.35em] text-[10px] rounded-2xl hover:bg-white/5 hover:text-white transition-all"
            >
              Talk to Luminara Digital
            </a>
          </div>
          <p className="text-[10px] text-gray-600 uppercase tracking-[0.3em]">
            A product of{' '}
            <a href="https://luminaradigital.io" target="_blank" rel="noopener noreferrer" className="text-gold/70 hover:text-gold tracking-[0.15em] transition-colors">
              Luminara Digital
            </a>
            <span className="text-gray-700"> · Melbourne</span>
          </p>
        </div>
      </section>

      <footer className="py-20 px-6 md:px-20 border-t border-white/[0.05] flex flex-col items-center gap-14 relative z-10 bg-black/80">
        <div className="flex flex-col lg:flex-row justify-between w-full items-center gap-10">
          <div className="flex items-center gap-5">
            <ICONS.LuminaraLogo className="w-11 h-11" />
            <div className="flex flex-col">
              <span className="text-xl font-bold tracking-[0.4em] uppercase gold-text leading-none">LUMINARA SUITE</span>
              <span className="text-[9px] text-gray-600 uppercase tracking-widest mt-2">Grow with clarity</span>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-10">
            {[
              { label: 'Privacy', href: '#privacy' },
              { label: 'Terms', href: '#terms' },
              { label: 'GitHub', href: 'https://github.com/LuminaraDigital/Luminara-Search-Oracle-Agent' },
              { label: 'Luminara Digital', href: 'https://luminaradigital.io' },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                target={link.href.startsWith('http') ? '_blank' : undefined}
                rel="noopener noreferrer"
                className="text-[9px] text-gray-600 uppercase tracking-widest hover:text-gold transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
        <div className="w-full h-px premium-hairline opacity-60" />
        <p className="text-[9px] text-gray-600 tracking-[0.12em] text-center">
          &copy; {new Date().getFullYear()} Luminara Suite. Produced by{' '}
          <a
            href="https://luminaradigital.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold/80 hover:text-gold transition-colors"
          >
            Luminara Digital
          </a>
          {' '}
          <span className="text-gray-700">(luminaradigital.io)</span>
        </p>
      </footer>
    </div>
  );
};

export default LandingPage;
