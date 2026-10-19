import { LIVE_ANSWER_CHECKS, SITE_AND_SEARCH_CHECK } from './engineCoverage';

/** Hero copy shared by the React pages and the worker's first paint. */
export interface MarketingHeroCopy {
  path: '/' | '/pricing';
  layout: 'home' | 'pricing';
  eyebrow: string;
  titleLead: string;
  titleEm: string;
  lede: string;
}

export const HOME_HERO: MarketingHeroCopy = {
  path: '/',
  layout: 'home',
  eyebrow: 'AI visibility, measured',
  titleLead: 'Be the answer',
  titleEm: 'AI gives.',
  lede: `See if AI recommends your business, and fix it. ${SITE_AND_SEARCH_CHECK}`,
};

export const PRICING_HERO: MarketingHeroCopy = {
  path: '/pricing',
  layout: 'pricing',
  eyebrow: 'Pricing',
  titleLead: 'Plans for audits, share links,',
  titleEm: 'and reminders.',
  lede: `Free covers Sample scouts and a daily hosted Instant Audit allowance after you create an account. Starter is web audits only. Growth adds IDE access and shareable reports. Agency adds API access and client workspaces saved in this browser. ${LIVE_ANSWER_CHECKS}`,
};

const HEROES = [HOME_HERO, PRICING_HERO] as const;

export function marketingHeroForPath(path: string): MarketingHeroCopy | null {
  return HEROES.find((hero) => hero.path === path) ?? null;
}
