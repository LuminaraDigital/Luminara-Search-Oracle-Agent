import React from 'react';
import type { HubRow } from '../../services/marketing/seoHubPages';

/** Two-column comparison table: a stacked card list on mobile, a table from md up. */
export const MarketingCompareTable: React.FC<{
  themLabel: string;
  usLabel: string;
  rows: readonly HubRow[];
}> = ({ themLabel, usLabel, rows }) => (
  <div className="lx-glass mt-12 rounded-3xl px-6 py-2 sm:px-8" data-reveal>
    <table className="block w-full text-left md:table">
      <thead className="hidden md:table-header-group">
        <tr>
          <th scope="col" className="py-5 pr-6 text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--color-ink-2)]">
            Dimension
          </th>
          <th scope="col" className="py-5 pr-6 text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--color-ink-2)]">
            {themLabel}
          </th>
          <th scope="col" className="py-5 text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--gold-light)]">
            {usLabel}
          </th>
        </tr>
      </thead>
      <tbody className="block md:table-row-group">
        {rows.map((row) => (
          <tr
            key={row.label}
            className="block border-t py-6 lx-hairline first:border-t-0 md:table-row md:py-0 md:first:border-t"
          >
            <th
              scope="row"
              className="block font-serif text-2xl font-normal leading-tight text-[var(--color-ink)] md:table-cell md:w-[24%] md:py-6 md:pr-6 md:align-top md:text-xl"
            >
              {row.label}
            </th>
            <td className="mt-4 block text-[15px] leading-relaxed text-[var(--color-ink-2)] md:mt-0 md:table-cell md:w-[36%] md:py-6 md:pr-6 md:align-top">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] md:hidden">{themLabel}</span>
              {row.them}
            </td>
            <td className="mt-4 block text-[15px] leading-relaxed text-[var(--color-ink)] md:mt-0 md:table-cell md:py-6 md:align-top">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-[var(--gold-light)] md:hidden">
                {usLabel}
              </span>
              <span className="flex gap-3">
                <span aria-hidden className="mt-[0.5em] h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" />
                {row.us}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
