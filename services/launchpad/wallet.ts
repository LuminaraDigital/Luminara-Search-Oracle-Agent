/**
 * Browser wallet flows (EIP-1193 + viem). Non-custodial: every transaction is signed in the
 * user's own wallet; the app never sees keys. Loaded lazily from the Launchpad UI.
 */
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  defineChain,
  http,
  parseEther,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { ESCROW_ABI, FACTORY_ABI, TOKEN_ABI } from './abi';
import {
  LAUNCHPAD_CHAINS,
  normaliseEvmAddress,
  type LaunchpadChain,
  type LaunchpadNetwork,
} from './contracts';
import { DEFAULT_RPC_URLS } from './chainVerify';

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function provider(): Eip1193 {
  const eth = (globalThis as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error('No wallet found. Install MetaMask, XDCPay or another EVM wallet, then reload.');
  return eth;
}

export function chainFor(chain: LaunchpadChain, network: LaunchpadNetwork): Chain {
  const c = LAUNCHPAD_CHAINS[chain][network];
  return defineChain({
    id: c.chainId,
    name: c.chainName,
    nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [DEFAULT_RPC_URLS[chain][network]] } },
    blockExplorers: { default: { name: 'Explorer', url: c.explorerBase } },
  });
}

/** Percent shares (e.g. [30, 70]) to basis points that sum to exactly 10000. */
export function percentagesToBps(percentages: number[]): number[] {
  if (percentages.length === 0 || percentages.length > 10) throw new Error('Use 1 to 10 milestones.');
  const bps = percentages.map((p) => Math.round(p * 100));
  if (bps.some((b) => !Number.isFinite(b) || b <= 0)) throw new Error('Each milestone needs a positive share.');
  const sum = bps.reduce((a, b) => a + b, 0);
  if (sum !== 10000) throw new Error('Milestone shares must add up to exactly 100%.');
  return bps;
}

/** Whole days to seconds, bounded to what the contract accepts. */
export function daysToSeconds(days: number, min: number, max: number, label: string): bigint {
  if (!Number.isInteger(days) || days < min || days > max) throw new Error(`${label} must be a whole number from ${min} to ${max} days.`);
  return BigInt(days) * 86400n;
}

export function parseNativeAmount(value: string, label: string): bigint {
  const v = value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(v)) throw new Error(`${label} must be a positive number.`);
  const wei = parseEther(v);
  if (wei <= 0n) throw new Error(`${label} must be greater than zero.`);
  return wei;
}

const REVERT_HELP: Record<string, string> = {
  IncorrectFee: 'The deployment fee changed. Refresh and try again.',
  InvalidDuration: 'Funding or delivery dates are invalid. Delivery must be after funding closes.',
  InvalidChallengeWindow: 'Challenge window must be 1 to 30 days.',
  InvalidMilestones: 'Milestones are invalid (1 to 10, shares must total 100%).',
  FundingClosed: 'Funding has closed for this campaign.',
  FundingStillOpen: 'Funding is still open.',
  HardCapExceeded: 'That pledge would exceed the campaign hard cap.',
  ZeroAmount: 'Amount must be greater than zero.',
  NotBacker: 'Only backers who pledged can do this.',
  AlreadyObjected: 'You already objected to this milestone.',
  AlreadyRefunded: 'You already claimed your refund.',
  NothingToRefund: 'There is nothing to refund.',
  NothingToWithdraw: 'There is nothing to withdraw.',
  ChallengeWindowOpen: 'The challenge window is still open. Backers can object until it closes.',
  ChallengeWindowClosed: 'The challenge window has closed.',
  MilestoneNotSubmitted: 'The merchant has not submitted proof for this milestone.',
  MilestoneAlreadySubmitted: 'Proof was already submitted for this milestone.',
  DeliveryDeadlineNotReached: 'The delivery deadline has not passed yet.',
  DeliveryDeadlinePassed: 'The delivery deadline has passed.',
  InvalidState: 'The campaign is not in a state that allows this action.',
  Unauthorized: 'This wallet is not allowed to do that.',
};

/** Turns wallet / viem / contract errors into a short instruction. */
export function describeWalletError(err: unknown): string {
  const e = err as { code?: number; shortMessage?: string; message?: string; cause?: unknown; name?: string };
  if (e?.code === 4001 || /user rejected|denied transaction/i.test(String(e?.message || ''))) return 'You cancelled the request in your wallet.';
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur; i++) {
    const c = cur as { data?: { errorName?: string }; cause?: unknown };
    const name = c.data?.errorName;
    if (name && REVERT_HELP[name]) return REVERT_HELP[name];
    cur = c.cause;
  }
  const msg = e?.shortMessage || e?.message || 'Wallet request failed.';
  if (/insufficient funds/i.test(msg)) return 'Not enough balance for this amount plus network fees.';
  return msg.split('\n')[0].slice(0, 200);
}

export interface WalletSession {
  address: Address;
}

export async function connectWallet(): Promise<WalletSession> {
  const accounts = (await provider().request({ method: 'eth_requestAccounts' })) as string[];
  const address = normaliseEvmAddress(accounts?.[0]);
  if (!address) throw new Error('Wallet returned no account.');
  return { address: address as Address };
}

/** Asks the wallet to switch (or add) the target chain. */
export async function ensureChain(chain: LaunchpadChain, network: LaunchpadNetwork): Promise<void> {
  const c = LAUNCHPAD_CHAINS[chain][network];
  const hexId = `0x${c.chainId.toString(16)}`;
  const eth = provider();
  const current = (await eth.request({ method: 'eth_chainId' })) as string;
  if (current?.toLowerCase() === hexId) return;
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (err) {
    if ((err as { code?: number })?.code !== 4902) throw err;
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: hexId,
        chainName: c.chainName,
        nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 },
        rpcUrls: [DEFAULT_RPC_URLS[chain][network]],
        blockExplorerUrls: [c.explorerBase],
      }],
    });
  }
}

function clients(chain: LaunchpadChain, network: LaunchpadNetwork) {
  const viemChain = chainFor(chain, network);
  return {
    wallet: createWalletClient({ chain: viemChain, transport: custom(provider()) }),
    pub: createPublicClient({ chain: viemChain, transport: http(DEFAULT_RPC_URLS[chain][network]) }),
    viemChain,
  };
}

function requireFactory(chain: LaunchpadChain, network: LaunchpadNetwork, override?: string | null): Address {
  const addr = normaliseEvmAddress(override ?? LAUNCHPAD_CHAINS[chain][network].factoryAddress);
  if (!addr) throw new Error('The Luminara factory is not deployed on this network yet.');
  return addr as Address;
}

export interface DeployResult {
  txHash: Hex;
  contractAddress: Address;
}

export interface DeployEscrowInput {
  chain: LaunchpadChain;
  network: LaunchpadNetwork;
  factoryAddress?: string | null;
  softCapNative: string;
  hardCapNative: string;
  fundingDays: number;
  deliveryDays: number;
  challengeDays: number;
  milestonePercentages: number[];
}

/** Validates inputs, reads the factory fee, deploys the escrow from the user's wallet. */
export async function deployEscrow(input: DeployEscrowInput): Promise<DeployResult> {
  const softCap = parseNativeAmount(input.softCapNative, 'Minimum goal');
  const hardCap = parseNativeAmount(input.hardCapNative, 'Maximum goal');
  if (hardCap < softCap) throw new Error('Maximum goal must be at least the minimum goal.');
  const fundingSeconds = daysToSeconds(input.fundingDays, 1, 90, 'Funding period');
  const deliveryDays = input.deliveryDays;
  if (!Number.isInteger(deliveryDays) || deliveryDays <= input.fundingDays || deliveryDays > 730) {
    throw new Error('Delivery deadline must be a whole number of days after funding closes (max 730).');
  }
  const challenge = daysToSeconds(input.challengeDays, 1, 30, 'Challenge window');
  const bps = percentagesToBps(input.milestonePercentages);

  const factory = requireFactory(input.chain, input.network, input.factoryAddress);
  await ensureChain(input.chain, input.network);
  const { wallet, pub } = clients(input.chain, input.network);
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error('Connect your wallet first.');

  const fee = await pub.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'deploymentFee' });
  // Delivery deadline is absolute; the chain clock can differ from the browser clock by seconds, which the
  // contract tolerates because the deadline is days beyond the funding deadline.
  const deliveryDeadline = BigInt(Math.floor(Date.now() / 1000)) + BigInt(deliveryDays) * 86400n;

  const txHash = await wallet.writeContract({
    address: factory,
    abi: FACTORY_ABI,
    functionName: 'deployPreorderEscrow',
    args: [softCap, hardCap, fundingSeconds, deliveryDeadline, challenge, bps],
    value: fee,
    account,
    chain: wallet.chain,
  });
  return awaitDeployment(pub, factory, txHash, 'PreorderEscrowDeployed');
}

export interface DeployTokenInput {
  chain: LaunchpadChain;
  network: LaunchpadNetwork;
  factoryAddress?: string | null;
  name: string;
  symbol: string;
  initialSupply: number;
  maxSupply: number;
}

export async function deployLoyaltyToken(input: DeployTokenInput): Promise<DeployResult> {
  if (!Number.isInteger(input.maxSupply) || input.maxSupply <= 0) throw new Error('Maximum supply must be a positive whole number.');
  if (!Number.isInteger(input.initialSupply) || input.initialSupply < 0 || input.initialSupply > input.maxSupply) {
    throw new Error('Initial supply must be a whole number from 0 up to the maximum supply.');
  }
  const factory = requireFactory(input.chain, input.network, input.factoryAddress);
  await ensureChain(input.chain, input.network);
  const { wallet, pub } = clients(input.chain, input.network);
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error('Connect your wallet first.');
  const fee = await pub.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'deploymentFee' });
  const txHash = await wallet.writeContract({
    address: factory,
    abi: FACTORY_ABI,
    functionName: 'deployLoyaltyToken',
    args: [input.name, input.symbol, BigInt(input.initialSupply), BigInt(input.maxSupply)],
    value: fee,
    account,
    chain: wallet.chain,
  });
  return awaitDeployment(pub, factory, txHash, 'LoyaltyTokenDeployed');
}

async function awaitDeployment(
  pub: ReturnType<typeof clients>['pub'],
  factory: Address,
  txHash: Hex,
  eventName: 'PreorderEscrowDeployed' | 'LoyaltyTokenDeployed',
): Promise<DeployResult> {
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
  if (receipt.status !== 'success') throw new Error('The deployment transaction failed on-chain.');
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: FACTORY_ABI, data: log.data, topics: log.topics });
      if (ev.eventName !== eventName) continue;
      const a = ev.args as unknown as { escrowAddress?: Address; tokenAddress?: Address };
      const contractAddress = a.escrowAddress ?? a.tokenAddress;
      if (contractAddress) return { txHash, contractAddress };
    } catch {
      continue;
    }
  }
  throw new Error('Deployment confirmed but the new contract address was not found in the receipt.');
}

export type EscrowAction =
  | { kind: 'pledge'; amountNative: string }
  | { kind: 'object'; milestoneIndex: number }
  | { kind: 'disburse'; milestoneIndex: number }
  | { kind: 'submitProof'; milestoneIndex: number; proofUri: string; proofHash: Hex }
  | { kind: 'finalizeFunding' }
  | { kind: 'markFailed' }
  | { kind: 'claimRefund' }
  | { kind: 'withdraw' };

/** Sends one escrow transaction from the connected wallet and waits for confirmation. */
export async function sendEscrowAction(
  chain: LaunchpadChain,
  network: LaunchpadNetwork,
  escrowAddress: string,
  action: EscrowAction,
): Promise<Hex> {
  const escrow = normaliseEvmAddress(escrowAddress) as Address | null;
  if (!escrow) throw new Error('Invalid contract address.');
  await ensureChain(chain, network);
  const { wallet, pub } = clients(chain, network);
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error('Connect your wallet first.');
  const base = { address: escrow, abi: ESCROW_ABI, account, chain: wallet.chain } as const;
  let hash: Hex;
  switch (action.kind) {
    case 'pledge':
      hash = await wallet.writeContract({ ...base, functionName: 'pledge', value: parseNativeAmount(action.amountNative, 'Pledge amount') });
      break;
    case 'object':
      hash = await wallet.writeContract({ ...base, functionName: 'object', args: [BigInt(action.milestoneIndex)] });
      break;
    case 'disburse':
      hash = await wallet.writeContract({ ...base, functionName: 'disburseMilestone', args: [BigInt(action.milestoneIndex)] });
      break;
    case 'submitProof':
      hash = await wallet.writeContract({ ...base, functionName: 'submitMilestoneProof', args: [BigInt(action.milestoneIndex), action.proofUri, action.proofHash] });
      break;
    case 'finalizeFunding':
      hash = await wallet.writeContract({ ...base, functionName: 'finalizeFunding' });
      break;
    case 'markFailed':
      hash = await wallet.writeContract({ ...base, functionName: 'markFailed' });
      break;
    case 'claimRefund':
      hash = await wallet.writeContract({ ...base, functionName: 'claimRefund' });
      break;
    case 'withdraw':
      hash = await wallet.writeContract({ ...base, functionName: 'withdraw' });
      break;
  }
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== 'success') throw new Error('The transaction failed on-chain.');
  return hash;
}

/** Customer-side: burn voucher tokens against a code the merchant issued. */
export async function redeemTokenVoucher(
  chain: LaunchpadChain,
  network: LaunchpadNetwork,
  tokenAddress: string,
  amount: number,
  voucherCode: string,
): Promise<Hex> {
  const token = normaliseEvmAddress(tokenAddress) as Address | null;
  if (!token) throw new Error('Invalid token address.');
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive whole number.');
  await ensureChain(chain, network);
  const { wallet, pub } = clients(chain, network);
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error('Connect your wallet first.');
  const hash = await wallet.writeContract({
    address: token, abi: TOKEN_ABI, functionName: 'redeem', args: [BigInt(amount), voucherCode], account, chain: wallet.chain,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== 'success') throw new Error('The transaction failed on-chain.');
  return hash;
}

/** Hash of the proof document text/URI list so backers can verify what the merchant submitted. */
export async function sha256Hex(text: string): Promise<Hex> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `0x${Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}
