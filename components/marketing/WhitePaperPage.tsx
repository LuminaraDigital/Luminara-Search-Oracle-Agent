import React, { lazy, Suspense, useEffect, useState } from 'react';
import type { AuditHandoff } from '../../services/activation/auditHandoff';
import { collectSourceIds, WHITE_PAPER_PDF_PATH } from '../../services/marketing/whitePaper';
import { WHITE_PAPER_SECTIONS } from '../../services/marketing/whitePaperSections';
import { whitePaperSource } from '../../services/marketing/whitePaperSources';
import { DomainCheck } from './DomainCheck';
import { prefersReducedMotion } from './deviceCapability';
import { MARKETING_BODY, MARKETING_SECTION, MarketingPageHeader, MarketingPageShell } from './MarketingPageShell';
import { AgencyBrief, BlockView, openSource, SourceAppendix } from './whitePaperRender';

const WhitePaperStory = lazy(() => import('./WhitePaperStory'));

const CHECK_INPUT_ID = 'white-paper-domain';

function storyFromLocation(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('view') === 'story';
}

interface WhitePaperPageProps {
  isAuthenticated?: boolean;
  onFullAudit: (handoff?: AuditHandoff) => void;
}

/** Product and methodology paper. Claims are labeled and linked to the source appendix. */
const WhitePaperPage: React.FC<WhitePaperPageProps> = ({ isAuthenticated, onFullAudit }) => {
  const [current, setCurrent] = useState<(typeof WHITE_PAPER_SECTIONS)[number]['id']>(WHITE_PAPER_SECTIONS[0].id);
  const [story, setStory] = useState(storyFromLocation);

  useEffect(() => {
    const sync = () => setStory(storyFromLocation());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    if (story) return;
    window.scrollTo(0, 0);
    const openFromHash = () => {
      const id = window.location.hash.replace(/^#src-/, '');
      if (id) openSource(id);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [story]);

  useEffect(() => {
    if (story || typeof IntersectionObserver === 'undefined') return;
    const nodes = WHITE_PAPER_SECTIONS.map((section) => document.getElementById(section.id)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = visible?.target.id;
        const match = WHITE_PAPER_SECTIONS.find((section) => section.id === id);
        if (match) setCurrent(match.id);
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0.1, 0.3, 0.6] },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [story]);

  const goToCheck = () => {
    const input = document.getElementById(CHECK_INPUT_ID);
    input?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    window.setTimeout(() => input?.focus({ preventScroll: true }), 400);
  };

  const openStory = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'story');
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
    setStory(true);
  };

  if (story) {
    return (
      <MarketingPageShell skipLink rootClassName="lx-wp" wide footerStatement="Measure when we can. Label when we cannot.">
        <Suspense fallback={<p className={MARKETING_BODY}>Opening story mode.</p>}>
          <WhitePaperStory />
        </Suspense>
      </MarketingPageShell>
    );
  }

  return (
    <MarketingPageShell
      skipLink
      rootClassName="lx-wp"
      wide
      footerStatement="Measure when we can. Label when we cannot."
      closing={{
        eyebrow: 'Free check',
        title: (
          <>
            Check the agency site <span className="italic lx-gold-text pr-[0.08em]">next.</span>
          </>
        ),
        body: 'The free check reads a homepage title and description, robots.txt, and llms.txt. No card. A full audit needs sign-in or your own keys.',
        cta: { label: 'Check a domain', onClick: goToCheck },
      }}
    >
      <MarketingPageHeader
        eyebrow="White paper"
        title={
          <>
            Product and <span className="italic lx-gold-text pr-[0.08em]">methodology.</span>
          </>
        }
        lede="For independent real estate agencies in Australia, Oceania and South-East Asia. Every number is tagged Fact, Estimate, or Speculation and links to a source. Traction and market size: Unknown. This paper does not recommend issuing a token."
      >
        <button type="button" onClick={goToCheck} className="lx-btn lx-btn-gold">
          Check a domain
        </button>
        <a href={`${WHITE_PAPER_PDF_PATH}`} className="lx-link inline-flex min-h-11 items-center text-sm">
          Download PDF
        </a>
        <a href="/white-paper?view=story" className="lx-link inline-flex min-h-11 items-center text-sm" onClick={openStory}>
          Story mode
        </a>
      </MarketingPageHeader>

      <AgencyBrief />

      <nav
        aria-label="White paper sections"
        className="lx-wp-screen sticky z-40 -mx-5 mt-12 border-y bg-black/90 px-5 py-1 lx-hairline sm:-mx-8 sm:px-8"
        style={{ top: 'calc(4.25rem + env(safe-area-inset-top, 0px))' }}
      >
        <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto">
          <li className="shrink-0">
            <a href="#white-paper-check" className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 text-sm text-[var(--gold-light)]">
              Check a domain
            </a>
          </li>
          {WHITE_PAPER_SECTIONS.map((section) => (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                aria-current={current === section.id ? 'true' : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none ${
                  current === section.id ? 'text-[var(--gold-light)]' : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
                }`}
              >
                {section.nav}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {WHITE_PAPER_SECTIONS.map((section) => {
        const sourceIds = collectSourceIds(section);
        return (
          <React.Fragment key={section.id}>
            <section
              id={section.id}
              aria-labelledby={`${section.id}-heading`}
              className={`${MARKETING_SECTION} scroll-mt-36`}
            >
              <h2 id={`${section.id}-heading`} className="lx-display lx-h3">
                {section.title}
              </h2>
              {section.blocks.map((block, index) => (
                <BlockView key={`${section.id}-${index}`} block={block} />
              ))}
              {section.id === 'sources' ? <SourceAppendix /> : null}
              {sourceIds.length > 0 ? (
                <details className="lx-faq mt-8 border-t pt-2 lx-hairline">
                  <summary className="flex items-center justify-between gap-4 py-3 text-sm text-[var(--color-ink)]">
                    <span>Sources in this section</span>
                    <span
                      aria-hidden
                      className="lx-faq-icon inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-rule)] text-lg leading-none text-[var(--gold-light)]"
                    >
                      +
                    </span>
                  </summary>
                  <ul className="space-y-2 pb-4">
                    {sourceIds.map((id) => {
                      const source = whitePaperSource(id);
                      return (
                        <li key={id} className={`text-sm ${MARKETING_BODY}`}>
                          <a href={`#src-${id}`} className="lx-link" onClick={() => openSource(id)}>
                            {id}
                          </a>
                          {` ${source.title}`}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}
            </section>
            {section.id === 'executive-summary' ? (
              <section id="white-paper-check" aria-labelledby="white-paper-check-heading" className={`${MARKETING_SECTION} scroll-mt-36`}>
                <h2 id="white-paper-check-heading" className="lx-display lx-h3">
                  Check a domain
                </h2>
                <p className={`mt-5 ${MARKETING_BODY}`}>
                  The free check reads a homepage title and description, robots.txt, and llms.txt. No card.
                </p>
                <div className="mt-8">
                  <DomainCheck
                    inputId={CHECK_INPUT_ID}
                    isAuthenticated={isAuthenticated}
                    onFullAudit={onFullAudit}
                    surface="white_paper"
                  />
                </div>
                <p className={`mt-6 ${MARKETING_BODY}`}>
                  <a href="/" className="lx-link">Free check</a>
                  {' · '}
                  <a href="/pricing" className="lx-link">Sign up</a>
                </p>
              </section>
            ) : null}
          </React.Fragment>
        );
      })}
    </MarketingPageShell>
  );
};

export default WhitePaperPage;
