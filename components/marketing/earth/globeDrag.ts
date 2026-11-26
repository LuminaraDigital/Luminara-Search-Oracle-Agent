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
/** Below this a fling would hold the globe still for its whole duration with nothing to show. */
const MIN_FLING_PX = 2;
/** A finger that rests this long before lifting has stopped, so the old speed no longer counts. */
const REST_MS = 100;
const NOT_DRAGGABLE = 'a,button,input,textarea,select,label,[role="button"],.overflow-x-auto';

export function attachGlobeDrag(
  surface: HTMLElement,
  globe: Pick<GlobeRenderer, 'dragBy' | 'setHeld'>,
): () => void {
  let flingS = 0;
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    flingS = FLING_S;
    return () => {
      flingS = 0;
    };
  });

  // pan-y also blocks sideways panning of a zoomed page, so hand it back while zoomed in.
  const viewport = window.visualViewport;
  const zoomed = () => !!viewport && viewport.scale > 1.01;
  const syncTouchAction = () => {
    surface.style.touchAction = zoomed() ? '' : 'pan-y pinch-zoom';
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

  const release = () => {
    pointer = null;
    if (dragging) globe.setHeld(false);
    dragging = false;
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    stopFling();
    // A second finger is a pinch, so the first lets go too. This also clears a gesture whose end never arrived.
    release();
    if (!e.isPrimary || zoomed()) return;
    if (e.target instanceof Element && e.target.closest(NOT_DRAGGABLE)) return;
    pointer = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    if (!dragging) {
      const intent = dragIntent(e.clientX - startX, e.clientY - startY);
      if (intent === 'wait') return;
      if (intent === 'none') {
        pointer = null;
        return;
      }
      dragging = true;
      velocity = 0;
      lastX = startX;
      lastT = e.timeStamp;
      globe.setHeld(true);
    }
    const dt = e.timeStamp - lastT;
    if (dt > 0) velocity = velocity * 0.2 + (((e.clientX - lastX) / dt) * 1000) * 0.8;
    globe.dragBy(e.clientX - lastX);
    lastX = e.clientX;
    lastT = e.timeStamp;
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    const px = dragging && e.timeStamp - lastT < REST_MS ? flingDistance(velocity, flingS) : 0;
    if (Math.abs(px) < MIN_FLING_PX) {
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

  // Only the start is scoped: the gesture must still end if the touched element is removed.
  surface.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('pointercancel', onCancel, { passive: true });

  return () => {
    stopFling();
    release();
    mm.revert();
    viewport?.removeEventListener('resize', syncTouchAction);
    surface.style.touchAction = '';
    surface.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  };
}
