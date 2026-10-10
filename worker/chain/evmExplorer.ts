/**
 * EVM Explorer Service (Cloudflare Worker Edge)
 * Fetches verified smart contract source code, ABI, and compiler metadata from EVM block explorers.
 * Caches in LUMINARA_KV (24h TTL) to avoid hitting explorer rate limits.
 */

import type { Env } from '../env';
import { getEvmChainConfig } from '../../services/chain/evmChainRegistry';

export interface VerifiedContractResult {
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

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Normalizes source code returned by Etherscan-compatible APIs.
 * Handles both plain single-file strings and JSON Multi-file inputs ({{ "sources": ... }} or { "sources": ... }).
 */
export function normalizeContractSource(rawSource: string): { mainSource: string; isMultiPart: boolean } {
  if (!rawSource) return { mainSource: '', isMultiPart: false };

  let trimmed = rawSource.trim();

  // Etherscan wraps JSON multi-part files in double braces {{ ... }}
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      const sources = parsed.sources || parsed;
      const fileNames = Object.keys(sources);
      if (fileNames.length > 0) {
        // Collect code from all files or the primary entry point
        const parts: string[] = [];
        for (const [filePath, fileData] of Object.entries<any>(sources)) {
          const content = typeof fileData === 'string' ? fileData : fileData?.content || '';
          parts.push(`// File: ${filePath}\n${content}`);
        }
        return { mainSource: parts.join('\n\n'), isMultiPart: true };
      }
    } catch {
      // If parsing fails, fall back to raw string
    }
  }

  return { mainSource: trimmed, isMultiPart: false };
}

/**
 * Fetches verified contract data from the appropriate block explorer API.
 */
export async function fetchVerifiedContract(
  chainId: number,
  address: string,
  env: Env
): Promise<{ ok: true; data: VerifiedContractResult } | { ok: false; status: number; error: string }> {
  if (!EVM_ADDRESS_REGEX.test(address)) {
    return { ok: false, status: 400, error: 'Invalid EVM address format' };
  }

  const chain = getEvmChainConfig(chainId);
  if (!chain) {
    return { ok: false, status: 400, error: `Unsupported chain ID: ${chainId}` };
  }

  const normalizedAddress = address.toLowerCase();
  const cacheKey = `evm:contract:${chainId}:${normalizedAddress}`;

  // 1. Check Cloudflare KV cache
  if (env.LUMINARA_KV) {
    try {
      const cached = await env.LUMINARA_KV.get(cacheKey, 'json');
      if (cached && typeof cached === 'object') {
        return {
          ok: true,
          data: { ...(cached as VerifiedContractResult), cached: true },
        };
      }
    } catch (kvErr) {
      console.warn('[EVM Explorer] KV cache read failed, falling back to network:', kvErr);
    }
  }

  // 2. Fetch from block explorer API
  const apiUrl = chain.blockExplorers.apiUrl;
  if (!apiUrl) {
    return { ok: false, status: 501, error: `No explorer API configured for chain ${chain.name}` };
  }

  try {
    const fetchUrl = new URL(apiUrl);
    fetchUrl.searchParams.set('module', 'contract');
    fetchUrl.searchParams.set('action', 'getsourcecode');
    fetchUrl.searchParams.set('address', address);

    const res = await fetch(fetchUrl.toString(), {
      headers: { 'User-Agent': 'Luminara-Suite/1.0' },
    });

    if (!res.ok) {
      return { ok: false, status: res.status, error: `Block explorer returned HTTP ${res.status}` };
    }

    const json = (await res.json()) as any;
    if (json.status !== '1' || !Array.isArray(json.result) || json.result.length === 0) {
      const msg = json.message || json.result || 'Contract not verified or not found';
      return { ok: false, status: 404, error: String(msg) };
    }

    const item = json.result[0];
    if (!item.SourceCode || item.ABI === 'Contract source code not verified') {
      return { ok: false, status: 404, error: 'Contract source code is not verified on block explorer' };
    }

    let parsedAbi: any[] = [];
    try {
      parsedAbi = JSON.parse(item.ABI);
    } catch {
      parsedAbi = [];
    }

    const { mainSource } = normalizeContractSource(item.SourceCode);

    const record: VerifiedContractResult = {
      address: normalizedAddress,
      chainId,
      contractName: item.ContractName || 'UnnamedContract',
      compilerVersion: item.CompilerVersion || 'unknown',
      sourceCode: mainSource,
      abi: parsedAbi,
      verified: true,
      cached: false,
      isProxy: item.Proxy === '1',
      implementationAddress: item.Implementation || undefined,
    };

    // 3. Write to Cloudflare KV cache (24h TTL)
    if (env.LUMINARA_KV) {
      try {
        await env.LUMINARA_KV.put(cacheKey, JSON.stringify(record), { expirationTtl: 86400 });
      } catch (kvPutErr) {
        console.warn('[EVM Explorer] KV cache write failed:', kvPutErr);
      }
    }

    return { ok: true, data: record };
  } catch (err: any) {
    return { ok: false, status: 502, error: `Upstream explorer error: ${err?.message || String(err)}` };
  }
}
