import React, { useEffect, useRef, useState } from 'react';
import { MARKETING_ORIGIN } from '../../services/marketing/pageMeta';
import { WHITE_PAPER_PATH } from '../../services/marketing/whitePaper';
import { WHITE_PAPER_SECTIONS } from '../../services/marketing/whitePaperSections';
import { MARKETING_BODY } from './MarketingPageShell';
import { BlockView, SourceAppendix } from './whitePaperRender';
import './whitePaper.css';

const CANONICAL = `${MARKETING_ORIGIN}${WHITE_PAPER_PATH}`;

export function storyIndexAfterKey(index: number, key: string, count: number): number {
  if (count <= 0) return 0;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return Math.min(count - 1, index + 1);
  if (key === 'ArrowLeft' || key === 'ArrowUp') return Math.max(0, index - 1);
  return index;
}

/** Positive dx moves back a page. A small or mostly vertical move stays put. */
export function storyIndexAfterSwipe(index: number, dx: number, dy: number, count: number): number {
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return index;
  return storyIndexAfterKey(index, dx < 0 ? 'ArrowRight' : 'ArrowLeft', count);
}

function indexFromHash(fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const id = window.location.hash.replace(/^#/, '');
  const found = WHITE_PAPER_SECTIONS.findIndex((section) => section.id === id);
  return found >= 0 ? found : fallback;
}

interface WhitePaperStoryProps {
  reducedMotion?: boolean;
  initialIndex?: number;
}

/** One chapter per page. Same section HTML as the long form. Canonical stays /white-paper. */
const WhitePaperStory: React.FC<WhitePaperStoryProps> = ({ reducedMotion, initialIndex = 0 }) => {
  const [index, setIndex] = useState(() => indexFromHash(initialIndex));
  const [leaving, setLeaving] = useState(false);
  const [reduced, setReduced] = useState(reducedMotion ?? false);
  const pageRef = useRef<HTMLElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const count = WHITE_PAPER_SECTIONS.length;
  const section = WHITE_PAPER_SECTIONS[index];

  useEffect(() => {
    if (reducedMotion !== undefined) {
      setReduced(reducedMotion);
      return;
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [reducedMotion]);

  const indexRef = useRef(index);
  const reducedRef = useRef(reduced);
  const turn = useRef(0);
  indexRef.current = index;
  reducedRef.current = reduced;

  const go = (next: number) => {
    if (next === indexRef.current) return;
    if (reducedRef.current) {
      setIndex(next);
      return;
    }
    const token = ++turn.current;
    setLeaving(true);
    window.setTimeout(() => {
      if (turn.current !== token) return;
      setIndex(next);
      setLeaving(false);
    }, 280);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      const next = storyIndexAfterKey(indexRef.current, event.key, count);
      if (next === indexRef.current) return;
      event.preventDefault();
      go(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count]);

  useEffect(() => {
    pageRef.current?.focus();
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'story');
    url.hash = section.id;
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) {
      window.history.replaceState({}, '', next);
    }
  }, [section.id]);

  const close = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const hash = window.location.hash;
    window.history.pushState({}, '', `${WHITE_PAPER_PATH}${hash}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="lx-story lx-story-stage" data-motion={reduced ? 'fade' : 'turn'}>
      <link rel="canonical" href={CANONICAL} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[var(--gold-light)]">Story mode</p>
        <a href={WHITE_PAPER_PATH} className="lx-link inline-flex min-h-11 items-center text-sm" onClick={close}>
          Long form
        </a>
      </div>
      <article
        ref={pageRef}
        id={section.id}
        tabIndex={-1}
        aria-labelledby={`${section.id}-heading`}
        className={`lx-story-page lx-glass max-h-[calc(100dvh-26rem)] overflow-y-auto rounded-3xl px-6 py-8 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] sm:px-10 ${leaving ? 'is-out' : ''}`}
        onPointerDown={(event) => {
          pointer.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          if (!pointer.current) return;
          const dx = event.clientX - pointer.current.x;
          const dy = event.clientY - pointer.current.y;
          pointer.current = null;
          go(storyIndexAfterSwipe(index, dx, dy, count));
        }}
      >
        <h2 id={`${section.id}-heading`} className="lx-display lx-h3">
          {section.title}
        </h2>
        {section.blocks.map((block, blockIndex) => (
          <BlockView key={`${section.id}-${blockIndex}`} block={block} />
        ))}
        {section.id === 'sources' ? <SourceAppendix /> : null}
      </article>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <button type="button" className="lx-link min-h-11 px-2 text-sm" onClick={() => go(storyIndexAfterKey(index, 'ArrowLeft', count))} disabled={index === 0}>
          Previous
        </button>
        <p aria-live="polite" className={`text-sm ${MARKETING_BODY}`}>
          Page {index + 1} of {count}
          <span className="sr-only">. {section.title}</span>
        </p>
        <button type="button" className="lx-link min-h-11 px-2 text-sm" onClick={() => go(storyIndexAfterKey(index, 'ArrowRight', count))} disabled={index === count - 1}>
          Next
        </button>
      </div>
    </div>
  );
};

export default WhitePaperStory;
