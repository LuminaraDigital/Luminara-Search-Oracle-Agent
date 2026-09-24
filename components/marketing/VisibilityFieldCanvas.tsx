import React, { useEffect, useRef } from 'react';
import type { DemoEngineRow, DemoEngineStatus } from './demo/demoFixtures';

const NODE_POS: Record<string, { x: number; y: number }> = {
  web_serp: { x: 0.5, y: 0.14 },
  google_aio: { x: 0.86, y: 0.42 },
  chatgpt: { x: 0.5, y: 0.86 },
  perplexity: { x: 0.14, y: 0.42 },
};

function statusColor(status: DemoEngineStatus, gold: string): string {
  switch (status) {
    case 'measured':
      return gold;
    case 'estimated':
      return 'rgba(191,149,63,0.55)';
    case 'pending':
      return 'rgba(252,246,186,0.7)';
    case 'not_measured':
      return 'rgba(255,255,255,0.22)';
    default:
      return 'rgba(255,255,255,0.16)';
  }
}

export type VisibilityFieldCanvasProps = {
  engines: DemoEngineRow[];
  domainLabel?: string;
  className?: string;
  onContextLost?: () => void;
};

/**
 * Canvas 2.5D constellation (no Three.js). Lazy-loaded only when WebGL/canvas path is allowed.
 * Falls back via onContextLost when the drawing surface fails.
 */
export const VisibilityFieldCanvas: React.FC<VisibilityFieldCanvasProps> = ({
  engines,
  domainLabel = 'your site',
  className = '',
  onContextLost,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const enginesRef = useRef(engines);
  const labelRef = useRef(domainLabel);
  enginesRef.current = engines;
  labelRef.current = domainLabel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onContextLost?.();
      return;
    }

    let raf = 0;
    let visible = true;
    let reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let t0 = performance.now();
    const gold = '#BF953F';

    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent?.clientWidth || 400;
      const h = Math.min(280, Math.round(w * 0.75));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number) => {
      if (!visible) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const pulse = reduced ? 0 : Math.sin((now - t0) / 700) * 0.5 + 0.5;
      const rows = enginesRef.current;
      const cx = w * 0.5;
      const cy = h * 0.5;

      for (const e of rows) {
        const p = NODE_POS[e.id] || { x: 0.5, y: 0.5 };
        const x = w * p.x;
        const y = h * p.y;
        const lit = e.status === 'measured' || e.status === 'estimated';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.strokeStyle = lit ? 'rgba(191,149,63,0.45)' : 'rgba(255,255,255,0.1)';
        ctx.setLineDash(lit ? [] : [4, 4]);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.arc(cx, cy, 22 + pulse * 2, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0a0a';
      ctx.fill();
      ctx.strokeStyle = gold;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const label = labelRef.current.length > 14 ? `${labelRef.current.slice(0, 12)}…` : labelRef.current;
      ctx.fillStyle = '#f1f1f1';
      ctx.font = '11px Outfit, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy);

      for (const e of rows) {
        const p = NODE_POS[e.id] || { x: 0.5, y: 0.5 };
        const x = w * p.x;
        const y = h * p.y;
        const r = 12 + (e.status === 'pending' ? pulse * 2 : 0);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        if (e.status === 'measured') {
          ctx.fillStyle = gold;
          ctx.fill();
        } else {
          ctx.fillStyle = 'transparent';
          ctx.strokeStyle = statusColor(e.status, gold);
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(200,200,200,0.85)';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText(e.label.split(' ')[0], x, y + 22);
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);

    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
      },
      { threshold: 0.05 },
    );
    io.observe(canvas);

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMq = () => {
      reduced = mq.matches;
    };
    mq.addEventListener?.('change', onMq);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      io.disconnect();
      mq.removeEventListener?.('change', onMq);
    };
  }, [onContextLost]);

  return (
    <div className={`relative w-full max-h-[280px] ${className}`} aria-hidden>
      <canvas ref={canvasRef} className="block w-full rounded-xl" />
    </div>
  );
};

export default VisibilityFieldCanvas;
