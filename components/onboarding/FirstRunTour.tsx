import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ICONS } from '../../constants';
import {
  flagAfterBack,
  flagAfterNext,
  persistTourFlag,
  progressLabel,
  readTourFlag,
  replayTour,
  tourCopy,
  tourStepToShow,
  type TourAnchors,
  type TourFlag,
} from '../../services/onboarding/firstRunTour';
import { noteWorkspaceDirty } from '../../services/sync/workspaceSyncService';
import { isInTelegram } from '../../services/telegram/tma';

const EMPTY_ANCHORS: TourAnchors = {
  hasUrl: false,
  hasResult: false,
  hasFix: false,
  hasRecheck: false,
};

function readAnchors(): TourAnchors {
  return {
    hasUrl: Boolean(document.getElementById('audit-target-url')),
    hasResult: Boolean(document.getElementById('tour-audit-result')),
    hasFix: Boolean(document.getElementById('tour-top-fix')),
    hasRecheck: Boolean(document.getElementById('tour-mark-done')),
  };
}

function sameAnchors(a: TourAnchors, b: TourAnchors): boolean {
  return a.hasUrl === b.hasUrl && a.hasResult === b.hasResult && a.hasFix === b.hasFix && a.hasRecheck === b.hasRecheck;
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea')]
    .filter((el) => !el.hasAttribute('disabled'));
}

function placeCard(anchor: DOMRect, card: DOMRect): { top: number; left: number } {
  const margin = 12;
  const gap = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.left;
  if (left + card.width > vw - margin) left = vw - margin - card.width;
  if (left < margin) left = margin;
  let top = anchor.bottom + gap;
  if (top + card.height > vh - margin) top = anchor.top - gap - card.height;
  if (top < margin) top = Math.max(margin, vh - card.height - margin);
  return { top, left };
}

export function ReplayTourButton({ onDone, goToAudit }: { onDone: () => void; goToAudit: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        replayTour({ push: noteWorkspaceDirty });
        goToAudit();
        onDone();
      }}
      className="w-full text-left px-3 py-2.5 min-h-11 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2 border-t border-white/5 mt-1 pt-2 outline-none focus-visible:ring-2 focus-visible:ring-gold"
    >
      <ICONS.Sparkle className="w-3.5 h-3.5 text-gold-light" />
      <span>Replay tour</span>
    </button>
  );
}

export function FirstRunTour({ signedInWeb }: { signedInWeb: boolean }) {
  const web = signedInWeb && !isInTelegram();
  const [flag, setFlag] = useState<TourFlag>(() => readTourFlag());
  const [anchors, setAnchors] = useState<TourAnchors>(EMPTY_ANCHORS);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const step = tourStepToShow({ signedInWeb: web, flag, anchors });

  const save = (next: TourFlag) => {
    persistTourFlag(next, { push: noteWorkspaceDirty });
    setFlag(next);
  };

  useEffect(() => {
    const sync = () => setFlag(readTourFlag());
    window.addEventListener('luminara-replay-tour', sync);
    window.addEventListener('luminara-workspace-restored', sync);
    return () => {
      window.removeEventListener('luminara-replay-tour', sync);
      window.removeEventListener('luminara-workspace-restored', sync);
    };
  }, []);

  useEffect(() => {
    if (!web || flag === 'done') return;
    const read = () => {
      const next = readAnchors();
      setAnchors((prev) => (sameAnchors(prev, next) ? prev : next));
    };
    read();
    const timer = window.setInterval(read, 500);
    return () => window.clearInterval(timer);
  }, [web, flag]);

  useEffect(() => {
    if (step == null) return;
    const el = document.getElementById(tourCopy(step).anchorId);
    el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [step]);

  useLayoutEffect(() => {
    if (step == null) return;
    const measure = () => {
      const el = document.getElementById(tourCopy(step).anchorId);
      const card = dialogRef.current;
      if (!el || !card) return;
      const rect = el.getBoundingClientRect();
      const nextBox = { top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 };
      const nextPos = placeCard(rect, card.getBoundingClientRect());
      setBox((prev) => (prev && prev.top === nextBox.top && prev.left === nextBox.left && prev.width === nextBox.width && prev.height === nextBox.height ? prev : nextBox));
      setCardPos((prev) => (prev && prev.top === nextPos.top && prev.left === nextPos.left ? prev : nextPos));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const timer = window.setInterval(measure, 200);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.clearInterval(timer);
    };
  }, [step, anchors]);

  const onSkip = () => save('done');
  const onNext = () => {
    if (step == null) return;
    const next = flagAfterNext({ step, anchors });
    if (next !== 'stay') save(next);
  };
  const onBack = () => {
    if (step == null || step === 1) return;
    save(flagAfterBack(step));
  };
  const actions = useRef({ onSkip, onNext, onBack });
  actions.current = { onSkip, onNext, onBack };

  useEffect(() => {
    if (step == null) return;
    const root = dialogRef.current;
    if (!root) return;
    const list = focusable(root);
    (list[list.length - 1] ?? root).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        actions.current.onSkip();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        actions.current.onNext();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        actions.current.onBack();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable(root);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [step, flag, anchors]);

  if (step == null || typeof document === 'undefined') return null;
  const copy = tourCopy(step);
  const nextBlocked = flagAfterNext({ step, anchors }) === 'stay';
  const showBack = step > 1 && !(step === 2 && !anchors.hasUrl);
  const motion = reducedMotion() ? '' : 'transition-opacity duration-150';

  return createPortal(
    <div className={motion}>
      <div className="fixed inset-0 z-[70]" aria-hidden="true" />
      {box && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[80] rounded-xl border-2 border-gold"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.78)',
          }}
        />
      )}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-tour-title"
        aria-describedby="first-run-tour-body"
        tabIndex={-1}
        data-tour-step={step}
        className="fixed z-[90] w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-gold/50 bg-black p-4 text-gray-100 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-gold"
        style={cardPos ? { top: cardPos.top, left: cardPos.left } : { top: 12, left: 12 }}
      >
        <p className="text-[11px] font-semibold tracking-wide text-gold-light">{progressLabel(step)}</p>
        <h2 id="first-run-tour-title" className="mt-1 text-base font-semibold text-white">{copy.title}</h2>
        <div aria-live="polite">
          <p id="first-run-tour-body" className="mt-2 text-sm leading-relaxed text-gray-200">{copy.body}</p>
          {nextBlocked && (
            <p className="mt-2 text-sm leading-relaxed text-gray-400">The recheck button is not on screen yet.</p>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="min-h-11 px-2 text-sm text-gray-300 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {showBack && (
              <button
                type="button"
                onClick={onBack}
                className="min-h-11 rounded-lg border border-white/20 px-3 text-sm text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={onNext}
              disabled={nextBlocked}
              className="min-h-11 rounded-lg bg-gold px-4 text-sm font-semibold text-black hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              {step === 4 ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
