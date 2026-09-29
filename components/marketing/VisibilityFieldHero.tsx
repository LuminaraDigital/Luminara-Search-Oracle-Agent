import React, { useEffect, useRef, useState } from 'react';
import { shouldLoadConstellationPlate } from './constellationCapability';
import {
  CONSTELLATION_ASSET,
  CONSTELLATION_ENGINE_LABELS,
  CONSTELLATION_HERO_OPACITY,
} from './constellationLayout';

interface VisibilityFieldHeroProps {
  className?: string;
  /** Soften plate when Probe results are lit (sample fixture). */
  resultsLit?: boolean;
}

/**
 * Immersive Blender stage: far hero plate + optional transparent near nodes
 * + sample crossfade when Probe results light. Reduced-motion stays static.
 * No Three.js / no runtime GLB.
 */
export const VisibilityFieldHero: React.FC<VisibilityFieldHeroProps> = ({
  className = '',
  resultsLit = false,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const layerFarRef = useRef<HTMLImageElement>(null);
  const layerNearRef = useRef<HTMLImageElement>(null);
  const layerSampleRef = useRef<HTMLImageElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const rafRef = useRef(0);
  const [nearOk, setNearOk] = useState(true);

  useEffect(() => {
    if (!shouldLoadConstellationPlate()) return;
    const root = rootRef.current;
    if (!root) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const onMove = (ev: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      target.current = {
        x: ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        y: ((ev.clientY - rect.top) / rect.height) * 2 - 1,
      };
    };
    const onLeave = () => {
      target.current = { x: 0, y: 0 };
    };

    const tick = () => {
      current.current.x += (target.current.x - current.current.x) * 0.08;
      current.current.y += (target.current.y - current.current.y) * 0.08;
      const { x, y } = current.current;
      // Far layer: smaller amplitude
      if (layerFarRef.current) {
        layerFarRef.current.style.transform = `translate3d(${x * 10}px, ${y * 8}px, 0) scale(1.06)`;
      }
      // Near layer: larger amplitude + slight scale differential
      if (layerNearRef.current) {
        layerNearRef.current.style.transform = `translate3d(${x * 22}px, ${y * 16}px, 0) scale(1.12)`;
      }
      if (layerSampleRef.current) {
        layerSampleRef.current.style.transform = `translate3d(${x * 18}px, ${y * 14}px, 0) scale(1.1)`;
      }
      if (spotRef.current) {
        const px = 50 + x * 28;
        const py = 45 + y * 22;
        const intensity = resultsLit ? 34 : 22;
        spotRef.current.style.background = `radial-gradient(ellipse 42% 36% at ${px}% ${py}%, color-mix(in oklab, var(--color-accent) ${intensity}%, transparent) 0%, transparent 70%)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, [resultsLit]);

  if (!shouldLoadConstellationPlate()) return null;
  const engines = Object.values(CONSTELLATION_ENGINE_LABELS);

  return (
    <div
      ref={rootRef}
      className={`absolute inset-0 overflow-hidden rounded-[1.35rem] ${className}`}
      aria-hidden
    >
      <img
        ref={layerFarRef}
        src={CONSTELLATION_ASSET.heroPlate}
        alt=""
        width={1600}
        height={1200}
        decoding="async"
        loading="lazy"
        fetchPriority="low"
        className="absolute inset-0 h-full w-full object-cover will-change-transform transition-opacity duration-700"
        style={{
          opacity: resultsLit ? CONSTELLATION_HERO_OPACITY * 0.55 : CONSTELLATION_HERO_OPACITY,
          transform: 'scale(1.06)',
        }}
        onError={(ev) => {
          (ev.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      {nearOk ? (
        <img
          ref={layerNearRef}
          src={CONSTELLATION_ASSET.heroNodesPlate}
          alt=""
          width={1600}
          height={1200}
          decoding="async"
          loading="lazy"
          fetchPriority="low"
          className="absolute inset-0 h-full w-full object-cover will-change-transform transition-opacity duration-700 pointer-events-none"
          style={{
            opacity: resultsLit ? 0.85 : 0.7,
            transform: 'scale(1.12)',
          }}
          onError={() => setNearOk(false)}
        />
      ) : null}
      <img
        ref={layerSampleRef}
        src={CONSTELLATION_ASSET.samplePlate}
        alt=""
        width={1280}
        height={960}
        decoding="async"
        loading="lazy"
        fetchPriority="low"
        className="absolute inset-0 h-full w-full object-cover mix-blend-screen will-change-transform transition-opacity duration-700"
        style={{
          opacity: resultsLit ? 0.42 : 0.08,
          transform: 'scale(1.1)',
        }}
        onError={(ev) => {
          (ev.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      <div
        ref={spotRef}
        className="absolute inset-0 pointer-events-none transition-[background] duration-75"
        style={{
          background:
            'radial-gradient(ellipse 42% 36% at 55% 45%, color-mix(in oklab, var(--color-accent) 22%, transparent) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 75% 70% at 55% 42%, transparent 0%, color-mix(in oklab, var(--color-paper) 55%, transparent) 68%, var(--color-paper) 100%)',
        }}
      />
      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-1.5 opacity-85 pointer-events-none">
        {engines.map((label) => (
          <span
            key={label}
            className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md border border-[var(--color-rule)] bg-black/45 text-[var(--gold-light)]"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
};
