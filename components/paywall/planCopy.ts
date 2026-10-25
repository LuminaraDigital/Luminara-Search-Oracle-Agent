/**
 * Plan names, badge, blurbs, and bullets shared by /pricing and the checkout modal.
 * Titles and limits come from PLAN_ENTITLEMENTS. Prices stay in planPrices.
 */
import { PLAN_ENTITLEMENTS } from '../../services/plans/planEntitlements';
import { PAID_PLAN_PRICES, type PaidPlanId } from './planPrices';

export const PLAN_CARD_BADGE = 'Recommended';

/** Checkout title. Plans have domain and feature caps, so this cannot say unlimited. */
export const PAYWALL_HEADLINE = 'Pick the plan that fits your sites';

export type PlanBullet = { included: boolean; text: string };

/** Same sentence as Settings: keys on this device, no sign-in required. */
export const BYOK_CHECKOUT_LINE = 'Your keys stay on this device and work without signing in.';

export function planTitle(id: PaidPlanId): string {
  return PLAN_ENTITLEMENTS[id].title;
}

export function planSeatLine(id: PaidPlanId): string {
  const seats = PLAN_ENTITLEMENTS[id].teamSeats;
  return seats === 1 ? '1 seat' : `${seats} seats`;
}

export const NO_TAX_LINE = 'Prices are in Australian dollars. No tax is added.';

export const NOTHING_TO_CANCEL = 'There is nothing to cancel, because a plan does not renew.';

/** Web card checkout is closed until STRIPE_CHECKOUT_LIVE is true. Stars in Telegram stays open. */
export const WAITLIST_LINE = 'Payment on the web is not open yet. Email info@luminara.digital to join the waitlist.';

/** One sentence for /pricing, llms.txt, and the pricing meta description. */
export function listPriceSummary(): string {
  const ids = ['starter', 'growth', 'agency'] as const;
  const parts = ids.map((id) => `${PLAN_ENTITLEMENTS[id].title} ${PAID_PLAN_PRICES[id].audLabel}`);
  return `${parts.join(', ')}. Pay by card for a 30-day pass that does not renew, or pay in Telegram Stars in the Mini App.`;
}

/** Free card lines. The daily allowance matches the Worker default of 3. */
export function freePlanLines(): PlanBullet[] {
  const free = PLAN_ENTITLEMENTS.free;
  return [
    { included: true, text: `${free.domainLimit} monitored domain` },
    { included: true, text: 'On-demand audits' },
    { included: true, text: '3 hosted Instant Audit checks a day' },
    { included: false, text: 'No IDE access (web app only)' },
    { included: false, text: 'No public share links' },
  ];
}

function withLeadCapital(text: string): string {
  return /^[a-z]/.test(text) ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function planBullets(id: PaidPlanId): PlanBullet[] {
  const e = PLAN_ENTITLEMENTS[id];
  const lines: PlanBullet[] = [
    { included: true, text: `${e.domainLimit} monitored domains` },
    { included: true, text: e.scheduledReaudit === 'none' ? 'On-demand audits' : `${e.scheduledReaudit} re-audit reminders in Telegram` },
    { included: e.whiteLabelPdf, text: e.whiteLabelPdf ? 'White-label PDF exports' : 'No white-label PDF' },
    {
      included: e.mcpAccess,
      text: e.mcpAccess ? 'IDE access (Cursor / Claude / Codex)' : 'No IDE access (web app only)',
    },
    {
      included: e.shareLinks,
      text: e.shareLinks ? 'Public share links' : 'No public share links',
    },
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
    priceLabel: PAID_PLAN_PRICES.starter.audLabel,
    stars: PAID_PLAN_PRICES.starter.starsLabel,
    ton: PAID_PLAN_PRICES.starter.tonLabel,
    blurb: 'Web audits for up to 2 sites. No IDE connectors or public share links.',
    highlight: false,
  },
  {
    id: 'growth',
    priceLabel: PAID_PLAN_PRICES.growth.audLabel,
    stars: PAID_PLAN_PRICES.growth.starsLabel,
    ton: PAID_PLAN_PRICES.growth.tonLabel,
    blurb: 'IDE access, shareable reports, and weekly re-audit reminders in Telegram.',
    highlight: true,
  },
  {
    id: 'agency',
    priceLabel: PAID_PLAN_PRICES.agency.audLabel,
    stars: PAID_PLAN_PRICES.agency.starsLabel,
    ton: PAID_PLAN_PRICES.agency.tonLabel,
    blurb: 'API access for paid research, 10 client workspaces, daily re-audit reminders in Telegram, white-label PDF.',
    highlight: false,
  },
];

/** Stars and card grants both last 30 days, start at confirmation, and do not renew. */
export const CHECKOUT_TERM_LINE =
  'Each paid plan lasts 30 days and starts as soon as payment is confirmed. It does not renew on its own.';

/** Plan modal subline. Same term as checkout: these are not monthly subscriptions. */
export const PAYWALL_SUBLINE = CHECKOUT_TERM_LINE;

/** Cards on the website and desktop app. Stars only inside the Mini App. */
export const TELEGRAM_STARS_HANDOFF =
  'Pay by card on the website and the desktop app. Pay with Telegram Stars in the Mini App.';

/** Same Stars button on /pricing and in the checkout modal. */
export function starsPayLabel(starsLabel: string, inTelegram: boolean): string {
  return inTelegram ? `Pay ${starsLabel} · 30 days` : `Pay ${starsLabel} in Telegram`;
}

/** Paid plans lift the free daily cap. They are not a promise of unlimited queries. */
export function dailyCapPaywallLine(limit?: number): string {
  const lead = typeof limit === 'number'
    ? `Daily limit reached (${limit}/${limit} used).`
    : 'Daily limit reached.';
  return `${lead} A paid plan lifts the free daily cap.`;
}

export function dailyCapStudioNote(limit: number): string {
  return `Daily limit reached (${limit}/${limit} used today). A paid plan lifts the free daily cap, or add your own API key in Settings.`;
}
