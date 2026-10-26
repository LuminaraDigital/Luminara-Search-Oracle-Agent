import { createContext, useContext } from 'react';
import type { MarketingNavLink } from '../MarketingNav';
import { ANDROID_LEGAL_LINKS } from '../../services/legal/playClient';

/** One nav for every marketing page, built once in App.tsx. */
export interface MarketingChrome {
  links: MarketingNavLink[];
  primaryCta: { label: string; onClick: () => void };
  secondaryCta: { label: string; onClick: () => void };
  onHome: () => void;
  userLabel?: string | null;
}

export const MarketingChromeContext = createContext<MarketingChrome | null>(null);

/** Header for documents rendered outside the main app nav. Same labels as pricing. */
export const DOCUMENT_CHROME: MarketingChrome = {
  links: [
    { label: 'Why', onClick: () => { window.location.assign('/why'); } },
    { label: 'How it works', onClick: () => { window.location.assign('/how-it-works'); } },
    { label: 'AI', onClick: () => { window.location.assign('/ai'); } },
    { label: 'Pricing', onClick: () => { window.location.assign('/pricing'); } },
  ],
  primaryCta: { label: 'Start free', onClick: () => { window.location.assign('/'); } },
  secondaryCta: { label: 'Sign in', onClick: () => { window.location.assign('/'); } },
  onHome: () => { window.location.assign('/'); },
};

/** Play-distributed legal pages. No Pricing link and no checkout CTA. */
export const ANDROID_DOCUMENT_CHROME: MarketingChrome = {
  links: ANDROID_LEGAL_LINKS.map((link) => ({
    label: link.label,
    onClick: () => { window.location.assign(link.href); },
  })),
  primaryCta: { label: 'Contact', onClick: () => { window.location.assign('/contact?client=android'); } },
  secondaryCta: { label: 'Privacy', onClick: () => { window.location.assign('/privacy?client=android'); } },
  onHome: () => { window.location.assign('/privacy?client=android'); },
};

const noop = () => {};

const FALLBACK_CHROME: MarketingChrome = {
  links: [],
  primaryCta: { label: 'Start free', onClick: noop },
  secondaryCta: { label: 'Sign in', onClick: noop },
  onHome: noop,
};

export function useMarketingChrome(): MarketingChrome {
  return useContext(MarketingChromeContext) ?? FALLBACK_CHROME;
}
