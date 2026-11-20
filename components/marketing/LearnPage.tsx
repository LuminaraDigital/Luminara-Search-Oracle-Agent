import React, { Fragment, useEffect } from 'react';
import { MARKETING_BODY as BODY, MARKETING_SECTION as SECTION, MarketingPageHeader, MarketingPageShell } from './MarketingPageShell';
import { MarketingFaq } from './MarketingFaq';
import { DomainCheck } from './DomainCheck';
import { prefersReducedMotion } from './deviceCapability';
import type { AuditHandoff } from '../../services/activation/auditHandoff';
import {
  LEARN_ARTICLES,
  LEARN_AUTHOR_NAME,
  LEARN_AUTHOR_ORG,
  LEARN_INDEX,
  LEARN_PATH,
  formatLearnDate,
  learnInline,
  type LearnArticle,
  type LearnSection,
} from '../../services/marketing/learnPages';

interface LearnPageProps {
  article: LearnArticle | null;
  isAuthenticated?: boolean;
  onFullAudit: (handoff?: AuditHandoff) => void;
}

const CHECK_INPUT_ID = 'learn-domain';

function externalProps(href: string): { target?: string; rel?: string } {
  return href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

const Inline: React.FC<{ text: string }> = ({ text }) => (
  <>
    {learnInline(text).map((run, index) =>
      run.kind === 'text' ? (
        <Fragment key={index}>{run.text}</Fragment>
      ) : (
        <a key={index} href={run.href} className="lx-link" {...externalProps(run.href)}>
          {run.label}
          {run.href.startsWith('http') ? <span className="sr-only"> (opens in a new tab)</span> : null}
        </a>
      ),
    )}
  </>
);

const LinkList: React.FC<{ links: readonly { label: string; href: string }[]; label: string }> = ({ links, label }) => (
  <section aria-labelledby={`${label}-heading`} className={SECTION}>
    <h2 id={`${label}-heading`} className="lx-eyebrow">{label}</h2>
    <ul className={`mt-4 flex flex-wrap gap-x-6 gap-y-2 ${BODY}`}>
      {links.map((link) => (
        <li key={link.href}>
          <a href={link.href} className="lx-link" {...externalProps(link.href)}>
            {link.label}
            {link.href.startsWith('http') ? <span className="sr-only"> (opens in a new tab)</span> : null}
          </a>
        </li>
      ))}
    </ul>
  </section>
);

const SectionBlock: React.FC<{ section: LearnSection }> = ({ section }) => (
  <section className={SECTION}>
    <h2 className="lx-display lx-h3">{section.heading}</h2>
    {section.paragraphs.map((paragraph) => (
      <p key={paragraph} className={`mt-4 ${BODY}`}><Inline text={paragraph} /></p>
    ))}
    {section.steps && (
      <ol className={`mt-4 list-decimal space-y-2 pl-5 ${BODY}`}>
        {section.steps.map((step) => (
          <li key={step}><Inline text={step} /></li>
        ))}
      </ol>
    )}
    {section.bullets && (
      <ul className={`mt-4 list-disc space-y-2 pl-5 ${BODY}`}>
        {section.bullets.map((item) => (
          <li key={item}><Inline text={item} /></li>
        ))}
      </ul>
    )}
    {section.code && (
      <pre className="mt-4 overflow-x-auto rounded-2xl border border-[var(--color-rule)] bg-black/30 p-4 text-left text-sm leading-relaxed text-[var(--color-ink)]">
        <code>{section.code}</code>
      </pre>
    )}
  </section>
);

const Crumbs: React.FC<{ current?: string }> = ({ current }) => (
  <nav aria-label="Breadcrumb" className={`mx-auto mb-8 max-w-3xl text-left ${BODY}`}>
    <ol className="flex flex-wrap gap-x-2 gap-y-1">
      <li><a href="/" className="lx-link">Home</a></li>
      <li aria-hidden="true">/</li>
      {current ? (
        <>
          <li><a href={LEARN_PATH} className="lx-link">Learn</a></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{current}</li>
        </>
      ) : (
        <li aria-current="page">Learn</li>
      )}
    </ol>
  </nav>
);

/** /learn and /learn/*. Copy, crawler HTML, and JSON-LD share services/marketing/learnPages. */
const LearnPage: React.FC<LearnPageProps> = ({ article, isAuthenticated, onFullAudit }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [article]);

  const goToCheck = () => {
    const input = document.getElementById(CHECK_INPUT_ID);
    input?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    window.setTimeout(() => input?.focus({ preventScroll: true }), 400);
  };

  return (
    <MarketingPageShell
      footerStatement="Measure when we can. Label when we cannot."
      wide
      closing={{
        eyebrow: 'Free check',
        title: (
          <>
            Check your own site <span className="italic lx-gold-text pr-[0.08em]">for free.</span>
          </>
        ),
        body: 'Reads a homepage title and description, robots.txt and llms.txt. No card, no account. Every result is labeled Measured, Estimated, or Not measured.',
        form: (
          <DomainCheck
            inputId={CHECK_INPUT_ID}
            isAuthenticated={isAuthenticated}
            onFullAudit={onFullAudit}
            surface={`learn:${article?.path ?? LEARN_PATH}`}
          />
        ),
      }}
    >
      <Crumbs current={article?.h1} />
      {article ? (
        <>
          <MarketingPageHeader eyebrow="Guide" title={article.h1}>
            <button type="button" onClick={goToCheck} className="lx-btn lx-btn-gold">
              Run the free check
            </button>
          </MarketingPageHeader>
          <p className={`mx-auto mt-8 max-w-3xl text-center ${BODY}`}>
            <time dateTime={article.published}>Published {formatLearnDate(article.published)}</time>
            {' · '}
            <time dateTime={article.updated}>Updated {formatLearnDate(article.updated)}</time>
          </p>
          <p className={`mx-auto mt-2 max-w-3xl text-center ${BODY}`}>
            {LEARN_AUTHOR_NAME}, {LEARN_AUTHOR_ORG}
          </p>
          {article.sections.map((section) => (
            <SectionBlock key={section.heading} section={section} />
          ))}
          <MarketingFaq embedded className="mt-16" items={article.faq} heading="Common questions" />
          <LinkList links={article.sources} label="Sources" />
          <LinkList links={[{ label: 'All guides', href: LEARN_PATH }, ...article.related.filter((link) => link.href !== LEARN_PATH)]} label="More guides" />
        </>
      ) : (
        <>
          <MarketingPageHeader eyebrow="Knowledge hub" title={LEARN_INDEX.h1} lede={LEARN_INDEX.lede}>
            <button type="button" onClick={goToCheck} className="lx-btn lx-btn-gold">
              Run the free check
            </button>
          </MarketingPageHeader>
          <p className={`mx-auto mt-8 max-w-3xl text-center ${BODY}`}>
            <time dateTime={LEARN_INDEX.updated}>Updated {formatLearnDate(LEARN_INDEX.updated)}</time>
            {' · '}
            {LEARN_AUTHOR_NAME}, {LEARN_AUTHOR_ORG}
          </p>
          <section aria-labelledby="guides-heading" className={SECTION}>
            <h2 id="guides-heading" className="sr-only">Guides</h2>
            <ul className="grid list-none gap-6 p-0 sm:grid-cols-2">
              {LEARN_ARTICLES.map((item) => (
                <li key={item.path}>
                  <a href={item.path} className="lx-glass block h-full rounded-3xl p-6 sm:p-8">
                    <h3 className="lx-display text-2xl text-[var(--color-ink)]">{item.h1}</h3>
                    <p className={`mt-3 ${BODY}`}>{item.description}</p>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </MarketingPageShell>
  );
};

export default LearnPage;
