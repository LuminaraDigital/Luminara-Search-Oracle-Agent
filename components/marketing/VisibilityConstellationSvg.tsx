import React from 'react';
import { ConstellationPlate } from './ConstellationPlate';
import { CONSTELLATION_HUB, constellationNodePos } from './constellationLayout';
import type { DemoEngineId, DemoEngineRow, DemoEngineStatus } from './demo/demoFixtures';

function statusClass(status: DemoEngineStatus, selected: boolean): string {
  const ring = selected ? ' stroke-[var(--color-accent-2)] stroke-[1.2]' : '';
  switch (status) {
    case 'measured':
      return `fill-[var(--color-accent)] stroke-[var(--color-accent-2)] opacity-95${ring}`;
    case 'estimated':
      return `fill-[var(--color-accent)]/40 stroke-[var(--gold-light)]/70 opacity-80${ring}`;
    case 'pending':
      return `fill-transparent stroke-[var(--color-accent)] animate-pulse${ring}`;
    case 'not_measured':
      return `fill-transparent stroke-white/25 opacity-60${ring}`;
    default:
      return `fill-transparent stroke-white/20 opacity-45${ring}`;
  }
}

export interface VisibilityConstellationViewProps {
  engines: DemoEngineRow[];
  domainLabel?: string;
  className?: string;
  plateVariant?: 'idle' | 'sample';
  /** Larger field for Probe / Map immersion. */
  size?: 'default' | 'hero';
  selectedEngineId?: DemoEngineId | null;
  onSelectEngine?: (id: DemoEngineId) => void;
}

/**
 * Default Visibility Field (SVG / 2.5D). Lit nodes = measured;
 * dim/dashed = not_measured. Clickable engines sync with Probe list.
 */
export const VisibilityConstellationSvg: React.FC<VisibilityConstellationViewProps> = ({
  engines,
  domainLabel = 'your site',
  className = '',
  plateVariant = 'idle',
  size = 'default',
  selectedEngineId = null,
  onSelectEngine,
}) => {
  const maxH = size === 'hero' ? 'max-h-[420px]' : 'max-h-[280px]';
  return (
    <figure
      className={`relative w-full aspect-[4/3] ${maxH} ${className}`}
      aria-label="Answer-engine visibility field"
    >
      <ConstellationPlate variant={plateVariant} />
      <svg viewBox="0 0 100 100" className="relative z-[1] h-full w-full" role="img">
        <title>Visibility constellation</title>
        <defs>
          <radialGradient id="hubGlowSvg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={CONSTELLATION_HUB.x} cy={CONSTELLATION_HUB.y} r={16} fill="url(#hubGlowSvg)" />
        {engines.map((e) => {
          const p = constellationNodePos(e.id);
          return (
            <line
              key={`edge-${e.id}`}
              x1={CONSTELLATION_HUB.x}
              y1={CONSTELLATION_HUB.y}
              x2={p.x}
              y2={p.y}
              className={
                e.status === 'measured' || e.status === 'estimated'
                  ? 'stroke-[var(--color-accent)]/55'
                  : 'stroke-white/10'
              }
              strokeWidth={selectedEngineId === e.id ? 0.7 : 0.4}
              strokeDasharray={e.status === 'not_measured' || e.status === 'idle' ? '1.2 1.2' : undefined}
            />
          );
        })}
        <circle
          cx={CONSTELLATION_HUB.x}
          cy={CONSTELLATION_HUB.y}
          r={7}
          className="fill-[var(--color-paper-2)] stroke-[var(--color-accent)]"
          strokeWidth={0.6}
        />
        <text
          x={CONSTELLATION_HUB.x}
          y={CONSTELLATION_HUB.y + 1.5}
          textAnchor="middle"
          className="fill-[var(--color-ink)] font-sans"
          style={{ fontSize: 3.2 }}
        >
          {domainLabel.length > 14 ? `${domainLabel.slice(0, 12)}\u2026` : domainLabel}
        </text>
        {engines.map((e) => {
          const p = constellationNodePos(e.id);
          const selected = selectedEngineId === e.id;
          return (
            <g key={e.id}>
              {onSelectEngine ? (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={8}
                  className="fill-transparent cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-label={`${e.label}: ${e.status}`}
                  onClick={() => onSelectEngine(e.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      onSelectEngine(e.id);
                    }
                  }}
                />
              ) : null}
              <circle
                cx={p.x}
                cy={p.y}
                r={selected ? 6.2 : 5.2}
                className={statusClass(e.status, selected)}
                strokeWidth={selected ? 1.1 : 0.7}
                style={{ pointerEvents: 'none' }}
              />
              <text
                x={p.x}
                y={p.y + 9.5}
                textAnchor="middle"
                className="fill-[var(--color-ink-2)]"
                style={{ fontSize: 2.6, fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}
              >
                {e.label.split(' ')[0]}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        Brand hub with four answer-engine nodes. Brightness follows measurement status only. Click a
        node to focus that engine in the Probe list.
      </figcaption>
    </figure>
  );
};
