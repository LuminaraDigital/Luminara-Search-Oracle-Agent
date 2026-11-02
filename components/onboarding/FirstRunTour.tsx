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
  tourIsWaiting,
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
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const nextBox = { top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 };
      setBox((prev) => (prev && prev.top === nextBox.top && prev.left === nextBox.left && prev.width === nextBox.width && prev.height === nextBox.height ? prev : nextBox));
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      actions.current.onSkip();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step, flag, anchors]);

  const waiting = tourIsWaiting({ signedInWeb: web, flag, anchors });
  if (typeof document === 'undefined') return null;
  if (waiting) {
    return createPortal(
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 left-4 z-[90] w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-gold/50 bg-black p-4 text-gray-100 shadow-2xl"
      >
        <p className="text-[11px] font-semibold tracking-wide text-gold-light">{progressLabel(2)}</p>
        <p className="mt-1 text-sm leading-relaxed text-gray-200">Waiting for your result.</p>
        <button
          type="button"
          onClick={onSkip}
          className="mt-3 min-h-11 px-2 text-sm text-gray-300 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          Skip
        </button>
      </div>,
      document.body,
    );
  }

  if (step == null) return null;
  const copy = tourCopy(step);
  const nextBlocked = flagAfterNext({ step, anchors }) === 'stay';
  const showBack = step > 1 && !(step === 2 && !anchors.hasUrl);
  const motion = reducedMotion() ? '' : 'transition-opacity duration-150';

  return createPortal(
    <div className={motion}>
      <div className="pointer-events-none fixed inset-0 z-[70]" aria-hidden="true" data-tour-blocks-primary="false" />
      {box && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[80] rounded-xl border-2 border-gold"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
          }}
        />
      )}
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="first-run-tour-title"
        aria-describedby="first-run-tour-body"
        tabIndex={-1}
        data-tour-step={step}
        data-tour-blocks-primary="false"
        className="pointer-events-auto fixed bottom-4 left-4 z-[90] w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-gold/50 bg-black p-4 text-gray-100 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-gold"
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
