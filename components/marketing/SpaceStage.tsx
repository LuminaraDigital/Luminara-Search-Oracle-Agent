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
import { STORY_CHAPTERS, type StoryChapter } from './earth/globeStory';
import type { GlobeLayers, GlobeRenderer, GlobeTarget } from './earth/globeRenderer';
import { isLowMemoryDevice, isSaveDataEnabled, prefersReducedMotion } from './deviceCapability';

interface SpaceStageProps {
  /** Scroll anchors in order: hero, statement, then one per story chapter. */
  anchors: React.MutableRefObject<Array<HTMLElement | null>>;
  /** Active story chapter index, or -1 before the chapters. */
  onChapterChange: (index: number) => void;
}

/**
 * Hero camera: facing far south, so the horizon shows Southeast Asia and northern Australia.
 * The statement then centres on Australia. Luminara is a Melbourne business.
 */
const HERO_LAT = -68;
const STATEMENT_LAT = -20;

/** What the globe shows for each chapter (the ambient network is hero-only). */
const CHAPTER_LAYERS: Record<StoryChapter['id'], Omit<GlobeLayers, 'network'>> = {
  scan: { story: 0, marker: 1, proof: 0, fix: 0, scan: 1 },
  ask: { story: 1, marker: 1, proof: 0, fix: 0, scan: 0 },
  prove: { story: 0.35, marker: 1, proof: 1, fix: 0, scan: 0 },
  fix: { story: 1, marker: 1, proof: 0, fix: 1, scan: 0 },
};

export interface StageLayout {
  /** Viewport is at or above the CSS lg breakpoint. */
  wide: boolean;
  /** Reduced motion: one still pose per section, no scroll-linked zoom or parallax. */
  reduced: boolean;
}

/** Story scalar S: 0 hero, 1 statement centred, 2 + i chapter i centred. */
export function chapterForProgress(s: number): number {
  if (s < 1.5) return -1;
  return clamp(Math.round(s - 2), 0, STORY_CHAPTERS.length - 1);
}

export function targetForProgress(
  rawS: number,
  w: number,
  h: number,
  layout: StageLayout = { wide: w >= 1024, reduced: false },
): GlobeTarget {
  const s = layout.reduced ? Math.round(rawS) : rawS;
  const story = storyPose(w, h, layout.wide);
  let pose: GlobePose;
  if (s <= 1) pose = lerpPose(horizonPose(w, h), centerPose(w, h), easeInOut(s));
  else if (s <= 2) pose = lerpPose(centerPose(w, h), story, easeInOut(s - 1));
  else pose = story;
  const starShift = layout.reduced ? 0 : s * 90;

  const chapter = chapterForProgress(s);
  if (chapter < 0) {
    const toCenter = clamp(s, 0, 1);
    return {
      pose,
      lat: lerp(HERO_LAT, STATEMENT_LAT, easeInOut(toCenter)),
      lon: null,
      layers: {
        network: lerp(0.6, 0.8, toCenter) * (1 - smoothstep(1.15, 1.5, s)),
        story: 0,
        marker: 0,
        proof: 0,
        fix: 0,
        scan: 0,
      },
      starShift,
    };
  }
  const { id, focus } = STORY_CHAPTERS[chapter];
  const fadeIn = smoothstep(1.5, 1.95, s);
  const base = CHAPTER_LAYERS[id];
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
    starShift,
  };
}

export const SpaceStage: React.FC<SpaceStageProps> = ({ anchors, onChapterChange }) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GlobeRenderer | null>(null);
  const chapterRef = useRef(-1);
  const onChapterRef = useRef(onChapterChange);
  const [ready, setReady] = useState(false);

  onChapterRef.current = onChapterChange;

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!stage || !canvas || !overlay) return;

    let cancelled = false;
    const reduced = prefersReducedMotion();
    const wideQuery = window.matchMedia('(min-width: 1024px)');
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
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting);
            rendererRef.current?.setVisible(visible);
          });
    io?.observe(stage);

    const start = () => {
      if (cancelled || isSaveDataEnabled()) return;
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
              return targetForProgress(s, w, h, { wide: wideQuery.matches, reduced });
            },
            onReady: () => {
              if (!cancelled) setReady(true);
            },
            onFail: () => {
              if (!cancelled) setReady(false);
            },
          });
          rendererRef.current.setVisible(visible);
        })
        .catch((err: unknown) => {
          // No WebGL, a software rasteriser or a missing chunk: the CSS planet stays.
          console.warn('[SpaceStage] static fallback:', err);
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
      io?.disconnect();
      if (idleId !== null) idleWin.cancelIdleCallback?.(idleId);
      if (timerId !== null) window.clearTimeout(timerId);
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [anchors]);

  const shown = ready ? 'opacity-100' : 'opacity-0';
  const fallback = ready ? 'opacity-0' : 'opacity-100';
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
      <div ref={stageRef} className="lx-stage sticky top-0 h-[100svh] overflow-hidden">
        <div className={`lx-stars absolute inset-0 transition-opacity duration-1000 motion-reduce:transition-none ${fallback}`} />
        <div className={`lx-planet-fallback transition-opacity duration-1000 motion-reduce:transition-none ${fallback}`} />
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full transition-opacity duration-1000 motion-reduce:transition-none ${shown}`}
        />
        <canvas
          ref={overlayRef}
          className={`absolute inset-0 h-full w-full transition-opacity duration-1000 motion-reduce:transition-none ${shown}`}
        />
      </div>
    </div>
  );
};
