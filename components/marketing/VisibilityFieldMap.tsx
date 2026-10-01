/* Hallmark · pre-emit critique: P5 H5 E5 S4 R5 V5
 * Industry Map: Canvas2D gold point-field (Aethir DNA adapted). No Three on critical path.
 */
import React, { useEffect, useRef } from 'react';
import {
  CONSTELLATION_ENGINE_LABELS,
  CONSTELLATION_HUB,
  CONSTELLATION_NODE_POS,
  type ConstellationEngineId,
} from './constellationLayout';
import type { DemoEngineRow, DemoEngineStatus } from './demo/demoFixtures';

interface VisibilityFieldMapProps {
  engines: DemoEngineRow[];
  domainLabel?: string;
  className?: string;
}

type Particle = {
  x: number;
  y: number;
  z: number;
  bright: number;
  engine?: ConstellationEngineId;
};

function statusBright(status: DemoEngineStatus): number {
  switch (status) {
    case 'measured':
      return 1;
    case 'estimated':
      return 0.62;
    case 'pending':
      return 0.85;
    case 'not_measured':
      return 0.22;
    default:
      return 0.18;
  }
}

/** Fibonacci sphere points (deterministic, no Math.random metrics). */
function fibSphere(count: number): Particle[] {
  const out: Particle[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(count - 1, 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push({
      x: Math.cos(theta) * r,
      y,
      z: Math.sin(theta) * r,
      bright: 0.18 + (i % 7) * 0.04,
    });
  }
  return out;
}

function pctToSphere(x: number, y: number): { x: number; y: number; z: number } {
  // Map layout % into a mild ellipsoid shell so engines sit on the field.
  const lon = ((x - 50) / 50) * 0.95;
  const lat = ((50 - y) / 50) * 0.85;
  const cl = Math.cos(lat);
  return {
    x: Math.sin(lon) * cl,
    y: Math.sin(lat),
    z: Math.cos(lon) * cl,
  };
}

/**
 * Full-bleed visibility Map: gold point-cloud field with lit engine clusters.
 * Three.js replacement for this surface: Canvas2D (critical path stays light).
 */
export const VisibilityFieldMap: React.FC<VisibilityFieldMapProps> = ({
  engines,
  domainLabel = 'your site',
  className = '',
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const enginesRef = useRef(engines);
  enginesRef.current = engines;

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const base = fibSphere(reduced ? 420 : 980);
    // Seed brighter shells around each engine seat
    (Object.keys(CONSTELLATION_NODE_POS) as ConstellationEngineId[]).forEach((id, idx) => {
      const seat = pctToSphere(CONSTELLATION_NODE_POS[id].x, CONSTELLATION_NODE_POS[id].y);
      for (let k = 0; k < 28; k += 1) {
        const a = (k / 28) * Math.PI * 2 + idx;
        const s = 0.06 + (k % 5) * 0.01;
        base.push({
          x: seat.x + Math.cos(a) * s,
          y: seat.y + Math.sin(a * 1.3) * s * 0.7,
          z: seat.z + Math.sin(a) * s,
          bright: 0.55,
          engine: id,
        });
      }
    });

    let w = 0;
    let h = 0;
    let raf = 0;
    let running = true;
    let visible = true;
    let pointer = { x: 0, y: 0 };
    let smooth = { x: 0, y: 0 };
    let yaw = 0.15;
    let pitch = -0.12;

    const resize = () => {
      const rect = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const rotate = (p: Particle, y: number, x: number) => {
      const cy = Math.cos(y);
      const sy = Math.sin(y);
      const cx = Math.cos(x);
      const sx = Math.sin(x);
      let X = p.x * cy + p.z * sy;
      let Z = -p.x * sy + p.z * cy;
      const Y = p.y * cx - Z * sx;
      Z = p.y * sx + Z * cx;
      return { x: X, y: Y, z: Z, bright: p.bright, engine: p.engine };
    };

    const statusFor = (id?: ConstellationEngineId): DemoEngineStatus => {
      if (!id) return 'idle';
      return enginesRef.current.find((e) => e.id === id)?.status ?? 'not_measured';
    };

    const draw = (t: number) => {
      if (!running || w < 2 || h < 2) return;
      smooth.x += (pointer.x - smooth.x) * 0.06;
      smooth.y += (pointer.y - smooth.y) * 0.06;
      if (!reduced) {
        yaw = 0.18 + smooth.x * 0.55 + t * 0.000045;
        pitch = -0.1 + smooth.y * 0.35;
      } else {
        yaw = 0.18 + smooth.x * 0.2;
        pitch = -0.1 + smooth.y * 0.12;
      }

      ctx.clearRect(0, 0, w, h);

      // Atmospheric well
      const well = ctx.createRadialGradient(w * 0.52, h * 0.48, 0, w * 0.52, h * 0.48, Math.max(w, h) * 0.62);
      well.addColorStop(0, 'rgba(191,149,63,0.14)');
      well.addColorStop(0.45, 'rgba(170,119,28,0.05)');
      well.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = well;
      ctx.fillRect(0, 0, w, h);

      const scale = Math.min(w, h) * 0.42;
      const cx = w * 0.52;
      const cy = h * 0.48;
      const projected: Array<{
        sx: number;
        sy: number;
        depth: number;
        alpha: number;
        size: number;
        engine?: ConstellationEngineId;
      }> = [];

      for (const p of base) {
        const r = rotate(p, yaw, pitch);
        const depth = (r.z + 1.35) / 2.35;
        const sx = cx + r.x * scale * (0.72 + depth * 0.45);
        const sy = cy + r.y * scale * (0.72 + depth * 0.45);
        let bright = p.bright * (0.35 + depth * 0.9);
        if (p.engine) bright *= 0.55 + statusBright(statusFor(p.engine)) * 0.9;
        projected.push({
          sx,
          sy,
          depth,
          alpha: Math.min(1, bright),
          size: (0.6 + depth * 1.8) * (p.engine ? 1.55 : 1),
          engine: p.engine,
        });
      }

      projected.sort((a, b) => a.depth - b.depth);

      // Soft hinterland ring
      ctx.beginPath();
      ctx.ellipse(cx, cy, scale * 0.92, scale * 0.78, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(191,149,63,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();

      for (const pt of projected) {
        const g = ctx.createRadialGradient(pt.sx, pt.sy, 0, pt.sx, pt.sy, pt.size * 3.2);
        g.addColorStop(0, `rgba(252,246,186,${0.55 * pt.alpha})`);
        g.addColorStop(0.35, `rgba(191,149,63,${0.35 * pt.alpha})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pt.sx, pt.sy, pt.size * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(252,246,186,${0.75 * pt.alpha})`;
        ctx.beginPath();
        ctx.arc(pt.sx, pt.sy, pt.size * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }

      // Hub breath
      const breath = reduced ? 1 : 1 + Math.sin(t / 700) * 0.018;
      const hub = rotate(
        { ...pctToSphere(CONSTELLATION_HUB.x, CONSTELLATION_HUB.y), bright: 1 },
        yaw,
        pitch,
      );
      const hx = cx + hub.x * scale * (0.72 + ((hub.z + 1.35) / 2.35) * 0.45);
      const hy = cy + hub.y * scale * (0.72 + ((hub.z + 1.35) / 2.35) * 0.45);
      const hubG = ctx.createRadialGradient(hx, hy, 0, hx, hy, scale * 0.28 * breath);
      hubG.addColorStop(0, 'rgba(252,246,186,0.35)');
      hubG.addColorStop(0.4, 'rgba(191,149,63,0.12)');
      hubG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hubG;
      ctx.beginPath();
      ctx.arc(hx, hy, scale * 0.28 * breath, 0, Math.PI * 2);
      ctx.fill();

      // Edge fade into paper so the field lives in the page void (not a card)
      const edge = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.28, cx, cy, Math.max(w, h) * 0.72);
      edge.addColorStop(0, 'rgba(0,0,0,0)');
      edge.addColorStop(0.7, 'rgba(0,0,0,0.25)');
      edge.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, w, h);
    };

    const loop = (t: number) => {
      if (!running) return;
      if (!visible) {
        raf = 0;
        return;
      }
      draw(t);
      raf = requestAnimationFrame(loop);
    };

    const wake = () => {
      if (!running || raf) return;
      raf = requestAnimationFrame(loop);
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
        visible = entries.some((e) => e.isIntersecting);
        if (visible) wake();
      },
      { threshold: 0.05 },
    );
    io.observe(root);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType === 'touch') return;
      const rect = root.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      pointer = {
        x: ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        y: ((ev.clientY - rect.top) / rect.height) * 2 - 1,
      };
      wake();
    };
    const onLeave = () => {
      pointer = { x: 0, y: 0 };
      wake();
    };

    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <figure
      ref={rootRef}
      className={`relative w-full aspect-[5/4] max-h-[520px] overflow-hidden ${className}`}
      aria-label="Answer-engine visibility field"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <figcaption className="sr-only">
        Point-field map for {domainLabel}. Nodes: Google, AI Overviews, ChatGPT, Perplexity.
      </figcaption>
      <ul className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2 pointer-events-none">
        {(Object.keys(CONSTELLATION_ENGINE_LABELS) as ConstellationEngineId[]).map((id) => {
          const row = engines.find((e) => e.id === id);
          const lit = row?.status === 'measured' || row?.status === 'estimated';
          return (
            <li
              key={id}
              className={`text-[10px] font-mono tracking-wide px-2 py-1 border ${
                lit
                  ? 'border-[var(--color-accent)] text-[var(--gold-light)] bg-black/50'
                  : 'border-[var(--color-rule)] text-[var(--color-ink-2)] bg-black/35'
              }`}
            >
              {CONSTELLATION_ENGINE_LABELS[id]}
              {row ? ` · ${row.status.replace('_', ' ')}` : ''}
            </li>
          );
        })}
      </ul>
    </figure>
  );
};
