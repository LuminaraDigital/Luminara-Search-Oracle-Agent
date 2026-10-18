import React from 'react';
import { MARKETING_FAQ } from '../../services/marketing/marketingFaqContent';
import './space.css';

/** Visible FAQ that must stay 1:1 with FAQPage JSON-LD in pageMeta. */
export const MarketingFaq: React.FC<{ className?: string; embedded?: boolean }> = ({
  className = '',
  embedded = false,
}) => (
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
        Common questions.
      </h2>
      <div className="border-b lx-hairline">
        {MARKETING_FAQ.map((item) => (
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
