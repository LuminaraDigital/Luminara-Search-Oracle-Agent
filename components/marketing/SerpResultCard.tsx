import React from 'react';
import { checkDescription, checkTitle, serpBreadcrumb, type SerpDevice } from '../../services/freeTools/serpPreview';

interface SerpResultCardProps {
  url: string;
  title: string;
  description: string;
  /** Shown above the URL. Falls back to the host. */
  siteName?: string;
  device?: SerpDevice;
  /** Wrap a desktop title instead of keeping it on one line (a card narrower than 600px). */
  wrapTitle?: boolean;
  /** Accessible name of the card, which says whose estimate it is. */
  label: string;
}

/**
 * One Google result, estimated from a title and description with Google's pixel cuts.
 * A light card, because Google results are light; colours follow Google's light theme.
 * Used by the SERP preview tool and the free check's homepage read.
 */
export const SerpResultCard: React.FC<SerpResultCardProps> = ({
  url,
  title,
  description,
  siteName = '',
  device = 'desktop',
  wrapTitle = false,
  label,
}) => {
  const crumb = serpBreadcrumb(url);
  const shownTitle = checkTitle(title).shown;
  const shownDescription = checkDescription(description, device).shown;
  const name = siteName.trim() || crumb.site;
  return (
    // A desktop title stays on one line, as on Google, and already carries Google's estimated cut;
    // a card narrower than 600px scrolls rather than cutting it again with CSS.
    <figure
      aria-label={label}
      className={`overflow-x-auto rounded-2xl bg-white p-4 text-left font-[Arial,Helvetica,sans-serif] ${device === 'mobile' ? 'max-w-[360px]' : ''}`}
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[rgb(241,243,244)] text-xs text-[rgb(77,81,86)]">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm text-[rgb(32,33,36)]">{name}</p>
          <p className="truncate text-xs text-[rgb(77,81,86)]">
            {url.toLowerCase().startsWith('http://') ? 'http' : 'https'}://{crumb.site}
            {crumb.crumbs.map((part) => ` › ${part}`).join('')}
          </p>
        </div>
      </div>
      <p
        className={`mt-2 text-xl leading-snug text-[rgb(26,13,171)] ${
          device === 'desktop' && !wrapTitle ? 'whitespace-nowrap' : '[overflow-wrap:anywhere]'
        }`}
      >
        {shownTitle || crumb.site}
      </p>
      {shownDescription ? (
        <p className="mt-1 text-sm leading-relaxed text-[rgb(77,81,86)] [overflow-wrap:anywhere]">{shownDescription}</p>
      ) : (
        // Our note, not the site's text, so it must not look like a snippet.
        <p className="mt-1 text-sm italic text-[rgb(128,134,139)]">
          (No description. Google picks text from the page.)
        </p>
      )}
    </figure>
  );
};
