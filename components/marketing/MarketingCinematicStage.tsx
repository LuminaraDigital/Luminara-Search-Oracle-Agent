/* Night sky for inner marketing pages.
 * Static stars only. Negative z-index inside an isolated page so it paints
 * behind every section and can never cover copy.
 * No glass, no perspective grid, no video, no Three.
 */
import React from 'react';

type Intensity = 'hero' | 'page';

interface MarketingCinematicStageProps {
  intensity?: Intensity;
  className?: string;
}

const STARS: Array<{ x: number; y: number; s: number; a: number }> = Array.from({ length: 40 }, (_, i) => ({
  x: (i * 53 + 7) % 100,
  y: (i * 31 + 11) % 100,
  s: i % 8 === 0 ? 2 : 1,
  a: 0.2 + (i % 4) * 0.1,
}));

export const MarketingCinematicStage: React.FC<MarketingCinematicStageProps> = ({
  intensity = 'page',
  className = '',
}) => {
  const hero = intensity === 'hero';
  return (
    <div
      className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden ${className}`}
      aria-hidden
    >
      <div className="absolute inset-0 bg-[var(--color-paper)]" />
      {STARS.map((star, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-[var(--gold-light)]"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: star.s,
            height: star.s,
            opacity: hero ? star.a : star.a * 0.55,
          }}
        />
      ))}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% 100%, color-mix(in oklab, var(--color-accent) 14%, transparent), transparent 60%)',
        }}
      />
    </div>
  );
};
