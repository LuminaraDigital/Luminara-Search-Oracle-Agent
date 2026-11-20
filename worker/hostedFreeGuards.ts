/**
 * Guards on hosted-key use by free and anonymous callers.
 *
 * Ceiling: a daily limit on hosted-key calls for free and anonymous callers, per provider.
 *
 * Per-account quotas stop one account; they do not stop many throwaway accounts. This meter is shared
 * by every free caller, so the most a free-tier flood can spend in one UTC day is the ceiling below.
 * Paid plans are not counted: their spend is bounded by their own plan quotas.
 *
 * Ceilings come from HOSTED_FREE_DAILY_CEILING (JSON, e.g. {"tavily":500}); a provider it leaves out
 * keeps the default. 0 pauses free hosted use of that provider.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { spendDailyQuota } from './quotaMiddleware';
import { json } from './workerUtils';

export type HostedProvider = 'groq' | 'gemini' | 'tavily' | 'firecrawl' | 'exa';

/** Calls per UTC day across all free callers. Sized for roughly 1,000 active free users. */
export const DEFAULT_FREE_DAILY_CEILING: Record<HostedProvider, number> = {
  groq: 5000,
  gemini: 2000,
  tavily: 1000,
  firecrawl: 1000,
  exa: 300,
};

export const HOSTED_CEILING_ERROR = 'Free hosted AI is busy today. Try again tomorrow, add your own key in Settings, or upgrade.';

export function isHostedProvider(id: string): id is HostedProvider {
  return Object.prototype.hasOwnProperty.call(DEFAULT_FREE_DAILY_CEILING, id);
}

export function freeDailyCeiling(env: Pick<Env, 'HOSTED_FREE_DAILY_CEILING'>, provider: HostedProvider): number {
  const fallback = DEFAULT_FREE_DAILY_CEILING[provider];
  const raw = env.HOSTED_FREE_DAILY_CEILING?.trim();
  if (!raw) return fallback;
  try {
    const value = (JSON.parse(raw) as Record<string, unknown>)[provider];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Takes one free hosted call from the provider's shared daily meter. False means do not call the
 * provider: the ceiling is reached, or the meter could not be read (fails closed, like account quotas).
 */
export async function takeFreeHostedCall(env: Env, provider: HostedProvider): Promise<boolean> {
  const ceiling = freeDailyCeiling(env, provider);
  if (ceiling === 0) return false;
  const spent = await spendDailyQuota(env, `hosted-free:${provider}`, ceiling);
  if (!spent.ok) {
    console.warn(JSON.stringify({ event: 'hosted_free_ceiling', provider, ceiling, reason: spent.code }));
  }
  return spent.ok;
}

export const VERIFY_EMAIL_ERROR = 'Confirm your email address to use free hosted AI. Check your inbox for the link, then try again.';

/**
 * With HOSTED_REQUIRE_VERIFIED_EMAIL=true, a free email sign-up must confirm its address before it
 * spends hosted keys, so a script cannot mint unlimited accounts from made-up addresses.
 * Only an explicit false refuses: Telegram and Google sign-ins, and older sessions that never
 * recorded the flag, pass.
 */
export function unverifiedEmailRefusal(env: Pick<Env, 'HOSTED_REQUIRE_VERIFIED_EMAIL'>, user: HostedIdentity | null): Response | null {
  if (env.HOSTED_REQUIRE_VERIFIED_EMAIL !== 'true') return null;
  if (!user || user.source !== 'firebase' || user.emailVerified !== false) return null;
  return json({ error: VERIFY_EMAIL_ERROR, code: 'EMAIL_UNVERIFIED' }, 403);
}

