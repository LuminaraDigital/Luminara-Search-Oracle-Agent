/**
 * XDC JSON-RPC probe (Phase 0 stub). No chain writes; used for health + fail-closed gating.
 * The probe is bounded by a 3 s timeout; probeXdcRpcCached adds a 60 s KV cache for /api/health.
 */
import type { Env } from '../env';
import { isProofFlagEnabled, resolveChainNetwork, type ChainNetwork } from '../chainNetwork';

/** Verified live 2026-10-01: Apothem 0x33 (51), mainnet 0x32 (50). */
export const XDC_CHAIN_ID: Record<ChainNetwork, number> = {
  testnet: 51,
  mainnet: 50,
};

export const XDC_PROBE_TIMEOUT_MS = 3000;
/** Workers KV rejects an expirationTtl below 60 seconds. */
export const XDC_PROBE_CACHE_TTL_SEC = 60;

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

  // The signal aborts the request; the race also bounds a fetch or body read that ignores the signal.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<XdcProbeResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: `XDC RPC timed out after ${XDC_PROBE_TIMEOUT_MS} ms` });
    }, XDC_PROBE_TIMEOUT_MS);
  });

  const attempt = async (): Promise<XdcProbeResult> => {
    try {
      const res = await fetcher(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        signal: controller.signal,
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
  };

  try {
    return await Promise.race([attempt(), timedOut]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function isXdcProbeResult(value: unknown): value is XdcProbeResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.ok === true ? typeof v.chainId === 'number' : v.ok === false && typeof v.reason === 'string';
}

/**
 * probeXdcRpc behind a 60 s KV cache (`health:xdc:<network>`), for callers on a hot path such as
 * /api/health. Failures are cached too, so a dead RPC costs one timeout per minute, not per request.
 * Without KV, or when KV errors, it probes directly.
 */
export async function probeXdcRpcCached(
  env: Pick<Env, 'CHAIN_NETWORK' | 'CHAIN_XDC_RPC_URL' | 'PROOF_XDC_ENABLED' | 'LUMINARA_KV'>,
  fetcher: typeof fetch = fetch,
): Promise<XdcProbeResult> {
  const network = resolveChainNetwork(env);
  const kv = env.LUMINARA_KV;
  // Config errors are answered without a fetch, so there is nothing worth caching.
  if (!network || !resolveXdcRpcUrl(env) || !kv) return probeXdcRpc(env, fetcher);

  const key = `health:xdc:${network}`;
  try {
    const cached = await kv.get(key, 'json');
    if (isXdcProbeResult(cached)) return cached;
  } catch {
    /* cache read is best-effort */
  }

  const result = await probeXdcRpc(env, fetcher);
  try {
    await kv.put(key, JSON.stringify(result), { expirationTtl: XDC_PROBE_CACHE_TTL_SEC });
  } catch {
    /* cache write is best-effort */
  }
  return result;
}
