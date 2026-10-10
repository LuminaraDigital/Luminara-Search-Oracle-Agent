/**
 * Client-Side Contract Explorer Consumer & Semantic Risk Analyzer
 * Fetches verified contract data from the Luminara edge worker (/api/chain/contract)
 * and performs semantic capability/risk extraction for conversational explanations.
 */

import { getEvmChainConfig } from '../chain/evmChainRegistry';

export interface VerifiedContractData {
  address: string;
  chainId: number;
  contractName: string;
  compilerVersion: string;
  sourceCode: string;
  abi: any[];
  verified: boolean;
  cached?: boolean;
  isProxy?: boolean;
  implementationAddress?: string;
}

export interface ContractSecurityVerdict {
  score: number; // 0-100, higher is safer
  verdict: 'Safe' | 'Moderate Risk' | 'High Risk' | 'Unknown';
  summary: string;
  findings: Array<{
    name: string;
    status: 'Safe' | 'Warning' | 'Dangerous' | 'Info';
    detail: string;
  }>;
}

/**
 * Fetches verified contract information from Luminara Edge API.
 */
export async function fetchVerifiedContractClient(
  chainId: number,
  address: string
): Promise<{ ok: true; data: VerifiedContractData } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/chain/contract?chainId=${chainId}&address=${encodeURIComponent(address)}`);
    const json = await res.json() as any;

    if (!res.ok || !json.ok) {
      return { ok: false, error: json.error || `HTTP ${res.status}: Failed to fetch contract` };
    }

    return { ok: true, data: json.data };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error fetching contract' };
  }
}

/**
 * Analyzes verified ABI and source code for common risks non-technical users need to know about.
 */
export function analyzeContractSafety(contract: VerifiedContractData): ContractSecurityVerdict {
  const findings: ContractSecurityVerdict['findings'] = [];
  let penalty = 0;

  const abi = Array.isArray(contract.abi) ? contract.abi : [];
  const source = (contract.sourceCode || '').toLowerCase();

  // 1. Check for minting capabilities
  const mintFuncs = abi.filter(
    (item: any) => item.type === 'function' && /mint/i.test(item.name || '')
  );
  if (mintFuncs.length > 0) {
    // Check if it's restricted or owner-only
    const hasOwnerMint = source.includes('onlyowner') && /function.*mint/i.test(source);
    if (hasOwnerMint) {
      findings.push({
        name: 'Owner Minting',
        status: 'Warning',
        detail: 'Owner can mint additional tokens post-deployment.',
      });
      penalty += 15;
    } else {
      findings.push({
        name: 'Public Minting',
        status: 'Info',
        detail: 'Contract contains mint functions accessible to callers.',
      });
    }
  } else {
    findings.push({
      name: 'Fixed Supply',
      status: 'Safe',
      detail: 'No mint functions found. Supply cannot be expanded.',
    });
  }

  // 2. Check for blacklist / freeze functions
  const blacklistFuncs = abi.filter(
    (item: any) => item.type === 'function' && /blacklist|freeze|block/i.test(item.name || '')
  );
  if (blacklistFuncs.length > 0 || source.includes('mapping(address => bool) private _isblacklisted')) {
    findings.push({
      name: 'Blacklist Function',
      status: 'Dangerous',
      detail: 'Owner can blacklist specific wallet addresses from trading.',
    });
    penalty += 35;
  } else {
    findings.push({
      name: 'No Blacklist',
      status: 'Safe',
      detail: 'No wallet blacklisting or address freezing mechanisms detected.',
    });
  }

  // 3. Check for transfer fees / taxes
  if (source.includes('tax') || source.includes('fee') || source.includes('feerecipient')) {
    if (source.includes('10000') || source.includes('basispoints')) {
      findings.push({
        name: 'Transfer Fee',
        status: 'Info',
        detail: 'Contract implements transfer fee routing to a designated recipient.',
      });
      penalty += 5;
    }
  } else {
    findings.push({
      name: 'Zero Transfer Tax',
      status: 'Safe',
      detail: 'Standard transfer logic with no automatic percentage deduction.',
    });
  }

  // 4. Check for pause mechanism
  const pauseFuncs = abi.filter(
    (item: any) => item.type === 'function' && /pause/i.test(item.name || '')
  );
  if (pauseFuncs.length > 0 || source.includes('whennotpaused')) {
    findings.push({
      name: 'Pausable Trading',
      status: 'Warning',
      detail: 'Owner can pause transfers and operations at will.',
    });
    penalty += 10;
  } else {
    findings.push({
      name: 'Unstoppable Execution',
      status: 'Safe',
      detail: 'Transfers cannot be globally paused or stopped.',
    });
  }

  // 5. Proxy check
  if (contract.isProxy) {
    findings.push({
      name: 'Upgradeable Proxy',
      status: 'Warning',
      detail: `Contract logic is upgradeable behind implementation ${contract.implementationAddress || 'unknown'}.`,
    });
    penalty += 15;
  }

  const score = Math.max(10, 100 - penalty);
  let verdict: ContractSecurityVerdict['verdict'] = 'Safe';
  if (score < 50) verdict = 'High Risk';
  else if (score < 80) verdict = 'Moderate Risk';

  const chainConfig = getEvmChainConfig(contract.chainId);
  const chainName = chainConfig ? chainConfig.name : `Chain ${contract.chainId}`;

  return {
    score,
    verdict,
    summary: `${contract.contractName} on ${chainName} scored ${score}/100 (${verdict}).`,
    findings,
  };
}
