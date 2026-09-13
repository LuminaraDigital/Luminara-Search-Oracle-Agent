import React from 'react';
import { ICONS } from '../constants';
import { PremiumAtmosphere } from './ui/PremiumAtmosphere';
import { MarketingNav } from './MarketingNav';

interface LandingPageProps {
  onEnter: () => void;
  onNavigateAudit?: () => void;
  onNavigateSuite?: () => void;
  onNavigateInfrastructure: () => void;
  onNavigateIntelligence: () => void;
  onNavigateWhy: () => void;
  onNavigatePricing: () => void;
  isAuthenticated?: boolean;
  userLabel?: string | null;
  onSignInClick?: () => void;
  onSignUpClick?: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({
  onEnter,
  onNavigateAudit,
  onNavigateSuite,
  onNavigateInfrastructure,
  onNavigateIntelligence,
  onNavigateWhy,
  onNavigatePricing,
  isAuthenticated,
  userLabel,
  onSignInClick,
  onSignUpClick,
}) => {
  const navLinks = [
    ...(onNavigateAudit ? [{ label: 'Instant Audit', onClick: onNavigateAudit, desktopHidden: true as const }] : []),
    ...(onNavigateSuite ? [{ label: 'All tools', onClick: onNavigateSuite, desktopHidden: true as const }] : []),
    { label: 'How It Works', onClick: onNavigateInfrastructure },
    { label: 'Our AI', onClick: onNavigateIntelligence },
    { label: 'Why Us', onClick: onNavigateWhy },
    { label: 'Pricing', onClick: onNavigatePricing },
  ];

  return (
    <div className="min-h-[100dvh] bg-black text-white selection:bg-gold selection:text-black font-sans antialiased relative overflow-x-clip">
      <PremiumAtmosphere intensity="full" />

      <MarketingNav
        brandLabel="Luminara Suite"
        brandSub="AI search visibility"
        onBrandClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        links={navLinks}
        secondaryCta={
          !isAuthenticated
            ? { label: 'Sign in', onClick: onSignInClick || onEnter }
            : undefined
        }
        primaryCta={{
          label: isAuthenticated ? 'Open app' : 'Get Started',
          onClick: isAuthenticated ? onEnter : onSignUpClick || onEnter,
        }}
        trailing={
          isAuthenticated && userLabel ? (
            <span className="hidden lg:inline-block text-[10px] text-gold/80 font-mono max-w-[140px] truncate">
              {userLabel}
            </span>
          ) : null
        }
      />

      {/* Hero: brand + one line + CTAs + product stage */}
      <section className="relative min-h-[100svh] pt-24 sm:pt-28 pb-16 sm:pb-20 px-4 sm:px-6 flex flex-col justify-center z-10 overflow-x-clip">
        <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-10 items-center">
          <div className="lg:col-span-6 text-center lg:text-left space-y-6 sm:space-y-8 min-w-0">
            <p className="font-display text-[clamp(2.5rem,10vw,4.5rem)] text-white/95 tracking-tight leading-[0.95] min-w-0 [overflow-wrap:anywhere]">
              Luminara
            </p>
            <h1 className="text-[clamp(1.5rem,5.5vw,3rem)] font-light tracking-tight leading-[1.1] text-gray-200 min-w-0 [overflow-wrap:anywhere]">
              Show up where{' '}
              <span className="gold-text animate-title-shimmer font-medium tracking-tight">customers ask.</span>
            </h1>
            <p className="max-w-xl mx-auto lg:mx-0 text-sm sm:text-base md:text-lg text-gray-400 font-light leading-relaxed">
              See how your business appears in Google, AI Overviews, ChatGPT and Perplexity. Get a plain-English list of what to fix first.
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-center lg:justify-start gap-3 pt-1 w-full">
              <button
                type="button"
                onClick={onEnter}
                className="w-full sm:w-auto whitespace-nowrap min-h-12 px-6 sm:px-9 py-3.5 sm:py-4 bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase tracking-[0.2em] sm:tracking-[0.28em] text-[10px] rounded-xl hover:scale-[1.03] active:scale-95 transition-all shadow-[0_20px_60px_rgba(191,149,63,0.28)] focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                {isAuthenticated ? 'Open the app' : 'Get Started'}
              </button>
              {onNavigateAudit && (
                <button
                  type="button"
                  onClick={onNavigateAudit}
                  className="w-full sm:w-auto whitespace-nowrap min-h-12 px-6 sm:px-9 py-3.5 sm:py-4 glass-premium text-gold-light font-black uppercase tracking-[0.2em] sm:tracking-[0.28em] text-[10px] rounded-xl hover:border-gold/60 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                >
                  Audit my site
                </button>
              )}
              <a
                href="/desktop"
                className="w-full sm:w-auto whitespace-nowrap min-h-12 inline-flex items-center justify-center px-6 sm:px-9 py-3.5 sm:py-4 border border-gold/35 text-gold-light font-black uppercase tracking-[0.2em] sm:tracking-[0.28em] text-[10px] rounded-xl hover:border-gold/70 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                title="Download the Windows desktop installer"
              >
                Windows app
              </a>
            </div>
            {!isAuthenticated && (
              <p className="text-[10px] text-gray-400 tracking-wider uppercase font-medium">
                Account required for live audits and saved Business DNA
              </p>
            )}
            <p className="text-[11px] text-gray-400 tracking-wide">
              Produced by{' '}
              <a
                href="https://luminaradigital.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gold/75 hover:text-gold transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded"
              >
                Luminara Digital
              </a>
            </p>
          </div>

          <div className="lg:col-span-6 relative min-w-0">
            <div className="absolute -inset-4 sm:-inset-8 bg-gold/10 blur-[90px] rounded-full opacity-70" />
            <div className="relative glass-premium rounded-2xl sm:rounded-[28px] p-4 sm:p-7 overflow-hidden">
              <div className="flex items-center justify-between gap-3 mb-5 sm:mb-6 min-w-0">
                <div className="flex items-center gap-3 min-w-0">
                  <ICONS.LuminaraLogo className="w-8 h-8 shrink-0" isThinking />
                  <div className="min-w-0">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] sm:tracking-[0.35em] gold-text truncate">Live audit stage</div>
                    <div className="text-[11px] text-gray-400 mt-1">What you open inside the app</div>
                  </div>
                </div>
                <span className="text-[9px] uppercase tracking-[0.2em] text-success-400/90 font-bold shrink-0">Ready</span>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Google + AI Overviews', score: '72', tone: 'text-gold-light' },
                  { label: 'ChatGPT citations', score: '41', tone: 'text-warning-300' },
                  { label: 'Perplexity presence', score: '58', tone: 'text-gold' },
                ].map((row) => (
                  <div key={row.label} className="rounded-2xl border border-white/[0.06] bg-black/40 px-3.5 sm:px-4 py-3 sm:py-3.5 flex items-center justify-between gap-3 min-w-0">
                    <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-gray-400 truncate">{row.label}</span>
                    <span className={`text-sm font-semibold tabular-nums shrink-0 ${row.tone}`}>{row.score}</span>
                  </div>
                ))}
              </div>
              <div className="mt-5 h-px premium-hairline" />
              <p className="mt-5 text-sm text-gray-400 font-light leading-relaxed">
                Prioritized fixes, competitor map, and schema gaps in one calm workspace. Built for owners, not agency decks.
              </p>
              {onNavigateSuite && (
                <button
                  type="button"
                  onClick={onNavigateSuite}
                  className="mt-5 text-[10px] font-black uppercase tracking-[0.25em] text-gold/80 hover:text-gold transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded whitespace-nowrap"
                >
                  See all tools →
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="relative py-20 sm:py-28 md:py-40 px-4 sm:px-6 md:px-20 z-10 border-y border-white/[0.05] bg-black/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-12 lg:gap-24">
          <div className="lg:w-1/2 space-y-8 sm:space-y-10 min-w-0 w-full">
            <h2 className="font-display text-[clamp(1.75rem,6vw,3.75rem)] leading-[1.1] text-white min-w-0 [overflow-wrap:anywhere]">
              Clarity without the{' '}
              <span className="gold-text font-sans font-semibold uppercase tracking-wider text-[0.7em] align-middle">
                retainer tax.
              </span>
            </h2>
            <p className="text-gray-400 text-base sm:text-lg leading-relaxed font-light max-w-xl">
              Many owners pay heavily for marketing that never shows what to fix. Luminara Suite reads search and AI answers like an expert, then ranks the moves that matter.
            </p>
            <div className="flex flex-wrap gap-8 sm:gap-10">
              <div>
                <div className="text-3xl font-light text-white">4</div>
                <div className="text-[10px] text-gold uppercase font-black tracking-[0.22em] mt-2">Answer engines</div>
                <p className="text-[12px] text-gray-400 mt-2 max-w-[12rem]">Google, AI Overviews, ChatGPT, Perplexity.</p>
              </div>
              <div>
                <div className="text-3xl font-light text-white">BYOK</div>
                <div className="text-[10px] text-gold uppercase font-black tracking-[0.22em] mt-2">Your AI keys</div>
                <p className="text-[12px] text-gray-400 mt-2 max-w-[12rem]">Groq, NIM, Ollama. Or hosted keys behind plan.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onNavigateWhy}
              className="w-full sm:w-auto whitespace-nowrap min-h-12 px-8 sm:px-10 py-4 bg-gold text-black font-black uppercase tracking-[0.25em] text-[9px] rounded-xl hover:scale-[1.03] transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              Why Luminara
            </button>
          </div>
          <div className="lg:w-1/2 w-full min-w-0">
            <div className="glass-premium rounded-[24px] sm:rounded-[32px] p-6 sm:p-8 md:p-10 relative">
              <div className="absolute -top-4 left-6 sm:left-8 px-4 sm:px-5 py-2 bg-gradient-to-br from-gold to-gold-dark text-black text-[9px] font-black uppercase tracking-[0.2em] rounded-lg whitespace-nowrap">
                Inside the app
              </div>
              <div className="flex items-center gap-4 border-b border-white/[0.06] pb-6 mt-2 min-w-0">
                <div className="w-12 h-12 rounded-xl bg-gold/10 border border-gold/25 flex items-center justify-center text-gold shrink-0">
                  <ICONS.Search />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-white">Instant Audit</div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-widest mt-1">Plain-English priorities</div>
                </div>
              </div>
              <div className="space-y-4 pt-6">
                <div className="flex justify-between gap-3 text-[11px] uppercase tracking-widest">
                  <span className="text-gray-400">Typical agency year</span>
                  <span className="text-danger-400 font-bold shrink-0">$120k+</span>
                </div>
                <div className="flex justify-between gap-3 text-[11px] uppercase tracking-widest">
                  <span className="text-gray-400">Luminara Suite</span>
                  <span className="gold-text font-bold shrink-0">Owner-first clarity</span>
                </div>
              </div>
              <button
                type="button"
                onClick={onEnter}
                className="mt-8 w-full min-h-12 py-4 rounded-xl border border-gold/30 bg-gold/10 text-gold-light font-black uppercase tracking-[0.22em] text-[10px] hover:bg-gold/15 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none whitespace-nowrap"
              >
                {isAuthenticated ? 'Enter workspace' : 'Sign in'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="sectors" className="relative py-16 sm:py-24 px-4 sm:px-6 md:px-20 z-10">
        <div className="max-w-5xl mx-auto text-center mb-10 sm:mb-14">
          <h2 className="font-display text-[clamp(1.5rem,5vw,3rem)] text-white tracking-tight [overflow-wrap:anywhere]">
            Built for operators who lead.
          </h2>
          <div className="w-14 h-px mx-auto mt-6 bg-gold/50" />
        </div>
        <div className="max-w-5xl mx-auto flex flex-wrap justify-center gap-x-8 sm:gap-x-10 gap-y-6">
          {[
            { name: 'Dentists', desc: 'More patients' },
            { name: 'Brokers', desc: 'Better leads' },
            { name: 'E-commerce', desc: 'Sell more' },
            { name: 'Retail', desc: 'Own demand' },
            { name: 'Wellness', desc: 'Be cited' },
          ].map((sector) => (
            <div key={sector.name} className="text-center min-w-[6.5rem]">
              <div className="text-[11px] font-black gold-text uppercase tracking-[0.22em]">{sector.name}</div>
              <div className="text-[10px] text-gray-400 uppercase tracking-[0.2em] mt-2">{sector.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="services" className="relative py-20 sm:py-28 md:py-36 px-4 sm:px-6 md:px-20 z-10 border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 sm:gap-8 mb-12 sm:mb-16 border-b border-white/[0.06] pb-8 sm:pb-10">
            <h2 className="font-display text-[clamp(1.75rem,6vw,3.75rem)] text-white tracking-tight [overflow-wrap:anywhere]">
              What the suite does.
            </h2>
            <p className="text-gray-400 text-[10px] font-bold uppercase tracking-[0.3em] md:pb-2">Product capabilities</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-10 sm:gap-y-12">
            {[
              { title: 'SEO growth', desc: 'Find the gaps that block rankings and fix the highest-leverage pages first.' },
              { title: 'AI answers', desc: 'See whether ChatGPT, Perplexity and AI Overviews mention you, and why not.' },
              { title: 'Local presence', desc: 'Help nearby customers discover you when they ask for services like yours.' },
              { title: 'Action brief', desc: 'Leave with a ranked list, not a 40-page PDF nobody opens.' },
              { title: 'Your keys or ours', desc: 'Bring your own AI keys, or use hosted keys with free daily quota and paid plans.' },
              { title: 'Saved workspace', desc: 'DNA, audits and settings follow your account when you sign back in.' },
            ].map((s, idx) => (
              <div key={s.title} className="group min-w-0">
                <div className="text-[10px] font-black text-gold/50 mb-3 tracking-[0.35em] group-hover:text-gold transition-colors">
                  {(idx + 1).toString().padStart(2, '0')}
                </div>
                <h3 className="text-lg font-semibold tracking-wide text-gray-100 mb-2">{s.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed font-light">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 sm:mt-16 text-center">
            <button
              type="button"
              onClick={onNavigateInfrastructure}
              className="w-full sm:w-auto whitespace-nowrap min-h-12 px-8 sm:px-10 py-4 border border-gold/30 text-gold-light font-black uppercase tracking-[0.25em] text-[9px] rounded-xl hover:bg-gold/10 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              How it works
            </button>
          </div>
        </div>
      </section>

      <section id="workflow" className="relative py-20 sm:py-28 md:py-36 px-4 sm:px-6 md:px-20 z-10 border-t border-white/[0.05] bg-black/40">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-12 lg:gap-24 items-center">
          <div className="lg:w-1/2 min-w-0 w-full">
            <h3 className="font-display text-[clamp(1.75rem,5.5vw,3rem)] text-white mb-6 sm:mb-8 leading-tight [overflow-wrap:anywhere]">
              Calm intelligence,{' '}
              <span className="gold-text font-sans font-semibold uppercase tracking-wider text-[0.65em]">on demand.</span>
            </h3>
            <p className="text-gray-400 text-base sm:text-lg font-light leading-relaxed mb-10 sm:mb-12 max-w-lg">
              The app pairs live search grounding with your chosen AI engines so every audit stays factual, readable, and actionable.
            </p>
            <div className="flex flex-wrap gap-x-6 sm:gap-x-8 gap-y-3 mb-10 sm:mb-12">
              {['Groq', 'NVIDIA NIM', 'Ollama', 'OpenRouter', 'Firecrawl', 'Tavily'].map((tool) => (
                <span key={tool} className="text-[11px] font-bold tracking-[0.18em] uppercase text-gray-400 hover:text-gold transition-colors">
                  {tool}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={onNavigateIntelligence}
              className="w-full sm:w-auto whitespace-nowrap min-h-12 px-8 sm:px-10 py-4 bg-gold text-black font-black uppercase tracking-[0.25em] text-[9px] rounded-xl hover:scale-[1.03] transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              Our AI
            </button>
          </div>
          <div className="lg:w-1/2 flex justify-center w-full min-w-0">
            <div className="relative w-full max-w-md aspect-square">
              <div className="absolute inset-0 bg-gold/15 blur-3xl rounded-full" />
              <div className="relative h-full glass-premium rounded-[28px] sm:rounded-[40px] flex flex-col items-center justify-center p-8 sm:p-12">
                <ICONS.LuminaraLogo className="w-20 h-20 sm:w-28 sm:h-28 mb-8 sm:mb-10" isThinking />
                <div className="text-[9px] font-black uppercase tracking-[0.4em] sm:tracking-[0.55em] text-gold mb-3">Suite online</div>
                <p className="font-display text-xl sm:text-2xl text-gray-300 text-center">Your visibility, composed.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="produced-by" className="relative py-20 sm:py-28 md:py-36 px-4 sm:px-6 md:px-20 z-10 border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-20 items-start">
          <div className="lg:col-span-5 space-y-6 sm:space-y-7 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.4em] text-gold">Produced by</p>
            <h2 className="font-display text-[clamp(1.75rem,5.5vw,3rem)] text-white tracking-tight leading-tight [overflow-wrap:anywhere]">
              Luminara Digital
            </h2>
            <p className="text-gray-400 text-sm sm:text-base md:text-lg leading-relaxed font-light">
              An Australian AI growth studio. We help businesses show up in Google and AI answers, then we built this suite so owners can run that clarity themselves.
            </p>
            <a
              href="https://luminaradigital.io"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full sm:w-auto justify-center whitespace-nowrap min-h-12 px-8 sm:px-9 py-3.5 border border-gold/30 text-gold-light font-black uppercase tracking-[0.22em] text-[9px] rounded-xl hover:bg-gold/10 transition-all"
            >
              Visit luminaradigital.io
            </a>
          </div>
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
            {[
              { title: 'SEO, AEO and GEO', desc: 'Visibility across classic search and AI-generated answers.' },
              { title: 'Sites and systems', desc: 'AI-ready sites, CRM, content and managed infrastructure.' },
              { title: 'Built for owners', desc: 'Plain-English priorities you can act on this week.' },
              { title: 'Australia-wide', desc: 'Melbourne operations with remote delivery nationally.' },
            ].map((item) => (
              <div key={item.title} className="p-5 sm:p-7 rounded-2xl border border-white/[0.05] bg-white/[0.02] hover:border-gold/25 transition-colors min-w-0">
                <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-white mb-3">{item.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed font-light">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative py-24 sm:py-36 md:py-48 px-4 sm:px-6 md:px-20 z-10 text-center overflow-x-clip border-t border-white/[0.05]">
        <div className="max-w-4xl mx-auto space-y-8 sm:space-y-12">
          <h2 className="font-display text-[clamp(2.25rem,10vw,6rem)] text-white tracking-tight leading-[0.95] [overflow-wrap:anywhere]">
            Win the{' '}
            <span className="gold-text animate-title-shimmer font-sans font-medium">market.</span>
          </h2>
          <p className="text-base sm:text-lg md:text-2xl text-gray-400 font-light leading-relaxed px-2">
            Built by Luminara Digital for business owners who want clearer search and AI visibility.
          </p>
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-center gap-3">
            <button
              type="button"
              className="w-full sm:w-auto whitespace-nowrap min-h-12 px-8 sm:px-12 py-4 sm:py-5 bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase tracking-[0.22em] text-[10px] rounded-2xl shadow-[0_40px_100px_rgba(191,149,63,0.28)] transition-all hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              onClick={onEnter}
            >
              {isAuthenticated ? 'Open the app' : 'Sign in'}
            </button>
            {onNavigateAudit && (
              <button
                type="button"
                className="w-full sm:w-auto whitespace-nowrap min-h-12 px-8 sm:px-12 py-4 sm:py-5 glass-premium text-gold-light font-black uppercase tracking-[0.22em] text-[10px] rounded-2xl hover:border-gold/50 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                onClick={onNavigateAudit}
              >
                Audit my site
              </button>
            )}
            <a
              href="https://luminaradigital.io"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto whitespace-nowrap min-h-12 inline-flex items-center justify-center px-8 sm:px-12 py-4 sm:py-5 border border-white/10 text-gray-300 font-black uppercase tracking-[0.22em] text-[10px] rounded-2xl hover:bg-white/5 hover:text-white transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              Talk to us
            </a>
          </div>
          <p className="text-[10px] text-gray-400 uppercase tracking-[0.2em]">
            A product of{' '}
            <a href="https://luminaradigital.io" target="_blank" rel="noopener noreferrer" className="text-gold/80 hover:text-gold tracking-[0.15em] transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded">
              Luminara Digital
            </a>
            <span className="text-gray-500"> · Melbourne</span>
          </p>
        </div>
      </section>

      <footer
        className="py-14 sm:py-20 px-4 sm:px-6 md:px-20 border-t border-white/[0.05] flex flex-col items-center gap-10 sm:gap-14 relative z-10 bg-black/80"
        style={{ paddingBottom: 'max(3.5rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex flex-col lg:flex-row justify-between w-full items-center gap-8 sm:gap-10">
          <div className="flex items-center gap-4 sm:gap-5 min-w-0">
            <ICONS.LuminaraLogo className="w-10 h-10 sm:w-11 sm:h-11 shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-base sm:text-xl font-bold tracking-[0.22em] sm:tracking-[0.4em] uppercase gold-text leading-none">Luminara Suite</span>
              <span className="text-[9px] text-gray-400 uppercase tracking-widest mt-2">Grow with clarity</span>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-4 sm:gap-10">
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
                className="text-[9px] text-gray-400 uppercase tracking-widest hover:text-gold transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded whitespace-nowrap py-2"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
        <div className="w-full h-px premium-hairline opacity-60" />
        <p className="text-[9px] text-gray-400 tracking-[0.12em] text-center px-2">
          &copy; {new Date().getFullYear()} Luminara Suite. Produced by{' '}
          <a
            href="https://luminaradigital.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold/80 hover:text-gold transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded"
          >
            Luminara Digital
          </a>
          {' '}
          <span className="text-gray-500">(luminaradigital.io)</span>
        </p>
      </footer>
    </div>
  );
};

export default LandingPage;
