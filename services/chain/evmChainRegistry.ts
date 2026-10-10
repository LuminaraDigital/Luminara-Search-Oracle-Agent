/**
 * EVM Chain Registry
 * One typed source of truth for supported EVM chains, RPC endpoints, explorers, and API configurations.
 * Pure module, zero I/O, safe for both browser bundles and Cloudflare Workers.
 */

export type EvmChainId = 1 | 8453 | 42161 | 137 | 10 | 50 | 11155111 | 84532;

export interface EvmChainConfig {
  id: EvmChainId;
  name: string;
  network: 'mainnet' | 'testnet';
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: readonly string[];
  blockExplorers: {
    name: string;
    url: string;
    apiUrl?: string;
  };
  testnet: boolean;
}

export const EVM_CHAIN_REGISTRY: Readonly<Record<EvmChainId, EvmChainConfig>> = Object.freeze({
  1: {
    id: 1,
    name: 'Ethereum',
    network: 'mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://cloudflare-eth.com', 'https://eth.llamarpc.com'],
    blockExplorers: {
      name: 'Etherscan',
      url: 'https://etherscan.io',
      apiUrl: 'https://api.etherscan.io/api',
    },
    testnet: false,
  },
  8453: {
    id: 8453,
    name: 'Base',
    network: 'mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.base.org', 'https://base.llamarpc.com'],
    blockExplorers: {
      name: 'BaseScan',
      url: 'https://basescan.org',
      apiUrl: 'https://api.basescan.org/api',
    },
    testnet: false,
  },
  42161: {
    id: 42161,
    name: 'Arbitrum One',
    network: 'mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.llamarpc.com'],
    blockExplorers: {
      name: 'Arbiscan',
      url: 'https://arbiscan.io',
      apiUrl: 'https://api.arbiscan.io/api',
    },
    testnet: false,
  },
  137: {
    id: 137,
    name: 'Polygon',
    network: 'mainnet',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: ['https://polygon-rpc.com', 'https://polygon.llamarpc.com'],
    blockExplorers: {
      name: 'PolygonScan',
      url: 'https://polygonscan.com',
      apiUrl: 'https://api.polygonscan.com/api',
    },
    testnet: false,
  },
  10: {
    id: 10,
    name: 'OP Mainnet',
    network: 'mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.optimism.io', 'https://optimism.llamarpc.com'],
    blockExplorers: {
      name: 'Optimistic Etherscan',
      url: 'https://optimistic.etherscan.io',
      apiUrl: 'https://api-optimistic.etherscan.io/api',
    },
    testnet: false,
  },
  50: {
    id: 50,
    name: 'XDC Network',
    network: 'mainnet',
    nativeCurrency: { name: 'XDC', symbol: 'XDC', decimals: 18 },
    rpcUrls: ['https://erpc.xinfin.network', 'https://rpc.xdcrpc.com'],
    blockExplorers: {
      name: 'XDCScan',
      url: 'https://xdcscan.com',
      apiUrl: 'https://xdcscan.com/api',
    },
    testnet: false,
  },
  11155111: {
    id: 11155111,
    name: 'Sepolia',
    network: 'testnet',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.sepolia.org'],
    blockExplorers: {
      name: 'Etherscan Sepolia',
      url: 'https://sepolia.etherscan.io',
      apiUrl: 'https://api-sepolia.etherscan.io/api',
    },
    testnet: true,
  },
  84532: {
    id: 84532,
    name: 'Base Sepolia',
    network: 'testnet',
    nativeCurrency: { name: 'Base Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.base.org'],
    blockExplorers: {
      name: 'BaseScan Sepolia',
      url: 'https://sepolia.basescan.org',
      apiUrl: 'https://api-sepolia.basescan.org/api',
    },
    testnet: true,
  },
});

export function getEvmChainConfig(chainId: number): EvmChainConfig | null {
  return EVM_CHAIN_REGISTRY[chainId as EvmChainId] ?? null;
}

export function isEvmChainSupported(chainId: number): boolean {
  return chainId in EVM_CHAIN_REGISTRY;
}

export function buildExplorerAddressUrl(chainId: number, address: string): string | null {
  const chain = getEvmChainConfig(chainId);
  if (!chain) return null;
  return `${chain.blockExplorers.url}/address/${encodeURIComponent(address.trim())}`;
}

export function buildExplorerTxUrl(chainId: number, txHash: string): string | null {
  const chain = getEvmChainConfig(chainId);
  if (!chain) return null;
  return `${chain.blockExplorers.url}/tx/${encodeURIComponent(txHash.trim())}`;
}
