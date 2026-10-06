/**
 * Who may spend hosted Instant Scout calls.
 * Telegram initData and signed-in accounts use the existing daily free meter.
 * Anonymous web stays on BYOK so hosted keys cannot be drained without identity.
 */
export type HostedScoutRail = 'tma_hosted' | 'signed_in_hosted' | 'byok_or_signin';

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
    return 'Telegram session: this quick scout can use a capped hosted allowance. No API key is required. Each hosted call counts against the daily free limit. When that limit is used, add your own key in Settings or upgrade.';
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
  return 'Signed-out on the web: add your own AI keys in Settings, or sign in. Hosted spend stays off for anonymous visitors so the free allowance cannot be drained.';
}
