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

const HEX_TX_HASH_RE = /^(?:0x)?([0-9a-fA-F]{64})$/;
const BASE64_TX_HASH_RE = /^[A-Za-z0-9+/_-]{43}=?$/;
const CANONICAL_TX_HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Canonical TON transaction hash: 64 lowercase hex characters.
 * Toncenter v3 returns the 32-byte hash base64-encoded, TonAPI v2 returns it as hex, so the same
 * transaction must collapse to one string before it is used as an idempotency key.
 * Values that are neither 32-byte base64 nor 64 hex are returned trimmed and otherwise unchanged.
 */
export function normalizeTonTxHash(hash: unknown): string {
  const value = typeof hash === 'string' ? hash.trim() : '';
  const hex = HEX_TX_HASH_RE.exec(value);
  if (hex) return hex[1].toLowerCase();
  if (!BASE64_TX_HASH_RE.test(value)) return value;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/').replace(/=$/, ''));
    if (binary.length !== 32) return value;
    let out = '';
    for (let i = 0; i < binary.length; i++) out += binary.charCodeAt(i).toString(16).padStart(2, '0');
    return out;
  } catch {
    return value;
  }
}

/**
 * Every string form the same transaction hash may already be stored under (canonical first).
 * Rows and KV guards written before normalisation hold the provider's own encoding.
 */
export function tonTxHashAliases(hash: string): string[] {
  const canonical = normalizeTonTxHash(hash);
  if (!CANONICAL_TX_HASH_RE.test(canonical)) return [canonical];
  let binary = '';
  for (let i = 0; i < canonical.length; i += 2) {
    binary += String.fromCharCode(Number.parseInt(canonical.slice(i, i + 2), 16));
  }
  const base64 = btoa(binary);
  const base64Url = base64.replace(/\+/g, '-').replace(/\//g, '_');
  return [
    ...new Set([
      canonical,
      canonical.toUpperCase(),
      base64,
      base64.replace(/=$/, ''),
      base64Url,
      base64Url.replace(/=$/, ''),
    ]),
  ];
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
