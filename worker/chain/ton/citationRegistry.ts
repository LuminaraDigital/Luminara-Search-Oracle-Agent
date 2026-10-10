/**
 * TON CitationRegistry client for Luminara Suite.
 *
 * Interacts with CitationRegistry.tolk on The Open Network (TON).
 * Supports constructing tamper-evident proof payloads, batch chunking,
 * and dispatching via Toncenter v3 / TonAPI.
 */

import type { Env } from '../../env';
import {
  type ChainNetwork,
  isProofFlagEnabled,
  resolveTonApiBases,
  tonExplorerTxUrl,
  normalizeTonTxHash,
} from '../../chainNetwork';
import { sha256Hex } from '../../workerUtils';

export const OP_INTERNAL_ANCHOR = 0x736e6368; // "snch"
export const OP_EXTERNAL_ANCHOR = 0x616e6368; // "anch"
export const OP_SET_PAUSED      = 0x70617573; // "paus"
export const OP_SET_MINTER      = 0x7365746d; // "setm"

export interface CitationPayload {
  domain: string;
  auditRunId: string;
  evidenceHash: string; // 64-char hex
  healthScore: number;
  citationRatePercent: number;
  findingsCount: number;
}

export interface OnChainCitationRecord {
  evidenceHash: string;
  healthScore: number;
  citationRate: number;
  findingsCount: number;
  anchoredAt: number;
  found: boolean;
}

export interface AnchorResult {
  ok: boolean;
  txHash?: string;
  network?: ChainNetwork;
  contract?: string;
  explorerUrl?: string;
  error?: string;
}

/**
 * Normalizes a domain to a 256-bit BigInt hash (SHA-256).
 */
export async function domainToBigInt(domain: string): Promise<bigint> {
  const hex = await sha256Hex(domain.toLowerCase().trim());
  return BigInt(`0x${hex}`);
}

/**
 * Normalizes an audit run ID to a 256-bit BigInt hash (SHA-256).
 */
export async function auditIdToBigInt(auditRunId: string): Promise<bigint> {
  const hex = await sha256Hex(auditRunId.trim());
  return BigInt(`0x${hex}`);
}

/**
 * Computes the 256-bit composite key (domainHash ^ auditIdHash).
 */
export function computeCompositeKey(domainBigInt: bigint, auditIdBigInt: bigint): bigint {
  return domainBigInt ^ auditIdBigInt;
}

/**
 * Resolves the configured CitationRegistry contract address.
 */
export function resolveCitationContract(env: Pick<Env, 'TON_CITATION_CONTRACT_ADDRESS' | 'CHAIN_NETWORK'>): string | null {
  const custom = String(env.TON_CITATION_CONTRACT_ADDRESS || '').trim();
  if (custom) return custom;
  // Network defaults (can be overridden by env)
  return null;
}

/**
 * Builds the binary payload slice for a citation record.
 * Layout:
 * [opcode: 32 bits]
 * [domainHash: 256 bits]
 * [auditIdHash: 256 bits]
 * [evidenceHash: 256 bits]
 * [healthScore: 8 bits]
 * [citationRate: 8 bits]
 * [findingsCount: 16 bits]
 */
export async function buildCitationPayloadHex(payload: CitationPayload): Promise<string> {
  const dHash = await sha256Hex(payload.domain.toLowerCase().trim());
  const aHash = await sha256Hex(payload.auditRunId.trim());
  const eHash = payload.evidenceHash.replace(/^0x/i, '').padStart(64, '0').slice(0, 64);

  const opHex = OP_INTERNAL_ANCHOR.toString(16).padStart(8, '0');
  const scoreHex = Math.max(0, Math.min(100, Math.round(payload.healthScore))).toString(16).padStart(2, '0');
  const rateHex = Math.max(0, Math.min(100, Math.round(payload.citationRatePercent))).toString(16).padStart(2, '0');
  const countHex = Math.max(0, Math.min(65535, Math.round(payload.findingsCount))).toString(16).padStart(4, '0');

  return `${opHex}${dHash}${aHash}${eHash}${scoreHex}${rateHex}${countHex}`;
}

/**
 * Broadcasts or records an audit citation anchor to the TON network.
 * Fails closed if PROOF_ANCHOR_ENABLED is false.
 */
export async function anchorAuditCitation(
  env: Env,
  payload: CitationPayload,
  fetcher: typeof fetch = fetch,
): Promise<AnchorResult> {
  if (!isProofFlagEnabled(env, 'PROOF_ANCHOR_ENABLED')) {
    return { ok: false, error: 'PROOF_ANCHOR_ENABLED is false; anchoring skipped' };
  }

  const bases = resolveTonApiBases(env);
  if (!bases) {
    return { ok: false, error: 'Invalid CHAIN_NETWORK or TON API configuration' };
  }

  const contractAddress = resolveCitationContract(env);
  const network = bases.network;

  // Fail closed honestly: never fabricate or simulate on-chain transactions.
  // The Worker holds no chain signing key, so there is no key to look for here.
  if (!contractAddress) {
    return {
      ok: false,
      error: 'TON citation contract not configured',
    };
  }

  try {
    const payloadHex = await buildCitationPayloadHex(payload);
    const apiKey = String(env.TON_API_KEY || '').trim();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (apiKey) headers['X-API-Key'] = apiKey;

    // Send via Toncenter v3 sendBoc / message endpoint
    const url = `${bases.toncenter}/message`;
    const res = await fetcher(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        boc: payloadHex,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Toncenter HTTP ${res.status}: ${errText.slice(0, 200)}` };
    }

    const data = (await res.json()) as { message_hash?: string; hash?: string };
    // Only a hash the chain API returned is reported. Without one nothing was anchored,
    // and a hash computed here would point at a transaction that does not exist.
    const txHash = String(data.message_hash || data.hash || '').trim();
    if (!txHash) {
      return { ok: false, error: 'Toncenter returned no message hash; nothing is recorded as anchored' };
    }
    const normalizedHash = normalizeTonTxHash(txHash);

    return {
      ok: true,
      txHash: normalizedHash,
      network,
      contract: contractAddress,
      explorerUrl: tonExplorerTxUrl(network, normalizedHash),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `TON broadcast failed: ${msg}` };
  }
}

/**
 * Queries the on-chain CitationRegistry contract for a recorded proof.
 */
export async function queryCitationOnChain(
  env: Env,
  domain: string,
  auditRunId: string,
  fetcher: typeof fetch = fetch,
): Promise<OnChainCitationRecord | null> {
  const bases = resolveTonApiBases(env);
  const contractAddress = resolveCitationContract(env);
  if (!bases || !contractAddress) return null;

  try {
    const dBigInt = await domainToBigInt(domain);
    const aBigInt = await auditIdToBigInt(auditRunId);

    const apiKey = String(env.TON_API_KEY || '').trim();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;

    const url = `${bases.toncenter}/runGetMethod`;
    const res = await fetcher(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: contractAddress,
        method: 'get_proof',
        stack: [
          ['num', dBigInt.toString()],
          ['num', aBigInt.toString()],
        ],
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; result?: { exit_code?: number; stack?: any[] } };
    if (!data.ok || data.result?.exit_code !== 0 || !data.result?.stack) return null;

    const stack = data.result.stack;
    const found = stack[5]?.[1] === '-1' || stack[5]?.[1] === '1' || stack[5]?.[1] === true;
    if (!found) return null;

    const evidenceHex = BigInt(stack[0][1]).toString(16).padStart(64, '0');
    return {
      evidenceHash: evidenceHex,
      healthScore: Number(stack[1][1]),
      citationRate: Number(stack[2][1]),
      findingsCount: Number(stack[3][1]),
      anchoredAt: Number(stack[4][1]),
      found: true,
    };
  } catch {
    return null;
  }
}
