import React from 'react';
import { MARKETING_FAQ } from '../../services/marketing/marketingFaqContent';

/** Visible FAQ that must stay 1:1 with FAQPage JSON-LD in pageMeta. */
export const MarketingFaq: React.FC<{ className?: string; embedded?: boolean }> = ({
  className = '',
  embedded = false,
}) => (
  <section
    id="faq"
    aria-labelledby="faq-heading"
    className={`${
      embedded ? 'relative border-t border-[var(--color-rule)] pt-14 sm:pt-20' : 'mkt-section'
    } ${className}`}
  >
    <div className={embedded ? 'max-w-3xl' : 'max-w-3xl mx-auto'}>
      <h2
        id="faq-heading"
        className="font-display text-[length:var(--text-display-s)] text-[var(--color-ink)] tracking-tight leading-tight mb-8 [overflow-wrap:anywhere]"
      >
        Questions before you run a scout.
      </h2>
      <dl className="space-y-6">
        {MARKETING_FAQ.map((item) => (
          <div key={item.question} className="border-t border-[var(--color-rule)] pt-4">
            <dt className="text-lg text-[var(--color-ink)] font-medium mb-2">{item.question}</dt>
            <dd className="mkt-body">{item.answer}</dd>
          </div>
        ))}
      </dl>
    </div>
  </section>
);
