import React from 'react';
import { TRUST_ITEMS } from '../../services/marketing/marketingPositioning';

/** Four facts beside a pricing or audit call to action. */
export const TrustStrip: React.FC<{ className?: string }> = ({ className = '' }) => (
  <ul className={`m-0 grid list-none gap-4 p-0 sm:grid-cols-2 ${className}`}>
    {TRUST_ITEMS.map((item) => (
      <li key={item.title} className="lx-glass rounded-2xl px-5 py-4 text-left">
        <p className="text-sm font-medium text-[var(--color-ink)]">{item.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-2)]">{item.body}</p>
      </li>
    ))}
  </ul>
);
