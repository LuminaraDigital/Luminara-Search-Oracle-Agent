/**
 * XDC JSON-RPC probe (Phase 0 stub). No writes; used for health + fail-closed gating.
 */
import type { Env } from '../env';
import { isProofFlagEnabled, resolveChainNetwork, type ChainNetwork } from '../chainNetwork';

/** Verified live 2026-10-01: Apothem 0x33 (51), mainnet 0x32 (50). */
export const XDC_CHAIN_ID: Record<ChainNetwork, number> = {
  testnet: 51,
  mainnet: 50,
};

export type XdcProbeResult =
  | { ok: true; chainId: number; network: ChainNetwork }
  | { ok: false; reason: string };

export function resolveXdcRpcUrl(env: Pick<Env, 'CHAIN_XDC_RPC_URL'>): string | null {
  const url = String(env.CHAIN_XDC_RPC_URL || '').trim();
  return url || null;
}

export async function probeXdcRpc(
  env: Pick<Env, 'CHAIN_NETWORK' | 'CHAIN_XDC_RPC_URL' | 'PROOF_XDC_ENABLED'>,
  fetcher: typeof fetch = fetch,
): Promise<XdcProbeResult> {
  const network = resolveChainNetwork(env);
  if (!network) return { ok: false, reason: 'CHAIN_NETWORK unset or invalid' };

  const rpcUrl = resolveXdcRpcUrl(env);
  if (!rpcUrl) {
    if (isProofFlagEnabled(env, 'PROOF_XDC_ENABLED')) {
      return { ok: false, reason: 'PROOF_XDC_ENABLED but CHAIN_XDC_RPC_URL is unset' };
    }
    return { ok: false, reason: 'CHAIN_XDC_RPC_URL unset' };
  }

  try {
    const res = await fetcher(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    if (!res.ok) return { ok: false, reason: `XDC RPC HTTP ${res.status}` };
    const data = (await res.json()) as { result?: string; error?: { message?: string } };
    if (data.error?.message) return { ok: false, reason: data.error.message };
    const hex = String(data.result || '').trim().toLowerCase();
    const chainId = Number.parseInt(hex, 16);
    if (!Number.isFinite(chainId)) return { ok: false, reason: 'invalid eth_chainId result' };
    const expected = XDC_CHAIN_ID[network];
    if (chainId !== expected) {
      return { ok: false, reason: `XDC chainId ${chainId} does not match CHAIN_NETWORK=${network} (expected ${expected})` };
    }
    return { ok: true, chainId, network };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'XDC RPC probe failed' };
  }
}
