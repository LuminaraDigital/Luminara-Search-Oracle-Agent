import React from 'react';
import { MARKETING_BODY as BODY } from './MarketingPageShell';
import type { LearnLink } from '../../services/marketing/learnPages';

/** Related /learn links on a compare, buyer's guide, or free-tool page. */
export const LearnReadingList: React.FC<{ links: readonly LearnLink[] }> = ({ links }) => {
  if (links.length === 0) return null;
  return (
    <div className="mt-10">
      <h2 className="lx-eyebrow">From the knowledge hub</h2>
      <ul className={`mt-4 flex flex-wrap gap-x-6 gap-y-2 ${BODY}`}>
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} className="lx-link">{link.label}</a>
          </li>
        ))}
      </ul>
    </div>
  );
};
