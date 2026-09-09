import React, { useEffect, useState } from 'react';

type Intensity = 'full' | 'subtle';

/**
 * Moving, pointer-reactive gold atmosphere for marketing and the app shell.
 * Soft aurora + perspective grid. Honors prefers-reduced-motion.
 */
export const PremiumAtmosphere: React.FC<{ intensity?: Intensity; className?: string }> = ({
  intensity = 'full',
  className = '',
}) => {
  const [pos, setPos] = useState({ x: 52, y: 38 });
  const [reduced, setReduced] = useState(false);
  const full = intensity === 'full';

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setPos({
          x: (e.clientX / Math.max(window.innerWidth, 1)) * 100,
          y: (e.clientY / Math.max(window.innerHeight, 1)) * 100,
        });
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, [reduced]);

  const tiltX = reduced ? 0 : (pos.y - 50) * (full ? 0.08 : 0.04);
  const tiltY = reduced ? 0 : (pos.x - 50) * (full ? -0.1 : -0.05);

  return (
    <div className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${className}`} aria-hidden>
      <div
        className="absolute inset-0 transition-[background] duration-700 ease-out"
        style={{
          background: `
            radial-gradient(900px circle at ${pos.x}% ${pos.y}%, rgba(252,246,186,${full ? 0.14 : 0.07}), transparent 42%),
            radial-gradient(700px circle at ${100 - pos.x}% ${100 - pos.y}%, rgba(191,149,63,${full ? 0.1 : 0.05}), transparent 48%),
            radial-gradient(1200px circle at 50% 120%, rgba(170,119,28,0.08), transparent 55%),
            #000
          `,
        }}
      />

      <div
        className="absolute inset-[-12%] opacity-[0.35]"
        style={{
          transform: `perspective(1200px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
          transition: reduced ? undefined : 'transform 0.45s ease-out',
          backgroundImage: `
            linear-gradient(rgba(191,149,63,${full ? 0.11 : 0.06}) 1px, transparent 1px),
            linear-gradient(90deg, rgba(191,149,63,${full ? 0.11 : 0.06}) 1px, transparent 1px)
          `,
          backgroundSize: full ? '72px 72px' : '96px 96px',
          maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 20%, transparent 78%)',
        }}
      />

      <div
        className={`absolute -top-24 left-[12%] h-[42vh] w-[42vw] rounded-full bg-gold/10 blur-[110px] ${reduced ? '' : 'animate-premium-drift'}`}
      />
      <div
        className={`absolute bottom-[-10%] right-[8%] h-[46vh] w-[40vw] rounded-full bg-gold-dark/10 blur-[130px] ${reduced ? '' : 'animate-premium-drift-slow'}`}
      />

      <div
        className="absolute inset-0 opacity-[0.18] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E")`,
        }}
      />

      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/70" />
    </div>
  );
};
