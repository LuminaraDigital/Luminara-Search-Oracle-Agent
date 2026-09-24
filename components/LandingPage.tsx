import React from 'react';
import { MarketingNav } from './MarketingNav';
import { MarketingAtmosphere } from './marketing/MarketingAtmosphere';
import { MarketingStage } from './marketing/MarketingStage';
import { MarketingFooter } from './marketing/MarketingFooter';

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
  const openAudit = () => {
    if (onNavigateAudit) onNavigateAudit();
    else onEnter();
  };
  const signIn = () => {
    (onSignInClick || onEnter)();
  };

  const navLinks = [
    ...(onNavigateAudit ? [{ label: 'Instant Audit', onClick: openAudit, desktopHidden: true as const }] : []),
    ...(onNavigateSuite ? [{ label: 'All tools', onClick: onNavigateSuite, desktopHidden: true as const }] : []),
    { label: 'How it works', onClick: onNavigateInfrastructure },
    { label: 'Why us', onClick: onNavigateWhy },
    { label: 'Pricing', onClick: onNavigatePricing },
    { label: 'Our AI', onClick: onNavigateIntelligence, desktopHidden: true as const },
  ];

  return (
    <div className="min-h-[100dvh] bg-[var(--color-paper)] text-[var(--color-ink)] selection:bg-gold selection:text-black font-sans antialiased relative overflow-x-clip">
      <MarketingAtmosphere />
      <MarketingNav
        brandLabel="Luminara Suite"
        brandSub="AI search visibility"
        onBrandClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        links={navLinks}
        secondaryCta={
          !isAuthenticated ? { label: 'Sign in', onClick: signIn } : undefined
        }
        primaryCta={{
          label: isAuthenticated ? 'Open app' : 'Audit my site',
          onClick: isAuthenticated ? onEnter : openAudit,
        }}
        trailing={
          isAuthenticated && userLabel ? (
            <span className="hidden lg:inline-block text-[10px] text-[var(--gold)]/80 font-mono max-w-[140px] truncate">
              {userLabel}
            </span>
          ) : null
        }
      />

      <section className="relative pt-24 sm:pt-28 pb-16 sm:pb-20 px-4 sm:px-6 flex flex-col justify-center z-10 overflow-x-clip">
        <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="lg:col-span-5 text-center lg:text-left space-y-6 min-w-0">
            <p className="font-display text-[clamp(2.5rem,10vw,4.5rem)] text-[var(--color-ink)] tracking-tight leading-[0.95] min-w-0 [overflow-wrap:anywhere]">
              Luminara
            </p>
            <h1 className="text-[clamp(1.5rem,5.5vw,2.75rem)] font-light tracking-tight leading-[1.15] text-[var(--color-ink-2)] min-w-0 [overflow-wrap:anywhere]">
              Show up where{' '}
              <span className="text-[var(--gold-light)] font-medium">customers ask.</span>
            </h1>
            <p className="max-w-xl mx-auto lg:mx-0 text-sm sm:text-base text-[var(--color-ink-2)] font-light leading-relaxed">
              See how your business appears in Google, AI Overviews, ChatGPT and Perplexity. Get a
              plain-English list of what to fix first.
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-center lg:justify-start gap-3 pt-1 w-full">
              <button type="button" onClick={openAudit} className="mkt-cta-primary w-full sm:w-auto">
                {isAuthenticated ? 'Open Instant Audit' : 'Audit my site'}
              </button>
              <button type="button" onClick={onNavigatePricing} className="mkt-cta-secondary w-full sm:w-auto">
                See pricing
              </button>
            </div>
            <p className="text-[11px] text-[var(--color-ink-2)]">
              Produced by{' '}
              <a
                href="https://luminaradigital.io"
                target="_blank"
                rel="noopener noreferrer"
                className="mkt-cta-tertiary"
              >
                Luminara Digital
              </a>
            </p>
          </div>

          <div className="lg:col-span-7 relative min-w-0">
            <MarketingStage
              isAuthenticated={isAuthenticated}
              onOpenAudit={openAudit}
              onSignIn={signIn}
              onSeePricing={onNavigatePricing}
            />
          </div>
        </div>
      </section>

      <section className="relative py-16 sm:py-24 px-4 sm:px-6 md:px-20 z-10 border-t border-white/[0.05]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
          {[
            {
              title: 'Paste a domain',
              desc: 'The Workbench stage mirrors Instant Audit: URL in, engines out, no agency deck.',
            },
            {
              title: 'Read measurement honestly',
              desc: 'Measured, estimated, or not measured. We never invent citation scores.',
            },
            {
              title: 'Ship one action',
              desc: 'Leave with a ranked fix you can do this week, then open the full suite when ready.',
            },
          ].map((step) => (
            <div key={step.title} className="min-w-0 border-t border-white/[0.08] pt-5">
              <h2 className="text-base font-semibold text-[var(--color-ink)] mb-2">{step.title}</h2>
              <p className="text-sm text-[var(--color-ink-2)] leading-relaxed font-light">{step.desc}</p>
            </div>
          ))}
        </div>
        {onNavigateInfrastructure && (
          <div className="max-w-5xl mx-auto mt-10">
            <button type="button" onClick={onNavigateInfrastructure} className="mkt-cta-secondary">
              How it works
            </button>
          </div>
        )}
      </section>

      <section className="relative py-16 sm:py-24 px-4 sm:px-6 z-10 border-t border-white/[0.05] text-center">
        <div className="max-w-2xl mx-auto space-y-6">
          <h2 className="font-display text-[clamp(1.75rem,6vw,3rem)] text-[var(--color-ink)] tracking-tight leading-tight [overflow-wrap:anywhere]">
            Run your first site audit.
          </h2>
          <p className="text-sm sm:text-base text-[var(--color-ink-2)] font-light leading-relaxed">
            Built by Luminara Digital for owners who want clearer search and AI visibility.
          </p>
          <button type="button" className="mkt-cta-primary" onClick={openAudit}>
            {isAuthenticated ? 'Open Instant Audit' : 'Audit my site'}
          </button>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default LandingPage;
