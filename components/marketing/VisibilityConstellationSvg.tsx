import React from 'react';
import type { DemoEngineRow, DemoEngineStatus } from './demo/demoFixtures';

const NODE_POS: Record<string, { x: number; y: number }> = {
  web_serp: { x: 50, y: 12 },
  google_aio: { x: 88, y: 42 },
  chatgpt: { x: 50, y: 88 },
  perplexity: { x: 12, y: 42 },
};

function statusClass(status: DemoEngineStatus): string {
  switch (status) {
    case 'measured':
      return 'fill-[var(--color-accent)] stroke-[var(--color-accent-2)] opacity-95';
    case 'estimated':
      return 'fill-[var(--color-accent)]/40 stroke-[var(--gold-light)]/70 opacity-80';
    case 'pending':
      return 'fill-transparent stroke-[var(--color-accent)] animate-pulse';
    case 'not_measured':
      return 'fill-transparent stroke-white/25 opacity-60';
    default:
      return 'fill-transparent stroke-white/20 opacity-45';
  }
}

export interface VisibilityConstellationViewProps {
  engines: DemoEngineRow[];
  domainLabel?: string;
  className?: string;
}

/**
 * Default Visibility Field (SVG / 2.5D). Lit nodes = measured;
 * dim/dashed = not_measured. No invented scores.
 */
export const VisibilityConstellationSvg: React.FC<VisibilityConstellationViewProps> = ({
  engines,
  domainLabel = 'your site',
  className = '',
}) => (
  <figure
    className={`relative w-full aspect-[4/3] max-h-[280px] ${className}`}
    aria-label="Answer-engine visibility field"
  >
    <svg viewBox="0 0 100 100" className="w-full h-full" role="img">
      <title>Visibility constellation</title>
      {engines.map((e) => {
        const p = NODE_POS[e.id] || { x: 50, y: 50 };
        return (
          <line
            key={`edge-${e.id}`}
            x1={50}
            y1={50}
            x2={p.x}
            y2={p.y}
            className={
              e.status === 'measured' || e.status === 'estimated'
                ? 'stroke-[var(--color-accent)]/45'
                : 'stroke-white/10'
            }
            strokeWidth={0.4}
            strokeDasharray={e.status === 'not_measured' || e.status === 'idle' ? '1.2 1.2' : undefined}
          />
        );
      })}
      <circle cx={50} cy={50} r={7} className="fill-[var(--color-paper-2)] stroke-[var(--color-accent)]" strokeWidth={0.6} />
      <text
        x={50}
        y={51.5}
        textAnchor="middle"
        className="fill-[var(--color-ink)] font-sans"
        style={{ fontSize: 3.2 }}
      >
        {domainLabel.length > 14 ? `${domainLabel.slice(0, 12)}\u2026` : domainLabel}
      </text>
      {engines.map((e) => {
        const p = NODE_POS[e.id] || { x: 50, y: 50 };
        return (
          <g key={e.id}>
            <circle cx={p.x} cy={p.y} r={5.2} className={statusClass(e.status)} strokeWidth={0.7} />
            <text
              x={p.x}
              y={p.y + 9.5}
              textAnchor="middle"
              className="fill-[var(--color-ink-2)]"
              style={{ fontSize: 2.6, fontFamily: 'var(--font-mono)' }}
            >
              {e.label.split(' ')[0]}
            </text>
          </g>
        );
      })}
    </svg>
    <figcaption className="sr-only">
      Brand hub with four answer-engine nodes. Brightness follows measurement status only.
    </figcaption>
  </figure>
);
