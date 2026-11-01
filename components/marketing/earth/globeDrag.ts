/* Touch drag for the landing globe.
 * The stage sits behind the page and ignores pointers, so this listens on the story
 * wrapper around it. The browser keeps every vertical pan and pinch (touch-action), and
 * cancels the pointer when it takes one; only a horizontal swipe reaches the globe.
 * Lazy chunk, loaded for touch devices only once the globe is live, so GSAP never
 * weighs on first paint or on desktop visitors.
 */
import gsap from 'gsap';
import { dragIntent, flingDistance } from './globeMath';
import type { GlobeRenderer } from './globeRenderer';

const FLING_S = 1.2;
/** A finger that rests this long before lifting has stopped, so the old speed no longer counts. */
const REST_MS = 100;
const NOT_DRAGGABLE = 'a,button,input,textarea,select,label,[role="button"]';

export function attachGlobeDrag(surface: HTMLElement, globe: GlobeRenderer): () => void {
  let flingS = 0;
  const mm = gsap.matchMedia();
  mm.add(
    { motion: '(prefers-reduced-motion: no-preference)', reduce: '(prefers-reduced-motion: reduce)' },
    (context) => {
      flingS = context.conditions?.motion ? FLING_S : 0;
    },
  );

  // pan-y also blocks sideways panning of a zoomed page, so hand it back while zoomed in.
  const viewport = window.visualViewport;
  const syncTouchAction = () => {
    surface.style.touchAction = viewport && viewport.scale > 1.01 ? '' : 'pan-y pinch-zoom';
  };
  syncTouchAction();
  viewport?.addEventListener('resize', syncTouchAction);

  let pointer: number | null = null;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0;
  let fling: gsap.core.Tween | null = null;

  const stopFling = () => {
    if (!fling) return;
    fling.kill();
    fling = null;
    globe.setHeld(false);
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    stopFling();
    // A second finger is a pinch: let the first one go too.
    if (!e.isPrimary || pointer !== null) {
      release();
      return;
    }
    if (e.target instanceof Element && e.target.closest(NOT_DRAGGABLE)) return;
    pointer = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    if (!dragging) {
      const intent = dragIntent(e.clientX - startX, e.clientY - startY);
      if (intent === 'none') {
        pointer = null;
      } else if (intent === 'drag') {
        dragging = true;
        velocity = 0;
        lastX = e.clientX;
        lastT = e.timeStamp;
        globe.setHeld(true);
      }
      return;
    }
    const dt = e.timeStamp - lastT;
    if (dt > 0) velocity = velocity * 0.2 + (((e.clientX - lastX) / dt) * 1000) * 0.8;
    globe.dragBy(e.clientX - lastX);
    lastX = e.clientX;
    lastT = e.timeStamp;
  };

  function release(): void {
    pointer = null;
    if (dragging) globe.setHeld(false);
    dragging = false;
  }

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    const px = dragging && e.timeStamp - lastT < REST_MS ? flingDistance(velocity, flingS) : 0;
    if (!px) {
      release();
      return;
    }
    pointer = null;
    dragging = false;
    const spin = { px: 0 };
    let previous = 0;
    fling = gsap.to(spin, {
      px,
      duration: flingS,
      ease: 'power3.out',
      onUpdate: () => {
        globe.dragBy(spin.px - previous);
        previous = spin.px;
      },
      onComplete: () => {
        fling = null;
        globe.setHeld(false);
      },
    });
  };

  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === pointer) release();
  };

  surface.addEventListener('pointerdown', onDown, { passive: true });
  surface.addEventListener('pointermove', onMove, { passive: true });
  surface.addEventListener('pointerup', onUp, { passive: true });
  surface.addEventListener('pointercancel', onCancel, { passive: true });

  return () => {
    stopFling();
    release();
    mm.revert();
    viewport?.removeEventListener('resize', syncTouchAction);
    surface.style.touchAction = '';
    surface.removeEventListener('pointerdown', onDown);
    surface.removeEventListener('pointermove', onMove);
    surface.removeEventListener('pointerup', onUp);
    surface.removeEventListener('pointercancel', onCancel);
  };
}
