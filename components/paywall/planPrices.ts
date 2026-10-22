/**
 * Display prices for the public pricing page.
 * Stars and TON are mirrors of the checkout catalogs:
 * worker/telegramBot.ts PLANS.*.stars and worker/tonPayment.ts TON_PRICING.*.ton.
 * USD strings are the published marketing labels already shown on /pricing.
 * tests/pricingDiscoverability.test.ts fails if Stars or TON drift from the worker.
 */

/** Display-only. Stars stay the amount the Worker charges. About A$1.55 per US$1, rounded. */
export const AUD_PER_USD = 1.55;

export function approximateAudLabel(usdLabel: string): string {
  const usd = Number(usdLabel.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(usd)) return usdLabel;
  return `A$${Math.round(usd * AUD_PER_USD)}`;
}

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
