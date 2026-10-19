/* Luminara landing: one cinematic space story, one call to action.
 * 1. Hero over a sunrise horizon, with the live domain check
 * 2. Statement: AI gives one answer (the globe pulls back to the full planet)
 * 3. How it works: four chapters beside the globe (crawl, engines, evidence, fix)
 * 4. What you get: an illustrative report
 * 5. Why Luminara: three value props and the MCP line for developers
 * 6. FAQ (1:1 with FAQPage JSON-LD)
 * 7. Closing call to action over a second horizon, then the footer
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './marketing/space.css';
import { MarketingNav } from './MarketingNav';
import { MarketingFooter } from './marketing/MarketingFooter';
import { MarketingFaq } from './marketing/MarketingFaq';
import { SpaceStage } from './marketing/SpaceStage';
import { DomainCheck } from './marketing/DomainCheck';
import { EvidenceGlyph } from './marketing/EvidenceGlyph';
import { useMarketingChrome } from './marketing/marketingChrome';
import { prefersReducedMotion } from './marketing/deviceCapability';
import {
  ENGINES,
  EVIDENCE_LEGEND,
  GLOBE_NOTICE,
  STORY_CHAPTERS,
  type EvidenceState,
} from './marketing/earth/globeStory';
import type { AuditHandoff } from '../services/activation/auditHandoff';
import { GUEST_HERO_NOTE, GUEST_REPORT_NOTE } from '../services/audit/hostedScoutRail';
import { LIVE_ANSWER_CHECKS } from '../services/marketing/engineCoverage';

interface LandingPageProps {
  onNavigateAudit: (handoff?: AuditHandoff) => void;
  onNavigatePricing: () => void;
  onNavigateMethodology: () => void;
  onNavigateSampleReport: () => void;
  isAuthenticated?: boolean;
  onSignUpClick: (handoff?: AuditHandoff) => void;
}

const MCP_COMMAND =
  'claude mcp add --transport http luminara https://luminarasuite.com/api/mcp --header "Authorization: Bearer lm_live_YOUR_KEY"';

const VALUE_PROPS = [
  {
    title: 'Honest by design',
    body: 'Every result says how it was measured. When something was not measured, the report says so instead of guessing.',
  },
  {
    title: 'One fix at a time',
    body: 'One prioritized change at a time, with copy and schema ready to paste. Not a backlog of warnings.',
  },
  {
    title: 'Works where you work',
    body: 'Use it on the web, on Windows or in Telegram. On Growth and Pro / Agency, your developer can pull the fix into Cursor or Claude.',
  },
] as const;

/** Illustrative report rows. Not a customer; labeled on the page. */
const EXAMPLE_REPORT_ROWS: ReadonlyArray<{ label: string; state: EvidenceState; note: string }> = [
  { label: 'Crawl access', state: 'Measured', note: 'Bots can read robots.txt and llms.txt.' },
  { label: 'Google Search', state: 'Measured', note: 'Named for the brand, not for the category.' },
  { label: 'AI Overviews', state: 'Estimated', note: 'A competitor page is quoted instead.' },
  { label: 'ChatGPT', state: 'Measured', note: 'Not named for "best dentist in Sydney".' },
  { label: 'Perplexity', state: 'Not measured', note: 'No data yet. Missing, not a poor result.' },
];

const LandingPage: React.FC<LandingPageProps> = ({
  onNavigateAudit,
  onNavigatePricing,
  onNavigateMethodology,
  onNavigateSampleReport,
  isAuthenticated,
  onSignUpClick,
}) => {
  const chrome = useMarketingChrome();
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorsRef = useRef<Array<HTMLElement | null>>([]);
  const [chapter, setChapter] = useState(-1);
  const [copied, setCopied] = useState(false);

  // Stable callback refs (hero, statement, one per chapter) so anchors never detach on re-render.
  const anchorRefs = useMemo(
    () =>
      Array.from({ length: 2 + STORY_CHAPTERS.length }, (_, i) => (el: HTMLElement | null) => {
        anchorsRef.current[i] = el;
      }),
    [],
  );

  const fullAudit = (handoff?: AuditHandoff) => {
    if (isAuthenticated) onNavigateAudit(handoff);
    else onSignUpClick(handoff);
  };

  const focusHeroInput = () => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    window.setTimeout(() => {
      (document.getElementById('hero-domain') as HTMLInputElement | null)?.focus({ preventScroll: true });
    }, 500);
  };

  const copyMcp = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(MCP_COMMAND)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  };

  // Scroll reveal: armed only when it can run, so content never hides without it.
  useEffect(() => {
    const root = rootRef.current;
    if (
      !root ||
      typeof IntersectionObserver === 'undefined' ||
      prefersReducedMotion() ||
      document.visibilityState !== 'visible'
    ) {
      return;
    }
    root.classList.add('lx-armed');
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-in', '');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    root.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className="lx-root relative min-h-[100dvh] overflow-x-clip font-sans antialiased selection:bg-gold selection:text-black"
    >
      <MarketingNav
        brandLabel="Luminara Suite"
        onBrandClick={() => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })}
        links={chrome.links}
        secondaryCta={chrome.secondaryCta}
        primaryCta={chrome.primaryCta}
      />

      <main id="main" tabIndex={-1} className="outline-none">
      {/* Story sequence: the sticky globe stage sits behind hero, statement and chapters. */}
      <div className="relative">
        <SpaceStage anchors={anchorsRef} onChapterChange={setChapter} />

        <section
          ref={anchorRefs[0]}
          aria-labelledby="hero-heading"
          className="relative z-10 flex min-h-[100svh] flex-col items-center px-5 pb-16 pt-[max(6.5rem,13svh)] text-center sm:px-8"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[8svh] -z-10 h-[78svh] w-[min(1100px,130vw)] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.62)_0%,rgb(0_0_0/0.35)_45%,transparent_70%)]"
          />
          <p className="lx-eyebrow lx-enter-rise lx-d1">AI visibility, measured</p>
          <h1 id="hero-heading" className="lx-display lx-h1 mt-6 max-w-5xl">
            <span className="lx-enter-mask">
              <span className="lx-enter-line lx-d2">Be the answer</span>
            </span>{' '}
            <span className="lx-enter-mask">
              <span className="lx-enter-line lx-d3 italic lx-gold-text pr-[0.08em]">AI gives.</span>
            </span>
          </h1>
          <span aria-hidden className="lx-rule lx-enter-draw lx-d4 mt-8" />
          <p className="lx-lede lx-enter-rise lx-d4 mt-7 max-w-2xl">
            See if AI recommends your business, and fix it. Every plan checks your site and live web search
            for the questions your buyers ask.
          </p>
          <p className="lx-enter-rise lx-d4 mt-4 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-2)]">
            {LIVE_ANSWER_CHECKS}
          </p>
          <div className="lx-enter-rise lx-d5 mt-9 w-full">
            <DomainCheck inputId="hero-domain" isAuthenticated={isAuthenticated} onFullAudit={fullAudit} />
          </div>
          <p className="lx-enter-rise lx-d6 mt-5 text-sm text-[var(--color-ink-2)]">
            {GUEST_HERO_NOTE}{' '}
            <button type="button" onClick={onNavigateSampleReport} className="lx-link">
              See a sample report
            </button>
          </p>

          <a
            href="#how-it-works"
            aria-label="Scroll to how it works"
            className="lx-enter-rise lx-d6 absolute bottom-[5svh] left-1/2 -translate-x-1/2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold-light)]"
          >
            <span className="lx-scroll-cue flex h-14 w-14 items-center justify-center rounded-full border border-[var(--color-rule)] bg-black/55 backdrop-blur-md">
              <svg viewBox="0 0 16 20" width="14" height="18" fill="none" aria-hidden="true">
                <path d="M8 1v17M1.5 11.5 8 18l6.5-6.5" stroke="currentColor" strokeWidth="1.6" className="text-[var(--gold-light)]" />
              </svg>
            </span>
          </a>
        </section>

        <section
          ref={anchorRefs[1]}
          aria-labelledby="shift-heading"
          className="relative z-10 flex items-center justify-center px-5 py-16 text-center sm:px-8 sm:py-20"
        >
          <div className="relative max-w-4xl" data-reveal>
            <div
              aria-hidden
              className="absolute -inset-x-16 -inset-y-20 -z-10 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.78)_0%,rgb(0_0_0/0.45)_45%,transparent_72%)]"
            />
            <p className="lx-eyebrow">The shift</p>
            <h2 id="shift-heading" className="lx-display lx-h2 mt-6">
              Search gave buyers ten links.{' '}
              <span className="block italic lx-gold-text">AI gives them one answer.</span>
            </h2>
            <p className="lx-lede mx-auto mt-8 max-w-2xl">
              When a buyer asks ChatGPT or Perplexity who to hire, there is no second page. The answer names
              you, or it names someone else. Luminara checks your site and live web search, then one fix. {LIVE_ANSWER_CHECKS}
            </p>
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="how-heading" className="relative z-10 pb-[10svh]">
          {STORY_CHAPTERS.map((c, i) => (
            <div
              key={c.id}
              ref={anchorRefs[2 + i]}
              className="flex items-center px-5 py-12 sm:px-8 lg:px-0 lg:py-16"
            >
              <article
                className="lx-chapter w-full max-w-xl rounded-3xl bg-black/75 p-6 lg:ml-[6vw] lg:max-w-[min(34rem,40vw)] lg:bg-transparent lg:p-0 xl:ml-[8vw]"
                data-active={chapter === -1 || chapter === i ? 'true' : 'false'}
              >
                {i === 0 && (
                  <h2 id="how-heading" className="lx-eyebrow mb-8">
                    How it works
                  </h2>
                )}
                <p className="flex items-center gap-4 text-[var(--gold-light)]">
                  <span className="font-serif text-3xl leading-none">{c.step}</span>
                  <span aria-hidden className="h-px w-10 bg-gold/60" />
                  <span className="text-[11px] uppercase tracking-[0.26em]">{c.stage}</span>
                </p>
                <h3 className="lx-display lx-h3 mt-6">{c.title}</h3>
                <p className="lx-lede mt-5">{c.body}</p>

                {c.id === 'ask' && (
                  <ul className="m-0 mt-7 flex list-none flex-wrap gap-2 p-0">
                    {ENGINES.map((name) => (
                      <li
                        key={name}
                        className="rounded-full border border-[var(--color-rule)] bg-black/40 px-3.5 py-1.5 text-sm text-[var(--color-ink)]"
                      >
                        {name}
                      </li>
                    ))}
                  </ul>
                )}

                {c.id === 'prove' && (
                  <>
                  <ul className="m-0 mt-7 list-none space-y-3 p-0">
                    {EVIDENCE_LEGEND.map((row) => (
                      <li key={row.state} className="flex items-baseline gap-3">
                        <span className="inline-flex translate-y-[1px]">
                          <EvidenceGlyph state={row.state} />
                        </span>
                        <p className="text-[15px] leading-snug text-[var(--color-ink-2)]">
                          <span className="font-medium text-[var(--color-ink)]">{row.state}.</span> {row.meaning}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={onNavigateMethodology} className="lx-link mt-6 text-sm">
                    How we measure
                  </button>
                  </>
                )}

                {i === 0 && <p className="mt-6 text-xs text-[var(--color-ink-2)]">{GLOBE_NOTICE}</p>}
              </article>
            </div>
          ))}
        </section>
      </div>

      <section
        id="report"
        aria-labelledby="report-heading"
        className="relative z-10 overflow-hidden border-t lx-hairline px-5 py-16 sm:px-8 sm:py-20"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-[36rem] w-[min(1100px,140vw)] -translate-x-1/2 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--gold)_16%,transparent),transparent_65%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5" data-reveal>
            <p className="lx-eyebrow">What you get</p>
            <h2 id="report-heading" className="lx-display lx-h2 mt-6">
              <span className="block">One verdict.</span>
              <span className="block">One fix.</span>
              <span className="block italic lx-gold-text">Ready to ship.</span>
            </h2>
            <p className="lx-lede mt-7">
              {GUEST_REPORT_NOTE}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-6">
              <button type="button" onClick={focusHeroInput} className="lx-btn lx-btn-gold">
                Check my site free
              </button>
              <button type="button" onClick={onNavigateSampleReport} className="lx-link text-sm">
                Open the sample report
              </button>
            </div>
          </div>

          <figure className="lx-glass m-0 rounded-3xl p-6 sm:p-8 lg:col-span-7" data-reveal>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-ink-2)]">Example report</p>
                <p className="mt-2 font-serif text-2xl text-[var(--color-ink)] sm:text-3xl">A dental clinic in Sydney</p>
              </div>
              <span className="shrink-0 rounded-full border border-[var(--color-rule)] px-3 py-1 text-xs text-[var(--gold-light)]">
                Agency example
              </span>
            </div>

            <ul className="m-0 mt-6 list-none divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)] p-0">
              {EXAMPLE_REPORT_ROWS.map((row) => (
                <li key={row.label} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,7.5rem)_1fr] items-center gap-3 py-3 max-sm:grid-cols-2">
                  <span className="text-sm text-[var(--color-ink)]">{row.label}</span>
                  <span className="flex items-center gap-2 text-[13px] text-[var(--gold-light)]">
                    <EvidenceGlyph state={row.state} />
                    {row.state}
                  </span>
                  <span className="text-[13px] leading-snug text-[var(--color-ink-2)] max-sm:col-span-2">{row.note}</span>
                </li>
              ))}
            </ul>

            <p className="mt-6 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
              <span className="text-[var(--color-ink)]">Verdict. </span>
              The site is readable, but the services page opens with a slogan. AI engines quote competitors who
              answer the question directly.
            </p>

            <div className="mt-6 rounded-2xl border border-gold/45 bg-gold/10 p-5">
              <p className="text-[11px] uppercase tracking-[0.26em] text-[var(--gold-light)]">Your next fix</p>
              <p className="mt-2 font-serif text-xl leading-snug text-[var(--color-ink)] sm:text-2xl">
                Add a 50-word direct answer under the heading on /services, with FAQ schema for your top three
                questions.
              </p>
              <p className="mt-3 text-xs text-[var(--color-ink-2)]">Copy and schema included, ready to paste.</p>
            </div>
            <figcaption className="mt-5 text-xs text-[var(--color-ink-2)]">
              Illustrative Agency example, not a real customer. {LIVE_ANSWER_CHECKS}
            </figcaption>
          </figure>
        </div>
      </section>

      <section
        id="why"
        aria-labelledby="why-heading"
        className="relative z-10 border-t lx-hairline px-5 py-16 sm:px-8 sm:py-20"
      >
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl" data-reveal>
            <p className="lx-eyebrow">Why Luminara</p>
            <h2 id="why-heading" className="lx-display lx-h2 mt-6">
              Built to be trusted, <span className="italic lx-gold-text">not to impress.</span>
            </h2>
          </div>

          <div className="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
            {VALUE_PROPS.map((v, i) => (
              <div key={v.title} data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
                <span className="font-serif text-5xl leading-none lx-gold-text">{`0${i + 1}`}</span>
                <div aria-hidden className="mt-6 h-px w-full bg-gradient-to-r from-gold/60 to-transparent" />
                <h3 className="mt-6 text-xl font-medium text-[var(--color-ink)]">{v.title}</h3>
                <p className="mt-3 leading-relaxed text-[var(--color-ink-2)]">{v.body}</p>
              </div>
            ))}
          </div>

          <div
            className="lx-glass mt-16 flex flex-col gap-5 rounded-2xl p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between"
            data-reveal
          >
            <div className="max-w-md">
              <p className="text-[15px] font-medium text-[var(--color-ink)]">For developers and agencies</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-2)]">
                Pull your latest verdict and fix into Cursor or Claude Code over MCP. Included on Growth and Pro / Agency.{' '}
                <a href="/docs/mcp.html" className="lx-link">
                  Setup guide
                </a>
              </p>
            </div>
            <div className="flex min-w-0 w-full max-w-xl items-center gap-2 rounded-2xl border border-[var(--color-rule)] bg-black/50 py-1.5 pl-4 pr-1.5">
              <code tabIndex={0} className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded font-mono text-xs text-[var(--color-ink)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold-light)]">{MCP_COMMAND}</code>
              <button type="button" onClick={copyMcp} className="lx-btn lx-btn-ghost !min-h-8 shrink-0 !px-3.5 !py-1.5 text-xs">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <p className="mx-auto mt-14 max-w-2xl text-center leading-relaxed text-[var(--color-ink-2)]" data-reveal>
            For owners who want a straight answer, marketers who need the exact page to fix, and agencies who
            share proof with clients.{' '}
            <button type="button" onClick={onNavigatePricing} className="lx-link">
              See plans
            </button>
          </p>
        </div>
      </section>

      <MarketingFaq className="relative z-10" />
      </main>

      <div className="relative overflow-hidden border-t lx-hairline">
        <div aria-hidden className="lx-stars absolute inset-0 opacity-80" />
        <div aria-hidden className="lx-horizon top-[34rem] sm:top-[33rem]" />
        <section aria-labelledby="closing-heading" className="relative z-10 px-5 pb-16 pt-28 text-center sm:px-8 sm:pt-36">
          <div data-reveal>
            <p className="lx-eyebrow">Start free</p>
            <h2 id="closing-heading" className="lx-display lx-h2 mx-auto mt-6 max-w-4xl">
              See what AI says <span className="italic lx-gold-text">about you.</span>
            </h2>
            <p className="lx-lede mx-auto mt-6 max-w-xl">
              Run the live crawl check now. Create a free account to run the full audit and get your first fix, with every engine row labeled by how it was measured.
            </p>
          </div>
          <div className="mt-10">
            <DomainCheck inputId="closing-domain" isAuthenticated={isAuthenticated} onFullAudit={fullAudit} />
          </div>
        </section>
        <div className="relative z-10 pt-40 sm:pt-48">
          <MarketingFooter divider={false} />
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
