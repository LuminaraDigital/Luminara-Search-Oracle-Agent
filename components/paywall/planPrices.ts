/**
 * Display prices for the public pricing page.
 * Stars and TON are mirrors of the checkout catalogs:
 * worker/telegramBot.ts PLANS.*.stars and worker/tonPayment.ts TON_PRICING.*.ton.
 * USD strings are the published marketing labels already shown on /pricing.
 * tests/pricingDiscoverability.test.ts fails if Stars or TON drift from the worker.
 */

export type PaidPlanId = 'starter' | 'growth' | 'agency';

export interface PaidPlanPrice {
  id: PaidPlanId;
  stars: number;
  starsLabel: string;
  ton: number;
  tonLabel: string;
  usdLabel: string;
}

export const PAID_PLAN_PRICES: Record<PaidPlanId, PaidPlanPrice> = {
  starter: {
    id: 'starter',
    stars: 2500,
    starsLabel: '2,500 Stars',
    ton: 15,
    tonLabel: '15 TON',
    usdLabel: 'US$49',
  },
  growth: {
    id: 'growth',
    stars: 7500,
    starsLabel: '7,500 Stars',
    ton: 45,
    tonLabel: '45 TON',
    usdLabel: 'US$149',
  },
  agency: {
    id: 'agency',
    stars: 18000,
    starsLabel: '18,000 Stars',
    ton: 120,
    tonLabel: '120 TON',
    usdLabel: 'US$349',
  },
};
