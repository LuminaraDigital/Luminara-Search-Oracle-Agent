import React, { useEffect, useState } from 'react';
import type { AuditHandoff } from '../../services/activation/auditHandoff';
import {
  isCited,
  collectSourceIds,
  WHITE_PAPER_PRODUCT_LINKS,
  WHITE_PAPER_SHOTS,
  type Cited,
  type ClaimLabel,
  type Rich,
  type ShotFile,
  type WhitePaperBlock,
} from '../../services/marketing/whitePaper';
import { WHITE_PAPER_SECTIONS } from '../../services/marketing/whitePaperSections';
import { compareSourceIds, whitePaperSource, WHITE_PAPER_SOURCES } from '../../services/marketing/whitePaperSources';
import { DomainCheck } from './DomainCheck';
import { prefersReducedMotion } from './deviceCapability';
import { MARKETING_BODY, MARKETING_SECTION, MarketingPageHeader, MarketingPageShell } from './MarketingPageShell';

const CHECK_INPUT_ID = 'white-paper-domain';

const CHIP: Record<ClaimLabel, string> = {
  Fact: 'border-[var(--color-accent)] text-[var(--gold-light)]',
  Estimate: 'border-[var(--color-accent)] text-[var(--color-ink)]',
  Speculation: 'border-dashed border-[var(--color-ink-2)] text-[var(--color-ink-2)]',
};

function openSource(id: string) {
  const el = document.getElementById(`src-${id}`);
  if (el instanceof HTMLDetailsElement) el.open = true;
}

const CitedSpan: React.FC<{ cited: Cited }> = ({ cited }) => (
  <>
    {cited.text ? <span>{cited.text} </span> : null}
    <span className="mx-0.5 inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-1 align-baseline">
      <span className={`inline-flex items-baseline gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${CHIP[cited.label]}`}>
        {cited.label}
        {cited.note ? <span className="font-normal normal-case tracking-normal">{cited.note}</span> : null}
      </span>
      {cited.sources.map((id) => (
        <a key={id} href={`#src-${id}`} className="lx-link text-[11px]" onClick={() => openSource(id)}>
          {id}
        </a>
      ))}
    </span>
  </>
);

const RichText: React.FC<{ parts: readonly Rich[] }> = ({ parts }) => (
  <>
    {parts.map((part, index) =>
      isCited(part) ? <CitedSpan key={index} cited={part} /> : <span key={index}>{part}</span>,
    )}
  </>
);

const ShotFigure: React.FC<{ file: ShotFile }> = ({ file }) => {
  const shot = WHITE_PAPER_SHOTS[file];
  return (
    <figure className="lx-glass overflow-hidden rounded-3xl">
      {shot.illustrative ? (
        <p className="px-5 pt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--gold-light)]">
          Illustrative example, not a measurement
        </p>
      ) : null}
      <img
        src={`/marketing/white-paper/${file}`}
        alt={shot.alt}
        width={1920}
        height={1200}
        loading="lazy"
        decoding="async"
        className="h-auto w-full"
      />
      <figcaption className={`px-5 py-4 text-sm leading-relaxed ${MARKETING_BODY}`}>{shot.caption}</figcaption>
    </figure>
  );
};

const BlockView: React.FC<{ block: WhitePaperBlock }> = ({ block }) => {
  if (block.kind === 'p') {
    return (
      <p className={`mt-5 ${MARKETING_BODY}`}>
        <RichText parts={block.parts} />
      </p>
    );
  }
  if (block.kind === 'ul') {
    return (
      <ul className="mt-5 space-y-4">
        {block.items.map((item, index) => (
          <li key={index} className={`flex gap-3 ${MARKETING_BODY}`}>
            <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
            <span>
              <RichText parts={item} />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === 'table') {
    return (
      <div className="lx-glass mt-8 overflow-x-auto rounded-3xl">
        <table className="w-full min-w-[40rem] text-left">
          <caption className={`px-5 py-4 text-left ${MARKETING_BODY}`}>{block.caption}</caption>
          <thead>
            <tr className="border-t lx-hairline">
              {block.columns.map((column) => (
                <th key={column} scope="col" className="px-5 py-3 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t lx-hairline">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={`px-5 py-4 align-top ${MARKETING_BODY}`}>
                    <RichText parts={[cell]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.kind === 'shots') {
    return (
      <div className="mt-8 grid gap-6">
        {block.files.map((file) => (
          <ShotFigure key={file} file={file} />
        ))}
      </div>
    );
  }
  if (block.kind === 'links') {
    return (
      <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-3">
        {WHITE_PAPER_PRODUCT_LINKS.map((link) => {
          const external = link.href.startsWith('http');
          return (
            <li key={link.href}>
              <a
                href={link.href}
                className="lx-link inline-flex min-h-11 items-center text-sm"
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {link.label}
                {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
    );
  }
  const _exhaustive: never = block;
  return _exhaustive;
};

const SourceAppendix: React.FC = () => {
  const sources = [...WHITE_PAPER_SOURCES].sort((a, b) => compareSourceIds(a.id, b.id));
  return (
    <div className="mt-8 border-b lx-hairline">
      {sources.map((source) => (
        <details key={source.id} id={`src-${source.id}`} className="lx-faq group border-t lx-hairline scroll-mt-36">
          <summary className="flex items-start justify-between gap-4 py-4">
            <span className="text-[15px] leading-snug text-[var(--color-ink)]">
              <span className="mr-2 text-[var(--gold-light)]">{source.id}</span>
              {source.title}
            </span>
            <span
              aria-hidden
              className="lx-faq-icon mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-rule)] text-lg leading-none text-[var(--gold-light)]"
            >
              +
            </span>
          </summary>
          <div className={`max-w-3xl pb-5 ${MARKETING_BODY}`}>
            <p>{source.notes}</p>
            <p className="mt-2">Accessed 2 November 2026.</p>
            <ul className="mt-2 space-y-1">
              {source.urls.map((url) => (
                <li key={url}>
                  <a href={url} className="lx-link break-all" target="_blank" rel="noopener noreferrer">
                    {url}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ))}
    </div>
  );
};

interface WhitePaperPageProps {
  isAuthenticated?: boolean;
  onFullAudit: (handoff?: AuditHandoff) => void;
}

/** Product and methodology paper. Claims are labeled and linked to the source appendix. */
const WhitePaperPage: React.FC<WhitePaperPageProps> = ({ isAuthenticated, onFullAudit }) => {
  const [current, setCurrent] = useState<(typeof WHITE_PAPER_SECTIONS)[number]['id']>(WHITE_PAPER_SECTIONS[0].id);

  useEffect(() => {
    window.scrollTo(0, 0);
    const openFromHash = () => {
      const id = window.location.hash.replace(/^#src-/, '');
      if (id) openSource(id);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
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
  }, []);

  const goToCheck = () => {
    const input = document.getElementById(CHECK_INPUT_ID);
    input?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    window.setTimeout(() => input?.focus({ preventScroll: true }), 400);
  };

  return (
    <MarketingPageShell
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
        form: (
          <div>
            <DomainCheck
              inputId={CHECK_INPUT_ID}
              isAuthenticated={isAuthenticated}
              onFullAudit={onFullAudit}
              surface="white_paper"
            />
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
              {WHITE_PAPER_PRODUCT_LINKS.map((link) => {
                const external = link.href.startsWith('http');
                return (
                  <li key={`close-${link.href}`}>
                    <a
                      href={link.href}
                      className="lx-link inline-flex min-h-11 items-center text-sm"
                      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    >
                      {link.label}
                      {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ),
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
      </MarketingPageHeader>

      <nav
        aria-label="White paper sections"
        className="sticky z-40 -mx-5 mt-12 border-y bg-black/90 px-5 py-1 lx-hairline sm:-mx-8 sm:px-8"
        style={{ top: 'calc(4.25rem + env(safe-area-inset-top, 0px))' }}
      >
        <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto">
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
          <section
            key={section.id}
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
        );
      })}
    </MarketingPageShell>
  );
};

export default WhitePaperPage;
