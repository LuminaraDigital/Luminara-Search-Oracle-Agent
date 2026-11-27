import React from 'react';
import { DESKTOP_EXTERNAL_LINKS } from '../../services/marketing/platformSurfaces';

interface DesktopExternalLinksProps {
  variant?: 'inline' | 'menu';
  excludeIds?: readonly string[];
  className?: string;
  linkClassName?: string;
  onSelect?: () => void;
}

const DEFAULT_CONTAINER: Record<'inline' | 'menu', string> = {
  inline: 'flex flex-wrap items-center gap-x-3.5 gap-y-1.5',
  menu: 'flex flex-col gap-0.5',
};

const DEFAULT_LINK: Record<'inline' | 'menu', string> = {
  inline:
    'inline-flex items-center min-h-6 px-0.5 py-0.5 text-xs text-gold-light/85 hover:text-gold-light underline decoration-gold/35 underline-offset-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold rounded',
  menu:
    'w-full text-left px-3 py-2 min-h-11 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center justify-between gap-2 outline-none focus-visible:ring-2 focus-visible:ring-gold',
};

/** Outbound Website, FAQ, Windows, Telegram, and Google Play links inside the desktop shell. */
export const DesktopExternalLinks: React.FC<DesktopExternalLinksProps> = ({
  variant = 'inline',
  excludeIds,
  className = '',
  linkClassName,
  onSelect,
}) => {
  const excluded = excludeIds ? new Set(excludeIds) : null;
  const items = excluded
    ? DESKTOP_EXTERNAL_LINKS.filter((link) => !excluded.has(link.id))
    : DESKTOP_EXTERNAL_LINKS;

  return (
    <nav aria-label="Luminara links" className={`${DEFAULT_CONTAINER[variant]} ${className}`.trim()}>
      {items.map((link) => (
        <a
          key={link.id}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onSelect}
          className={linkClassName ?? DEFAULT_LINK[variant]}
        >
          <span className="truncate">{link.label}</span>
          {variant === 'menu' && (
            <span aria-hidden="true" className="text-[10px] text-gold-light/70 shrink-0">↗</span>
          )}
          <span className="sr-only"> (opens in browser)</span>
        </a>
      ))}
    </nav>
  );
};
