import React, { useEffect, useId, useState } from 'react';
import { ICONS } from '../constants';

export interface MarketingNavLink {
  label: string;
  onClick: () => void;
  /** Hide from the compact desktop rail (still available in the mobile sheet). */
  desktopHidden?: boolean;
}

interface MarketingNavProps {
  brandLabel: string;
  brandSub?: string;
  onBrandClick: () => void;
  links: MarketingNavLink[];
  primaryCta: { label: string; onClick: () => void };
  secondaryCta?: { label: string; onClick: () => void };
  trailing?: React.ReactNode;
}

/**
 * N10 scroll-morph marketing nav: bar at top → detached pill after scroll.
 * Sentence-case CTAs per design.md.
 */
export const MarketingNav: React.FC<MarketingNavProps> = ({
  brandLabel,
  brandSub,
  onBrandClick,
  links,
  primaryCta,
  secondaryCta,
  trailing,
}) => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelId = useId();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const shell = scrolled
    ? 'left-3 right-3 sm:left-6 sm:right-6 md:left-10 md:right-10 top-3 rounded-2xl border border-white/[0.08] bg-black/75 shadow-[0_20px_60px_rgba(0,0,0,0.45)]'
    : 'left-0 right-0 top-0 rounded-none border-b border-white/[0.04] bg-black/40';

  return (
    <nav
      className={`fixed z-50 backdrop-blur-xl transition-[left,right,top,border-radius,box-shadow,background-color] duration-300 ease-out ${shell}`}
      style={{
        paddingTop: scrolled ? undefined : 'max(0px, env(safe-area-inset-top, 0px))',
        paddingLeft: 'max(0px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(0px, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 md:px-8 py-3 sm:py-3.5 min-h-[3.25rem]">
        <button
          type="button"
          className="flex items-center gap-2.5 sm:gap-3 group cursor-pointer text-left min-w-0 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none rounded-lg"
          onClick={onBrandClick}
          aria-label="Luminara Suite home"
        >
          <ICONS.LuminaraLogo className="w-8 h-8 shrink-0 group-hover:scale-105 transition-transform duration-500" />
          <div className="flex flex-col leading-none min-w-0">
            <span className="text-sm sm:text-base font-semibold tracking-tight text-[var(--gold-light)] truncate">
              {brandLabel}
            </span>
            {brandSub && (
              <span className="hidden sm:block text-[10px] text-[var(--color-ink-2)] tracking-wide mt-1 truncate">
                {brandSub}
              </span>
            )}
          </div>
        </button>

        <div className="flex items-center gap-2 sm:gap-3 md:gap-5 shrink-0">
          <div className="hidden md:flex items-center gap-5 lg:gap-6">
            {links
              .filter((l) => !l.desktopHidden)
              .map((link) => (
                <button
                  key={link.label}
                  type="button"
                  onClick={link.onClick}
                  className="whitespace-nowrap text-sm font-medium text-[var(--color-ink-2)] hover:text-[var(--gold-light)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none rounded px-1 py-1"
                >
                  {link.label}
                </button>
              ))}
          </div>

          {secondaryCta && (
            <button
              type="button"
              onClick={secondaryCta.onClick}
              className="hidden sm:inline-flex whitespace-nowrap text-sm font-medium text-[var(--color-ink-2)] hover:text-[var(--gold-light)] transition-colors px-2 py-2 min-h-11 items-center focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none rounded"
            >
              {secondaryCta.label}
            </button>
          )}

          <button type="button" onClick={primaryCta.onClick} className="hidden sm:inline-flex mkt-cta-primary !min-h-11 !py-2 !px-4 text-sm">
            {primaryCta.label}
          </button>

          {trailing}

          <button
            type="button"
            className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-xl border border-white/10 bg-white/[0.03] text-[var(--gold-light)] hover:border-[var(--color-accent)]/40 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ICONS.Close className="w-5 h-5" /> : <ICONS.List className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div
          id={panelId}
          className="md:hidden border-t border-white/[0.06] bg-black/95 backdrop-blur-2xl rounded-b-2xl"
          style={{
            maxHeight: 'min(70dvh, 28rem)',
            overflowY: 'auto',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div className="flex flex-col p-3 gap-1">
            {links.map((link) => (
              <button
                key={`m-${link.label}`}
                type="button"
                onClick={() => run(link.onClick)}
                className="w-full text-left whitespace-nowrap px-4 py-3.5 min-h-12 rounded-xl text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-accent)]/10 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none"
              >
                {link.label}
              </button>
            ))}
            {secondaryCta && (
              <button
                type="button"
                onClick={() => run(secondaryCta.onClick)}
                className="w-full text-left whitespace-nowrap px-4 py-3.5 min-h-12 rounded-xl text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-accent)]/10 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none"
              >
                {secondaryCta.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => run(primaryCta.onClick)}
              className="mt-2 mkt-cta-primary w-full"
            >
              {primaryCta.label}
            </button>
          </div>
        </div>
      )}
    </nav>
  );
};

export default MarketingNav;
