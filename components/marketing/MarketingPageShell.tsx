import React, { useEffect, useRef } from 'react';
import './space.css';
import { MarketingNav } from '../MarketingNav';
import { MarketingAtmosphere } from './MarketingAtmosphere';
import { MarketingFooter } from './MarketingFooter';
import { useMarketingChrome } from './marketingChrome';
import { prefersReducedMotion } from './constellationCapability';
import type { EvidenceState } from './earth/globeStory';

interface MarketingAction {
  label: string;
  onClick: () => void;
}

/** Closing call to action over the horizon, directly above the footer. */
export interface MarketingClosing {
  eyebrow: string;
  title: React.ReactNode;
  body?: React.ReactNode;
  cta: MarketingAction;
  links?: MarketingAction[];
}

interface MarketingPageShellProps {
  brandSub?: string;
  footerStatement?: string;
  children: React.ReactNode;
  /** Wider main for tables / grids */
  wide?: boolean;
  closing?: MarketingClosing;
}

/** Evidence label glyphs, the same marks as the landing legend: filled, half, dashed. */
export const EvidenceGlyph: React.FC<{ state: EvidenceState; large?: boolean }> = ({ state, large = false }) => {
  const size = large ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5';
  if (state === 'Measured') {
    return <span aria-hidden className={`inline-block ${size} shrink-0 rounded-full bg-[var(--color-accent)]`} />;
  }
  if (state === 'Estimated') {
    return (
      <span
        aria-hidden
        className={`inline-block ${size} shrink-0 rounded-full border border-[var(--color-accent)] bg-[linear-gradient(90deg,var(--color-accent)_50%,transparent_50%)]`}
      />
    );
  }
  return <span aria-hidden className={`inline-block ${size} shrink-0 rounded-full border border-dashed border-[var(--color-ink-2)]`} />;
};

/** Centered page hero in the landing's type: eyebrow, serif headline, gold rule, lede. */
export const MarketingPageHeader: React.FC<{
  eyebrow: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ eyebrow, title, lede, children }) => (
  <header className="relative mx-auto max-w-4xl text-center">
    <p className="lx-eyebrow lx-enter-rise lx-d1">{eyebrow}</p>
    <h1 className="lx-display lx-h2 lx-enter-rise lx-d2 mt-6 [overflow-wrap:anywhere]">{title}</h1>
    <span aria-hidden className="lx-rule lx-enter-draw lx-d3 mx-auto mt-8" />
    {lede && <p className="lx-lede lx-enter-rise lx-d3 mx-auto mt-7 max-w-2xl">{lede}</p>}
    {children && (
      <div className="lx-enter-rise lx-d4 mt-9 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
        {children}
      </div>
    )}
  </header>
);

/** Shared marketing chrome: starfield backdrop, the one nav, a closing horizon and the one footer. */
export const MarketingPageShell: React.FC<MarketingPageShellProps> = ({
  brandSub,
  footerStatement,
  children,
  wide = false,
  closing,
}) => {
  const chrome = useMarketingChrome();
  const rootRef = useRef<HTMLDivElement>(null);

  // Scroll reveal: armed only when it can run, so content never hides without it.
  useEffect(() => {
    const root = rootRef.current;
    if (
      !root ||
      typeof IntersectionObserver === 'undefined' ||
      prefersReducedMotion() ||
      document.visibilityState !== 'visible'
    ) {
      return;
    }
    root.classList.add('lx-armed');
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-in', '');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    root.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className="lx-root isolate relative min-h-[100dvh] overflow-x-clip font-sans antialiased selection:bg-gold selection:text-black"
    >
      <MarketingAtmosphere intensity="page" />
      <MarketingNav
        brandLabel="Luminara Suite"
        brandSub={brandSub}
        onBrandClick={chrome.onHome}
        links={chrome.links}
        primaryCta={chrome.primaryCta}
        secondaryCta={chrome.secondaryCta}
      />
      <main
        className={`relative z-10 mx-auto px-5 pb-24 pt-32 sm:px-8 sm:pb-32 sm:pt-44 ${wide ? 'max-w-6xl' : 'max-w-5xl'}`}
      >
        {children}
      </main>
      {closing ? (
        <div className="relative overflow-hidden border-t lx-hairline">
          <section aria-labelledby="closing-heading" className="relative z-10 px-5 pb-12 pt-24 text-center sm:px-8 sm:pt-32">
            <div data-reveal>
              <p className="lx-eyebrow">{closing.eyebrow}</p>
              <h2 id="closing-heading" className="lx-display lx-h2 mx-auto mt-6 max-w-4xl [overflow-wrap:anywhere]">
                {closing.title}
              </h2>
              {closing.body && <p className="lx-lede mx-auto mt-6 max-w-xl">{closing.body}</p>}
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
              <button type="button" onClick={closing.cta.onClick} className="lx-btn lx-btn-gold">
                {closing.cta.label}
              </button>
              {closing.links?.map((link) => (
                <button key={link.label} type="button" onClick={link.onClick} className="lx-link text-sm">
                  {link.label}
                </button>
              ))}
            </div>
          </section>
          {/* The horizon hangs from the footer, so it clears the closing copy at any length. */}
          <div className="relative pt-36 sm:pt-44">
            <div aria-hidden className="lx-horizon top-14 sm:top-16" />
            <div className="relative z-10">
              <MarketingFooter statement={footerStatement} divider={false} />
            </div>
          </div>
        </div>
      ) : (
        <MarketingFooter statement={footerStatement} />
      )}
    </div>
  );
};
