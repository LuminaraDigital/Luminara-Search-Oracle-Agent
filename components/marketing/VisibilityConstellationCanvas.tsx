import React, { useEffect, useRef } from 'react';
import { ConstellationPlate } from './ConstellationPlate';
import { CONSTELLATION_HUB, constellationNodePos } from './constellationLayout';
import type { DemoEngineId, DemoEngineStatus } from './demo/demoFixtures';
import type { VisibilityConstellationViewProps } from './VisibilityConstellationSvg';

interface CanvasProps extends VisibilityConstellationViewProps {
  onContextLost?: () => void;
}

interface Palette {
  paper2: string;
  ink: string;
  ink2: string;
  accent: string;
  accent2: string;
  goldLight: string;
}

function readPalette(el: HTMLElement): Palette {
  const s = getComputedStyle(el);
  return {
    paper2: s.getPropertyValue('--color-paper-2').trim() || '#1a1a14',
    ink: s.getPropertyValue('--color-ink').trim() || '#f1f1f1',
    ink2: s.getPropertyValue('--color-ink-2').trim() || '#a8a89a',
    accent: s.getPropertyValue('--color-accent').trim() || '#bf953f',
    accent2: s.getPropertyValue('--color-accent-2').trim() || '#fcf6ba',
    goldLight: s.getPropertyValue('--gold-light').trim() || '#fcf6ba',
  };
}

function nodeStyle(status: DemoEngineStatus, p: Palette): {
  fill: string;
  stroke: string;
  alpha: number;
  dash: boolean;
  glow: number;
} {
  switch (status) {
    case 'measured':
      return { fill: p.accent, stroke: p.accent2, alpha: 0.95, dash: false, glow: 1 };
    case 'estimated':
      return { fill: p.accent, stroke: p.goldLight, alpha: 0.55, dash: false, glow: 0.55 };
    case 'pending':
      return { fill: 'transparent', stroke: p.accent, alpha: 0.9, dash: false, glow: 0.75 };
    case 'not_measured':
      return { fill: 'transparent', stroke: 'rgba(255,255,255,0.28)', alpha: 0.65, dash: true, glow: 0 };
    default:
      return { fill: 'transparent', stroke: 'rgba(255,255,255,0.2)', alpha: 0.45, dash: true, glow: 0 };
  }
}

function truncateLabel(label: string, max = 14): string {
  return label.length > max ? `${label.slice(0, max - 1)}\u2026` : label;
}

/**
 * Immersive Canvas2D Visibility Field: glow, edge energy, pointer depth,
 * clickable engine nodes. Status from DemoEngineRow only. No decorative particles.
 */
export const VisibilityConstellationCanvas: React.FC<CanvasProps> = ({
  engines,
  domainLabel = 'your site',
  className = '',
  plateVariant = 'idle',
  size = 'default',
  selectedEngineId = null,
  onSelectEngine,
  onContextLost,
}) => {
  const figureRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sentinelRef = useRef<HTMLCanvasElement>(null);
  const enginesRef = useRef(engines);
  const domainRef = useRef(domainLabel);
  const selectedRef = useRef(selectedEngineId);
  const onSelectRef = useRef(onSelectEngine);
  const visibleRef = useRef(true);
  const pointerRef = useRef({ x: 0, y: 0 });
  const smoothPtr = useRef({ x: 0, y: 0 });
  const hoverIdRef = useRef<DemoEngineId | null>(null);

  enginesRef.current = engines;
  domainRef.current = domainLabel;
  selectedRef.current = selectedEngineId;
  onSelectRef.current = onSelectEngine;

  useEffect(() => {
    const figure = figureRef.current;
    const canvas = canvasRef.current;
    if (!figure || !canvas) return;

    let alive = true;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onContextLost?.();
      return;
    }

    const sentinel = sentinelRef.current;
    let onLost: ((ev: Event) => void) | undefined;
    if (sentinel) {
      let gl: WebGLRenderingContext | null = null;
      try {
        gl = (sentinel.getContext('webgl', { failIfMajorPerformanceCaveat: true }) ||
          sentinel.getContext('experimental-webgl', {
            failIfMajorPerformanceCaveat: true,
          })) as WebGLRenderingContext | null;
      } catch {
        gl = null;
      }
      if (!gl) {
        onContextLost?.();
        return;
      }
      onLost = (ev: Event) => {
        ev.preventDefault();
        if (alive) onContextLost?.();
      };
      sentinel.addEventListener('webglcontextlost', onLost, false);
    }

    let raf = 0;
    let running = true;
    let w = 0;
    let h = 0;

    const project = (x: number, y: number, ox: number, oy: number) => {
      const depth = 1 + (Math.hypot(x - 50, y - 50) / 70) * 0.08;
      return {
        x: (x / 100) * w + ox * (x / 100 - 0.5) * 0.55 * depth,
        y: (y / 100) * h + oy * (y / 100 - 0.5) * 0.45 * depth,
        depth,
      };
    };

    const hitTest = (clientX: number, clientY: number): DemoEngineId | null => {
      const rect = figure.getBoundingClientRect();
      const lx = clientX - rect.left;
      const ly = clientY - rect.top;
      const ox = smoothPtr.current.x * 18;
      const oy = smoothPtr.current.y * 14;
      const r = Math.min(w, h) * 0.07;
      for (const e of enginesRef.current) {
        const p = constellationNodePos(e.id);
        const pt = project(p.x, p.y, ox, oy);
        if (Math.hypot(lx - pt.x, ly - pt.y) <= r) return e.id as DemoEngineId;
      }
      return null;
    };

    const resize = () => {
      const rect = figure.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawGlow = (cx: number, cy: number, r: number, color: string, strength: number) => {
      if (strength <= 0.01) return;
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.6);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.22 * strength;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    const draw = (t: number) => {
      if (!running || w < 2 || h < 2) return;
      const palette = readPalette(figure);
      smoothPtr.current.x += (pointerRef.current.x - smoothPtr.current.x) * 0.12;
      smoothPtr.current.y += (pointerRef.current.y - smoothPtr.current.y) * 0.12;
      const ox = smoothPtr.current.x * 18;
      const oy = smoothPtr.current.y * 14;

      ctx.clearRect(0, 0, w, h);

      // Soft vignette floor (depth, not particles)
      const floor = ctx.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.55);
      floor.addColorStop(0, 'rgba(191,149,63,0.06)');
      floor.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = floor;
      ctx.fillRect(0, 0, w, h);

      const hub = project(CONSTELLATION_HUB.x, CONSTELLATION_HUB.y, ox, oy);
      const rows = enginesRef.current;
      const pulse = 0.55 + 0.45 * Math.sin(t / 380);
      const hubActive = rows.some((e) => e.status === 'pending' || e.status === 'measured');
      const hubBreath = hubActive ? 1 + 0.005 * Math.sin(t / 600) : 1;

      for (const e of rows) {
        const p = constellationNodePos(e.id);
        const pt = project(p.x, p.y, ox, oy);
        const lit = e.status === 'measured' || e.status === 'estimated' || e.status === 'pending';
        const style = nodeStyle(e.status, palette);
        const selected = selectedRef.current === e.id || hoverIdRef.current === e.id;

        ctx.beginPath();
        ctx.moveTo(hub.x, hub.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.strokeStyle = lit ? palette.accent : 'rgba(255,255,255,0.12)';
        ctx.globalAlpha = lit ? (selected ? 0.75 : 0.5) : 0.45;
        ctx.lineWidth = selected ? 2.2 : lit ? 1.6 : 1;
        if (style.dash) ctx.setLineDash([5, 5]);
        else ctx.setLineDash([]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Energy packet along lit edges
        if (lit) {
          const u = (Math.sin(t / 520 + p.x) + 1) / 2;
          const ex = hub.x + (pt.x - hub.x) * u;
          const ey = hub.y + (pt.y - hub.y) * u;
          drawGlow(ex, ey, Math.min(w, h) * 0.02, palette.accent2, 0.7);
        }
        ctx.globalAlpha = 1;
      }

      const hubR = Math.min(w, h) * 0.078 * hubBreath;
      drawGlow(hub.x, hub.y, hubR, palette.accent, 0.85);
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, hubR, 0, Math.PI * 2);
      ctx.fillStyle = palette.paper2;
      ctx.fill();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, hubR * 1.35, 0, Math.PI * 2);
      ctx.strokeStyle = palette.accent2;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = palette.ink;
      ctx.font = `500 ${Math.max(11, Math.min(w, h) * 0.034)}px var(--font-body), sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncateLabel(domainRef.current), hub.x, hub.y);

      for (const e of rows) {
        const p = constellationNodePos(e.id);
        const pt = project(p.x, p.y, ox, oy);
        const baseR = Math.min(w, h) * 0.055 * pt.depth;
        const selected = selectedRef.current === e.id || hoverIdRef.current === e.id;
        const r = selected ? baseR * 1.28 : baseR;
        const style = nodeStyle(e.status, palette);
        const glowStrength = e.status === 'pending' ? pulse : style.glow;

        // Contact shadow under hover/selected (fake depth, no particles)
        if (selected) {
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.ellipse(pt.x + ox * 0.04, pt.y + r * 0.9, r * 0.95, r * 0.32, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        drawGlow(pt.x, pt.y, r, palette.accent2, glowStrength);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        if (style.fill !== 'transparent') {
          ctx.globalAlpha = style.alpha;
          ctx.fillStyle = style.fill;
          ctx.fill();
        }
        ctx.globalAlpha = e.status === 'pending' ? pulse : style.alpha;
        ctx.strokeStyle = selected ? palette.accent2 : style.stroke;
        ctx.lineWidth = selected ? 2.4 : 1.8;
        if (style.dash) ctx.setLineDash([4, 4]);
        else ctx.setLineDash([]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        const short = e.label.split(' ')[0] || e.label;
        ctx.fillStyle = selected ? palette.accent2 : palette.ink2;
        ctx.font = `500 ${Math.max(10, Math.min(w, h) * 0.028)}px var(--font-mono), monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(short, pt.x, pt.y + r + 5);
      }
    };

    const loop = (t: number) => {
      if (!running) return;
      if (!visibleRef.current) {
        raf = 0;
        return;
      }
      draw(t);
      raf = requestAnimationFrame(loop);
    };

    const ensureLoop = () => {
      if (!running || raf) return;
      raf = requestAnimationFrame(loop);
    };

    resize();
    ensureLoop();

    const ro = new ResizeObserver(() => resize());
    ro.observe(figure);

    const io = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries.some((en) => en.isIntersecting);
        if (visibleRef.current) ensureLoop();
      },
      { threshold: 0.05 }
    );
    io.observe(figure);

    const onPointer = (ev: PointerEvent) => {
      const rect = figure.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      pointerRef.current = {
        x: ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        y: ((ev.clientY - rect.top) / rect.height) * 2 - 1,
      };
      const hit = hitTest(ev.clientX, ev.clientY);
      hoverIdRef.current = hit;
      figure.style.cursor = hit && onSelectRef.current ? 'pointer' : 'default';
    };
    const onLeave = () => {
      pointerRef.current = { x: 0, y: 0 };
      hoverIdRef.current = null;
      figure.style.cursor = 'default';
    };
    const onClick = (ev: MouseEvent) => {
      const hit = hitTest(ev.clientX, ev.clientY);
      if (hit && onSelectRef.current) onSelectRef.current(hit);
    };

    figure.addEventListener('pointermove', onPointer, { passive: true });
    figure.addEventListener('pointerleave', onLeave);
    figure.addEventListener('click', onClick);

    return () => {
      alive = false;
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      figure.removeEventListener('pointermove', onPointer);
      figure.removeEventListener('pointerleave', onLeave);
      figure.removeEventListener('click', onClick);
      if (sentinel && onLost) {
        sentinel.removeEventListener('webglcontextlost', onLost);
      }
    };
  }, [onContextLost]);

  const maxH = size === 'hero' ? 'max-h-[420px]' : 'max-h-[280px]';

  return (
    <div
      ref={figureRef}
      className={`relative w-full aspect-[4/3] ${maxH} ${className}`}
      role="img"
      aria-label="Answer-engine visibility field. Click an engine node to focus it."
    >
      <ConstellationPlate variant={plateVariant} />
      <canvas ref={canvasRef} className="absolute inset-0 z-[1] h-full w-full" aria-hidden={false} />
      <canvas ref={sentinelRef} width={1} height={1} className="pointer-events-none absolute opacity-0" aria-hidden />
      <p className="sr-only">
        Brand hub with four answer-engine nodes. Brightness follows measurement status only. Click a
        node to focus that engine.
      </p>
    </div>
  );
};
