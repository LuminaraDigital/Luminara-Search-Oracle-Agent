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

export function hostedScoutPreRunCopy(rail: HostedScoutRail): string {
  if (rail === 'tma_hosted') {
    return 'Telegram session: this quick scout can use a capped hosted allowance. No API key is required. Each hosted call counts against the daily free limit. When that limit is used, add your own key in Settings or upgrade.';
  }
  if (rail === 'signed_in_hosted') {
    return 'Signed in: hosted engines use your daily free allowance, or your own keys in Settings. Premium engines still need an active plan.';
  }
  return 'Signed-out on the web: add your own AI keys in Settings, or sign in. Hosted spend stays off for anonymous visitors so the free allowance cannot be drained.';
}
