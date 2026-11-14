import React, { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './deviceCapability';
import { addPoint, createTrail, POINT_LIFE_MS, prune, type TrailState } from './cursorTrailModel';

/** Where the trail leaves the pointer: the base of the arrow, measured from its tip. */
const TAIL_X = 11;
const TAIL_Y = 15;

function draw(ctx: CanvasRenderingContext2D, state: TrailState, now: number): void {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 1; i < state.points.length; i++) {
    const from = state.points[i - 1];
    const to = state.points[i];
    const fresh = 1 - (now - to.born) / POINT_LIFE_MS;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = `rgb(255 190 40 / ${0.16 * fresh})`;
    ctx.lineWidth = 12 * fresh;
    ctx.stroke();
    ctx.strokeStyle = `rgb(255 232 160 / ${0.85 * fresh})`;
    ctx.lineWidth = 2.2 * fresh;
    ctx.stroke();
  }
  for (const spark of state.sparks) {
    const age = now - spark.born;
    const seconds = age / 1000;
    ctx.fillStyle = `rgb(255 205 70 / ${1 - age / spark.life})`;
    ctx.fillRect(spark.x + spark.vx * seconds, spark.y + spark.vy * seconds, spark.size, spark.size);
  }
}

/**
 * The animated half of the gold cursor. The arrow is the native cursor (space.css), so the
 * hotspot never lags; this canvas only paints the energy trail behind it. Mouse only, and
 * not at all under reduced motion.
 */
export const CursorTrail: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || prefersReducedMotion() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const state = createTrail();
    let frame = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // Runs only while something is still fading, so an idle pointer costs nothing.
    const tick = () => {
      const now = performance.now();
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (!prune(state, now)) {
        frame = 0;
        return;
      }
      draw(ctx, state, now);
      frame = requestAnimationFrame(tick);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      addPoint(state, event.clientX + TAIL_X, event.clientY + TAIL_Y, performance.now());
      if (!frame) frame = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="lx-cursor-trail" />;
};
