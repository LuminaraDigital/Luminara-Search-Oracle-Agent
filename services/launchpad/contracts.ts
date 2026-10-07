/**
 * Chain config and helpers for SMB Launchpad (shared by Worker and UI).
 *
 * Factory addresses are deliberately unset. They are filled in only after
 * `contracts/` is audited and deployed with `contracts/scripts/deploy.ts`.
 * Never point these at third-party contracts: an ABI mismatch sends user funds
 * to code we do not control.
 */

export type LaunchpadChain = 'xdc' | 'polygon';
export type LaunchpadNetwork = 'testnet' | 'mainnet';

export interface LaunchpadChainConfig {
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  explorerBase: string;
  /** Deployed MerchantLaunchFactory, or null until our own audited deployment exists. */
  factoryAddress: string | null;
}

export const LAUNCHPAD_CHAINS: Record<LaunchpadChain, Record<LaunchpadNetwork, LaunchpadChainConfig>> = {
  xdc: {
    testnet: { chainId: 51, chainName: 'XDC Apothem Testnet', nativeSymbol: 'TXDC', explorerBase: 'https://testnet.xdcscan.com', factoryAddress: null },
    mainnet: { chainId: 50, chainName: 'XDC Network', nativeSymbol: 'XDC', explorerBase: 'https://xdcscan.com', factoryAddress: null },
  },
  polygon: {
    testnet: { chainId: 80002, chainName: 'Polygon Amoy Testnet', nativeSymbol: 'POL', explorerBase: 'https://amoy.polygonscan.com', factoryAddress: null },
    mainnet: { chainId: 137, chainName: 'Polygon', nativeSymbol: 'POL', explorerBase: 'https://polygonscan.com', factoryAddress: null },
  },
};

export function isLaunchpadChain(v: unknown): v is LaunchpadChain {
  return v === 'xdc' || v === 'polygon';
}

export function isLaunchpadNetwork(v: unknown): v is LaunchpadNetwork {
  return v === 'testnet' || v === 'mainnet';
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const XDC_ADDRESS_RE = /^xdc[0-9a-fA-F]{40}$/i;

/** Accepts 0x... or xdc... and returns lower-case 0x form, or null if invalid. */
export function normaliseEvmAddress(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (EVM_ADDRESS_RE.test(s)) return s.toLowerCase();
  if (XDC_ADDRESS_RE.test(s)) return `0x${s.slice(3)}`.toLowerCase();
  return null;
}

export function explorerAddressUrl(chain: LaunchpadChain, network: LaunchpadNetwork, address: string): string {
  return `${LAUNCHPAD_CHAINS[chain][network].explorerBase}/address/${encodeURIComponent(address)}`;
}

/** Crockford-style alphabet without 0/O/1/I/L to avoid misreads at the counter. */
const VOUCHER_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const VOUCHER_CODE_RE = /^VCH-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

/**
 * Unguessable voucher code: 12 symbols from a 31-char alphabet (about 59 bits),
 * drawn with rejection sampling from crypto.getRandomValues so there is no modulo bias.
 * Format: VCH-XXXX-XXXX-XXXX
 */
export function generateVoucherCode(): string {
  const out: string[] = [];
  const limit = 256 - (256 % VOUCHER_ALPHABET.length);
  const buf = new Uint8Array(32);
  while (out.length < 12) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit) out.push(VOUCHER_ALPHABET[b % VOUCHER_ALPHABET.length]);
      if (out.length === 12) break;
    }
  }
  return `VCH-${out.slice(0, 4).join('')}-${out.slice(4, 8).join('')}-${out.slice(8, 12).join('')}`;
}
