/* Sticky space stage behind the landing hero, statement and story chapters.
 * One WebGL globe for the whole sequence: a sunrise horizon under the hero pulls back
 * to the full planet behind the statement, then settles beside the four chapters.
 * Decorative only (aria-hidden); every word of the story lives in the page HTML.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  centerPose,
  clamp,
  easeInOut,
  horizonPose,
  lerp,
  lerpPose,
  smoothstep,
  storyPose,
  storyProgress,
  type GlobePose,
} from './earth/globeMath';
import { STORY_CHAPTERS } from './earth/globeStory';
import type { GlobeLayers, GlobeRenderer, GlobeTarget } from './earth/globeRenderer';
import { isLowMemoryDevice, isSaveDataEnabled, prefersReducedMotion } from './constellationCapability';

interface SpaceStageProps {
  /** Scroll anchors in order: hero, statement, then one per story chapter. */
  anchors: React.MutableRefObject<Array<HTMLElement | null>>;
  /** Active story chapter index, or -1 before the chapters. */
  onChapterChange: (index: number) => void;
}

type Status = 'loading' | 'ready' | 'fallback';

const CHAPTER_LAYERS: readonly GlobeLayers[] = [
  { network: 0, story: 0, marker: 1, proof: 0, fix: 0, scan: 1 },
  { network: 0, story: 1, marker: 1, proof: 0, fix: 0, scan: 0 },
  { network: 0, story: 0.35, marker: 1, proof: 1, fix: 0, scan: 0 },
  { network: 0, story: 1, marker: 1, proof: 0, fix: 1, scan: 0 },
];

/** Story scalar S: 0 hero, 1 statement centred, 2 + i chapter i centred. */
export function chapterForProgress(s: number): number {
  if (s < 1.5) return -1;
  return clamp(Math.round(s - 2), 0, STORY_CHAPTERS.length - 1);
}

export function targetForProgress(s: number, w: number, h: number): GlobeTarget {
  let pose: GlobePose;
  if (s <= 1) pose = lerpPose(horizonPose(w, h), centerPose(w, h), easeInOut(s));
  else if (s <= 2) pose = lerpPose(centerPose(w, h), storyPose(w, h), easeInOut(s - 1));
  else pose = storyPose(w, h);

  const chapter = chapterForProgress(s);
  if (chapter < 0) {
    const toCenter = clamp(s, 0, 1);
    return {
      pose,
      lat: lerp(-18, 12, easeInOut(toCenter)),
      lon: null,
      layers: {
        network: lerp(0.6, 0.8, toCenter) * (1 - smoothstep(1.15, 1.5, s)),
        story: 0,
        marker: 0,
        proof: 0,
        fix: 0,
        scan: 0,
      },
      starShift: s * 90,
    };
  }
  const focus = STORY_CHAPTERS[chapter].focus;
  const fadeIn = smoothstep(1.5, 1.95, s);
  const base = CHAPTER_LAYERS[chapter];
  return {
    pose,
    lat: focus.lat,
    lon: focus.lon,
    layers: {
      network: 0,
      story: base.story * fadeIn,
      marker: base.marker * fadeIn,
      proof: base.proof * fadeIn,
      fix: base.fix * fadeIn,
      scan: base.scan * fadeIn,
    },
    starShift: s * 90,
  };
}

export const SpaceStage: React.FC<SpaceStageProps> = ({ anchors, onChapterChange }) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GlobeRenderer | null>(null);
  const chapterRef = useRef(-1);
  const onChapterRef = useRef(onChapterChange);
  const [status, setStatus] = useState<Status>('loading');

  onChapterRef.current = onChapterChange;

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!stage || !canvas || !overlay) return;

    let cancelled = false;
    const reduced = prefersReducedMotion();
    const lowPower =
      isLowMemoryDevice() || (navigator.hardwareConcurrency || 8) <= 4 || window.innerWidth < 640;

    const readProgress = (): number => {
      const vh = window.innerHeight || 800;
      const offsets: number[] = [];
      anchors.current.forEach((el, i) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        offsets.push(i === 0 ? rect.top : rect.top + rect.height / 2 - vh / 2);
      });
      return storyProgress(offsets);
    };

    const reportChapter = (s: number) => {
      const next = chapterForProgress(s);
      if (next !== chapterRef.current) {
        chapterRef.current = next;
        onChapterRef.current(next);
      }
    };

    const onScroll = () => {
      reportChapter(readProgress());
      rendererRef.current?.invalidate();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();

    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      rendererRef.current?.setVisible(visible);
    });
    io.observe(stage);

    const start = () => {
      if (cancelled) return;
      if (isSaveDataEnabled()) {
        setStatus('fallback');
        return;
      }
      import('./earth/globeRenderer')
        .then(({ createGlobeRenderer }) => {
          if (cancelled) return;
          rendererRef.current = createGlobeRenderer(canvas, overlay, {
            reducedMotion: reduced,
            lowPower,
            businessLabel: 'Your business',
            getTarget: (w, h) => {
              const s = readProgress();
              reportChapter(s);
              return targetForProgress(s, w, h);
            },
            onReady: () => {
              if (!cancelled) setStatus('ready');
            },
            onLost: () => {
              if (!cancelled) setStatus('fallback');
            },
          });
          rendererRef.current.setVisible(visible);
        })
        .catch((err: unknown) => {
          console.warn('[SpaceStage] static fallback:', err);
          if (!cancelled) setStatus('fallback');
        });
    };

    const idleWin = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | null = null;
    let timerId: number | null = null;
    if (typeof idleWin.requestIdleCallback === 'function') {
      idleId = idleWin.requestIdleCallback(start, { timeout: 600 });
    } else {
      timerId = window.setTimeout(start, 120);
    }

    return () => {
      cancelled = true;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      io.disconnect();
      if (idleId !== null) idleWin.cancelIdleCallback?.(idleId);
      if (timerId !== null) window.clearTimeout(timerId);
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [anchors]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
      <div ref={stageRef} className="lx-stage sticky top-0 h-[100svh] overflow-hidden">
        <div className={`lx-stars absolute inset-0 transition-opacity duration-1000 ${status === 'ready' ? 'opacity-0' : 'opacity-100'}`} />
        <div className={`lx-planet-fallback transition-opacity duration-1000 ${status === 'ready' ? 'opacity-0' : 'opacity-100'}`} />
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full transition-opacity duration-1000 motion-reduce:transition-none ${
            status === 'ready' ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <canvas
          ref={overlayRef}
          className={`absolute inset-0 h-full w-full transition-opacity duration-1000 motion-reduce:transition-none ${
            status === 'ready' ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>
    </div>
  );
};
