import React from 'react';
import { MarketingNav } from './MarketingNav';
import { MarketingAtmosphere } from './marketing/MarketingAtmosphere';
import { MarketingStage } from './marketing/MarketingStage';
import { MarketingFooter } from './marketing/MarketingFooter';
import { VisibilityConstellation } from './marketing/VisibilityConstellation';
import { SAMPLE_FIXTURE } from './marketing/demo/demoFixtures';
import type { AuditHandoff } from '../services/activation/auditHandoff';

interface LandingPageProps {
  onEnter: () => void;
  onNavigateAudit?: (handoff?: AuditHandoff) => void;
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
  onNavigateSuite: _onNavigateSuite,
  onNavigateInfrastructure,
  onNavigateIntelligence: _onNavigateIntelligence,
  onNavigateWhy,
  onNavigatePricing,
  isAuthenticated,
  userLabel,
  onSignInClick,
  onSignUpClick: _onSignUpClick,
}) => {
  const openAudit = (handoff?: AuditHandoff) => {
    if (onNavigateAudit) onNavigateAudit(handoff);
    else onEnter();
  };
  const signIn = () => {
    (onSignInClick || onEnter)();
  };

  // S1 nav: Pricing · Why · How (short). Instant Audit stays a CTA, not a nav clutter.
  const navLinks = [
    { label: 'Pricing', onClick: onNavigatePricing },
    { label: 'Why', onClick: onNavigateWhy },
    { label: 'How', onClick: onNavigateInfrastructure },
  ];

  return (
    <div className="min-h-[100dvh] bg-[var(--color-paper)] text-[var(--color-ink)] selection:bg-gold selection:text-black font-sans antialiased relative overflow-x-clip">
      <MarketingAtmosphere />
      <MarketingNav
        brandLabel="Luminara Suite"
        onBrandClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        links={navLinks}
        secondaryCta={
          !isAuthenticated ? { label: 'Sign in', onClick: signIn } : undefined
        }
        primaryCta={{
          label: isAuthenticated ? 'Open Instant Audit' : 'Run sample scout',
          onClick: isAuthenticated ? onEnter : () => openAudit(),
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
              Replace tool sprawl. Adopt AI{' '}
              <span className="text-[var(--gold-light)] font-medium">without rebuilding.</span>
            </h1>
            <p className="max-w-xl mx-auto lg:mx-0 text-sm sm:text-base text-[var(--color-ink-2)] font-light leading-relaxed">
              Cut stack sprawl and ship on what you already run. Instant Audit and Visibility Probe
              prove answer-engine presence with honest Sample labels; Live follows Instant Audit rules.
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-center lg:justify-start gap-3 pt-1 w-full">
              <button type="button" onClick={() => openAudit()} className="mkt-cta-primary w-full sm:w-auto">
                {isAuthenticated ? 'Open Instant Audit' : 'Run sample scout'}
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
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <div className="min-w-0 order-2 lg:order-1">
            <p className="text-[11px] font-mono uppercase tracking-wider text-[var(--gold-light)] mb-3">
              Visibility field
            </p>
            <h2 className="font-display text-[clamp(1.75rem,5vw,2.75rem)] text-[var(--color-ink)] tracking-tight leading-tight mb-4 [overflow-wrap:anywhere]">
              One map of where answers happen.
            </h2>
            <p className="text-sm sm:text-base text-[var(--color-ink-2)] font-light leading-relaxed mb-6">
              Instant Audit models your brand across Google, AI Overviews, ChatGPT, and Perplexity.
              Sample is labeled; Live follows Instant Audit rules. Brightness means measured or
              estimated; dim means not measured yet. No invented citation scores.
            </p>
            <ul className="space-y-2 text-sm text-[var(--color-ink-2)]">
              {[
                'Paste a domain in the Workbench Probe',
                'Read Measured / Estimated / Not measured honestly',
                'Ship one owner-first fix, then open Instant Audit',
              ].map((line) => (
                <li key={line} className="border-t border-white/[0.08] pt-2">
                  {line}
                </li>
              ))}
            </ul>
            {onNavigateInfrastructure && (
              <button type="button" onClick={onNavigateInfrastructure} className="mkt-cta-secondary mt-8">
                How it works
              </button>
            )}
          </div>
          <figure className="min-w-0 order-1 lg:order-2 relative overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-2)] p-3 sm:p-4">
            <VisibilityConstellation
              engines={SAMPLE_FIXTURE.engines}
              domainLabel={SAMPLE_FIXTURE.domain}
              size="hero"
              plateVariant="sample"
              className="max-h-none"
            />
            <figcaption className="mt-2 text-[11px] font-mono text-[var(--color-ink-2)]">
              Interactive sample field · product metaphor · not a live KPI chart
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="relative py-16 sm:py-24 px-4 sm:px-6 z-10 border-t border-white/[0.05] text-center">
        <div className="max-w-2xl mx-auto space-y-6">
          <h2 className="font-display text-[clamp(1.75rem,6vw,3rem)] text-[var(--color-ink)] tracking-tight leading-tight [overflow-wrap:anywhere]">
            Run your first sample scout.
          </h2>
          <p className="text-sm sm:text-base text-[var(--color-ink-2)] font-light leading-relaxed">
            Start labeled Sample, then open Instant Audit when you are ready for Live. Built by
            Luminara Digital.
          </p>
          <button type="button" className="mkt-cta-primary" onClick={() => openAudit()}>
            {isAuthenticated ? 'Open Instant Audit' : 'Run sample scout'}
          </button>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default LandingPage;
