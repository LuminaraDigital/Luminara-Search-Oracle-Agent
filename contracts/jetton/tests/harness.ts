/**
 * Shared helpers for the sandbox test suites.
 */
import { readFileSync } from 'node:fs';
import { Address, beginCell, Cell, Dictionary, storeStateInit, toNano } from '@ton/core';
import { type BlockchainTransaction, createShardAccount, internal, type SendMessageResult } from '@ton/sandbox';
import { findTransaction, filterTransactions, flattenTransaction, type FlatTransactionComparable } from '@ton/test-utils';
import type { LocalJetton, LocalNet } from '../src/localnet';

export * from '../src/localnet';
export * from '../src/token';

/** Wallet label for the test suites. Fixed, so addresses are the same on every run. */
export const TEST_SEED = 'luminara-jetton-tests';

/** Opcodes: TEP-74, TEP-89 and this contract's launch and admin messages. */
export const OP = {
  transfer: 0x0f8a7ea5,
  internalTransfer: 0x178d4519,
  transferNotification: 0x7362d09c,
  burn: 0x595f07bc,
  burnNotification: 0x7bdd97de,
  excesses: 0xd53276db,
  provideWalletAddress: 0x2c76b973,
  takeWalletAddress: 0xd1735400,
  launch: 0x4c41554e,
  changeAdmin: 0x6501f354,
  claimAdmin: 0xfb88e119,
  dropAdmin: 0x7431f221,
  updateContent: 0x00000004,
} as const;

/** Exit codes, mirrored from contracts/messages.tact. */
export const ERR = {
  notOwner: 705,
  insufficientBalance: 706,
  notValidWallet: 707,
  malformedForwardPayload: 708,
  insufficientTon: 709,
  notAdmin: 710,
  notNextAdmin: 711,
  invalidSupply: 712,
  invalidContent: 713,
  notLaunched: 714,
  alreadyLaunched: 715,
  decimalsAreFixed: 716,
  /** Tact: no handler accepts this message. */
  unknownMessage: 130,
  /** Tact: the address is not in the basechain. */
  notBasechain: 138,
} as const;

export const ZERO_ADDRESS = Address.parseRaw(`0:${'0'.repeat(64)}`);

export const YEAR = 365 * 24 * 60 * 60;

type Result = { transactions: BlockchainTransaction[] };

function describeMatch(match: FlatTransactionComparable): string {
  return JSON.stringify(match, (_key, value) => {
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function') return '[predicate]';
    if (value instanceof Address) return value.toString();
    if (value instanceof Cell) return `cell:${value.hash().toString('hex').slice(0, 8)}`;
    return value;
  });
}

function describeTransactions(transactions: BlockchainTransaction[]): string {
  return transactions
    .map((tx) => {
      const flat = flattenTransaction(tx);
      const op = flat.op === undefined ? 'none' : `0x${flat.op.toString(16)}`;
      return `  ${flat.from ?? 'external'} -> ${flat.to} op=${op} value=${flat.value} success=${flat.success} exit=${flat.exitCode} action=${flat.actionResultCode}`;
    })
    .join('\n');
}

/** Asserts that one of the transactions matches and returns it. */
export function expectTx(result: Result, match: FlatTransactionComparable): BlockchainTransaction {
  const found = findTransaction(result.transactions, match);
  if (!found) {
    throw new Error(
      `Expected a transaction matching ${describeMatch(match)}, but saw:\n${describeTransactions(result.transactions)}`,
    );
  }
  return found;
}

/** Asserts that none of the transactions match. */
export function expectNoTx(result: Result, match: FlatTransactionComparable): void {
  const found = filterTransactions(result.transactions, match);
  if (found.length > 0) {
    throw new Error(
      `Expected no transaction matching ${describeMatch(match)}, but saw:\n${describeTransactions(result.transactions)}`,
    );
  }
}

/** Gas used by the compute phase of a transaction. */
export function gasUsed(tx: BlockchainTransaction): bigint {
  if (tx.description.type !== 'generic' || tx.description.computePhase.type !== 'vm') {
    throw new Error('Transaction has no compute phase.');
  }
  return tx.description.computePhase.gasUsed;
}

/** Storage rent collected by a transaction. */
export function rentPaid(tx: BlockchainTransaction): bigint {
  if (tx.description.type !== 'generic') throw new Error('Unexpected transaction type.');
  return tx.description.storagePhase?.storageFeesCollected ?? 0n;
}

/** Body of the message that triggered a transaction. */
export function inboundBody(tx: BlockchainTransaction): Cell {
  if (!tx.inMessage) throw new Error('Transaction has no inbound message.');
  return tx.inMessage.body;
}

/** Toncoin carried by the message that triggered a transaction. */
export function inboundValue(tx: BlockchainTransaction): bigint {
  if (tx.inMessage?.info.type !== 'internal') throw new Error('Not an internal message.');
  return tx.inMessage.info.value.coins;
}

/** Counts the distinct cells and the data bits in a tree of cells, the way TON charges for them. */
export function cellStats(root: Cell): { cells: number; bits: number } {
  const seen = new Set<string>();
  let bits = 0;
  const visit = (cell: Cell) => {
    const id = cell.hash().toString('hex');
    if (seen.has(id)) return;
    seen.add(id);
    bits += cell.bits.length;
    cell.refs.forEach(visit);
  };
  visit(root);
  return { cells: seen.size, bits };
}

/** The network's message-forwarding prices for the basechain (config parameter 25). */
function forwardPrices(net: LocalNet) {
  const config = net.blockchain.config.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
  const prices = config.get(25);
  if (!prices) throw new Error('The sandbox config has no forwarding prices.');
  const data = prices.beginParse();
  data.skip(8);
  const lump = data.loadUintBig(64);
  const bit = data.loadUintBig(64);
  const cell = data.loadUintBig(64);
  data.skip(32);
  const firstFraction = BigInt(data.loadUint(16));
  return { lump, bit, cell, firstFraction };
}

/**
 * The forwarding fee a real wallet pays to send `body` (and optionally the
 * code and data of a new contract), as the receiving contract reads it.
 */
export function forwardFeeFor(net: LocalNet, body: Cell, stateInit?: Cell): { total: bigint; inMessage: bigint } {
  const { lump, bit, cell, firstFraction } = forwardPrices(net);
  const seen = new Set<string>();
  let bits = 0n;
  const visit = (node: Cell) => {
    const id = node.hash().toString('hex');
    if (seen.has(id)) return;
    seen.add(id);
    bits += BigInt(node.bits.length);
    node.refs.forEach(visit);
  };
  visit(body);
  if (stateInit) visit(stateInit);
  const variable = bits * bit + BigInt(seen.size) * cell;
  const total = lump + (variable + 65535n) / 65536n;
  // A third of the fee is collected at once; the message carries the rest.
  return { total, inMessage: total - (total * firstFraction) / 65536n };
}

/**
 * Sends an internal message that appears to come from `from`, carrying the
 * forwarding fee a real wallet would have paid. Only an emulator can do this.
 */
export function sendAs(net: LocalNet, from: Address, to: Address, value: bigint, body: Cell) {
  return net.blockchain.sendMessage(
    internal({ from, to, value, body, bounce: true, forwardFee: forwardFeeFor(net, body).inMessage }),
  );
}

/**
 * Replaces the contract at `address` with one that fails on every message, so
 * tests can prove that a transfer or burn which bounces is refunded.
 * Returns a function that puts the original contract back.
 */
export async function breakContract(net: LocalNet, address: Address): Promise<() => Promise<void>> {
  const contract = await net.blockchain.getContract(address);
  const original = contract.account;
  // TVM `THROW 42`.
  const alwaysThrows = beginCell().storeUint(0xf200 | 42, 16).endCell();
  await net.blockchain.setShardAccount(
    address,
    createShardAccount({ address, code: alwaysThrows, data: new Cell(), balance: 1_000_000_000n }),
  );
  return async () => {
    await net.blockchain.setShardAccount(address, original);
  };
}

/**
 * Puts the contract at `address` into the frozen state the network gives an
 * account whose unpaid storage rent has passed the freeze limit.
 */
export async function freezeContract(net: LocalNet, address: Address): Promise<void> {
  const shard = (await net.blockchain.getContract(address)).account;
  const account = shard.account;
  if (!account || account.storage.state.type !== 'active') throw new Error('Only an active contract can be frozen.');
  const stateHash = BigInt(`0x${beginCell().store(storeStateInit(account.storage.state.state)).endCell().hash().toString('hex')}`);
  await net.blockchain.setShardAccount(address, {
    ...shard,
    account: { ...account, storage: { ...account.storage, state: { type: 'frozen', stateHash } } },
  });
}

/** Reads a constant such as `GAS_FOR_TRANSFER` or `GENESIS_TON` straight from the contract source. */
export function contractConstant(name: string): bigint {
  const source = readFileSync(new URL('../contracts/messages.tact', import.meta.url), 'utf8');
  const match = new RegExp(`const ${name}: Int = (?:([0-9]+)|ton\\("([0-9.]+)"\\)|([0-9* ]+));`).exec(source);
  if (!match) throw new Error(`Constant ${name} was not found in contracts/messages.tact.`);
  if (match[1]) return BigInt(match[1]);
  if (match[2]) return toNano(match[2]);
  return match[3].split('*').reduce((product, factor) => product * BigInt(factor.trim()), 1n);
}

/** Small deterministic random number generator, so property tests are repeatable. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Finds, to the nanoTON, the smallest attached value for which the first
 * contract accepts the request: the transaction with `opcode` succeeds.
 * Leaves the sandbox in the state after that cheapest accepted request.
 */
export async function cheapestAccepted(
  net: LocalNet,
  opcode: number,
  attempt: (value: bigint) => Promise<SendMessageResult>,
  ceiling: bigint = toNano('2'),
): Promise<{ value: bigint; result: SendMessageResult }> {
  const start = net.blockchain.snapshot();
  const accepted = (result: SendMessageResult) => findTransaction(result.transactions, { op: opcode, success: true }) !== undefined;

  let rejected = 0n;
  let acceptedAt = ceiling;
  while (acceptedAt - rejected > 1n) {
    const middle = (rejected + acceptedAt) / 2n;
    await net.blockchain.loadFrom(start);
    if (accepted(await attempt(middle))) acceptedAt = middle;
    else rejected = middle;
  }
  await net.blockchain.loadFrom(start);
  const result = await attempt(acceptedAt);
  if (!accepted(result)) throw new Error(`Nothing up to ${ceiling} nanoTON was accepted.`);
  return { value: acceptedAt, result };
}

/** The two things that must always hold: no tokens appear from nowhere, and the master's count matches reality. */
export async function expectConservation(jetton: LocalJetton, holders: Address[], burned: bigint): Promise<void> {
  let held = 0n;
  for (const holder of holders) held += await jetton.balanceOf(holder);
  const reported = await jetton.totalSupply();
  if (held !== reported || reported !== jetton.supply - burned) {
    throw new Error(
      `Supply is not conserved: wallets hold ${held}, the master reports ${reported}, expected ${jetton.supply - burned} (${burned} burned).`,
    );
  }
}

/** Asserts that nothing in `result` created tokens: the master sent no credit to any wallet. */
export function expectNoMint(jetton: LocalJetton, result: Result): void {
  expectNoTx(result, { from: jetton.master.address, op: OP.internalTransfer });
}

/**
 * The network's fee formulas, read from the sandbox's copy of the live
 * network configuration. Tests use them to work out, independently of the
 * contracts, exactly how much Toncoin a request must carry.
 */
export function networkFees(net: LocalNet) {
  const config = net.blockchain.config.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
  const need = (id: number) => {
    const cell = config.get(id);
    if (!cell) throw new Error(`The sandbox config has no parameter ${id}.`);
    return cell.beginParse();
  };
  const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

  const gas = need(21);
  gas.skip(8);
  const flatLimit = gas.loadUintBig(64);
  const flatPrice = gas.loadUintBig(64);
  gas.skip(8);
  const gasPrice = gas.loadUintBig(64);
  gas.skip(64 * 4);
  const freezeDueLimit = gas.loadUintBig(64);

  const forward = forwardPrices(net);

  const now = net.blockchain.now ?? Math.floor(Date.now() / 1000);
  const storagePrices = need(18).loadDictDirect(Dictionary.Keys.Uint(32), {
    serialize: () => {
      throw new Error('read-only');
    },
    parse: (slice) => {
      slice.skip(8 + 32);
      return { bit: slice.loadUintBig(64), cell: slice.loadUintBig(64) };
    },
  });
  const since = Math.max(...storagePrices.keys().filter((key) => key <= now));
  const storage = storagePrices.get(since);
  if (!storage) throw new Error('The sandbox config has no storage prices for the current time.');

  return {
    /** Toncoin charged for `gasUnits` of computation. */
    compute: (gasUnits: bigint) => (gasUnits <= flatLimit ? flatPrice : flatPrice + ceilDiv((gasUnits - flatLimit) * gasPrice, 65536n)),
    /** Toncoin charged for carrying `cells` and `bits` in a message, without the fixed part. */
    simpleForward: (cells: bigint, bits: bigint) => ceilDiv(bits * forward.bit + cells * forward.cell, 65536n),
    /** The full forwarding fee of an inbound message, recovered from the part the message still carries. */
    originalForward: (carried: bigint) => (carried * 65536n) / (65536n - forward.firstFraction),
    /** Rent for storing `cells` and `bits` for `seconds`. */
    storage: (cells: bigint, bits: bigint, seconds: bigint) => ceilDiv((bits * storage.bit + cells * storage.cell) * seconds, 65536n),
    /** A contract whose unpaid rent exceeds this is frozen. */
    freezeDueLimit,
  };
}

/**
 * Makes storage `times` as expensive on this local chain, the way a vote of
 * the network's validators could on the real one.
 */
export function raiseStoragePrices(net: LocalNet, times: bigint): void {
  const config = net.blockchain.config.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
  const current = config.get(18);
  if (!current) throw new Error('The sandbox config has no storage prices.');
  // Each entry: storage_prices#cc utime_since:uint32, then four prices of 64 bits each.
  const entries = current.beginParse().loadDictDirect(Dictionary.Keys.Uint(32), Dictionary.Values.BitString(8 + 32 + 4 * 64));
  const raised = Dictionary.empty(Dictionary.Keys.Uint(32), Dictionary.Values.Cell());
  for (const [since, entry] of entries) {
    const fields = beginCell().storeBits(entry).endCell().beginParse();
    const header = fields.loadBits(8 + 32);
    const priced = beginCell().storeBits(header);
    for (let price = 0; price < 4; price++) priced.storeUint(fields.loadUintBig(64) * times, 64);
    raised.set(since, priced.endCell());
  }
  // The values are stored inline in the dictionary, so rebuild it with inline values.
  const inline = Dictionary.empty(Dictionary.Keys.Uint(32), Dictionary.Values.BitString(8 + 32 + 4 * 64));
  for (const [since, cell] of raised) inline.set(since, cell.beginParse().loadBits(8 + 32 + 4 * 64));
  config.set(18, beginCell().storeDictDirect(inline).endCell());
  net.blockchain.setConfig(beginCell().storeDictDirect(config).endCell());
}

/** The storage reserve a wallet keeps, computed the way contracts/messages.tact does. */
export function walletStorageReserve(net: LocalNet): bigint {
  const fiveYears = networkFees(net).storage(
    contractConstant('WALLET_STORAGE_CELLS'),
    contractConstant('WALLET_STORAGE_BITS'),
    contractConstant('STORAGE_RESERVE_SECONDS'),
  );
  const cap = contractConstant('MAX_STORAGE_RESERVE');
  return fiveYears < cap ? fiveYears : cap;
}

/** The forwarding fee the receiving contract reads from the message that triggered `tx`. */
export function inboundForwardFee(net: LocalNet, tx: BlockchainTransaction): bigint {
  if (tx.inMessage?.info.type !== 'internal') throw new Error('Not an internal message.');
  return networkFees(net).originalForward(tx.inMessage.info.forwardFee);
}

/** Storage rent a contract still owes. */
export async function rentOwed(net: LocalNet, address: Address): Promise<bigint> {
  const account = (await net.blockchain.getContract(address)).account.account;
  return account?.storageStats.duePayment ?? 0n;
}
