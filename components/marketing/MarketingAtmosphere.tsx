import React from 'react';
import './space.css';

type Intensity = 'hero' | 'page' | 'full' | 'subtle';

/**
 * Space backdrop for marketing pages: starfield plus a low gold glow.
 * Fixed behind the page at z -10; the page root must be `isolate` so it stays
 * above the root background and below every section, positioned or not.
 */
export const MarketingAtmosphere: React.FC<{ intensity?: Intensity; className?: string }> = ({
  intensity = 'page',
  className = '',
}) => {
  const strong = intensity === 'hero' || intensity === 'full';
  return (
    <div aria-hidden className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden ${className}`}>
      <div className={`lx-stars absolute inset-0 ${strong ? 'opacity-90' : 'opacity-60'}`} />
      <div
        className="absolute left-1/2 top-0 h-[60vh] w-[140vw] -translate-x-1/2"
        style={{
          background: `radial-gradient(ellipse 50% 60% at 50% 0%, color-mix(in srgb, var(--gold) ${strong ? 16 : 9}%, transparent), transparent 70%)`,
        }}
      />
    </div>
  );
};
