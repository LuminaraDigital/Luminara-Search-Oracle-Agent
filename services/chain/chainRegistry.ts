/**
 * Chain registry: one typed source of truth for chain metadata used by checkout and proofs.
 * Pattern borrowed from Trust Wallet Core `registry.json` (data, not logic). Pure module, no I/O,
 * safe to import from both the browser bundle and the Worker.
 *
 * Values are verified constants only. Never add an RPC, explorer, or chain id that has not been
 * checked against the live network.
 */

export type ChainId = 'ton' | 'xdc';
export type ChainNetworkName = 'mainnet' | 'testnet';

export interface ChainNetworkEntry {
  /** Explorer origin, no trailing slash. */
  explorer: string;
  /** Path segment before a tx hash (leading and trailing slash). */
  txPath: string;
  /** Path segment before an account address (leading slash, trailing slash when non-root). */
  accountPath: string;
  /** EVM chain id (XDC) or TonConnect CHAIN id string (TON). */
  chainRef: string;
}

export interface ChainEntry {
  id: ChainId;
  name: string;
  symbol: string;
  decimals: number;
  /** SLIP-44 coin type, as in wallet-core registry.json. */
  slip44: number;
  curve: 'ed25519' | 'secp256k1';
  networks: Record<ChainNetworkName, ChainNetworkEntry>;
}

export const CHAIN_REGISTRY: Readonly<Record<ChainId, ChainEntry>> = Object.freeze({
  ton: {
    id: 'ton',
    name: 'TON',
    symbol: 'TON',
    decimals: 9,
    slip44: 607,
    curve: 'ed25519',
    networks: {
      // TonConnect CHAIN.MAINNET = '-239', CHAIN.TESTNET = '-3'.
      mainnet: { explorer: 'https://tonviewer.com', txPath: '/transaction/', accountPath: '/', chainRef: '-239' },
      testnet: { explorer: 'https://testnet.tonviewer.com', txPath: '/transaction/', accountPath: '/', chainRef: '-3' },
    },
  },
  xdc: {
    id: 'xdc',
    name: 'XDC Network',
    symbol: 'XDC',
    decimals: 18,
    slip44: 550,
    curve: 'secp256k1',
    networks: {
      // Chain ids match worker/chain/xdcRpc.ts XDC_CHAIN_ID (verified 2026-10-01).
      mainnet: { explorer: 'https://xdcscan.com', txPath: '/tx/', accountPath: '/address/', chainRef: '50' },
      testnet: { explorer: 'https://testnet.xdcscan.com', txPath: '/tx/', accountPath: '/address/', chainRef: '51' },
    },
  },
});

export function getChain(id: ChainId): ChainEntry {
  return CHAIN_REGISTRY[id];
}

export function explorerTxUrl(chain: ChainId, network: ChainNetworkName, txHash: string): string {
  const n = CHAIN_REGISTRY[chain].networks[network];
  return `${n.explorer}${n.txPath}${encodeURIComponent(txHash.trim())}`;
}

export function explorerAccountUrl(chain: ChainId, network: ChainNetworkName, address: string): string {
  const n = CHAIN_REGISTRY[chain].networks[network];
  return `${n.explorer}${n.accountPath}${encodeURIComponent(address.trim())}`;
}

/** Maps a TonConnect `wallet.account.chain` value to a network. Unknown values return null (fail closed). */
export function tonNetworkFromConnectChain(chain: unknown): ChainNetworkName | null {
  const value = typeof chain === 'string' ? chain.trim() : typeof chain === 'number' ? String(chain) : '';
  if (value === CHAIN_REGISTRY.ton.networks.mainnet.chainRef) return 'mainnet';
  if (value === CHAIN_REGISTRY.ton.networks.testnet.chainRef) return 'testnet';
  return null;
}

/**
 * Converts a decimal amount string to elementary units (bigint) without float math.
 * Rejects negatives, exponents, and more fractional digits than `decimals`.
 */
export function toElementaryUnits(amount: string, decimals: number): bigint | null {
  const value = String(amount ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const [whole, frac = ''] = value.split('.');
  if (frac.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** Formats elementary units as a trimmed decimal string (e.g. 15000000000n, 9 -> "15"). */
export function formatElementaryUnits(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
