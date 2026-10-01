/**
 * Chain network gating helpers (TON + XDC).
 * Fail closed when CHAIN_NETWORK is unset or mismatches the merchant address testnet flag.
 */
import type { Env } from './env';

export type ChainNetwork = 'testnet' | 'mainnet';

export type MerchantAddressCheck =
  | { ok: true; format: 'friendly' | 'raw'; testnet: boolean }
  | { ok: false; reason: string };

const MAINNET_TONAPI = 'https://tonapi.io';
const TESTNET_TONAPI = 'https://testnet.tonapi.io';

export function resolveChainNetwork(env: Pick<Env, 'CHAIN_NETWORK'>): ChainNetwork | null {
  const raw = String(env.CHAIN_NETWORK || '').trim().toLowerCase();
  if (raw === 'testnet' || raw === 'mainnet') return raw;
  return null;
}

export function isProofFlagEnabled(env: Pick<Env, 'PROOF_ANCHOR_ENABLED' | 'PROOF_XDC_ENABLED'>, flag: 'PROOF_ANCHOR_ENABLED' | 'PROOF_XDC_ENABLED'): boolean {
  return String(env[flag] || '').trim().toLowerCase() === 'true';
}

/** Strip trailing slashes so callers can append `/transactions` safely. */
export function normalizeApiBase(base: string): string {
  return base.trim().replace(/\/+$/, '');
}

/**
 * Resolve Toncenter + TonAPI bases. CHAIN_TON_API_BASE is required (fail closed).
 * TonAPI fallback defaults only when CHAIN_TON_API_FALLBACK_BASE is unset.
 */
export function resolveTonApiBases(
  env: Pick<Env, 'CHAIN_NETWORK' | 'CHAIN_TON_API_BASE' | 'CHAIN_TON_API_FALLBACK_BASE'>,
): { toncenter: string; tonapi: string; network: ChainNetwork } | null {
  const network = resolveChainNetwork(env);
  if (!network) return null;

  const toncenterRaw = String(env.CHAIN_TON_API_BASE || '').trim();
  if (!toncenterRaw) return null;
  const toncenter = normalizeApiBase(toncenterRaw);

  const tonapiRaw = String(env.CHAIN_TON_API_FALLBACK_BASE || '').trim();
  const tonapi = normalizeApiBase(
    tonapiRaw || (network === 'testnet' ? TESTNET_TONAPI : MAINNET_TONAPI),
  );

  if (network === 'testnet') {
    if (!/testnet/i.test(toncenter)) return null;
    if (!/testnet/i.test(tonapi)) return null;
  } else {
    if (/testnet/i.test(toncenter)) return null;
    if (/testnet/i.test(tonapi)) return null;
  }

  return { toncenter, tonapi, network };
}

/**
 * Merchant address must match CHAIN_NETWORK.
 * Raw `0:`/`-1:` addresses are rejected for merchant config (no reliable testnet flag).
 */
export function merchantAddressMatchesNetwork(
  addressCheck: MerchantAddressCheck,
  network: ChainNetwork,
): { ok: true } | { ok: false; reason: string } {
  if (!addressCheck.ok) return { ok: false, reason: addressCheck.reason };
  if (addressCheck.format === 'raw') {
    return { ok: false, reason: 'raw 0:/-1: merchant addresses are not allowed; use EQ/UQ (mainnet) or kQ/0Q (testnet)' };
  }
  if (network === 'testnet' && !addressCheck.testnet) {
    return { ok: false, reason: 'CHAIN_NETWORK=testnet requires a testnet merchant address (kQ/0Q)' };
  }
  if (network === 'mainnet' && addressCheck.testnet) {
    return { ok: false, reason: 'CHAIN_NETWORK=mainnet rejects testnet merchant addresses (kQ/0Q)' };
  }
  return { ok: true };
}

export function tonExplorerTxUrl(network: ChainNetwork, txHash: string): string {
  const host = network === 'testnet' ? 'https://testnet.tonviewer.com' : 'https://tonviewer.com';
  const hash = encodeURIComponent(txHash);
  return `${host}/transaction/${hash}`;
}

export function productionImpliesMainnet(env: Pick<Env, 'ENVIRONMENT' | 'CHAIN_NETWORK'>): boolean {
  const isProd = String(env.ENVIRONMENT || '').trim().toLowerCase() === 'production';
  if (!isProd) return true;
  return resolveChainNetwork(env) === 'mainnet';
}
