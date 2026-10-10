import { describe, it, expect } from 'vitest';
import {
  simulateDeployTransaction,
  simulateMethodCall,
} from '../../services/web3/simulationEngine';

describe('Web3 Simulation Engine', () => {
  it('returns graceful error on unsupported chain ID', async () => {
    const res = await simulateDeployTransaction({
      chainId: 12345678,
      bytecode: '0x1234',
      abi: [],
    });
    expect(res.success).toBe(false);
    expect(res.revertReason).toContain('Unsupported chain ID');
  });

  it('calculates USD equivalent using simulated or fallback pricing', async () => {
    // Calling with Sepolia or Base (if live network unreachable in tests, viem returns graceful fallback)
    const res = await simulateDeployTransaction({
      chainId: 8453,
      bytecode: '0x608060405234801561001057600080fd5b50',
      abi: [],
      ethUsdPrice: 3000,
    });
    expect(typeof res.estimatedFeeUsd).toBe('string');
    expect(res.estimatedFeeUsd).toContain('$');
    expect(res.gasLimit).toBeGreaterThan(0n);
  });

  it('handles method call simulation parameters safely', async () => {
    const res = await simulateMethodCall({
      chainId: 8453,
      contractAddress: '0x140C07055B0B85efe91b80e765BCc24b3dd647d9',
      abi: [{ type: 'function', name: 'totalSupply', inputs: [], outputs: [] }],
      functionName: 'totalSupply',
    });
    expect(typeof res.summary).toBe('string');
    expect(typeof res.estimatedFeeUsd).toBe('string');
  });
});
