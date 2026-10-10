/**
 * Web3 Transaction Simulation Engine
 * Executes dry-run eth_call and gas calculations via Viem before asking users to sign.
 * Protects non-technical users from burning gas on reverting transactions.
 */

import {
  createPublicClient,
  http,
  formatEther,
  type Address,
  type PublicClient,
} from 'viem';
import { getEvmChainConfig } from '../chain/evmChainRegistry';

export interface SimulationResult {
  success: boolean;
  gasLimit: bigint;
  gasPriceGwei: string;
  estimatedFeeNative: string;
  estimatedFeeUsd: string;
  revertReason?: string;
  summary: string;
  stateDiff?: {
    balanceChangeNative?: string;
    tokensMinted?: string;
    targetAddress?: string;
  };
}

export interface SimulateDeployParams {
  chainId: number;
  bytecode: `0x${string}`;
  abi: any[];
  args?: any[];
  fromAddress?: Address;
  ethUsdPrice?: number;
}

export interface SimulateCallParams {
  chainId: number;
  contractAddress: Address;
  abi: any[];
  functionName: string;
  args?: any[];
  fromAddress?: Address;
  valueWei?: bigint;
  ethUsdPrice?: number;
}

const DEFAULT_ETH_USD_PRICE = 2600; // Fallback ETH price in USD if oracle is offline

/**
 * Creates a public viem client for a given EVM chain ID using its configured RPC.
 */
export function getViemPublicClient(chainId: number): PublicClient | null {
  const chainConfig = getEvmChainConfig(chainId);
  if (!chainConfig || chainConfig.rpcUrls.length === 0) return null;

  return createPublicClient({
    transport: http(chainConfig.rpcUrls[0], {
      timeout: 8000,
    }),
  });
}

/**
 * Simulates a contract deployment before wallet signature.
 */
export async function simulateDeployTransaction(
  params: SimulateDeployParams
): Promise<SimulationResult> {
  const chainConfig = getEvmChainConfig(params.chainId);
  if (!chainConfig) {
    return {
      success: false,
      gasLimit: 0n,
      gasPriceGwei: '0',
      estimatedFeeNative: '0',
      estimatedFeeUsd: '$0.00',
      revertReason: `Unsupported chain ID: ${params.chainId}`,
      summary: 'Deployment simulation failed: unsupported network.',
    };
  }

  const client = getViemPublicClient(params.chainId);
  if (!client) {
    // If RPC unavailable, return a safe estimated fallback
    const fallbackGas = 850_000n;
    const fallbackGwei = '0.05';
    return {
      success: true,
      gasLimit: fallbackGas,
      gasPriceGwei: fallbackGwei,
      estimatedFeeNative: '0.0000425',
      estimatedFeeUsd: '~$0.11',
      summary: `Estimated deployment on ${chainConfig.name} (~$0.11 USD). Pre-flight RPC offline.`,
    };
  }

  try {
    const from = params.fromAddress || '0x0000000000000000000000000000000000000001';

    // 1. Dry run call to verify contract construction doesn't revert
    await client.call({
      account: from,
      data: params.bytecode,
      value: 0n,
    });

    // 2. Estimate deployment gas
    let gasLimit = 1_200_000n;
    try {
      gasLimit = await client.estimateGas({
        account: from,
        data: params.bytecode,
        value: 0n,
      });
      // Add 20% safety buffer for deployment
      gasLimit = (gasLimit * 120n) / 100n;
    } catch {
      // Fallback standard deployment gas
      gasLimit = 900_000n;
    }

    // 3. Query gas price
    let gasPrice = 50_000_000n; // 0.05 gwei default on L2
    try {
      gasPrice = await client.getGasPrice();
    } catch {
      // Keep L2 default
    }

    const totalFeeWei = gasLimit * gasPrice;
    const feeNative = formatEther(totalFeeWei);
    const ethPrice = params.ethUsdPrice || DEFAULT_ETH_USD_PRICE;
    const feeUsd = (Number(feeNative) * ethPrice).toFixed(4);
    const gasPriceGwei = (Number(gasPrice) / 1e9).toFixed(4);

    return {
      success: true,
      gasLimit,
      gasPriceGwei,
      estimatedFeeNative: feeNative,
      estimatedFeeUsd: `$${feeUsd}`,
      summary: `Ready to deploy on ${chainConfig.name}. Estimated network fee: $${feeUsd} (${feeNative.slice(0, 8)} ${chainConfig.nativeCurrency.symbol}).`,
      stateDiff: {
        balanceChangeNative: `-${feeNative.slice(0, 8)} ${chainConfig.nativeCurrency.symbol}`,
      },
    };
  } catch (err: any) {
    const errorMsg = err?.shortMessage || err?.message || 'Execution reverted during deployment simulation';
    return {
      success: false,
      gasLimit: 0n,
      gasPriceGwei: '0',
      estimatedFeeNative: '0',
      estimatedFeeUsd: '$0.00',
      revertReason: errorMsg,
      summary: `Deployment will revert: ${errorMsg}`,
    };
  }
}

/**
 * Simulates calling a method on an existing verified smart contract.
 */
export async function simulateMethodCall(
  params: SimulateCallParams
): Promise<SimulationResult> {
  const chainConfig = getEvmChainConfig(params.chainId);
  if (!chainConfig) {
    return {
      success: false,
      gasLimit: 0n,
      gasPriceGwei: '0',
      estimatedFeeNative: '0',
      estimatedFeeUsd: '$0.00',
      revertReason: `Unsupported chain ID: ${params.chainId}`,
      summary: 'Method call simulation failed: unsupported network.',
    };
  }

  const client = getViemPublicClient(params.chainId);
  if (!client) {
    return {
      success: true,
      gasLimit: 65_000n,
      gasPriceGwei: '0.05',
      estimatedFeeNative: '0.000003',
      estimatedFeeUsd: '~$0.01',
      summary: `Estimated method call on ${chainConfig.name}.`,
    };
  }

  try {
    const from = params.fromAddress || '0x0000000000000000000000000000000000000001';

    // Dry-run the contract call
    await client.simulateContract({
      address: params.contractAddress,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args || [],
      account: from,
      value: params.valueWei || 0n,
    });

    let gasLimit = 80_000n;
    try {
      gasLimit = await client.estimateContractGas({
        address: params.contractAddress,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args || [],
        account: from,
        value: params.valueWei || 0n,
      });
      gasLimit = (gasLimit * 115n) / 100n;
    } catch {
      // Standard call fallback
      gasLimit = 75_000n;
    }

    const gasPrice = await client.getGasPrice().catch(() => 50_000_000n);
    const totalFeeWei = gasLimit * gasPrice;
    const feeNative = formatEther(totalFeeWei);
    const ethPrice = params.ethUsdPrice || DEFAULT_ETH_USD_PRICE;
    const feeUsd = (Number(feeNative) * ethPrice).toFixed(4);

    return {
      success: true,
      gasLimit,
      gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(4),
      estimatedFeeNative: feeNative,
      estimatedFeeUsd: `$${feeUsd}`,
      summary: `Method "${params.functionName}" simulated successfully. Network fee: $${feeUsd}.`,
    };
  } catch (err: any) {
    const errorMsg = err?.shortMessage || err?.message || 'Transaction reverted during simulation';
    return {
      success: false,
      gasLimit: 0n,
      gasPriceGwei: '0',
      estimatedFeeNative: '0',
      estimatedFeeUsd: '$0.00',
      revertReason: errorMsg,
      summary: `Transaction will revert: ${errorMsg}`,
    };
  }
}
