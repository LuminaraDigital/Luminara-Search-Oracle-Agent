/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5
 * Claim-led hero + Probe workbench, facts band, alternating split sections.
 * design-system: design.md · Night Foundry · no glass · no invented metrics
 */
import React, { useCallback } from 'react';
import { MarketingNav } from './MarketingNav';
import { MarketingAtmosphere } from './marketing/MarketingAtmosphere';
import { MarketingStage } from './marketing/MarketingStage';
import { MarketingFooter } from './marketing/MarketingFooter';
import { MarketingFaq } from './marketing/MarketingFaq';
import { MarketingSellPoints } from './marketing/MarketingSellPoints';
import { VisibilityFieldMap } from './marketing/VisibilityFieldMap';
import { useMarketingChrome } from './marketing/marketingChrome';
import { SAMPLE_FIXTURE } from './marketing/demo/demoFixtures';
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

/** The four surfaces one scout covers. */
const SURFACES = ['Google Search', 'AI Overviews', 'ChatGPT', 'Perplexity'] as const;

/** Free MCP tools exposed to Growth and above (worker MCP server). */
const MCP_TOOLS = [
  { name: 'list_projects', note: 'Your sites and clients' },
  { name: 'get_project_context', note: 'Brand, audience, competitors' },
  { name: 'list_reports', note: 'Past audits and findings' },
  { name: 'save_report', note: 'Write a new report back' },
] as const;

const HOW_STEPS = [
  {
    title: 'Enter a domain',
    body: 'Run a labeled Sample scout. No card required.',
  },
  {
    title: 'Read engine status',
    body: 'Each engine is marked Measured, Estimated, or Not measured. Sample never claims Measured without a Live run.',
  },
  {
    title: 'Ship one fix',
    body: 'Take the Weekly Decision Card: a verdict and one next action. Create a free account to run Live Instant Audit.',
  },
] as const;

const H2 =
  'font-display text-[length:var(--text-display-s)] text-[var(--color-ink)] tracking-tight leading-[1.08] [overflow-wrap:anywhere]';

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
    document.getElementById('visibility-workbench')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      window.dispatchEvent(new Event('luminara:focus-probe'));
    }, 350);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[var(--color-paper)] text-[var(--color-ink)] selection:bg-gold selection:text-black font-sans antialiased relative overflow-x-clip">
      <MarketingAtmosphere intensity="hero" />
      <MarketingNav
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

      {/* Hero: the claim is the headline; the Probe is the product. */}
      <section className="relative z-10 min-h-[min(100dvh,54rem)] flex flex-col justify-center pt-28 sm:pt-32 pb-16 sm:pb-20 px-4 sm:px-6 md:px-10 overflow-x-clip">
        <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-14 items-center">
          <div className="lg:col-span-7 min-w-0">
            <p className="mkt-eyebrow mb-5">Luminara Suite</p>
            <h1 className="font-display text-[clamp(2.75rem,6.4vw,4.9rem)] text-[var(--color-ink)] tracking-tight leading-[1.02] mb-6 [overflow-wrap:anywhere]">
              See if AI recommends your business, and fix it.
            </h1>
            <p className="max-w-xl text-lg sm:text-xl text-[var(--color-ink-2)] leading-relaxed mb-8">
              Check whether ChatGPT, Perplexity, and Google AI Overviews mention your business when customers search. Leave with an actionable 1-3 fix list and IDE connectors to get cited.
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-5">
              {isAuthenticated ? (
                <>
                  <button type="button" onClick={() => onNavigateAudit()} className="mkt-cta-primary">
                    Open Instant Audit
                  </button>
                  <button type="button" onClick={onNavigateSuite} className="mkt-cta-secondary">
                    Open dashboard
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={scrollToProbe} className="mkt-cta-primary">
                    Run sample scout
                  </button>
                  <button type="button" onClick={() => onSignUpClick()} className="mkt-cta-secondary">
                    Create free account
                  </button>
                </>
              )}
            </div>
            <p className="max-w-xl text-[13px] text-[var(--color-ink-2)] leading-relaxed">
              Sample is labeled. Live Instant Audit is free with an account (daily hosted allowance).
              {!isAuthenticated && (
                <>
                  {' '}
                  Guests can still{' '}
                  <button type="button" onClick={() => onNavigateAudit()} className="mkt-cta-tertiary">
                    open Instant Audit
                  </button>{' '}
                  with their own keys.
                </>
              )}
            </p>
          </div>

          <div id="visibility-workbench" className="lg:col-span-5 relative min-w-0 scroll-mt-28">
            <MarketingStage
              isAuthenticated={isAuthenticated}
              onOpenAudit={onNavigateAudit}
              onSignIn={onSignInClick}
              onSignUp={onSignUpClick}
              onSeePricing={onNavigatePricing}
            />
          </div>
        </div>
      </section>

      {/* Coverage strip: the four surfaces, stated once. */}
      <section className="mkt-section mkt-section-alt !py-12 sm:!py-14" aria-label="What one scout covers">
        <div className="max-w-7xl mx-auto">
          <p className="mkt-eyebrow mb-6">One scout covers</p>
          <ul className="grid grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-6 list-none">
            {SURFACES.map((name) => (
              <li
                key={name}
                className="font-display text-[clamp(1.75rem,3.2vw,2.5rem)] leading-none text-[var(--color-ink)] border-t border-[var(--color-rule)] pt-5"
              >
                {name}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Category: cost-displacement, visibility as the proof. */}
      <section className="mkt-section">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 mb-16 sm:mb-20">
            <div className="lg:col-span-7 min-w-0">
              <p className="mkt-eyebrow mb-4">Why Luminara</p>
              <h2 className={H2}>Cut tool sprawl. Adopt AI without rebuilding.</h2>
            </div>
            <p className="lg:col-span-5 mkt-body lg:pt-10">
              Most teams pay for a rank tracker, an audit tool, a retainer, and a chat assistant that never
              talk to each other. Luminara Suite runs the audit, labels the evidence, and hands you the next
              action in one place, on the stack you already run.
            </p>
          </div>
          <MarketingSellPoints heading="" />

          {/* Competitor contrast grid */}
          <div className="mt-16 sm:mt-20 pt-12 sm:pt-16 border-t border-[var(--color-rule)]">
            <p className="mkt-eyebrow mb-3">The landscape</p>
            <h3 className="font-display text-2xl sm:text-3xl text-[var(--color-ink)] tracking-tight mb-8">
              Why modern teams choose Luminara over legacy tools.
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
              <div className="p-6 border border-[var(--color-rule)] bg-[var(--color-paper-2)]/60 flex flex-col justify-between">
                <div>
                  <p className="text-xs font-mono text-[var(--color-ink-2)] uppercase tracking-wider mb-2">Legacy SEO Suites</p>
                  <h4 className="text-lg font-medium text-[var(--color-ink)] mb-3">Semrush / Ahrefs</h4>
                  <p className="text-sm text-[var(--color-ink-2)] leading-relaxed mb-6">
                    Built 15 years ago for 10 blue links and keyword counts. Overwhelming 40-tab dashboards that leave you blind to generative AI answers and provide no code fixes.
                  </p>
                </div>
                <p className="text-xs font-mono text-[var(--color-ink-2)] border-t border-[var(--color-rule)] pt-3">$139 to $499/mo · Annual lock-in</p>
              </div>
              <div className="p-6 border border-[var(--color-rule)] bg-[var(--color-paper-2)]/60 flex flex-col justify-between">
                <div>
                  <p className="text-xs font-mono text-[var(--color-ink-2)] uppercase tracking-wider mb-2">Passive AI Trackers</p>
                  <h4 className="text-lg font-medium text-[var(--color-ink)] mb-3">Otterly / Profound</h4>
                  <p className="text-sm text-[var(--color-ink-2)] leading-relaxed mb-6">
                    Prompt-scraping dashboards that alert you when citations are missing, but stop there. They invent synthetic 0-100 vanity scores and offer no IDE remediation.
                  </p>
                </div>
                <p className="text-xs font-mono text-[var(--color-ink-2)] border-t border-[var(--color-rule)] pt-3">$99 to $500+/mo · Model add-on fees</p>
              </div>
              <div className="p-6 border border-[var(--color-accent)] bg-[var(--color-paper)] relative flex flex-col justify-between shadow-sm">
                <div>
                  <p className="text-xs font-mono text-[var(--color-accent)] uppercase tracking-wider mb-2">The Closed-Loop Engine</p>
                  <h4 className="text-lg font-medium text-[var(--color-ink)] mb-3">Luminara Suite</h4>
                  <p className="text-sm text-[var(--color-ink-2)] leading-relaxed mb-6">
                    Audits Google and AI engines together with strict evidence labeling. Delivers an ordered 1-3 fix list with code snippets and native Cursor/Claude MCP integration.
                  </p>
                </div>
                <p className="text-xs font-mono text-[var(--color-accent)] border-t border-[var(--color-rule)] pt-3">$49 to $149 flat 30-day tiers · No lock-in</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Map: interactive constellation, separate from the Probe (design.md). */}
      <section id="visibility-map" className="mkt-section mkt-section-alt scroll-mt-24">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <div className="lg:col-span-5 min-w-0">
            <p className="mkt-eyebrow mb-4">Visibility field</p>
            <h2 className={`${H2} mb-5`}>One map of where answers happen.</h2>
            <p className="mkt-body mb-8 max-w-md">
              Google, AI Overviews, ChatGPT, and Perplexity as lit nodes on one map. Measured stays bright.
              Gaps stay labeled. Sample data until you run Live.
            </p>
            <button type="button" onClick={() => (isAuthenticated ? onNavigateAudit() : onSignUpClick())} className="mkt-cta-secondary">
              {isAuthenticated ? 'Open Instant Audit' : 'Create free account'}
            </button>
          </div>
          <div className="lg:col-span-7 min-w-0">
            <VisibilityFieldMap engines={SAMPLE_FIXTURE.engines} domainLabel={SAMPLE_FIXTURE.domain} />
          </div>
        </div>
      </section>

      {/* Loop: the steps beside the real Instant Audit screen. */}
      <section className="mkt-section">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <div className="lg:col-span-5 min-w-0">
            <p className="mkt-eyebrow mb-4">Weekly Decision Loop</p>
            <h2 className={`${H2} mb-10`}>From a domain to the next action.</h2>
            <ol className="space-y-7 list-none mb-8">
              {HOW_STEPS.map((step, index) => (
                <li key={step.title} className="min-w-0 border-t border-[var(--color-rule)] pt-5">
                  <p className="text-[12px] font-mono text-[var(--color-accent)] mb-2">
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <h3 className="text-xl text-[var(--color-ink)] font-medium mb-1.5">{step.title}</h3>
                  <p className="mkt-body">{step.body}</p>
                </li>
              ))}
            </ol>

            {/* Actionable Fix List visual preview */}
            <div className="border border-[var(--color-rule)] bg-[var(--color-paper-2)]/60 p-4 sm:p-5 mb-8">
              <p className="text-[11px] font-mono text-[var(--color-accent)] uppercase tracking-wider mb-2">Output: Actionable 1-3 Fix List</p>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between p-2 bg-[var(--color-paper)] border border-[var(--color-rule)]">
                  <span className="text-[var(--color-ink)] truncate mr-2">1. /llms.txt Machine-Readable Summary</span>
                  <span className="text-[var(--color-accent)] shrink-0">Perplexity</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-[var(--color-paper)] border border-[var(--color-rule)]">
                  <span className="text-[var(--color-ink)] truncate mr-2">2. Schema.org Entity Graph Injection</span>
                  <span className="text-[var(--color-accent)] shrink-0">Google AIO</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-[var(--color-paper)] border border-[var(--color-rule)]">
                  <span className="text-[var(--color-ink)] truncate mr-2">3. 40-60 Word Extractable Answer Block</span>
                  <span className="text-[var(--color-accent)] shrink-0">ChatGPT</span>
                </div>
              </div>
              <p className="text-[12px] text-[var(--color-ink-2)] mt-3">
                Ship one fix today, re-check tomorrow. Build an evidence-backed daily streak.
              </p>
            </div>

            <button type="button" onClick={onNavigateInfrastructure} className="mkt-cta-tertiary">
              How an audit runs
            </button>
          </div>
          <figure className="lg:col-span-7 min-w-0">
            <button
              type="button"
              onClick={() => onNavigateAudit()}
              className="block w-full border border-[var(--color-rule)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
              aria-label="Open Instant Audit"
            >
              <img
                src="/brand/instant-audit.webp"
                alt="The Instant Audit screen: a domain field, SEO, AEO and GEO report types, and focus lenses."
                width={1440}
                height={740}
                loading="lazy"
                decoding="async"
                className="block w-full h-auto"
              />
            </button>
            <figcaption className="mt-3 text-[13px] text-[var(--color-ink-2)]">
              Instant Audit as a guest sees it. Select the image to open it.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Sample report: visual left, copy right. */}
      <section id="sample-report" className="mkt-section mkt-section-alt scroll-mt-24">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <div className="lg:col-span-6 min-w-0 order-2 lg:order-1 border border-[var(--color-rule)] bg-[var(--color-paper)] p-5 sm:p-7 space-y-5">
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
          <div className="lg:col-span-6 min-w-0 order-1 lg:order-2">
            <p className="mkt-eyebrow mb-4">The report</p>
            <h2 className={`${H2} mb-5`}>A verdict and one fix, not a 40-page PDF.</h2>
            <p className="mkt-body mb-8 max-w-md">
              Each engine gets a status, the report gives a plain-English verdict, and you leave with
              the one fix to make first.
            </p>
            <button type="button" onClick={onNavigateSampleReport} className="mkt-cta-secondary">
              Full sample report
            </button>
          </div>
        </div>
      </section>

      {/* IDE access: Growth tooling as the visual. */}
      <section className="mkt-section">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <div className="lg:col-span-6 min-w-0">
            <p className="mkt-eyebrow mb-4">Growth and above</p>
            <h2 className={`${H2} mb-5`}>Turn AI visibility audits into Git pull requests.</h2>
            <p className="mkt-body mb-8 max-w-lg">
              Growth unlocks our native Model Context Protocol (MCP) server so Cursor, Claude Code, Cline,
              and Windsurf can read your projects, brand context, and audit findings, and generate the schema
              and code fixes directly in your codebase. Agency adds API access for paid research.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <button type="button" onClick={onNavigatePricing} className="mkt-cta-secondary">
                See plans
              </button>
              <a href="/docs/mcp.html" className="mkt-cta-tertiary">
                IDE setup guide
              </a>
              <button type="button" onClick={onNavigateMethodology} className="mkt-cta-tertiary">
                How we measure
              </button>
            </div>
          </div>
          <div className="lg:col-span-6 min-w-0 border border-[var(--color-rule)] bg-[var(--color-paper-2)]">
            <p className="px-5 sm:px-6 py-3.5 border-b border-[var(--color-rule)] text-[12px] font-mono text-[var(--color-ink-2)]">
              luminara IDE tools (MCP server)
            </p>
            <ul className="divide-y divide-[var(--color-rule)] list-none">
              {MCP_TOOLS.map((tool) => (
                <li key={tool.name} className="flex items-baseline justify-between gap-4 px-5 sm:px-6 py-3.5">
                  <code className="text-[13px] font-mono text-[var(--color-ink)]">{tool.name}</code>
                  <span className="text-[14px] text-[var(--color-ink-2)] text-right">{tool.note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <MarketingFaq className="mkt-section-alt" />

      {/* Closing CTA plus the one builder credit (dual-brand lock). */}
      <section className="mkt-section">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-end">
          <div className="lg:col-span-7 min-w-0">
            <h2 className={`${H2} mb-5`}>Run a free sample scout.</h2>
            <p className="mkt-body mb-8 max-w-lg">
              Enter your site in the Probe. Create a free account when you want Live Instant Audit.
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap gap-3">
              <button type="button" className="mkt-cta-primary" onClick={scrollToProbe}>
                Run sample scout
              </button>
              <button
                type="button"
                className="mkt-cta-secondary"
                onClick={() => (isAuthenticated ? onNavigateAudit() : onSignUpClick())}
              >
                {isAuthenticated ? 'Open Instant Audit' : 'Create free account'}
              </button>
            </div>
          </div>
          <div className="lg:col-span-5 min-w-0 border-t border-[var(--color-rule)] pt-5">
            <p className="text-lg text-[var(--color-ink)] font-medium mb-2">Visibility is only the beginning.</p>
            <p className="mkt-body">
              Built by{' '}
              <a
                href="https://luminaradigital.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-ink)] underline underline-offset-4"
              >
                Luminara Digital
              </a>
              . Optional implementation and stack review, so you modernise without a rip-and-replace.
            </p>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default LandingPage;
