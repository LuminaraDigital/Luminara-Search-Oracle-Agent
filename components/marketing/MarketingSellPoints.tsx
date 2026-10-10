import React from 'react';

export const MARKETING_SELL_POINTS = [
  {
    title: 'Search and AI answers together',
    body: 'One pass across Google, AI Overviews, ChatGPT, and Perplexity, so classic search rankings and AI answer citations appear on the same workbench.',
  },
  {
    title: 'Evidence-bound honesty',
    body: 'Every engine result is strictly labeled Measured, Estimated, or Not measured. No synthetic 0-100 vanity scores or invented metrics.',
  },
  {
    title: 'Closed-loop fix engine',
    body: 'Turns audit gaps into a prioritized 1-3 fix list. Growth tier connects directly to Cursor and Claude via MCP so AI agents write the code fixes.',
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
