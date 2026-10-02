import { createContext, useContext } from 'react';
import type { MarketingNavLink } from '../MarketingNav';

/** One nav for every marketing page, built once in App.tsx. */
export interface MarketingChrome {
  links: MarketingNavLink[];
  primaryCta: { label: string; onClick: () => void };
  secondaryCta: { label: string; onClick: () => void };
  onHome: () => void;
  userLabel?: string | null;
}

export const MarketingChromeContext = createContext<MarketingChrome | null>(null);

const noop = () => {};

const FALLBACK_CHROME: MarketingChrome = {
  links: [],
  primaryCta: { label: 'Create free account', onClick: noop },
  secondaryCta: { label: 'Sign in', onClick: noop },
  onHome: noop,
};

export function useMarketingChrome(): MarketingChrome {
  return useContext(MarketingChromeContext) ?? FALLBACK_CHROME;
}
