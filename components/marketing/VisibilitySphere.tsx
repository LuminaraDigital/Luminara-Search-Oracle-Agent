/**
 * Landing hero: one dotted visibility sphere on a starfield.
 * Canvas2D only. Ink dots, gold reserved for the limb and the four engine nodes.
 * Reduced motion draws one composed frame and does not start a loop.
 */
import React, { useEffect, useRef } from 'react';
import { isLowMemoryDevice, isSaveDataEnabled } from './constellationCapability';
import { SAMPLE_FIXTURE } from './demo/demoFixtures';
import { CONSTELLATION_ENGINE_LABELS, type ConstellationEngineId } from './constellationLayout';
import {
  HERO_ENGINE_ANCHORS,
  HERO_HUB_ANCHOR,
  HERO_MOON_SCALE,
  heroCap,
  heroSphereFrame,
  projectSpherePoint,
  starField,
  type ProjectedSpherePoint,
  type SphereProjector,
} from './sphereField';

const ENGINE_IDS = Object.keys(HERO_ENGINE_ANCHORS) as ConstellationEngineId[];

const LABEL_SIZE: Record<ConstellationEngineId, string> = {
  web_serp: 'text-[11px]',
  google_aio: 'text-[11px]',
  chatgpt: 'text-[13px]',
  perplexity: 'text-[13px]',
};

type RingPoint = { x: number; y: number; z: number };

function ring(kind: 'equator' | 'meridian' | 'meridian90', segments = 96): RingPoint[] {
  const pts: RingPoint[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    if (kind === 'equator') pts.push({ x: c, y: 0, z: s });
    else if (kind === 'meridian') pts.push({ x: c, y: s, z: 0 });
    else pts.push({ x: 0, y: c, z: s });
  }
  return pts;
}

const RINGS = [ring('equator'), ring('meridian'), ring('meridian90')];

export const VisibilitySphere: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<Partial<Record<ConstellationEngineId | 'hub', HTMLSpanElement | null>>>({});

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const quiet = () => motion.matches || isSaveDataEnabled() || isLowMemoryDevice();
    let reduced = quiet();
    let running = true;
    let visible = true;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dotCount = -1;
    let dots = heroCap(2600);
    const stars = starField(90);
    let pointer = { x: 0, y: 0 };
    let smooth = { x: 0, y: 0 };
    let yaw = 0;
    let last = 0;

    const place = (
      key: ConstellationEngineId | 'hub',
      projected: ProjectedSpherePoint,
      camera: SphereProjector,
      nudge: number,
      below = false,
    ) => {
      const el = labelsRef.current[key];
      if (!el) return;
      if (!projected.front) {
        el.style.opacity = '0';
        return;
      }
      let x = projected.sx;
      let y = projected.sy;
      if (below) {
        y += nudge;
      } else {
        const dx = projected.sx - camera.originX;
        const dy = projected.sy - camera.originY;
        const len = Math.hypot(dx, dy) || 1;
        x += (dx / len) * nudge;
        y += (dy / len) * nudge;
      }
      const inType = x > w * 0.3 && x < w * 0.7 && y > h * 0.1 && y < h * 0.56;
      const inView = x > 16 && x < w - 16 && y > 68 && y < h - 20;
      el.style.opacity = inType || !inView ? '0' : '1';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };

    const draw = () => {
      if (w < 2 || h < 2) return;
      const frame = heroSphereFrame(w, h);
      const yawNow = frame.yaw + (reduced ? 0 : yaw + smooth.x * 0.08);
      const pitchNow = frame.pitch + (reduced ? 0 : smooth.y * 0.08);
      const camera: SphereProjector = { ...frame, yaw: yawNow, pitch: pitchNow };
      const moon: SphereProjector = { ...camera, radius: frame.radius * HERO_MOON_SCALE };

      ctx.clearRect(0, 0, w, h);

      const body = ctx.createRadialGradient(
        camera.originX,
        camera.originY,
        camera.radius * 0.15,
        camera.originX,
        camera.originY,
        camera.radius,
      );
      body.addColorStop(0, 'rgba(241,241,241,0.045)');
      body.addColorStop(0.7, 'rgba(241,241,241,0.015)');
      body.addColorStop(1, 'rgba(241,241,241,0)');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(camera.originX, camera.originY, camera.radius, 0, Math.PI * 2);
      ctx.fill();

      for (const star of stars) {
        ctx.fillStyle = `rgba(241,241,241,${star.alpha})`;
        ctx.beginPath();
        ctx.arc(star.u * w, star.v * h, star.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(camera.originX, camera.originY, camera.radius, Math.PI * 0.22, Math.PI * 0.78);
      ctx.strokeStyle = 'rgba(191,149,63,0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(241,241,241,0.22)';
      for (const pts of RINGS) {
        ctx.beginPath();
        let pen = false;
        for (const point of pts) {
          const projected = projectSpherePoint(point, camera);
          if (!projected.front) {
            pen = false;
            continue;
          }
          if (!pen) {
            ctx.moveTo(projected.sx, projected.sy);
            pen = true;
          } else {
            ctx.lineTo(projected.sx, projected.sy);
          }
        }
        ctx.stroke();
      }

      const nextCount = w < 768 ? 900 : 2600;
      if (nextCount !== dotCount) {
        dotCount = nextCount;
        dots = heroCap(nextCount);
      }

      const painted: Array<{ sx: number; sy: number; z: number; alpha: number; size: number }> = [];
      for (const point of dots) {
        const projected = projectSpherePoint(point, camera);
        if (projected.sx < -24 || projected.sx > w + 24 || projected.sy < -24 || projected.sy > h + 24) {
          continue;
        }
        const depth = (projected.z + 1) / 2;
        const alpha = projected.front ? 0.5 + depth * 0.4 : 0.07;
        painted.push({
          sx: projected.sx,
          sy: projected.sy,
          z: projected.z,
          alpha: Math.min(0.95, alpha),
          size: projected.front ? 1.55 + depth * 1.15 : 0.6,
        });
      }
      painted.sort((a, b) => a.z - b.z);
      for (const dot of painted) {
        ctx.fillStyle = `rgba(241,241,241,${dot.alpha})`;
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, dot.size, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const id of ENGINE_IDS) {
        const projected = projectSpherePoint(HERO_ENGINE_ANCHORS[id], moon);
        if (projected.front && projected.sx > -8 && projected.sx < w + 8 && projected.sy > -8 && projected.sy < h + 8) {
          ctx.fillStyle = 'rgba(191,149,63,0.95)';
          ctx.beginPath();
          ctx.arc(projected.sx, projected.sy, 3.1, 0, Math.PI * 2);
          ctx.fill();
        }
        place(id, projected, camera, 22);
      }

      const hub = projectSpherePoint(HERO_HUB_ANCHOR, camera);
      if (hub.front) {
        ctx.fillStyle = 'rgba(252,246,186,0.95)';
        ctx.beginPath();
        ctx.arc(hub.sx, hub.sy, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
      place('hub', hub, camera, 28, true);
    };

    const resize = () => {
      const rect = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const loop = (t: number) => {
      if (!running) return;
      if (!visible || reduced) {
        raf = 0;
        return;
      }
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
      last = t;
      smooth.x += (pointer.x - smooth.x) * 0.06;
      smooth.y += (pointer.y - smooth.y) * 0.06;
      yaw = (yaw + dt * 0.15) % (Math.PI * 2);
      draw();
      raf = requestAnimationFrame(loop);
    };

    const wake = () => {
      if (!running || reduced || !visible || raf) return;
      last = 0;
      raf = requestAnimationFrame(loop);
    };

    const onMotion = () => {
      reduced = quiet();
      if (reduced) {
        cancelAnimationFrame(raf);
        raf = 0;
        yaw = 0;
        smooth = { x: 0, y: 0 };
        pointer = { x: 0, y: 0 };
        draw();
        return;
      }
      wake();
    };

    const onMove = (ev: PointerEvent) => {
      if (reduced || ev.pointerType === 'touch') return;
      const rect = root.getBoundingClientRect();
      if (
        ev.clientX < rect.left ||
        ev.clientX > rect.right ||
        ev.clientY < rect.top ||
        ev.clientY > rect.bottom
      ) {
        pointer = { x: 0, y: 0 };
        return;
      }
      pointer = {
        x: ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        y: ((ev.clientY - rect.top) / rect.height) * 2 - 1,
      };
    };

    resize();
    wake();

    const ro = new ResizeObserver(() => {
      resize();
      wake();
    });
    ro.observe(root);

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) {
          if (reduced) draw();
          else wake();
        } else {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      { threshold: 0.08 },
    );
    io.observe(root);

    motion.addEventListener?.('change', onMotion);
    window.addEventListener('pointermove', onMove, { passive: true });

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      motion.removeEventListener?.('change', onMotion);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {ENGINE_IDS.map((id) => (
        <span
          key={id}
          ref={(el) => {
            labelsRef.current[id] = el;
          }}
          className={`absolute hidden -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-sans text-[var(--color-ink)] md:block ${LABEL_SIZE[id]}`}
          style={{ left: -9999, top: -9999, opacity: 0 }}
        >
          {CONSTELLATION_ENGINE_LABELS[id]}
        </span>
      ))}
      <span
        ref={(el) => {
          labelsRef.current.hub = el;
        }}
        className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
        style={{ left: -9999, top: -9999, opacity: 0 }}
      >
        <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          Sample
        </span>
        <span className="block font-sans text-[13px] text-[var(--color-ink)]">{SAMPLE_FIXTURE.domain}</span>
      </span>
    </div>
  );
};
