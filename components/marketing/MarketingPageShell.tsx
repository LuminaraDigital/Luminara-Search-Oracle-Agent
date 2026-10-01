import React from 'react';
import { MarketingNav } from '../MarketingNav';
import { MarketingAtmosphere } from './MarketingAtmosphere';
import { MarketingFooter } from './MarketingFooter';
import { useMarketingChrome } from './marketingChrome';

interface MarketingPageShellProps {
  brandSub?: string;
  footerStatement?: string;
  children: React.ReactNode;
  /** Wider main for tables / grids */
  wide?: boolean;
}

/** Shared marketing chrome: cinematic stage + the one nav + the one footer. */
export const MarketingPageShell: React.FC<MarketingPageShellProps> = ({
  brandSub,
  footerStatement,
  children,
  wide = false,
}) => {
  const chrome = useMarketingChrome();
  return (
    <div className="min-h-[100dvh] bg-[var(--color-paper)] text-[var(--color-ink)] selection:bg-gold selection:text-black font-sans antialiased relative overflow-x-clip">
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
        className={`relative z-10 pt-28 sm:pt-36 pb-20 sm:pb-28 px-4 sm:px-6 md:px-10 mx-auto ${
          wide ? 'max-w-7xl' : 'max-w-5xl'
        }`}
      >
        {children}
      </main>
      <MarketingFooter statement={footerStatement} />
    </div>
  );
};
