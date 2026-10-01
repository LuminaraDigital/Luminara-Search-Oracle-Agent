/* Hallmark · pre-emit critique: P5 H5 E5 S5 R4 V5
 * Aethir-class cinematic underlay: volumetric gold depth, perspective grid,
 * light shafts. Owned CSS + rAF only. No glass, no Three, no Inter.
 */
import React, { useEffect, useRef, useState } from 'react';

type Intensity = 'hero' | 'page';

interface MarketingCinematicStageProps {
  intensity?: Intensity;
  className?: string;
}

/**
 * Full-bleed cinematic underlay for marketing.
 * DNA borrowed from atmospheric compute landings (depth void + lit field),
 * remapped to Night Foundry black/gold.
 */
export const MarketingCinematicStage: React.FC<MarketingCinematicStageProps> = ({
  intensity = 'page',
  className = '',
}) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(false);
  const hero = intensity === 'hero';

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  useEffect(() => {
    if (reduced || !hero) return;
    const layer = layerRef.current;
    const grid = gridRef.current;
    if (!layer) return;

    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let running = false;

    const tick = () => {
      cx += (tx - cx) * 0.04;
      cy += (ty - cy) * 0.04;
      const dx = -cx * 22;
      const dy = -cy * 14;
      const sc = 1.06 + Math.max(0, cy) * 0.02;
      layer.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) scale(${sc.toFixed(4)})`;
      if (grid) {
        const gx = cx * 8;
        const gy = cy * 5;
        grid.style.transform = `perspective(900px) rotateX(58deg) translate3d(${gx.toFixed(2)}px, ${gy.toFixed(2)}px, 0)`;
      }
      if (Math.abs(tx - cx) < 0.0005 && Math.abs(ty - cy) < 0.0005) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const w = Math.max(window.innerWidth, 1);
      const h = Math.max(window.innerHeight, 1);
      tx = (e.clientX / w) * 2 - 1;
      ty = (e.clientY / h) * 2 - 1;
      wake();
    };

    const onLeave = () => {
      tx = 0;
      ty = 0;
      wake();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [reduced, hero]);

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${className}`}
      aria-hidden
    >
      <div className="absolute inset-0 bg-[var(--color-paper)]" />

      {/* Volumetric depth field */}
      <div
        ref={layerRef}
        className="absolute inset-[-12%] will-change-transform"
        style={{
          background: `
            radial-gradient(ellipse 110% 70% at 50% 115%, color-mix(in oklab, var(--color-accent) ${hero ? '28%' : '14%'}, transparent) 0%, transparent 55%),
            radial-gradient(ellipse 55% 45% at 12% 22%, color-mix(in oklab, var(--gold-light) ${hero ? '14%' : '6%'}, transparent) 0%, transparent 55%),
            radial-gradient(ellipse 50% 40% at 88% 18%, color-mix(in oklab, var(--gold-dark) ${hero ? '18%' : '8%'}, transparent) 0%, transparent 52%),
            radial-gradient(ellipse 35% 28% at 58% 6%, color-mix(in oklab, var(--color-accent) ${hero ? '12%' : '4%'}, transparent) 0%, transparent 60%),
            radial-gradient(ellipse 80% 50% at 50% 40%, color-mix(in oklab, var(--color-paper-2) ${hero ? '70%' : '40%'}, transparent) 0%, transparent 70%),
            linear-gradient(180deg, var(--color-paper) 0%, var(--color-paper-2) 38%, var(--color-paper) 100%)
          `,
        }}
      />

      {/* Light shafts (Aethir void lighting, gold) */}
      <div
        className="absolute inset-0 opacity-[0.55]"
        style={{
          background: `
            linear-gradient(118deg, transparent 42%, color-mix(in oklab, var(--color-accent) ${hero ? '9%' : '4%'}, transparent) 49%, transparent 56%),
            linear-gradient(68deg, transparent 48%, color-mix(in oklab, var(--gold-light) ${hero ? '5%' : '2%'}, transparent) 52%, transparent 58%)
          `,
        }}
      />

      {/* Perspective floor grid */}
      <div
        className="absolute left-[-20%] right-[-20%] bottom-[-18%] h-[58%] origin-bottom opacity-[0.35]"
        style={{
          perspective: '900px',
          perspectiveOrigin: '50% 0%',
        }}
      >
        <div
          ref={gridRef}
          className="absolute inset-0 will-change-transform"
          style={{
            transform: 'perspective(900px) rotateX(58deg)',
            backgroundImage: `
              linear-gradient(to right, color-mix(in oklab, var(--color-accent) 22%, transparent) 1px, transparent 1px),
              linear-gradient(to bottom, color-mix(in oklab, var(--color-accent) 18%, transparent) 1px, transparent 1px)
            `,
            backgroundSize: '72px 72px',
            maskImage:
              'linear-gradient(180deg, transparent 0%, black 28%, black 62%, transparent 100%), linear-gradient(90deg, transparent 0%, black 18%, black 82%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(180deg, transparent 0%, black 28%, black 62%, transparent 100%), linear-gradient(90deg, transparent 0%, black 18%, black 82%, transparent 100%)',
            maskComposite: 'intersect',
            WebkitMaskComposite: 'source-in',
          }}
        />
      </div>

      {/* Horizon ember band */}
      <div
        className="absolute left-[-12%] right-[-12%] top-[38%] h-[36%]"
        style={{
          background: `
            linear-gradient(180deg, transparent 0%, color-mix(in oklab, var(--color-accent) ${hero ? '14%' : '7%'}, transparent) 48%, transparent 100%)
          `,
          filter: hero ? 'blur(0.5px)' : undefined,
          maskImage: 'linear-gradient(90deg, transparent 0%, black 15%, black 85%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, black 15%, black 85%, transparent 100%)',
        }}
      />

      {/* Soft dust motes (static, no metrics) */}
      {hero ? (
        <div
          className="absolute inset-0 opacity-[0.45] mix-blend-screen"
          style={{
            backgroundImage: `
              radial-gradient(1.5px 1.5px at 12% 28%, color-mix(in oklab, var(--gold-light) 70%, transparent), transparent),
              radial-gradient(1px 1px at 28% 62%, color-mix(in oklab, var(--color-accent) 55%, transparent), transparent),
              radial-gradient(1.5px 1.5px at 72% 22%, color-mix(in oklab, var(--gold-light) 60%, transparent), transparent),
              radial-gradient(1px 1px at 84% 58%, color-mix(in oklab, var(--color-accent) 50%, transparent), transparent),
              radial-gradient(1px 1px at 46% 18%, color-mix(in oklab, var(--gold-light) 45%, transparent), transparent),
              radial-gradient(1.5px 1.5px at 58% 74%, color-mix(in oklab, var(--color-accent) 40%, transparent), transparent)
            `,
          }}
        />
      ) : null}

      {/* Readability vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 78% 68% at 50% 38%, transparent 0%, color-mix(in oklab, var(--color-paper) 28%, transparent) 72%, var(--color-paper) 100%),
            linear-gradient(180deg, color-mix(in oklab, var(--color-paper) 48%, transparent) 0%, transparent 16%, transparent 70%, color-mix(in oklab, var(--color-paper) 88%, transparent) 100%)
          `,
        }}
      />

      {/* Film grain */}
      <div
        className="absolute inset-0 opacity-[0.14] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
};
