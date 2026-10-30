import React from 'react';
import { MARKETING_FAQ, type MarketingFaqItem } from '../../services/marketing/marketingFaqContent';
import './space.css';

/**
 * Visible FAQ. Each page's items must stay 1:1 with its FAQPage JSON-LD in pageMeta.
 * Defaults to the landing FAQ; hub and free tool pages pass their own items.
 */
export const MarketingFaq: React.FC<{
  className?: string;
  embedded?: boolean;
  items?: readonly MarketingFaqItem[];
  heading?: string;
}> = ({ className = '', embedded = false, items = MARKETING_FAQ, heading = 'Common questions.' }) => (
  <section
    id="faq"
    aria-labelledby="faq-heading"
    className={`${
      embedded
        ? 'relative border-t lx-hairline pt-14 sm:pt-20'
        : 'border-t lx-hairline px-5 py-28 sm:px-8 sm:py-36'
    } ${className}`}
  >
    <div className={embedded ? 'max-w-3xl' : 'mx-auto max-w-3xl'}>
      {!embedded && <p className="lx-eyebrow">Questions</p>}
      <h2
        id="faq-heading"
        className={embedded ? 'lx-display lx-h3 mb-8' : 'lx-display lx-h2 mt-6 mb-12'}
      >
        {heading}
      </h2>
      <div className="border-b lx-hairline">
        {items.map((item) => (
          <details key={item.question} className="lx-faq group border-t lx-hairline">
            <summary className="flex items-start justify-between gap-6 py-6">
              <span className="text-lg leading-snug text-[var(--color-ink)] sm:text-xl">{item.question}</span>
              <span
                aria-hidden
                className="lx-faq-icon mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-rule)] text-lg leading-none text-[var(--gold-light)]"
              >
                +
              </span>
            </summary>
            <p className="-mt-1 max-w-2xl pb-7 leading-relaxed text-[var(--color-ink-2)]">{item.answer}</p>
          </details>
        ))}
      </div>
    </div>
  </section>
);
