/* Cinematic world for the landing hero.
 * Gold wireframe globe on a black starfield. CSS + one canvas. No Three, no video.
 * The sphere is decorative. Engine names live in HTML so they cannot collide.
 */
import React, { useEffect, useRef } from 'react';

const STARS: Array<{ x: number; y: number; s: number; a: number }> = Array.from({ length: 56 }, (_, i) => ({
  x: (i * 47 + (i % 5) * 3) % 100,
  y: (i * 29 + (i % 7) * 5) % 100,
  s: i % 9 === 0 ? 2 : 1,
  a: 0.28 + (i % 5) * 0.12,
}));

type Dot = { x: number; y: number; z: number; bright: number };

function fibSphere(count: number): Dot[] {
  const out: Dot[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(count - 1, 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push({
      x: Math.cos(theta) * r,
      y,
      z: Math.sin(theta) * r,
      bright: 0.35 + (i % 6) * 0.08,
    });
  }
  return out;
}

/** Lat/lon seats for the four answer surfaces. Radians. */
const ENGINES: Array<{ lat: number; lon: number }> = [
  { lat: 0.42, lon: -0.35 },
  { lat: 0.05, lon: 1.15 },
  { lat: -0.15, lon: -1.25 },
  { lat: -0.55, lon: 0.25 },
];

/**
 * Full-bleed night sky and a slowly turning gold world.
 * Sits inside the hero only. It is not a fixed overlay, so it cannot cover later sections.
 */
export const WorldStage: React.FC<{ className?: string }> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dots = fibSphere(reduced ? 520 : 1100);
    let w = 0;
    let h = 0;
    let raf = 0;
    let running = true;
    let yaw = 0.4;
    const pointer = { x: 0, y: 0 };
    const smooth = { x: 0, y: 0 };

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

    const rot = (x: number, y: number, z: number, yawA: number, pitchA: number) => {
      const cy = Math.cos(yawA);
      const sy = Math.sin(yawA);
      const cx = Math.cos(pitchA);
      const sx = Math.sin(pitchA);
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const y2 = y * cx - z1 * sx;
      const z2 = y * sx + z1 * cx;
      return { x: x1, y: y2, z: z2 };
    };

    const drawWire = (
      scale: number,
      cx: number,
      cy: number,
      yawA: number,
      pitchA: number,
    ) => {
      ctx.lineWidth = 1;
      const rings = 8;
      const meridians = 12;
      const steps = 72;
      for (let r = 1; r < rings; r += 1) {
        const lat = -Math.PI / 2 + (r / rings) * Math.PI;
        ctx.beginPath();
        let started = false;
        for (let s = 0; s <= steps; s += 1) {
          const lon = (s / steps) * Math.PI * 2;
          const p = rot(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon), yawA, pitchA);
          const depth = (p.z + 1) / 2;
          if (p.z < -0.05) {
            started = false;
            continue;
          }
          const sx = cx + p.x * scale;
          const sy = cy + p.y * scale;
          if (!started) {
            ctx.moveTo(sx, sy);
            started = true;
          } else ctx.lineTo(sx, sy);
          ctx.strokeStyle = `rgba(191,149,63,${0.08 + depth * 0.22})`;
        }
        ctx.stroke();
      }
      for (let m = 0; m < meridians; m += 1) {
        const lon = (m / meridians) * Math.PI * 2;
        ctx.beginPath();
        let started = false;
        for (let s = 0; s <= steps; s += 1) {
          const lat = -Math.PI / 2 + (s / steps) * Math.PI;
          const p = rot(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon), yawA, pitchA);
          if (p.z < -0.02) {
            started = false;
            continue;
          }
          const sx = cx + p.x * scale;
          const sy = cy + p.y * scale;
          if (!started) {
            ctx.moveTo(sx, sy);
            started = true;
          } else ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = 'rgba(252,246,186,0.16)';
        ctx.stroke();
      }
    };

    const draw = (t: number) => {
      if (!running || w < 2) return;
      smooth.x += (pointer.x - smooth.x) * 0.05;
      smooth.y += (pointer.y - smooth.y) * 0.05;
      if (!reduced) yaw += 0.0011;
      const pitch = -0.18 + smooth.y * 0.22;
      const yawA = yaw + smooth.x * 0.35;

      ctx.clearRect(0, 0, w, h);
      const cx = w * 0.5;
      const cy = h * 0.64;
      const scale = Math.min(w * 0.46, h * 0.5);

      const well = ctx.createRadialGradient(cx, cy, scale * 0.2, cx, cy, scale * 1.6);
      well.addColorStop(0, 'rgba(191,149,63,0.16)');
      well.addColorStop(0.45, 'rgba(120,78,16,0.06)');
      well.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = well;
      ctx.fillRect(0, 0, w, h);

      const projected: Array<{ sx: number; sy: number; a: number; z: number }> = [];
      for (const d of dots) {
        const p = rot(d.x, d.y, d.z, yawA, pitch);
        const depth = (p.z + 1.15) / 2.15;
        projected.push({
          sx: cx + p.x * scale,
          sy: cy + p.y * scale,
          z: p.z,
          a: d.bright * (0.15 + depth * 0.85) * (p.z < 0 ? 0.35 : 1),
        });
      }
      projected.sort((a, b) => a.z - b.z);
      for (const p of projected) {
        ctx.fillStyle = `rgba(252,246,186,${Math.min(0.9, p.a)})`;
        const size = p.z > 0.35 ? 1.6 : 1.1;
        ctx.fillRect(p.sx, p.sy, size, size);
      }

      drawWire(scale, cx, cy, yawA, pitch);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, scale, 0, Math.PI * 2);
      ctx.clip();
      const spec = ctx.createRadialGradient(cx - scale * 0.32, cy - scale * 0.36, scale * 0.05, cx, cy, scale);
      spec.addColorStop(0, 'rgba(252,246,186,0.22)');
      spec.addColorStop(0.4, 'rgba(191,149,63,0.05)');
      spec.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = spec;
      ctx.fillRect(cx - scale, cy - scale, scale * 2, scale * 2);
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, scale + 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(252,246,186,0.28)';
      ctx.lineWidth = 1.25;
      ctx.stroke();

      for (const engine of ENGINES) {
        const p = rot(
          Math.cos(engine.lat) * Math.sin(engine.lon),
          Math.sin(engine.lat),
          Math.cos(engine.lat) * Math.cos(engine.lon),
          yawA,
          pitch,
        );
        if (p.z < 0.05) continue;
        const sx = cx + p.x * scale;
        const sy = cy + p.y * scale;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 14);
        g.addColorStop(0, 'rgba(252,246,186,0.95)');
        g.addColorStop(0.4, 'rgba(191,149,63,0.45)');
        g.addColorStop(1, 'rgba(191,149,63,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, 14, 0, Math.PI * 2);
        ctx.fill();
      }

      // Quiet the top of the frame so the claim stays on black sky.
      const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
      sky.addColorStop(0, 'rgba(0,0,0,0.55)');
      sky.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h * 0.55);

      void t;
    };

    const loop = () => {
      if (!running) return;
      draw(performance.now());
      if (reduced) return;
      raf = requestAnimationFrame(loop);
    };

    resize();
    loop();

    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw(0);
    });
    ro.observe(root);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType === 'touch' || reduced) return;
      pointer.x = (ev.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
      pointer.y = (ev.clientY / Math.max(window.innerHeight, 1)) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <div ref={rootRef} className={`absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      <div className="absolute inset-0 bg-black" />
      {STARS.map((star, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-[var(--gold-light)]"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: star.s,
            height: star.s,
            opacity: star.a,
          }}
        />
      ))}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
};
