import React from 'react';

export const MARKETING_SELL_POINTS = [
  {
    title: 'Search and AI answers together',
    body: 'One scout across Google, AI Overviews, ChatGPT, and Perplexity, so classic ranking gaps and answer-engine gaps show up in the same pass.',
  },
  {
    title: 'Evidence, not theater scores',
    body: 'Every engine is Measured, Estimated, or Not measured. We do not invent citation rates, visibility composites, or ROI.',
  },
  {
    title: 'One action you can ship',
    body: 'Sample scout to Instant Audit to a plain-English next step. Growth adds MCP for Cursor and shareable report links.',
  },
] as const;

interface MarketingSellPointsProps {
  className?: string;
  heading?: string;
}

/** Honest product proofs. No invented customer counts. */
export const MarketingSellPoints: React.FC<MarketingSellPointsProps> = ({
  className = '',
  heading = 'What you get from one scout',
}) => (
  <section className={className}>
    {heading && (
      <h2 className="font-display text-[length:var(--text-display-s)] text-[var(--color-ink)] tracking-tight leading-[1.08] mb-12 max-w-2xl [overflow-wrap:anywhere]">
        {heading}
      </h2>
    )}
    <ol className="grid grid-cols-1 md:grid-cols-3 gap-10 list-none">
      {MARKETING_SELL_POINTS.map((point, index) => (
        <li key={point.title} className="min-w-0 border-t border-[var(--color-rule)] pt-5">
          <p className="text-[12px] font-mono text-[var(--color-accent)] mb-3">
            {String(index + 1).padStart(2, '0')}
          </p>
          <h3 className="text-xl text-[var(--color-ink)] font-medium mb-2">{point.title}</h3>
          <p className="mkt-body">{point.body}</p>
        </li>
      ))}
    </ol>
  </section>
);
