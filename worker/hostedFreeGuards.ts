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
import { bearerFromAuthorization } from './firebaseAuth';
import { identityToolkitHeaders } from './identityToolkit';

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

const IDENTITY_LOOKUP = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';
const CONFIRMED_KV_PREFIX = 'email_confirmed:';
const CONFIRMED_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Whether Firebase says the address is confirmed now. An ID token, and a session minted from one,
 * keeps the email_verified it had when it was issued, so a user who just clicked the link still
 * reads as unverified until the token refreshes. The lookup returns the account behind the token.
 */
async function confirmedSinceToken(env: Env, uid: string, idToken: string, fetchImpl: typeof fetch): Promise<boolean> {
  const key = env.FIREBASE_WEB_API_KEY?.trim();
  if (!key) return false;
  try {
    const res = await fetchImpl(`${IDENTITY_LOOKUP}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: identityToolkitHeaders(env),
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { users?: Array<{ localId?: string; emailVerified?: boolean }> };
    const account = data.users?.[0];
    return account?.localId === uid && account.emailVerified === true;
  } catch {
    return false;
  }
}

/**
 * With HOSTED_REQUIRE_VERIFIED_EMAIL=true, a free email sign-up must confirm its address before it
 * spends hosted keys, so a script cannot mint unlimited accounts from made-up addresses.
 * Only an explicit false refuses: Telegram and Google sign-ins, and older sessions that never
 * recorded the flag, pass. Before refusing, Firebase is asked once whether the address was confirmed
 * after the token was issued; a confirmed login is remembered so later requests skip the lookup.
 */
export async function unverifiedEmailRefusal(
  env: Env,
  user: HostedIdentity | null,
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  if (env.HOSTED_REQUIRE_VERIFIED_EMAIL !== 'true') return null;
  if (!user || user.source !== 'firebase' || user.emailVerified !== false) return null;
  const uid = user.id.replace(/^fb:/, '');
  if (await env.LUMINARA_KV?.get(`${CONFIRMED_KV_PREFIX}${uid}`)) return null;
  const idToken = bearerFromAuthorization(request.headers.get('authorization'));
  if (idToken && (await confirmedSinceToken(env, uid, idToken, fetchImpl))) {
    await env.LUMINARA_KV?.put(`${CONFIRMED_KV_PREFIX}${uid}`, '1', { expirationTtl: CONFIRMED_TTL_SECONDS });
    return null;
  }
  return json({ error: VERIFY_EMAIL_ERROR, code: 'EMAIL_UNVERIFIED' }, 403);
}
