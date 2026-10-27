/**
 * Who may spend hosted Instant Scout calls.
 * Telegram initData and signed-in accounts use the existing daily free meter.
 * Anonymous web stays on BYOK so hosted keys cannot be drained without identity.
 */
import { configService } from '../configService';
import { draftPersistenceService, DRAFT_KEYS } from '../state/draftPersistenceService';

export type HostedScoutRail = 'tma_hosted' | 'signed_in_hosted' | 'byok_or_signin';

/** Homepage probe reads the homepage head and the crawl files only. A full audit is a different product. */
export const GUEST_HERO_NOTE =
  'Free check of your homepage search snippet, robots.txt and llms.txt. No card. A full audit needs sign-in or your own keys.';

export const GUEST_REPORT_NOTE =
  'No 40-page PDF and no made-up score. A full verdict needs sign-in or your own keys.';

export const GUEST_FULL_AUDIT_CTA = 'Sign in to run a full audit';

const GUEST_AUDIT_KEY_STORES = [
  'luminara_tavily_key',
  'luminara_firecrawl_key',
  'luminara_groq_key',
  'luminara_api_key',
  'luminara_openrouter_key',
  'luminara_nvidia_key',
  'luminara_ollama_key',
] as const;

/** Browser-saved vendor keys only. The hosted "proxy" sentinel is not a guest key. */
export function guestHasOwnAuditKeys(): boolean {
  return GUEST_AUDIT_KEY_STORES.some((storageKey) => configService.getByokKey(storageKey).length > 0);
}

/** A guest full audit with no own keys has nowhere to run. Send them to sign-in. */
export function guestNeedsFullAuditSignIn(rail: HostedScoutRail): boolean {
  return rail === 'byok_or_signin' && !guestHasOwnAuditKeys();
}

export function requestGuestFullAuditSignIn(domain?: string): void {
  const trimmed = domain?.trim();
  if (trimmed) draftPersistenceService.setDraft(DRAFT_KEYS.AUDIT_URL, trimmed);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('luminara-open-login', { detail: { mode: 'signin' } }));
}

export function resolveHostedScoutRail(input: {
  inTelegram: boolean;
  hasInitData: boolean;
  signedIn: boolean;
}): HostedScoutRail {
  if (input.inTelegram && input.hasInitData) return 'tma_hosted';
  if (input.signedIn) return 'signed_in_hosted';
  return 'byok_or_signin';
}

export function railHasSession(rail: HostedScoutRail): boolean {
  return rail !== 'byok_or_signin';
}

/**
 * Recovery line after a hosted auth skip or a degraded scout.
 * Guests can be asked to sign in. A signed-in or Telegram rail must not be.
 * Pass `rail` when the caller has one, or `signedIn` from the current session.
 */
export function hostedAuthRecoveryHint(input: { signedIn: boolean } | { rail: HostedScoutRail }): string {
  const signedIn = 'rail' in input ? railHasSession(input.rail) : input.signedIn;
  if (signedIn) return 'Retry, or check Settings → provider status.';
  return 'Add your own key in Settings or sign in.';
}

export function hostedScoutPreRunCopy(
  rail: HostedScoutRail,
  options?: { hostedGateOpen?: boolean },
): string {
  if (rail === 'tma_hosted') {
    return 'Telegram session: Instant Audit can use a capped hosted allowance. No API key is required. Each hosted call counts against the daily free limit. When that limit is used, add your own key in Settings or upgrade.';
  }
  if (rail === 'signed_in_hosted') {
    if (options?.hostedGateOpen === false) {
      return 'Signed in: hosted engines are off for this session. Add your own keys in Settings, or retry when provider status is ready. Premium engines still need an active plan.';
    }
    if (options?.hostedGateOpen === true) {
      return 'Signed in: hosted engines use your daily free allowance, or your own keys in Settings. Premium engines still need an active plan.';
    }
    return 'Signed in: hosted engines use your daily free allowance when provider status is ready, or your own keys in Settings. Premium engines still need an active plan.';
  }
  return 'Sign in for a full audit, or add your own AI keys in Settings.';
}
