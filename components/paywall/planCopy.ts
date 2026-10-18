/**
 * Plan names, badge, blurbs, and bullets shared by /pricing and the checkout modal.
 * Titles and limits come from PLAN_ENTITLEMENTS. Prices stay in planPrices.
 */
import { PLAN_ENTITLEMENTS } from '../../services/plans/planEntitlements';
import { PAID_PLAN_PRICES, type PaidPlanId } from './planPrices';

export const PLAN_CARD_BADGE = 'Recommended';

/** Checkout title. Plans have domain, seat, and feature caps, so this cannot say unlimited. */
export const PAYWALL_HEADLINE = 'Pick the plan that fits your sites';

export type PlanBullet = { included: boolean; text: string };

/** Same sentence as Settings: keys on this device, no sign-in required. */
export const BYOK_CHECKOUT_LINE = 'Your keys stay on this device and work without signing in.';

export function planTitle(id: PaidPlanId): string {
  return PLAN_ENTITLEMENTS[id].title;
}

function withLeadCapital(text: string): string {
  return /^[a-z]/.test(text) ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function planBullets(id: PaidPlanId): PlanBullet[] {
  const e = PLAN_ENTITLEMENTS[id];
  const lines: PlanBullet[] = [
    { included: true, text: `${e.domainLimit} monitored domains` },
    { included: true, text: e.scheduledReaudit === 'none' ? 'On-demand audits' : `${e.scheduledReaudit} re-audits` },
    { included: true, text: id === 'agency' ? 'White-label PDF exports' : id === 'growth' ? 'Branded PDF exports' : 'Standard PDF exports' },
    {
      included: e.mcpAccess,
      text: e.mcpAccess ? 'IDE access (Cursor / Claude / Codex)' : 'No IDE access (web app only)',
    },
    {
      included: e.shareLinks,
      text: e.shareLinks ? 'Public share links' : 'No public share links',
    },
    { included: true, text: `${e.teamSeats} team seat${e.teamSeats === 1 ? '' : 's'}` },
  ];
  if (e.apiAccess) lines.push({ included: true, text: 'Paid research API (Agency plan or your own DataForSEO login)' });
  if (e.agencyClientLimit > 0) lines.push({ included: true, text: `${e.agencyClientLimit} client workspaces` });
  return lines.map((line) => ({ ...line, text: withLeadCapital(line.text) }));
}

export const pricingTiers: Array<{
  id: PaidPlanId;
  priceLabel: string;
  stars: string;
  ton: string;
  blurb: string;
  highlight: boolean;
}> = [
  {
    id: 'starter',
    priceLabel: PAID_PLAN_PRICES.starter.usdLabel,
    stars: PAID_PLAN_PRICES.starter.starsLabel,
    ton: PAID_PLAN_PRICES.starter.tonLabel,
    blurb: 'Web audits for up to 2 sites. No IDE connectors or public share links.',
    highlight: false,
  },
  {
    id: 'growth',
    priceLabel: PAID_PLAN_PRICES.growth.usdLabel,
    stars: PAID_PLAN_PRICES.growth.starsLabel,
    ton: PAID_PLAN_PRICES.growth.tonLabel,
    blurb: 'The growth plan: IDE access, shareable reports, 3 seats, weekly re-audits.',
    highlight: true,
  },
  {
    id: 'agency',
    priceLabel: PAID_PLAN_PRICES.agency.usdLabel,
    stars: PAID_PLAN_PRICES.agency.starsLabel,
    ton: PAID_PLAN_PRICES.agency.tonLabel,
    blurb: 'API access for paid research, 10 client workspaces, 10 team seats, daily re-audits, white-label PDF.',
    highlight: false,
  },
];

/** Stars and card grants both last 30 days, start at confirmation, and do not renew. */
export const CHECKOUT_TERM_LINE =
  'Each paid plan lasts 30 days and starts as soon as payment is confirmed. It does not renew on its own.';

/** Plan modal subline. Same term as checkout: these are not monthly subscriptions. */
export const PAYWALL_SUBLINE = CHECKOUT_TERM_LINE;

/** Shown before a control that leaves this page for Telegram Stars. */
export const TELEGRAM_STARS_HANDOFF = 'Payment happens in Telegram with Stars.';

/** Same Stars button on /pricing and in the checkout modal. */
export function starsPayLabel(starsLabel: string, inTelegram: boolean): string {
  return inTelegram ? `Pay ${starsLabel} · 30 days` : `Pay ${starsLabel} in Telegram`;
}
