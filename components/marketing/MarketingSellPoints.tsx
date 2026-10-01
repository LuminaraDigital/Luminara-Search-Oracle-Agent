import React from 'react';

export const MARKETING_SELL_POINTS = [
  {
    title: 'Search and AI answers together',
    body: 'One scout across Google, AI Overviews, ChatGPT, and Perplexity, so classic ranking gaps and answer-engine gaps show up in the same pass.',
  },
  {
    title: 'Labeled evidence',
    body: 'Every engine result is marked Measured, Estimated, or Not measured, so you can tell what is proven from what is a best guess.',
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
    <ul className="grid grid-cols-1 md:grid-cols-3 gap-10 list-none">
      {MARKETING_SELL_POINTS.map((point) => (
        <li key={point.title} className="min-w-0 border-t border-[var(--color-rule)] pt-5">
          <h3 className="text-xl text-[var(--color-ink)] font-medium mb-2">{point.title}</h3>
          <p className="mkt-body">{point.body}</p>
        </li>
      ))}
    </ul>
  </section>
);
