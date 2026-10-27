import React, { useEffect } from 'react';
import { MARKETING_BODY as BODY, MARKETING_SECTION as SECTION, MarketingPageHeader, MarketingPageShell } from './MarketingPageShell';
import { MarketingCompareTable } from './MarketingCompareTable';
import { MarketingFaq } from './MarketingFaq';
import { HUB_FAQ_HEADING, HUB_PAGES, HUB_REVIEWED, type BestPage, type ComparePage, type HubPage } from '../../services/marketing/seoHubPages';

interface SeoHubPageProps {
  page: HubPage;
  onTerminal: () => void;
}

const Bullets: React.FC<{ items: readonly string[] }> = ({ items }) => (
  <ul className={`mt-5 space-y-3 ${BODY}`}>
    {items.map((item) => (
      <li key={item} className="flex gap-3">
        <span aria-hidden className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
        {item}
      </li>
    ))}
  </ul>
);

const CompareBody: React.FC<{ page: ComparePage }> = ({ page }) => (
  <>
    <section aria-labelledby="matrix-heading" className={SECTION}>
      <h2 id="matrix-heading" className="lx-display lx-h3">Side by side</h2>
      <MarketingCompareTable
        themLabel={page.competitor}
        usLabel="Luminara Suite"
        rows={page.rows}
      />
    </section>
    <section className={`${SECTION} grid gap-12 md:grid-cols-2`}>
      <div role="group" aria-labelledby="choose-them-heading">
        <h2 id="choose-them-heading" className="lx-display lx-h3">When to choose {page.competitor}</h2>
        <Bullets items={page.chooseThem} />
      </div>
      <div role="group" aria-labelledby="choose-us-heading">
        <h2 id="choose-us-heading" className="lx-display lx-h3">When to choose Luminara Suite</h2>
        <Bullets items={page.chooseUs} />
      </div>
    </section>
  </>
);

const BestBody: React.FC<{ page: BestPage }> = ({ page }) => (
  <>
    <section aria-labelledby="picks-heading" className={SECTION}>
      <h2 id="picks-heading" className="lx-display lx-h3">Quick picks</h2>
      <ol className={`mt-6 space-y-2 ${BODY}`}>
        {page.picks.map((pick) => (
          <li key={pick.name}>
            <a href={`#${slug(pick.name)}`} className="lx-link">{pick.name}</a>: {pick.bestFor}
          </li>
        ))}
      </ol>
      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {page.picks.map((pick) => (
          <article key={pick.name} id={slug(pick.name)} className="lx-glass rounded-3xl p-6 sm:p-8" data-reveal>
            <p className="lx-eyebrow">{pick.bestFor}</p>
            <h3 className="lx-display mt-4 text-2xl">{pick.name}</h3>
            <p className={`mt-4 ${BODY}`}>{pick.icp}</p>
            <h4 className="mt-6 text-sm font-medium text-[var(--color-ink)]">Pros</h4>
            <Bullets items={pick.pros} />
            <h4 className="mt-6 text-sm font-medium text-[var(--color-ink)]">Cons</h4>
            <Bullets items={pick.cons} />
            <p className={`mt-6 ${BODY}`}>{pick.pricing}</p>
            <a href={pick.url} rel="noopener noreferrer" target="_blank" className="lx-link mt-4 inline-block text-sm">
              Visit {pick.name}<NewTab />
            </a>
          </article>
        ))}
      </div>
    </section>
    <section aria-labelledby="method-heading" className={SECTION}>
      <h2 id="method-heading" className="lx-display lx-h3">How we picked</h2>
      <Bullets items={page.methodology} />
    </section>
  </>
);

const NewTab: React.FC = () => <span className="sr-only"> (opens in a new tab)</span>;

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** /compare/* and /best/* pages. Content, crawler HTML, and JSON-LD share services/marketing/seoHubPages. */
const SeoHubPage: React.FC<SeoHubPageProps> = ({ page, onTerminal }) => {

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <MarketingPageShell
      footerStatement="Measure when we can. Label when we cannot."
      wide
      closing={{
        eyebrow: 'Start free',
        title: (
          <>
            Check your own site <span className="italic lx-gold-text pr-[0.08em]">for free.</span>
          </>
        ),
        body: 'The live crawl check reads your robots.txt and llms.txt with no card and no account. Results are labeled Measured, Estimated, or Not measured.',
        cta: { label: 'Run the free crawl check', onClick: onTerminal },
      }}
    >
      <MarketingPageHeader
        eyebrow={`${page.kind === 'compare' ? 'Comparison' : "Buyer's guide"} · reviewed ${HUB_REVIEWED}`}
        title={page.h1}
      >
        <button type="button" onClick={onTerminal} className="lx-btn lx-btn-gold">
          Run the free crawl check
        </button>
      </MarketingPageHeader>

      <section aria-label="Short answer" className="lx-glass mx-auto mt-12 max-w-3xl rounded-3xl p-6 sm:p-8">
        <p className="lx-eyebrow">Short answer</p>
        <p className="mt-4 text-lg leading-relaxed text-[var(--color-ink)] [text-wrap:pretty]">{page.verdict}</p>
      </section>

      {page.kind === 'compare' ? <CompareBody page={page} /> : <BestBody page={page} />}

      <MarketingFaq embedded className="mt-16" items={page.faq} heading={HUB_FAQ_HEADING} />

      <section aria-labelledby="sources-heading" className={SECTION}>
        <h2 id="sources-heading" className="lx-eyebrow">Sources, reviewed {HUB_REVIEWED}</h2>
        <ul className={`mt-4 flex flex-wrap gap-x-6 gap-y-2 ${BODY}`}>
          {page.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} rel="noopener noreferrer" target="_blank" className="lx-link">{source.label}<NewTab /></a>
            </li>
          ))}
        </ul>
        <h2 className="lx-eyebrow mt-10">More comparisons</h2>
        <ul className={`mt-4 flex flex-wrap gap-x-6 gap-y-2 ${BODY}`}>
          {HUB_PAGES.filter((other) => other.path !== page.path).map((other) => (
            <li key={other.path}>
              <a href={other.path} className="lx-link">{other.label}</a>
            </li>
          ))}
        </ul>
      </section>
    </MarketingPageShell>
  );
};

export default SeoHubPage;
