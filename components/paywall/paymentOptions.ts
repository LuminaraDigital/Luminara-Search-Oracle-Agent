export type PaymentRail = 'card' | 'stars' | 'ton';

/** Published Mini App link (see public/privacy.html and worker/privacyPolicy.ts). */
export const TELEGRAM_MINI_APP_URL = 'https://t.me/LuminaraSuiteBot/app';

export const PREMIUM_ENGINES_FALLBACK = 'Premium hosted AI engines';

const DEFAULT_PAID_TIER = ['nim', 'ollama', 'openrouter'];

const ENGINE_LABELS: Record<string, string> = {
  groq: 'Groq',
  nim: 'NVIDIA NIM',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  gemini: 'Google Gemini',
};

interface HealthLike {
  ok?: boolean;
  ton?: boolean;
  jettonCheckout?: boolean;
  stripeCheckout?: boolean;
  providers?: Record<string, boolean>;
  tiers?: { free?: string[]; paid?: string[] };
}

/** USDT / $LORA rails show only when health loaded, TON is configured, and the server says Jetton checkout is live. */
export function isJettonCheckoutAvailable(health: HealthLike | null | undefined): boolean {
  return Boolean(health?.ok && health.ton === true && health.jettonCheckout === true);
}

/**
 * Card (Stripe) only on web when the Worker reports stripeCheckout live.
 * Never inside Telegram Mini App (Stars for digital goods).
 */
export function isStripeCheckoutAvailable(
  health: HealthLike | null | undefined,
  inTelegram: boolean,
): boolean {
  if (inTelegram) return false;
  return health?.ok === true && health.stripeCheckout === true;
}

export interface PaymentOptions {
  tonAvailable: boolean;
  /** Stars can be paid in place only inside the Mini App; on the web we hand off to Telegram. */
  starsInline: boolean;
  /** Card tab only when Stripe is live and not in Telegram. */
  cardAvailable: boolean;
  /** The TON tab is drawn at all only outside Telegram. Inside it there is no tab, not even a disabled one. */
  showTonTab: boolean;
  /** The line that invites card payment or an invoice by email. Never inside Telegram. */
  showCardGuidance: boolean;
  defaultTab: PaymentRail;
}

export function isTonAvailable(health: HealthLike | null | undefined): boolean {
  return health?.ok === true && health.ton === true;
}

export function resolvePaymentOptions({
  inTelegram,
  health,
}: {
  inTelegram: boolean;
  health: HealthLike | null | undefined;
}): PaymentOptions {
  // Telegram requires digital goods inside a bot or Mini App to be sold for Stars, so inside
  // Telegram the only rail is Stars, whatever the server reports.
  const tonAvailable = !inTelegram && isTonAvailable(health);
  const cardAvailable = isStripeCheckoutAvailable(health, inTelegram);
  let defaultTab: PaymentRail = 'stars';
  if (inTelegram) {
    defaultTab = 'stars';
  } else if (cardAvailable) {
    defaultTab = 'card';
  } else if (tonAvailable) {
    defaultTab = 'ton';
  }
  return {
    tonAvailable,
    starsInline: inTelegram,
    cardAvailable,
    showTonTab: !inTelegram,
    showCardGuidance: !inTelegram && !cardAvailable,
    defaultTab,
  };
}

/** The rails a buyer can actually pay with on this surface. Inside Telegram this is exactly Stars. */
export function railsOffered(options: PaymentOptions): PaymentRail[] {
  const rails: PaymentRail[] = [];
  if (options.cardAvailable) rails.push('card');
  rails.push('stars');
  if (options.tonAvailable) rails.push('ton');
  return rails;
}

export function effectiveTab(requested: PaymentRail, options: PaymentOptions): PaymentRail {
  if (requested === 'card' && !options.cardAvailable) {
    return options.tonAvailable ? 'ton' : 'stars';
  }
  if (requested === 'ton' && !options.tonAvailable) {
    return options.cardAvailable ? 'card' : 'stars';
  }
  return requested;
}

export function paidEngineLabels(health: HealthLike | null | undefined): string[] {
  if (health?.ok !== true || !health.providers) return [];
  const paidTier = health.tiers?.paid?.length ? health.tiers.paid : DEFAULT_PAID_TIER;
  return paidTier
    .filter(id => health.providers?.[id] === true && ENGINE_LABELS[id])
    .map(id => ENGINE_LABELS[id]);
}

export function formatEngineList(labels: string[]): string {
  if (labels.length === 0) return PREMIUM_ENGINES_FALLBACK;
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
}

export function isFreeEngineConfigured(health: HealthLike | null | undefined, id = 'groq'): boolean {
  return health?.ok === true && health.providers?.[id] === true;
}
