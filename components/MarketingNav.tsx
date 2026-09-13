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
 * Shared marketing chrome: compact brand on small screens, desktop link rail,
 * and a full-height mobile sheet so nav never overflows or wraps.
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
  const panelId = useId();

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

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.04] backdrop-blur-xl bg-black/40"
      style={{
        paddingTop: 'max(0px, env(safe-area-inset-top, 0px))',
        paddingLeft: 'max(0px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(0px, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 md:px-12 py-3.5 sm:py-5 min-h-[3.5rem]">
        <button
          type="button"
          className="flex items-center gap-2.5 sm:gap-4 group cursor-pointer text-left min-w-0 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded-lg"
          onClick={onBrandClick}
          aria-label="Luminara Suite home"
        >
          <ICONS.LuminaraLogo className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 group-hover:scale-110 transition-transform duration-700" />
          <div className="flex flex-col leading-none min-w-0">
            <span className="text-sm sm:text-lg font-bold tracking-[0.18em] sm:tracking-[0.32em] uppercase gold-text truncate">
              {brandLabel}
            </span>
            {brandSub && (
              <span className="hidden sm:block text-[7px] text-gray-400 tracking-[0.35em] sm:tracking-[0.55em] font-semibold uppercase mt-1.5 truncate">
                {brandSub}
              </span>
            )}
          </div>
        </button>

        <div className="flex items-center gap-2 sm:gap-4 md:gap-6 shrink-0">
          <div className="hidden md:flex items-center gap-6 lg:gap-8">
            {links
              .filter((l) => !l.desktopHidden)
              .map((link) => (
                <button
                  key={link.label}
                  type="button"
                  onClick={link.onClick}
                  className="whitespace-nowrap text-[9px] uppercase tracking-[0.28em] font-bold text-gray-400 hover:text-gold-light transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded px-1 py-1"
                >
                  {link.label}
                </button>
              ))}
          </div>

          {secondaryCta && (
            <button
              type="button"
              onClick={secondaryCta.onClick}
              className="hidden sm:inline-flex whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.2em] text-gray-300 hover:text-gold transition-colors px-2 py-2 min-h-11 items-center focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded"
            >
              {secondaryCta.label}
            </button>
          )}

          <button
            type="button"
            onClick={primaryCta.onClick}
            className="hidden sm:inline-flex whitespace-nowrap items-center justify-center min-h-11 px-4 md:px-5 py-2 bg-gradient-to-br from-gold to-gold-dark text-black text-[9px] font-black uppercase tracking-[0.2em] rounded-full hover:scale-[1.03] active:scale-95 transition-all shadow-[0_12px_40px_rgba(191,149,63,0.25)] focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            {primaryCta.label}
          </button>

          {trailing}

          <button
            type="button"
            className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-xl border border-white/10 bg-white/[0.03] text-gold-light hover:border-gold/40 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
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
          className="md:hidden border-t border-white/[0.06] bg-black/95 backdrop-blur-2xl"
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
                className="w-full text-left whitespace-nowrap px-4 py-3.5 min-h-12 rounded-xl text-[11px] uppercase tracking-[0.22em] font-bold text-gray-300 hover:text-white hover:bg-gold/10 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                {link.label}
              </button>
            ))}
            {secondaryCta && (
              <button
                type="button"
                onClick={() => run(secondaryCta.onClick)}
                className="w-full text-left whitespace-nowrap px-4 py-3.5 min-h-12 rounded-xl text-[11px] uppercase tracking-[0.22em] font-bold text-gray-300 hover:text-white hover:bg-gold/10 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                {secondaryCta.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => run(primaryCta.onClick)}
              className="mt-2 w-full whitespace-nowrap px-4 py-4 min-h-12 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black text-[11px] font-black uppercase tracking-[0.22em] focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
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
