/**
 * Local TON sandbox for Jetton development.
 *
 * Everything here runs inside @ton/sandbox, an in-memory emulator of the TON
 * virtual machine. It opens no network connection, so nothing in this file
 * can reach testnet or mainnet.
 *
 * The wallets are sandbox treasuries. They are plain contracts in emulator
 * memory with made-up Toncoin balances. No seed phrase or private key is
 * generated, read or stored for them: the emulator lets the test send from
 * them directly.
 */
import { type Address, beginCell, Cell, type Slice, toNano } from '@ton/core';
import { Blockchain, type SandboxContract, type SendMessageResult, type TreasuryContract } from '@ton/sandbox';
import { JettonMaster } from '../build/LuminaraJetton_JettonMaster';
import { JettonWallet } from '../build/LuminaraJetton_JettonWallet';
import { buildOnchainContent, loadTokenProfile, supplyInUnits, type TokenProfile } from './token';

export const LOCAL_WALLET_NAMES = ['deployer', 'treasury', 'merchant', 'alice', 'bob', 'mallory'] as const;
export type LocalWalletName = (typeof LOCAL_WALLET_NAMES)[number];
export type LocalWallet = SandboxContract<TreasuryContract>;

export interface LocalNet {
  blockchain: Blockchain;
  /** Wallet addresses are derived from this label. A new label gives a new set of wallets. */
  seed: string;
  wallets: Record<LocalWalletName, LocalWallet>;
}

/** Toncoin sent with the launch. It stays on the master as storage rent. */
export const LAUNCH_VALUE = toNano('1');

/** Toncoin attached to a transfer or burn by default. What is not used comes back as excess. */
export const DEFAULT_ATTACHED_TON = toNano('0.1');

/**
 * The time on a new local chain. It is fixed, and only moves when a test
 * moves it, so storage rent is the same on every run.
 */
export const LOCAL_START_TIME = 1_790_000_000;

/**
 * Starts an in-memory blockchain and creates the disposable wallets on it.
 * The same `seed` always gives the same addresses, which keeps tests stable.
 */
export async function startLocalNet(seed: string): Promise<LocalNet> {
  const blockchain = await Blockchain.create();
  blockchain.now = LOCAL_START_TIME;
  const wallets = {} as Record<LocalWalletName, LocalWallet>;
  for (const name of LOCAL_WALLET_NAMES) {
    wallets[name] = await blockchain.treasury(`${seed}/${name}`);
  }
  return { blockchain, seed, wallets };
}

/** Moves the local clock forward. Storage rent for the skipped time falls due on each contract's next transaction. */
export function advanceTime(net: LocalNet, seconds: number): void {
  net.blockchain.now = (net.blockchain.now ?? LOCAL_START_TIME) + seconds;
}

export interface LocalJetton {
  master: SandboxContract<JettonMaster>;
  admin: Address;
  profile: TokenProfile;
  /** The supply the master creates at launch, in the smallest unit. */
  supply: bigint;
  /** Every transaction caused by the last message `deployJetton` or `launch` sent. */
  deployment: SendMessageResult;
  /** The Jetton wallet of `owner`. The address is computed locally, so this works before anything is deployed. */
  wallet(owner: Address): Promise<SandboxContract<JettonWallet>>;
  /** Zero when the owner has no Jetton wallet yet. */
  balanceOf(owner: Address): Promise<bigint>;
  totalSupply(): Promise<bigint>;
}

export interface DeployOptions {
  /** Receives the whole supply and the admin role, and sends the launch. Defaults to the `treasury` wallet. */
  admin?: LocalWallet;
  /** Toncoin sent with the launch. */
  value?: bigint;
  profile?: TokenProfile;
  /** Overrides the metadata cell, for tests that deploy malformed content. */
  content?: Cell;
  /** Overrides the supply in the smallest unit, for tests that deploy an invalid supply. */
  supply?: bigint;
  /** Overrides the admin address, for tests of an admin that is not one of the local wallets. */
  adminAddress?: Address;
  /**
   * Who sends the first message, and what it is. The default is the real
   * deployment: the admin sends `Launch` together with the contract code.
   * `'shell'` only puts the code on-chain (a plain Toncoin transfer from the
   * `deployer` wallet) and launches nothing.
   */
  first?: 'launch' | 'shell';
}

/**
 * Deploys the Jetton master to the local sandbox the way the deploy tool
 * does on a real network: one message from the admin that carries the
 * contract code and the launch. This does not check that it succeeded:
 * read `deployment`.
 */
export async function deployJetton(net: LocalNet, options: DeployOptions = {}): Promise<LocalJetton> {
  const profile = options.profile ?? loadTokenProfile();
  const supply = options.supply ?? supplyInUnits(profile);
  const adminWallet = options.admin ?? net.wallets.treasury;
  const admin = options.adminAddress ?? adminWallet.address;
  const content = options.content ?? buildOnchainContent({ ...profile.metadata });

  const master = net.blockchain.openContract(await JettonMaster.fromInit(false, 0n, supply, admin, null, content));
  const deployment =
    options.first === 'shell'
      ? await master.send(net.wallets.deployer.getSender(), { value: options.value ?? LAUNCH_VALUE }, null)
      : await master.send(adminWallet.getSender(), { value: options.value ?? LAUNCH_VALUE }, { $$type: 'Launch', queryId: 0n });

  const wallet = async (owner: Address) =>
    net.blockchain.openContract(await JettonWallet.fromInit(0n, owner, master.address));

  return {
    master,
    admin,
    profile,
    supply,
    deployment,
    wallet,
    balanceOf: async (owner) => {
      const holder = await wallet(owner);
      if (!(await isActive(net, holder.address))) return 0n;
      return (await holder.getGetWalletData()).balance;
    },
    totalSupply: async () => (await master.getGetJettonData()).totalSupply,
  };
}

/** Sends `Launch` to an already created master from `from`. */
export function launch(jetton: LocalJetton, from: LocalWallet, value: bigint = LAUNCH_VALUE) {
  return jetton.master.send(from.getSender(), { value }, { $$type: 'Launch', queryId: 0n });
}

export async function isActive(net: LocalNet, address: Address): Promise<boolean> {
  return (await net.blockchain.getContract(address)).accountState?.type === 'active';
}

/** Toncoin held by a contract. */
export async function tonBalance(net: LocalNet, address: Address): Promise<bigint> {
  return (await net.blockchain.getContract(address)).balance;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** A `forward_payload` with no data: just the `Either` tag bit. */
export function emptyPayload(): Slice {
  return beginCell().storeBit(false).endCell().beginParse();
}

/** A `forward_payload` carrying a text comment by reference, the way wallets and the Luminara app send memos. */
export function commentPayload(text: string): Slice {
  const comment = beginCell().storeUint(0, 32).storeStringTail(text).endCell();
  return beginCell().storeBit(true).storeRef(comment).endCell().beginParse();
}

/** Reads a text comment out of a `forward_payload`. Returns null when it holds something else. */
export function readComment(payload: Slice): string | null {
  const data = payload.clone();
  if (data.remainingBits < 1) return null;
  const body = data.loadBit() ? data.loadRef().beginParse() : data;
  if (body.remainingBits < 32 || body.loadUint(32) !== 0) return null;
  return body.loadStringTail();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface TransferOptions {
  to: Address;
  amount: bigint;
  /** Toncoin attached to the transfer. */
  value?: bigint;
  /** Toncoin forwarded to the recipient with a transfer notification. Zero sends no notification. */
  forwardTon?: bigint;
  payload?: Slice;
  /** Where unused Toncoin goes. Defaults to the sender. Null keeps it in the receiving wallet. */
  response?: Address | null;
  queryId?: bigint;
  customPayload?: Cell | null;
}

export async function transfer(jetton: LocalJetton, from: LocalWallet, options: TransferOptions) {
  const wallet = await jetton.wallet(from.address);
  return wallet.send(
    from.getSender(),
    { value: options.value ?? DEFAULT_ATTACHED_TON },
    {
      $$type: 'JettonTransfer',
      queryId: options.queryId ?? 0n,
      amount: options.amount,
      destination: options.to,
      responseDestination: options.response === undefined ? from.address : options.response,
      customPayload: options.customPayload ?? null,
      forwardTonAmount: options.forwardTon ?? 0n,
      forwardPayload: options.payload ?? emptyPayload(),
    },
  );
}

export interface BurnOptions {
  amount: bigint;
  value?: bigint;
  response?: Address | null;
  queryId?: bigint;
}

export async function burn(jetton: LocalJetton, from: LocalWallet, options: BurnOptions) {
  const wallet = await jetton.wallet(from.address);
  return wallet.send(
    from.getSender(),
    { value: options.value ?? DEFAULT_ATTACHED_TON },
    {
      $$type: 'JettonBurn',
      queryId: options.queryId ?? 0n,
      amount: options.amount,
      responseDestination: options.response === undefined ? from.address : options.response,
      customPayload: null,
    },
  );
}
