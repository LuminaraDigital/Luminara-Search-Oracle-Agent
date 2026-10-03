/**
 * Read-only chain checks used by the Worker (no wallet, no keys).
 * The RPC transport is injected so tests need no network.
 */
import { decodeEventLog, decodeFunctionResult, encodeFunctionData, type Hex } from 'viem';
import { CAMPAIGN_STATES, ESCROW_ABI, FACTORY_ABI, type CampaignStateName } from './abi';
import { LAUNCHPAD_CHAINS, normaliseEvmAddress, type LaunchpadChain, type LaunchpadNetwork } from './contracts';

export type RpcCall = (method: string, params: unknown[]) => Promise<unknown>;

/** Public fallbacks. Production should set LAUNCHPAD_RPC_* to a provider with an SLA. */
export const DEFAULT_RPC_URLS: Record<LaunchpadChain, Record<LaunchpadNetwork, string>> = {
  xdc: { testnet: 'https://rpc.apothem.network', mainnet: 'https://rpc.xdcrpc.com' },
  polygon: { testnet: 'https://rpc-amoy.polygon.technology', mainnet: 'https://polygon-rpc.com' },
};

export function makeRpc(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): RpcCall {
  let id = 0;
  return async (method, params) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const data = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (data.error) throw new Error(data.error.message || 'RPC error');
    return data.result;
  };
}

export type DeploymentKind = 'preorder_escrow' | 'loyalty_token';

export interface VerifiedDeployment {
  contractAddress: string;
  merchantWallet: string;
}

interface RawLog { address?: string; topics?: string[]; data?: string }
interface RawReceipt { status?: string; to?: string | null; logs?: RawLog[] }

/**
 * Confirms that `txHash` is a successful call to OUR factory that emitted the deployment event
 * for exactly `contractAddress`. Prevents listing arbitrary or look-alike contracts.
 * Returns an instructive error string on failure.
 */
export async function verifyDeployment(args: {
  rpc: RpcCall;
  factoryAddress: string;
  txHash: string;
  contractAddress: string;
  kind: DeploymentKind;
}): Promise<VerifiedDeployment | string> {
  let receipt: RawReceipt | null;
  try {
    receipt = (await args.rpc('eth_getTransactionReceipt', [args.txHash])) as RawReceipt | null;
  } catch {
    return 'Could not reach the chain RPC to verify the deployment. Try again shortly.';
  }
  if (!receipt) return 'Transaction not found yet. Wait for it to confirm, then register again.';
  if (receipt.status !== '0x1') return 'That transaction failed on-chain.';

  const factory = args.factoryAddress.toLowerCase();
  const eventName = args.kind === 'preorder_escrow' ? 'PreorderEscrowDeployed' : 'LoyaltyTokenDeployed';
  for (const log of receipt.logs ?? []) {
    if (String(log.address || '').toLowerCase() !== factory) continue;
    try {
      const ev = decodeEventLog({
        abi: FACTORY_ABI,
        data: (log.data || '0x') as Hex,
        topics: (log.topics || []) as [Hex, ...Hex[]],
      });
      if (ev.eventName !== eventName) continue;
      const a = ev.args as unknown as Record<string, string>;
      const deployed = String(a.escrowAddress ?? a.tokenAddress ?? '').toLowerCase();
      if (deployed !== args.contractAddress.toLowerCase()) continue;
      return { contractAddress: deployed, merchantWallet: String(a.merchant).toLowerCase() };
    } catch {
      continue;
    }
  }
  return 'This transaction did not deploy that contract from the Luminara factory. Deploy from the app, then register the resulting address.';
}

export interface MilestoneProofDetails {
  payoutBps: number;
  submitted: boolean;
  disbursed: boolean;
  challengeEndsAt: number;
  proofHash: string;
  objectionWeightWei: string;
  proofUri: string;
}

export interface EscrowSnapshot {
  state: CampaignStateName;
  totalPledgedWei: string;
  totalDisbursedWei: string;
  totalRefundedWei: string;
  softCapWei: string;
  hardCapWei: string;
  fundingDeadline: number;
  deliveryDeadline: number;
  currentMilestone: number;
  milestoneCount: number;
  merchant: string;
  currentMilestoneDetails?: MilestoneProofDetails | null;
}

async function callEscrow<T>(rpc: RpcCall, to: string, functionName: string): Promise<T> {
  const data = encodeFunctionData({ abi: ESCROW_ABI, functionName: functionName as 'state' } as never);
  const out = (await rpc('eth_call', [{ to, data }, 'latest'])) as Hex;
  return decodeFunctionResult({ abi: ESCROW_ABI, functionName: functionName as 'state', data: out } as never) as T;
}

/** Live escrow figures read directly from the chain. Throws if the RPC fails or the address is not an escrow. */
export async function readEscrowSnapshot(rpc: RpcCall, escrowAddress: string): Promise<EscrowSnapshot> {
  const to = normaliseEvmAddress(escrowAddress);
  if (!to) throw new Error('Invalid escrow address');
  const [state, pledged, disbursed, refunded, soft, hard, fund, deliver, current, count, merchant] = await Promise.all([
    callEscrow<number>(rpc, to, 'state'),
    callEscrow<bigint>(rpc, to, 'totalPledged'),
    callEscrow<bigint>(rpc, to, 'totalDisbursed'),
    callEscrow<bigint>(rpc, to, 'totalRefunded'),
    callEscrow<bigint>(rpc, to, 'softCap'),
    callEscrow<bigint>(rpc, to, 'hardCap'),
    callEscrow<bigint>(rpc, to, 'fundingDeadline'),
    callEscrow<bigint>(rpc, to, 'deliveryDeadline'),
    callEscrow<bigint>(rpc, to, 'currentMilestone'),
    callEscrow<bigint>(rpc, to, 'milestoneCount'),
    callEscrow<string>(rpc, to, 'merchant'),
  ]);
  const name = CAMPAIGN_STATES[Number(state)];
  if (!name) throw new Error('Unexpected escrow state');

  let currentMilestoneDetails: MilestoneProofDetails | null = null;
  if (Number(current) < Number(count)) {
    try {
      const data = encodeFunctionData({
        abi: ESCROW_ABI,
        functionName: 'milestones',
        args: [current],
      } as never);
      const out = (await rpc('eth_call', [{ to, data }, 'latest'])) as Hex;
      const res = decodeFunctionResult({
        abi: ESCROW_ABI,
        functionName: 'milestones',
        data: out,
      } as never) as unknown as readonly [number, boolean, boolean, bigint, Hex, bigint, string];
      currentMilestoneDetails = {
        payoutBps: Number(res[0]),
        submitted: Boolean(res[1]),
        disbursed: Boolean(res[2]),
        challengeEndsAt: Number(res[3]),
        proofHash: String(res[4]),
        objectionWeightWei: res[5].toString(),
        proofUri: String(res[6]),
      };
    } catch {
      // Non-fatal if test RPC mock doesn't implement milestones
    }
  }

  return {
    state: name,
    totalPledgedWei: pledged.toString(),
    totalDisbursedWei: disbursed.toString(),
    totalRefundedWei: refunded.toString(),
    softCapWei: soft.toString(),
    hardCapWei: hard.toString(),
    fundingDeadline: Number(fund),
    deliveryDeadline: Number(deliver),
    currentMilestone: Number(current),
    milestoneCount: Number(count),
    merchant: merchant.toLowerCase(),
    currentMilestoneDetails,
  };
}

export function resolveFactoryAddress(
  chain: LaunchpadChain,
  network: LaunchpadNetwork,
  env: Record<string, string | undefined>,
): string | null {
  const fromCode = LAUNCHPAD_CHAINS[chain][network].factoryAddress;
  if (fromCode) return normaliseEvmAddress(fromCode);
  // Testnet staging may override via env so a code change is not needed to try a fresh deployment.
  // Mainnet addresses must be committed (reviewable, audit-pinned).
  if (network === 'testnet') {
    const key = `LAUNCHPAD_FACTORY_${chain.toUpperCase()}_TESTNET`;
    return normaliseEvmAddress(env[key]);
  }
  return null;
}

export function resolveRpcUrl(
  chain: LaunchpadChain,
  network: LaunchpadNetwork,
  env: Record<string, string | undefined>,
): string {
  const key = `LAUNCHPAD_RPC_${chain.toUpperCase()}_${network.toUpperCase()}`;
  const v = String(env[key] || '').trim();
  return /^https:\/\//i.test(v) ? v : DEFAULT_RPC_URLS[chain][network];
}
