import React from 'react';
import { ICONS } from '../../constants';

interface MarketingFooterProps {
  statement?: string;
}

const LINKS = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'MCP', href: '/docs/mcp.html' },
  { label: 'Windows app', href: '/desktop' },
  { label: 'Studio', href: 'https://luminaradigital.io' },
] as const;

/** Ft5 Statement footer for marketing pages. */
export const MarketingFooter: React.FC<MarketingFooterProps> = ({
  statement = 'Grow with clarity where customers ask.',
}) => (
  <footer
    className="relative z-10 py-14 sm:py-16 px-4 sm:px-6 md:px-20 border-t border-white/[0.05]"
    style={{ paddingBottom: 'max(3.5rem, env(safe-area-inset-bottom, 0px))' }}
  >
    <div className="max-w-5xl mx-auto flex flex-col items-center gap-8 text-center">
      <div className="flex items-center gap-3">
        <ICONS.LuminaraLogo className="w-9 h-9 shrink-0" />
        <span className="font-display text-2xl sm:text-3xl text-[var(--color-ink)] tracking-tight">
          Luminara Suite
        </span>
      </div>
      <p className="font-display text-xl sm:text-2xl text-[var(--color-ink-2)] max-w-xl leading-snug">
        {statement}
      </p>
      <nav className="flex flex-wrap justify-center gap-x-6 gap-y-3" aria-label="Footer">
        {LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target={link.href.startsWith('http') ? '_blank' : undefined}
            rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
            className="text-sm text-[var(--color-ink-2)] hover:text-[var(--gold-light)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none rounded py-1"
          >
            {link.label}
          </a>
        ))}
      </nav>
      <p className="text-[11px] text-gray-500">
        &copy; {new Date().getFullYear()} Luminara Suite. Produced by{' '}
        <a
          href="https://luminaradigital.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--gold)]/80 hover:text-[var(--gold-light)] transition-colors"
        >
          Luminara Digital
        </a>
        {' · Melbourne'}
      </p>
    </div>
  </footer>
);
