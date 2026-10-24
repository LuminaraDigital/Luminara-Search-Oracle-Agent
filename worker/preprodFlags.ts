/**
 * Features that stay off in production until an operator turns one flag on
 * in its own change. Absent and "false" both count as off. Do not add a flag
 * that production already enables (card checkout, the Oracle server, the audit queue).
 */
import type { Env } from './env';

export const PREPROD_GATED_FLAGS = [
  'PROOF_ANCHOR_ENABLED',
  'PROOF_XDC_ENABLED',
  'TRUST_RECEIPTS_ENABLED',
  'CITATION_WATCH_LIVE',
  'DOMAIN_VERIFY_ENABLED',
  'AUDIT_RECEIPTS_ENABLED',
  'COMMUNITY_FEED_ENABLED',
  'LUMENS_ENABLED',
  'ORACLE_AUTO_TOOLS',
  'LAUNCHPAD_ENABLED',
  'LAUNCHPAD_MAINNET_ENABLED',
  'LAUNCHPAD_SKIP_CHAIN_VERIFY',
  'Q402_LIVE',
  'OTP_SMS_ENABLED',
  'REQUEST_SIGNING_REQUIRED',
] as const satisfies readonly (keyof Env)[];

export type PreprodGatedFlag = (typeof PREPROD_GATED_FLAGS)[number];

const ENABLING = new Set(['true', 'on', 'enforce', '1', 'yes']);

/** Flag names whose prod value would turn the feature on. Missing means off. */
export function enabledPreprodFlags(vars: Record<string, unknown> | undefined): PreprodGatedFlag[] {
  const source = vars ?? {};
  const enabled: PreprodGatedFlag[] = [];
  for (const flag of PREPROD_GATED_FLAGS) {
    const value = String(source[flag] ?? '').trim().toLowerCase();
    if (ENABLING.has(value)) enabled.push(flag);
  }
  return enabled;
}
