export type PaymentRail = 'stars' | 'ton';

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
  providers?: Record<string, boolean>;
  tiers?: { free?: string[]; paid?: string[] };
}

export interface PaymentOptions {
  tonAvailable: boolean;
  /** Stars can be paid in place only inside the Mini App; on the web we hand off to Telegram. */
  starsInline: boolean;
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
  const tonAvailable = isTonAvailable(health);
  return {
    tonAvailable,
    starsInline: inTelegram,
    defaultTab: !inTelegram && tonAvailable ? 'ton' : 'stars',
  };
}

export function effectiveTab(requested: PaymentRail, options: PaymentOptions): PaymentRail {
  return requested === 'ton' && !options.tonAvailable ? 'stars' : requested;
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
