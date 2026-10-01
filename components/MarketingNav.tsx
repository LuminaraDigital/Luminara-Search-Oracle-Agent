import React, { useEffect, useId, useState } from 'react';
import { ICONS } from '../constants';

export interface MarketingNavLink {
  label: string;
  onClick: () => void;
  desktopHidden?: boolean;
  /** Marks the page the visitor is on. */
  current?: boolean;
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
 * Fixed marketing nav: hairline bar, no glass morph pill (design.md ban).
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
      className="fixed z-50 left-0 right-0 top-0 border-b border-[var(--color-rule)] bg-[var(--color-paper)]"
      style={{
        paddingTop: 'max(0px, env(safe-area-inset-top, 0px))',
        paddingLeft: 'max(0px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(0px, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 md:px-8 py-3 min-h-[3.25rem] max-w-7xl mx-auto">
        <button
          type="button"
          className="flex items-center gap-2.5 group cursor-pointer text-left min-w-0 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none rounded"
          onClick={onBrandClick}
          aria-label="Luminara Suite home"
        >
          <ICONS.LuminaraLogo className="w-7 h-7 shrink-0" />
          <div className="flex flex-col leading-none min-w-0">
            <span className="text-sm font-semibold tracking-tight text-[var(--color-ink)] truncate">
              {brandLabel}
            </span>
            {brandSub && (
              <span className="hidden sm:block text-[11px] text-[var(--color-ink-2)] mt-0.5 truncate">
                {brandSub}
              </span>
            )}
          </div>
        </button>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <div className="hidden md:flex items-center gap-5">
            {links
              .filter((l) => !l.desktopHidden)
              .map((link) => (
                <button
                  key={link.label}
                  type="button"
                  onClick={link.onClick}
                  aria-current={link.current ? 'page' : undefined}
                  className={`whitespace-nowrap text-sm hover:text-[var(--color-ink)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none rounded px-1 py-1 ${
                    link.current ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-2)]'
                  }`}
                >
                  {link.label}
                </button>
              ))}
          </div>

          {secondaryCta && (
            <button
              type="button"
              onClick={secondaryCta.onClick}
              className="hidden sm:inline-flex whitespace-nowrap text-sm text-[var(--color-ink-2)] hover:text-[var(--color-ink)] transition-colors min-h-11 items-center px-2 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none rounded"
            >
              {secondaryCta.label}
            </button>
          )}

          <button
            type="button"
            onClick={primaryCta.onClick}
            className="hidden sm:inline-flex mkt-cta-primary !min-h-10 !py-2 !px-4 text-sm"
          >
            {primaryCta.label}
          </button>

          {trailing}

          <button
            type="button"
            className="md:hidden inline-flex items-center justify-center w-11 h-11 border border-[var(--color-rule)] text-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none"
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
          className="md:hidden border-t border-[var(--color-rule)] bg-[var(--color-paper)]"
          style={{
            maxHeight: 'min(70dvh, 28rem)',
            overflowY: 'auto',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div className="flex flex-col p-2 max-w-7xl mx-auto">
            {links.map((link) => (
              <button
                key={`m-${link.label}`}
                type="button"
                onClick={() => run(link.onClick)}
                aria-current={link.current ? 'page' : undefined}
                className={`w-full text-left whitespace-nowrap px-4 py-3.5 min-h-12 text-sm focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none ${
                  link.current
                    ? 'text-[var(--color-ink)] border-l-2 border-[var(--color-accent)]'
                    : 'text-[var(--color-ink-2)] border-l-2 border-transparent'
                }`}
              >
                {link.label}
              </button>
            ))}
            {secondaryCta && (
              <button
                type="button"
                onClick={() => run(secondaryCta.onClick)}
                className="w-full text-left whitespace-nowrap px-4 py-3.5 min-h-12 text-sm text-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none"
              >
                {secondaryCta.label}
              </button>
            )}
            <div className="px-2 pt-2 pb-3">
              <button type="button" onClick={() => run(primaryCta.onClick)} className="mkt-cta-primary w-full">
                {primaryCta.label}
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default MarketingNav;
