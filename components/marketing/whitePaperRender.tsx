import React from 'react';
import {
  isCited,
  WHITE_PAPER_PRODUCT_LINKS,
  WHITE_PAPER_SHOTS,
  type Cited,
  type ClaimLabel,
  type Rich,
  type ShotFile,
  type WhitePaperBlock,
} from '../../services/marketing/whitePaper';
import { WHITE_PAPER_AGENCY_BRIEF } from '../../services/marketing/whitePaperSections';
import { compareSourceIds, WHITE_PAPER_SOURCES } from '../../services/marketing/whitePaperSources';
import { MARKETING_BODY } from './MarketingPageShell';
import './whitePaper.css';

const CHIP: Record<ClaimLabel, string> = {
  Fact: 'border-[var(--color-accent)] text-[var(--gold-light)]',
  Estimate: 'border-[var(--color-accent)] text-[var(--color-ink)]',
  Speculation: 'border-dashed border-[var(--color-ink)] text-[var(--color-ink)]',
};

export function openSource(id: string) {
  const el = document.getElementById(`src-${id}`);
  if (el instanceof HTMLDetailsElement) el.open = true;
}

export const CitedSpan: React.FC<{ cited: Cited }> = ({ cited }) => (
  <>
    {cited.text ? <span>{cited.text} </span> : null}
    <span className="mx-0.5 inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-1 align-baseline">
      <span className={`lx-claim inline-flex items-baseline gap-1 rounded-full border px-2 py-0.5 font-semibold uppercase tracking-[0.08em] ${CHIP[cited.label]}`}>
        {cited.label}
        {cited.note ? <span className="font-normal normal-case tracking-normal">{cited.note}</span> : null}
      </span>
      {cited.sources.map((id) => (
        <a key={id} href={`#src-${id}`} className="lx-link text-[13px]" onClick={() => openSource(id)}>
          {id}
        </a>
      ))}
    </span>
  </>
);

export const RichText: React.FC<{ parts: readonly Rich[] }> = ({ parts }) => (
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
        <p className="px-5 pt-5 text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--gold-light)]">
          Illustrative example, not a measurement
        </p>
      ) : null}
      <img
        src={shot.src}
        srcSet={shot.srcSet}
        sizes="(min-width: 48rem) 720px, 100vw"
        alt={shot.alt}
        width={shot.width}
        height={shot.height}
        loading="lazy"
        decoding="async"
        className="h-auto w-full"
      />
      <figcaption className={`px-5 py-4 text-sm leading-relaxed ${MARKETING_BODY}`}>{shot.caption}</figcaption>
    </figure>
  );
};

export const BlockView: React.FC<{ block: WhitePaperBlock }> = ({ block }) => {
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
      <div className="lx-glass mt-8 overflow-hidden rounded-3xl">
        <p className={`px-5 py-4 ${MARKETING_BODY}`}>{block.caption}</p>
        <div className="lx-wp-stack border-t lx-hairline md:hidden">
          {block.rows.map((row, rowIndex) => (
            <div key={rowIndex} className="space-y-3 border-t lx-hairline px-5 py-4">
              {row.map((cell, cellIndex) => (
                <p key={cellIndex} className={MARKETING_BODY}>
                  <span className="mb-1 block text-[13px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink)]">
                    {block.columns[cellIndex]}
                  </span>
                  <RichText parts={[cell]} />
                </p>
              ))}
            </div>
          ))}
        </div>
        <div className="hidden md:block">
          <table className="w-full text-left">
            <caption className="sr-only">{block.caption}</caption>
            <thead>
              <tr className="border-t lx-hairline">
                {block.columns.map((column) => (
                  <th key={column} scope="col" className="px-5 py-3 text-[13px] font-medium uppercase tracking-[0.14em] text-[var(--color-ink)]">
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

export const SourceAppendix: React.FC = () => {
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

export const AgencyBrief: React.FC = () => (
  <aside className="lx-glass mx-auto mt-12 max-w-3xl rounded-3xl px-6 py-7 text-left sm:px-8" aria-labelledby="agency-brief-heading">
    <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[var(--gold-light)]">{WHITE_PAPER_AGENCY_BRIEF.kicker}</p>
    <h2 id="agency-brief-heading" className="lx-display lx-h3 mt-3">
      {WHITE_PAPER_AGENCY_BRIEF.title}
    </h2>
    <ul className="mt-5 space-y-4">
      {WHITE_PAPER_AGENCY_BRIEF.items.map((item, index) => (
        <li key={index} className={`flex gap-3 ${MARKETING_BODY}`}>
          <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
          <span>
            <RichText parts={item} />
          </span>
        </li>
      ))}
    </ul>
  </aside>
);
