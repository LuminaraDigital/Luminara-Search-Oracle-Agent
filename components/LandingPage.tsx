/* Landing: one full-viewport world, then a short path into the scout.
 * Black and gold. The claim is the headline. The globe carries the four engines.
 * No split workbench, no second visual system, no invented metrics.
 */
import React, { useCallback } from 'react';
import { MarketingNav } from './MarketingNav';
import { MarketingStage } from './marketing/MarketingStage';
import { MarketingFooter } from './marketing/MarketingFooter';
import { MarketingFaq } from './marketing/MarketingFaq';
import { WorldStage } from './marketing/WorldStage';
import { useMarketingChrome } from './marketing/marketingChrome';
import { LIVE_SAMPLE_SNAPSHOT } from '../services/marketing/liveSampleSnapshot';
import type { AuditHandoff } from '../services/activation/auditHandoff';

interface LandingPageProps {
  onNavigateAudit: (handoff?: AuditHandoff) => void;
  onNavigateSuite: () => void;
  onNavigateInfrastructure: () => void;
  onNavigatePricing: () => void;
  onNavigateMethodology: () => void;
  onNavigateSampleReport: () => void;
  isAuthenticated?: boolean;
  onSignInClick: (handoff?: AuditHandoff) => void;
  onSignUpClick: (handoff?: AuditHandoff) => void;
}

function statusCopy(status: string): string {
  switch (status) {
    case 'measured':
      return 'Measured';
    case 'estimated':
      return 'Estimated';
    case 'not_measured':
      return 'Not measured';
    default:
      return status;
  }
}

const STEPS = [
  {
    n: '01',
    title: 'Enter a domain',
    body: 'Run a labeled sample scout. No card required.',
  },
  {
    n: '02',
    title: 'Read each engine',
    body: 'Every result is Measured, Estimated, or Not measured. A sample never claims Measured without a live run.',
  },
  {
    n: '03',
    title: 'Ship one fix',
    body: 'The report ends on a verdict and one next action. A free account runs Live Instant Audit.',
  },
] as const;

const H2 =
  'font-display text-[length:var(--text-display-s)] text-[var(--color-ink)] tracking-tight leading-[1.05] [overflow-wrap:anywhere]';

const LandingPage: React.FC<LandingPageProps> = ({
  onNavigateAudit,
  onNavigateSuite,
  onNavigateInfrastructure,
  onNavigatePricing,
  onNavigateMethodology,
  onNavigateSampleReport,
  isAuthenticated,
  onSignInClick,
  onSignUpClick,
}) => {
  const chrome = useMarketingChrome();

  const scrollToProbe = useCallback(() => {
    document.getElementById('visibility-workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      window.dispatchEvent(new Event('luminara:focus-probe'));
    }, 400);
  }, []);

  return (
    <div className="isolate min-h-[100dvh] bg-black text-[var(--color-ink)] selection:bg-gold selection:text-black font-sans antialiased relative overflow-x-clip">
      <MarketingNav
        overlay
        brandLabel="Luminara Suite"
        onBrandClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        links={chrome.links}
        secondaryCta={chrome.secondaryCta}
        primaryCta={chrome.primaryCta}
        trailing={
          chrome.userLabel ? (
            <span className="hidden lg:inline-block text-[11px] text-[var(--color-ink-2)] font-mono max-w-[140px] truncate">
              {chrome.userLabel}
            </span>
          ) : null
        }
      />

      <section className="relative min-h-[100dvh] overflow-hidden" aria-label="Will AI mention your brand">
        <WorldStage />
        <div className="relative z-10 flex min-h-[100dvh] flex-col items-center px-5 sm:px-8 pt-28 sm:pt-32 pb-28 text-center">
          <div className="relative max-w-3xl">
            <div
              className="pointer-events-none absolute -inset-x-24 -inset-y-16 -z-10"
              style={{
                background:
                  'radial-gradient(ellipse at center, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.42) 52%, transparent 74%)',
              }}
            />
            <p className="mkt-eyebrow mb-5">AI visibility</p>
            <h1 className="font-display text-[clamp(3.1rem,7.2vw,6.4rem)] leading-[0.92] tracking-tight text-white">
              Will AI mention
              <br />
              your brand?
            </h1>
            <div className="mx-auto mt-6 h-[3px] w-16 rounded-full bg-[var(--color-accent)]" />
            <p className="mx-auto mt-6 max-w-xl text-lg sm:text-xl leading-relaxed text-white/90">
              One scout across Google, AI Overviews, ChatGPT, and Perplexity. You leave with a plain verdict and the one fix to ship first.
            </p>
            <div className="mt-8 flex flex-col items-center gap-4">
              {isAuthenticated ? (
                <>
                  <button type="button" onClick={() => onNavigateAudit()} className="mkt-cta-gloss">
                    Open Instant Audit
                  </button>
                  <button type="button" onClick={onNavigateSuite} className="mkt-cta-tertiary">
                    Open dashboard
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={scrollToProbe} className="mkt-cta-gloss">
                    Run a sample scout
                  </button>
                  <button type="button" onClick={() => onSignUpClick()} className="mkt-cta-tertiary">
                    Create a free account
                  </button>
                </>
              )}
            </div>
            <p className="mx-auto mt-5 max-w-md text-[13px] leading-relaxed text-white/70">
              Sample is labeled. Live Instant Audit is free with an account.
              {!isAuthenticated && (
                <>
                  {' '}
                  Guests can{' '}
                  <button type="button" onClick={() => onNavigateAudit()} className="mkt-cta-tertiary">
                    open Instant Audit
                  </button>{' '}
                  with their own keys.
                </>
              )}
            </p>
          </div>

          <div className="mt-auto hidden w-full max-w-6xl md:flex items-end justify-between px-2 pt-16 pointer-events-none">
            <ul className="space-y-4 text-left" aria-label="Search engines">
              <li className="font-display text-lg tracking-[0.22em] uppercase [text-shadow:0_2px_18px_rgba(0,0,0,0.85)]">Google Search</li>
              <li className="font-display text-lg tracking-[0.22em] uppercase text-white/80 [text-shadow:0_2px_18px_rgba(0,0,0,0.85)]">AI Overviews</li>
            </ul>
            <ul className="space-y-4 text-right" aria-label="Answer engines">
              <li className="font-display text-lg tracking-[0.22em] uppercase [text-shadow:0_2px_18px_rgba(0,0,0,0.85)]">ChatGPT</li>
              <li className="font-display text-lg tracking-[0.22em] uppercase text-white/80 [text-shadow:0_2px_18px_rgba(0,0,0,0.85)]">Perplexity</li>
            </ul>
          </div>
        </div>

        <button
          type="button"
          onClick={scrollToProbe}
          aria-label="Scroll to the sample scout"
          className="absolute bottom-6 left-1/2 z-10 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white"
        >
          <svg viewBox="0 0 26 33" className="h-5 w-4" fill="none" aria-hidden>
            <path
              d="M13 1.5 V31.5 M1.9 20.4 L13 31.5 L24.1 20.4"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="square"
            />
          </svg>
        </button>
      </section>

      <section className="relative z-10 bg-black border-t border-[var(--color-rule)]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
          <p className="mkt-eyebrow mb-4">The path</p>
          <h2 className={`${H2} max-w-xl mb-14`}>From a domain to the one fix.</h2>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-12 list-none">
            {STEPS.map((step) => (
              <li key={step.n} className="min-w-0">
                <p className="font-display text-5xl text-[var(--color-accent)] leading-none mb-4">{step.n}</p>
                <h3 className="text-2xl text-[var(--color-ink)] font-medium mb-2">{step.title}</h3>
                <p className="mkt-body max-w-sm">{step.body}</p>
              </li>
            ))}
          </ol>
          <button type="button" onClick={onNavigateInfrastructure} className="mkt-cta-tertiary mt-12">
            How an audit runs
          </button>
        </div>
      </section>

      <section id="visibility-workbench" className="relative z-10 scroll-mt-24 bg-[var(--color-paper-2)] border-t border-[var(--color-rule)]">
        <div className="max-w-xl mx-auto px-5 sm:px-8 pt-14 pb-10 sm:pt-16 sm:pb-12">
          <p className="mkt-eyebrow mb-4">Try it</p>
          <h2 className={`${H2} mb-4`}>Run it on your domain.</h2>
          <p className="mkt-body mb-8">
            The sample scout shows the engine layout. It does not invent a score. Answer engines stay Not measured until a live run.
          </p>
          <MarketingStage
            isAuthenticated={isAuthenticated}
            onOpenAudit={onNavigateAudit}
            onSignIn={onSignInClick}
            onSignUp={onSignUpClick}
            onSeePricing={onNavigatePricing}
          />
        </div>
      </section>

      <section id="sample-report" className="relative z-10 scroll-mt-24 bg-black border-t border-[var(--color-rule)]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12 sm:py-14 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <div className="lg:col-span-6 min-w-0 border border-[var(--color-rule)] p-5 sm:p-7 space-y-5">
            <div className="flex items-baseline justify-between gap-3 min-w-0">
              <p className="text-base text-[var(--color-ink)] truncate">{LIVE_SAMPLE_SNAPSHOT.domain}</p>
              <p className="text-[12px] font-mono text-[var(--color-accent)] shrink-0">
                {LIVE_SAMPLE_SNAPSHOT.label} · {LIVE_SAMPLE_SNAPSHOT.measuredAt}
              </p>
            </div>
            <ul className="divide-y divide-[var(--color-rule)] border-t border-[var(--color-rule)]">
              {LIVE_SAMPLE_SNAPSHOT.rows.map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-4 py-3.5">
                  <span className="text-base text-[var(--color-ink-2)]">{row.label}</span>
                  <span className="text-[12px] font-mono tracking-wide text-[var(--color-ink)]">
                    {statusCopy(row.status)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="space-y-2 pt-1">
              <p className="text-base text-[var(--color-ink)] leading-relaxed">{LIVE_SAMPLE_SNAPSHOT.verdict}</p>
              <p className="text-base text-[var(--color-ink-2)] leading-relaxed">
                <span className="text-[var(--color-ink)] font-medium">Next: </span>
                {LIVE_SAMPLE_SNAPSHOT.shipAction}
              </p>
            </div>
          </div>
          <div className="lg:col-span-6 min-w-0">
            <p className="mkt-eyebrow mb-4">The report</p>
            <h2 className={`${H2} mb-5`}>A verdict and one fix.</h2>
            <p className="mkt-body mb-8 max-w-md">
              Each engine gets a status. The page gives you the verdict in plain English and the single change to make first.
            </p>
            <button type="button" onClick={onNavigateSampleReport} className="mkt-cta-secondary">
              Full sample report
            </button>
          </div>
        </div>
      </section>

      <section className="relative z-10 bg-black border-t border-[var(--color-rule)]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-12 pb-8 sm:pt-14 sm:pb-10">
          <div className="max-w-2xl min-w-0">
            <h2 className={`${H2} mb-5`}>See if AI mentions you.</h2>
            <p className="mkt-body mb-8 max-w-lg">
              Start with the sample. Create a free account when you want the live audit. Growth reads the same reports inside Cursor and Claude.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <button type="button" className="mkt-cta-gloss" onClick={scrollToProbe}>
                Run a sample scout
              </button>
              <button type="button" onClick={onNavigatePricing} className="mkt-cta-tertiary">
                See plans
              </button>
              <button type="button" onClick={onNavigateMethodology} className="mkt-cta-tertiary">
                How we measure
              </button>
            </div>
          </div>
        </div>
      </section>

      <MarketingFaq className="mkt-section-alt !py-12 sm:!py-14" />
      <MarketingFooter />
    </div>
  );
};

export default LandingPage;
