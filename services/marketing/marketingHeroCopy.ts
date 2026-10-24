import { LIVE_ANSWER_CHECKS } from './engineCoverage';

/** Audience line for home and pricing. It does not claim clients or offices. */
export const REAL_ESTATE_AUDIENCE =
  'For independent real estate agencies in Australia, Oceania and South-East Asia.';

/** Hero copy shared by the React pages and the worker's first paint. */
export interface MarketingHeroCopy {
  path: '/' | '/pricing' | '/methodology';
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
  lede: `Buyers and sellers now ask AI which agent to call. Luminara Suite checks whether those answers name your agency, then gives you the one fix to ship next. ${REAL_ESTATE_AUDIENCE} ${LIVE_ANSWER_CHECKS}`,
};

export const PRICING_HERO: MarketingHeroCopy = {
  path: '/pricing',
  layout: 'pricing',
  eyebrow: 'Pricing',
  titleLead: 'Plans for audits, share links,',
  titleEm: 'and reminders.',
  lede: `${REAL_ESTATE_AUDIENCE} Free covers Sample scouts and a daily hosted Instant Audit allowance after you create an account. Starter is web audits only. Growth adds IDE access and shareable reports. Agency adds API access and client workspaces. ${LIVE_ANSWER_CHECKS}`,
};

export const METHODOLOGY_HERO: MarketingHeroCopy = {
  path: '/methodology',
  layout: 'pricing',
  eyebrow: 'Methodology',
  titleLead: 'Measured, estimated,',
  titleEm: 'or not measured.',
  lede: 'Live evidence is labeled Measured. A directional read is Estimated. Missing data stays Not measured, and it is never filled in.',
};

const HEROES = [HOME_HERO, PRICING_HERO, METHODOLOGY_HERO] as const;

export function marketingHeroForPath(path: string): MarketingHeroCopy | null {
  return HEROES.find((hero) => hero.path === path) ?? null;
}
