import React from 'react';
import { ICONS } from '../../constants';
import { COMPANY_SERVICES_URL, OPERATOR_LINE } from '../../services/legal/consumerTerms';

interface MarketingFooterProps {
  statement?: string;
  /** Hairline above the footer; off when the footer sits over a horizon. */
  divider?: boolean;
}

const LINKS = [
  { label: 'Pricing', href: '/pricing' },
  { label: 'Methodology', href: '/methodology' },
  { label: 'Sample report', href: '/sample-report' },
  { label: 'What is AEO', href: '/docs/what-is-aeo.html' },
  { label: 'MCP', href: '/docs/mcp.html' },
  { label: 'Windows app', href: '/desktop' },
  { label: 'Support', href: '/contact' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
] as const;

/** Ft5 Statement footer for marketing pages. */
export const MarketingFooter: React.FC<MarketingFooterProps> = ({
  statement = 'Know where AI recommends you. Fix what matters first.',
  divider = true,
}) => (
  <footer
    className={`relative z-10 py-14 sm:py-16 px-4 sm:px-6 md:px-20 ${divider ? 'border-t border-[var(--color-rule)]' : ''}`}
    style={{ paddingBottom: 'max(3.5rem, env(safe-area-inset-bottom, 0px))' }}
  >
    <div className="max-w-5xl mx-auto flex flex-col items-center gap-8 text-center">
      <div className="flex items-center gap-3">
        <ICONS.LuminaraLogo className="w-9 h-9 shrink-0" />
        <span className="font-serif text-2xl sm:text-3xl text-[var(--color-ink)] tracking-tight">
          Luminara Suite
        </span>
      </div>
      <p className="font-serif italic text-xl sm:text-2xl text-gold-light/85 max-w-xl leading-snug">
        {statement}
      </p>
      <nav className="flex flex-wrap justify-center gap-x-6 gap-y-3" aria-label="Footer">
        {LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className="inline-flex items-center text-sm text-[var(--color-ink-2)] hover:text-[var(--gold-light)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none rounded min-h-6 min-w-6 px-0.5 py-1"
          >
            {link.label}
          </a>
        ))}
      </nav>
      <p className="text-[12px] text-[var(--color-ink-2)]">
        &copy; {new Date().getFullYear()} Luminara Suite. Produced by{' '}
        <a
          href={COMPANY_SERVICES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center min-h-6 text-gold/80 hover:text-gold-light transition-colors"
        >
          Luminara Digital
        </a>
        {` · ${OPERATOR_LINE}`}
      </p>
    </div>
  </footer>
);
