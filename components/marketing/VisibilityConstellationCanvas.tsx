import React, { useEffect, useRef } from 'react';
import type { DemoEngineStatus } from './demo/demoFixtures';
import type { VisibilityConstellationViewProps } from './VisibilityConstellationSvg';

/** Same layout as SVG field (percent of viewBox 0-100). */
const NODE_POS: Record<string, { x: number; y: number }> = {
  web_serp: { x: 50, y: 12 },
  google_aio: { x: 88, y: 42 },
  chatgpt: { x: 50, y: 88 },
  perplexity: { x: 12, y: 42 },
};

interface CanvasProps extends VisibilityConstellationViewProps {
  /** Electron / GPU path: caller switches back to SVG. */
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

function nodeStyle(status: DemoEngineStatus, p: Palette): { fill: string; stroke: string; alpha: number; dash: boolean } {
  switch (status) {
    case 'measured':
      return { fill: p.accent, stroke: p.accent2, alpha: 0.95, dash: false };
    case 'estimated':
      return { fill: p.accent, stroke: p.goldLight, alpha: 0.45, dash: false };
    case 'pending':
      return { fill: 'transparent', stroke: p.accent, alpha: 0.85, dash: false };
    case 'not_measured':
      return { fill: 'transparent', stroke: 'rgba(255,255,255,0.25)', alpha: 0.6, dash: true };
    default:
      return { fill: 'transparent', stroke: 'rgba(255,255,255,0.2)', alpha: 0.45, dash: true };
  }
}

function truncateLabel(label: string, max = 14): string {
  return label.length > max ? `${label.slice(0, max - 1)}\u2026` : label;
}

/**
 * Product-serving Canvas2D constellation with light pointer parallax.
 * No decorative particles. Status from DemoEngineRow only.
 * Lazy-imported only; never on the main critical path.
 */
export const VisibilityConstellationCanvas: React.FC<CanvasProps> = ({
  engines,
  domainLabel = 'your site',
  className = '',
  onContextLost,
}) => {
  const figureRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sentinelRef = useRef<HTMLCanvasElement>(null);
  const enginesRef = useRef(engines);
  const domainRef = useRef(domainLabel);
  const visibleRef = useRef(true);
  const pointerRef = useRef({ x: 0, y: 0 });
  const pendingPulseRef = useRef(0);

  enginesRef.current = engines;
  domainRef.current = domainLabel;

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

    // Sentinel WebGL surface: Electron GPU loss → SVG fallback (CEO lock).
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

    const resize = () => {
      const rect = figure.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (t: number) => {
      if (!running) return;
      const rect = figure.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w < 2 || h < 2) return;

      const palette = readPalette(figure);
      const px = pointerRef.current.x;
      const py = pointerRef.current.y;
      // Subtle parallax offset in CSS pixels (product depth, not decoration).
      const ox = px * 10;
      const oy = py * 8;

      ctx.clearRect(0, 0, w, h);

      const sx = (x: number) => (x / 100) * w + ox * (x / 100 - 0.5) * 0.4;
      const sy = (y: number) => (y / 100) * h + oy * (y / 100 - 0.5) * 0.4;

      const rows = enginesRef.current;
      for (const e of rows) {
        const p = NODE_POS[e.id] || { x: 50, y: 50 };
        const lit = e.status === 'measured' || e.status === 'estimated';
        const style = nodeStyle(e.status, palette);
        ctx.beginPath();
        ctx.moveTo(sx(50), sy(50));
        ctx.lineTo(sx(p.x), sy(p.y));
        ctx.strokeStyle = lit ? palette.accent : 'rgba(255,255,255,0.1)';
        ctx.globalAlpha = lit ? 0.45 : 0.55;
        ctx.lineWidth = 1;
        if (style.dash) ctx.setLineDash([4, 4]);
        else ctx.setLineDash([]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // Brand hub
      const hx = sx(50);
      const hy = sy(50);
      const hubR = Math.min(w, h) * 0.07;
      ctx.beginPath();
      ctx.arc(hx, hy, hubR, 0, Math.PI * 2);
      ctx.fillStyle = palette.paper2;
      ctx.fill();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = palette.ink;
      ctx.font = `500 ${Math.max(10, Math.min(w, h) * 0.032)}px var(--font-body), sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncateLabel(domainRef.current), hx, hy);

      pendingPulseRef.current = 0.55 + 0.45 * Math.sin(t / 420);

      for (const e of rows) {
        const p = NODE_POS[e.id] || { x: 50, y: 50 };
        const nx = sx(p.x);
        const ny = sy(p.y);
        const r = Math.min(w, h) * 0.052;
        const style = nodeStyle(e.status, palette);

        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
        if (style.fill !== 'transparent') {
          ctx.globalAlpha = style.alpha;
          ctx.fillStyle = style.fill;
          ctx.fill();
        }
        ctx.globalAlpha = e.status === 'pending' ? pendingPulseRef.current : style.alpha;
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = 1.75;
        ctx.stroke();
        ctx.globalAlpha = 1;

        const short = e.label.split(' ')[0] || e.label;
        ctx.fillStyle = palette.ink2;
        ctx.font = `400 ${Math.max(9, Math.min(w, h) * 0.026)}px var(--font-mono), monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(short, nx, ny + r + 4);
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
    };
    const onLeave = () => {
      pointerRef.current = { x: 0, y: 0 };
    };
    figure.addEventListener('pointermove', onPointer, { passive: true });
    figure.addEventListener('pointerleave', onLeave);

    return () => {
      alive = false;
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      figure.removeEventListener('pointermove', onPointer);
      figure.removeEventListener('pointerleave', onLeave);
      if (sentinel && onLost) {
        sentinel.removeEventListener('webglcontextlost', onLost);
      }
    };
  }, [onContextLost]);

  return (
    <div
      ref={figureRef}
      className={`relative w-full aspect-[4/3] max-h-[280px] ${className}`}
      role="img"
      aria-label="Answer-engine visibility field"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden={false} />
      <canvas ref={sentinelRef} width={1} height={1} className="pointer-events-none absolute opacity-0" aria-hidden />
      <p className="sr-only">
        Brand hub with four answer-engine nodes. Brightness follows measurement status only. Canvas depth
        field; reduced motion and mobile use the SVG stage.
      </p>
    </div>
  );
};
