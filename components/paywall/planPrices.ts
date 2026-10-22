/**
 * Display prices for the public pricing page.
 * Stars and TON are mirrors of the checkout catalogs:
 * worker/telegramBot.ts PLANS.*.stars and worker/tonPayment.ts TON_PRICING.*.ton.
 * AUD strings are the card prices in worker/stripePayment.ts (cents / 100).
 * tests/pricingDiscoverability.test.ts fails if Stars or TON drift from the worker.
 */

export type PaidPlanId = 'starter' | 'growth' | 'agency';

export interface PaidPlanPrice {
  id: PaidPlanId;
  stars: number;
  starsLabel: string;
  ton: number;
  tonLabel: string;
  audLabel: string;
}

export const PAID_PLAN_PRICES: Record<PaidPlanId, PaidPlanPrice> = {
  starter: {
    id: 'starter',
    stars: 2500,
    starsLabel: '2,500 Stars',
    ton: 15,
    tonLabel: '15 TON',
    audLabel: 'A$79',
  },
  growth: {
    id: 'growth',
    stars: 7500,
    starsLabel: '7,500 Stars',
    ton: 45,
    tonLabel: '45 TON',
    audLabel: 'A$229',
  },
  agency: {
    id: 'agency',
    stars: 18000,
    starsLabel: '18,000 Stars',
    ton: 120,
    tonLabel: '120 TON',
    audLabel: 'A$549',
  },
};

/** Card price line. One-off 30-day pass, not a subscription. */
export function cardTermLabel(id: PaidPlanId): string {
  return `${PAID_PLAN_PRICES[id].audLabel} · 30 days`;
}

/** Card checkout button. */
export function cardPayLabel(id: PaidPlanId): string {
  return `Pay ${PAID_PLAN_PRICES[id].audLabel} by card`;
}
