import React from 'react';
import { LIVE_ANSWER_CHECKS } from '../../services/marketing/engineCoverage';
import './space.css';

export const MARKETING_SELL_POINTS = [
  {
    title: 'Search and AI answers together',
    body: `Your site, suburb pages, and live web search in one pass so you see where buyers find you and where competitors get named instead. ${LIVE_ANSWER_CHECKS}`,
  },
  {
    title: 'Labeled evidence',
    body: 'Every engine result is marked Measured, Estimated, or Not measured, so you can tell what is proven from what is a best guess.',
  },
  {
    title: 'One action you can ship',
    body: 'Live crawl check to Instant Audit to a ready-to-paste page, review, or schema fix that helps win the enquiry. Growth adds shareable report links and IDE access.',
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
  <section className={className} aria-labelledby={heading ? 'sell-points-heading' : undefined}>
    {heading && (
      <div className="max-w-3xl" data-reveal>
        <p className="lx-eyebrow">What you get</p>
        <h2 id="sell-points-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
          {heading}
        </h2>
      </div>
    )}
    <ul className="m-0 mt-14 grid list-none gap-12 p-0 md:grid-cols-3 md:gap-10">
      {MARKETING_SELL_POINTS.map((point, idx) => (
        <li key={point.title} className="min-w-0" data-reveal style={{ transitionDelay: `${idx * 90}ms` }}>
          <span aria-hidden className="font-serif text-5xl leading-none lx-gold-text">{`0${idx + 1}`}</span>
          <div aria-hidden className="mt-6 h-px w-full bg-gradient-to-r from-gold/60 to-transparent" />
          <h3 className="mt-6 text-xl font-medium text-[var(--color-ink)]">{point.title}</h3>
          <p className="mt-3 leading-relaxed text-[var(--color-ink-2)]">{point.body}</p>
        </li>
      ))}
    </ul>
  </section>
);
