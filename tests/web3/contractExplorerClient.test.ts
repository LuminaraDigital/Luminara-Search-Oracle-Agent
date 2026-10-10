import { describe, it, expect } from 'vitest';
import {
  analyzeContractSafety,
  type VerifiedContractData,
} from '../../services/web3/contractExplorerClient';

describe('Contract Explorer Semantic Safety Analyzer', () => {
  it('gives clean fixed supply contract a 100/100 Safe score', () => {
    const cleanContract: VerifiedContractData = {
      address: '0x140c07055b0b85efe91b80e765bcc24b3dd647d9',
      chainId: 8453,
      contractName: 'CleanFixedToken',
      compilerVersion: 'v0.8.20+commit.a1b79de6',
      sourceCode: 'contract CleanFixedToken { function transfer() public {} }',
      abi: [
        { type: 'function', name: 'transfer', inputs: [] },
        { type: 'function', name: 'balanceOf', inputs: [] },
      ],
      verified: true,
    };

    const audit = analyzeContractSafety(cleanContract);
    expect(audit.score).toBe(100);
    expect(audit.verdict).toBe('Safe');
    expect(audit.findings.map((f) => f.name)).toContain('Fixed Supply');
    expect(audit.findings.map((f) => f.name)).toContain('No Blacklist');
    expect(audit.findings.map((f) => f.name)).toContain('Zero Transfer Tax');
  });

  it('penalizes owner minting capabilities', () => {
    const mintableContract: VerifiedContractData = {
      address: '0x1234567890123456789012345678901234567890',
      chainId: 8453,
      contractName: 'MintableToken',
      compilerVersion: 'v0.8.20',
      sourceCode: 'contract MintableToken { function mint(address to, uint256 amount) public onlyOwner {} }',
      abi: [{ type: 'function', name: 'mint', inputs: [] }],
      verified: true,
    };

    const audit = analyzeContractSafety(mintableContract);
    expect(audit.score).toBeLessThan(100);
    const mintFinding = audit.findings.find((f) => f.name === 'Owner Minting');
    expect(mintFinding).toBeDefined();
    expect(mintFinding?.status).toBe('Warning');
  });

  it('flags blacklist capabilities as High Risk', () => {
    const honeypotContract: VerifiedContractData = {
      address: '0x9999999999999999999999999999999999999999',
      chainId: 1,
      contractName: 'ShadyToken',
      compilerVersion: 'v0.8.20',
      sourceCode: 'contract ShadyToken { mapping(address => bool) private _isblacklisted; function blacklistWallet(address target) public {} }',
      abi: [
        { type: 'function', name: 'blacklistWallet', inputs: [] },
        { type: 'function', name: 'pause', inputs: [] },
      ],
      verified: true,
    };

    const audit = analyzeContractSafety(honeypotContract);
    expect(audit.score).toBeLessThanOrEqual(60);
    const blacklistFinding = audit.findings.find((f) => f.name === 'Blacklist Function');
    expect(blacklistFinding).toBeDefined();
    expect(blacklistFinding?.status).toBe('Dangerous');
  });

  it('identifies upgradeable proxies', () => {
    const proxyContract: VerifiedContractData = {
      address: '0x8888888888888888888888888888888888888888',
      chainId: 8453,
      contractName: 'ERC1967Proxy',
      compilerVersion: 'v0.8.20',
      sourceCode: 'contract ERC1967Proxy {}',
      abi: [],
      verified: true,
      isProxy: true,
      implementationAddress: '0x7777777777777777777777777777777777777777',
    };

    const audit = analyzeContractSafety(proxyContract);
    const proxyFinding = audit.findings.find((f) => f.name === 'Upgradeable Proxy');
    expect(proxyFinding).toBeDefined();
    expect(proxyFinding?.detail).toContain('0x7777777777777777777777777777777777777777');
  });
});
