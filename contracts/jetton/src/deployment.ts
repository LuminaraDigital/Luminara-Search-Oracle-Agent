/**
 * Preparing a deployment and checking a deployed Jetton, shared by the deploy
 * tool, the verify script and the tests.
 *
 * Nothing here can sign or send a transaction. Preparing a deployment only
 * computes the address and the message a wallet would have to approve, and
 * proves in a local sandbox that this message does what it should.
 */
import { readFileSync } from 'node:fs';
import { Address, beginCell, Cell, type ContractProvider, storeStateInit, toNano } from '@ton/core';
import { Blockchain, internal } from '@ton/sandbox';
import { JettonMaster, storeLaunch } from '../build/LuminaraJetton_JettonMaster';
import { JettonWallet, storeJettonBurn, storeJettonTransfer } from '../build/LuminaraJetton_JettonWallet';
import { buildOnchainContent, formatUnits, parseOnchainContent, supplyInUnits, type TokenProfile, toUnits } from './token';

export type Network = 'testnet' | 'mainnet';

/** TON Connect chain identifiers. A wallet on the other network refuses a request that names one of these. */
export const CHAIN_ID: Record<Network, '-3' | '-239'> = { testnet: '-3', mainnet: '-239' };

/**
 * Toncoin sent with the launch. The contract refuses to launch with less
 * than 1 TON on it. It is a deposit, not a fee: it stays on the token
 * contract and pays its storage rent for decades.
 */
export const DEFAULT_DEPLOY_VALUE = toNano('1');
export const MIN_DEPLOY_VALUE = toNano('1');
/** More than this is almost certainly a typing mistake, and nothing can be withdrawn from the token contract. */
export const MAX_DEPLOY_VALUE = toNano('5');

const ZERO_ADDRESS = Address.parseRaw(`0:${'0'.repeat(64)}`);

// ---------------------------------------------------------------------------
// Pinned code hashes
// ---------------------------------------------------------------------------

export interface CodeHashes {
  /** Version of @tact-lang/compiler the hashes were produced with. */
  compiler: string;
  master: string;
  wallet: string;
}

/** The code hashes that were reviewed and tested. code-hashes.json is this package's lockfile for contract code. */
export function loadPinnedCodeHashes(): CodeHashes {
  return JSON.parse(readFileSync(new URL('../code-hashes.json', import.meta.url), 'utf8')) as CodeHashes;
}

/** The code hashes of what `npm run build` just produced. */
export function compiledCodeHashes(): CodeHashes {
  const read = (name: string) =>
    Cell.fromBoc(readFileSync(new URL(`../build/LuminaraJetton_${name}.code.boc`, import.meta.url)))[0].hash().toString('hex');
  const compiler = JSON.parse(
    readFileSync(new URL('../node_modules/@tact-lang/compiler/package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return { compiler: compiler.version, master: read('JettonMaster'), wallet: read('JettonWallet') };
}

/** Throws unless the compiled contracts are exactly the pinned ones. */
export function assertPinnedCode(): CodeHashes {
  const pinned = loadPinnedCodeHashes();
  const compiled = compiledCodeHashes();
  for (const key of ['compiler', 'master', 'wallet'] as const) {
    if (pinned[key] !== compiled[key]) {
      throw new Error(
        `The compiled contracts are not the reviewed ones: ${key} is ${compiled[key]} but code-hashes.json pins ${pinned[key]}. ` +
          'If the contracts were changed on purpose, re-run the tests and the mutation check, then run "npm run pin -- --write".',
      );
    }
  }
  return pinned;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** Gives read access to one account. Both the sandbox and a real network client can provide this. */
export type ProviderFactory = (address: Address) => ContractProvider;

export interface Check {
  name: string;
  /** `warn` does not fail the verification. */
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

export interface VerifyOptions {
  master: Address;
  profile: TokenProfile;
  pinned: CodeHashes;
  /** The address expected to be admin. Required with `fresh`. */
  admin?: Address;
  /**
   * True right after launch: nothing has been transferred, burned or changed
   * yet, so the admin must still hold the whole supply and the metadata must
   * be exactly token.json.
   */
  fresh?: boolean;
  /**
   * True when the metadata must be exactly token.json even on a token that
   * has been used since launch. The mainnet gate asks for this: what was
   * rehearsed on testnet has to be what gets launched.
   */
  exactMetadata?: boolean;
  /** The Toncoin balance below which the master's rent runway is flagged. */
  minMasterBalance?: bigint;
}

export interface Verification {
  ok: boolean;
  checks: Check[];
  /** True when the token contract exists and has been launched. */
  launched: boolean;
  totalSupply?: bigint;
  admin?: Address;
}

async function codeHashOf(provider: ContractProvider): Promise<{ active: boolean; hash?: string; balance: bigint }> {
  const state = await provider.getState();
  if (state.state.type !== 'active' || !state.state.code) return { active: false, balance: state.balance };
  return { active: true, hash: Cell.fromBoc(state.state.code)[0].hash().toString('hex'), balance: state.balance };
}

/**
 * Reads a deployed Jetton and compares it with what this package would
 * deploy. The same checks run against the local sandbox before a deployment
 * and against the real network after it.
 */
export async function verifyDeployment(provide: ProviderFactory, options: VerifyOptions): Promise<Verification> {
  const { master, profile, pinned, admin, fresh = false } = options;
  const symbol = profile.metadata.symbol;
  const genesisSupply = supplyInUnits(profile);
  const checks: Check[] = [];
  const add = (name: string, passed: boolean, detail: string, onFailure: 'fail' | 'warn' = 'fail') =>
    checks.push({ name, status: passed ? 'pass' : onFailure, detail });
  const result = (extra: Partial<Verification> = {}): Verification => ({
    ok: checks.every((c) => c.status !== 'fail'),
    checks,
    launched: false,
    ...extra,
  });

  if (fresh && !admin) throw new Error('A fresh deployment can only be verified against the admin address it was deployed for.');

  const masterProvider = provide(master);
  const masterCode = await codeHashOf(masterProvider);
  add('The token contract exists', masterCode.active, masterCode.active ? 'account is active' : 'no contract at this address');
  if (!masterCode.active) return result();

  add(
    'The token contract runs the reviewed code',
    masterCode.hash === pinned.master,
    masterCode.hash === pinned.master ? `code hash ${pinned.master}` : `code hash is ${masterCode.hash}, expected ${pinned.master}`,
  );
  if (masterCode.hash !== pinned.master) return result();

  const data = (await masterProvider.get('get_jetton_data', [])).stack;
  const totalSupply = data.readBigNumber();
  const mintable = data.readBoolean();
  const currentAdmin = data.readAddress();
  const content = data.readCell();
  const walletCode = data.readCell();
  const onChainGenesis = (await masterProvider.get('get_genesis_supply', [])).stack.readBigNumber();

  // Before launch the contract reports itself mintable: its one mint is still to come.
  const launched = !mintable;
  add(
    'The token has been launched and minting is closed',
    launched,
    launched ? 'mintable = false' : 'the contract is deployed but not launched: no tokens exist yet',
  );
  add(
    'The genesis supply is the supply in token.json',
    onChainGenesis === genesisSupply,
    `${formatUnits(profile, onChainGenesis)} ${symbol}, expected ${formatUnits(profile, genesisSupply)}`,
  );
  if (!launched) return result({ totalSupply, admin: currentAdmin });

  if (fresh) {
    add(
      'The whole supply exists',
      totalSupply === genesisSupply,
      `total supply ${formatUnits(profile, totalSupply)} ${symbol}, expected ${formatUnits(profile, genesisSupply)}`,
    );
  } else {
    const inRange = totalSupply > 0n && totalSupply <= genesisSupply;
    add(
      'The supply never exceeds the genesis supply',
      inRange,
      inRange
        ? `total supply ${formatUnits(profile, totalSupply)} ${symbol} (${formatUnits(profile, genesisSupply - totalSupply)} burned since launch)`
        : `total supply is ${totalSupply} units, outside 1 to ${genesisSupply}`,
    );
  }

  const walletHash = walletCode.hash().toString('hex');
  add(
    'Holders run the reviewed wallet code',
    walletHash === pinned.wallet,
    walletHash === pinned.wallet ? `wallet code hash ${pinned.wallet}` : `wallet code hash is ${walletHash}, expected ${pinned.wallet}`,
  );

  let metadataDetail: string;
  let metadataMatches = false;
  try {
    const { fields, keyCount } = parseOnchainContent(content);
    const expected = profile.metadata as unknown as Record<string, string>;
    const differing = Object.keys(expected).filter((key) => fields[key] !== expected[key]);
    metadataMatches = differing.length === 0 && keyCount === Object.keys(expected).length;
    metadataDetail = metadataMatches
      ? `${fields.name} (${fields.symbol}), ${fields.decimals} decimals`
      : `differs from token.json in: ${differing.join(', ') || 'extra keys'}`;
  } catch (error) {
    metadataDetail = error instanceof Error ? error.message : String(error);
  }
  // After launch the admin may change metadata on purpose, so a difference is only fatal
  // on a fresh deployment, or when the caller needs the token to match token.json exactly.
  add('The metadata is token.json', metadataMatches, metadataDetail, fresh || options.exactMetadata ? 'fail' : 'warn');

  const dropped = currentAdmin.equals(ZERO_ADDRESS);
  if (admin) {
    add(
      'The admin is the expected address',
      currentAdmin.equals(admin),
      currentAdmin.equals(admin) ? admin.toString() : `admin is ${dropped ? 'dropped (zero address)' : currentAdmin.toString()}`,
      fresh ? 'fail' : 'warn',
    );
  } else {
    add('The admin role', true, dropped ? 'dropped forever (zero address)' : `held by ${currentAdmin.toString()}`);
  }

  if (fresh && admin) {
    const walletAddress = (
      await masterProvider.get('get_wallet_address', [{ type: 'slice', cell: beginCell().storeAddress(admin).endCell() }])
    ).stack.readAddress();
    const walletProvider = provide(walletAddress);
    const wallet = await codeHashOf(walletProvider);
    add(
      'The admin wallet exists and runs the reviewed code',
      wallet.active && wallet.hash === pinned.wallet,
      wallet.active ? `wallet ${walletAddress.toString()}, code hash ${wallet.hash}` : `no wallet at ${walletAddress.toString()}`,
    );
    if (wallet.active && wallet.hash === pinned.wallet) {
      const walletData = (await walletProvider.get('get_wallet_data', [])).stack;
      const balance = walletData.readBigNumber();
      const owner = walletData.readAddress();
      const walletMaster = walletData.readAddress();
      add(
        'The admin holds the whole supply',
        balance === genesisSupply && owner.equals(admin) && walletMaster.equals(master),
        `balance ${formatUnits(profile, balance)} ${symbol}`,
      );
    }
  }

  const minBalance = options.minMasterBalance ?? toNano('0.5');
  add(
    'The token contract is funded for storage rent',
    masterCode.balance >= minBalance,
    `${Number(masterCode.balance) / 1e9} TON on the contract. Anyone can add more with a plain Toncoin transfer (no comment).`,
    'warn',
  );

  return result({ launched: true, totalSupply, admin: currentAdmin });
}

// ---------------------------------------------------------------------------
// Preparing a deployment
// ---------------------------------------------------------------------------

/** A TON Connect `sendTransaction` request. Only a wallet can turn this into a transaction. */
export interface TonConnectRequest {
  validUntil: number;
  network: string;
  /** The wallet that must send it. A wallet app showing a different account refuses. */
  from: string;
  messages: { address: string; amount: string; stateInit?: string; payload?: string }[];
}

/** Wallets reject requests that stay valid for longer than this. */
const REQUEST_VALID_SECONDS = 5 * 60;

export interface PreparedDeployment {
  network: Network;
  admin: Address;
  master: Address;
  adminWallet: Address;
  value: bigint;
  codeHashes: CodeHashes;
  request: TonConnectRequest;
  /** The checks that passed when this exact message was sent on a local sandbox. */
  dryRun: Check[];
}

export interface PrepareOptions {
  network: Network;
  /** The wallet that will send the launch. It becomes the admin and receives the whole supply. */
  admin: Address;
  profile: TokenProfile;
  value?: bigint;
}

async function masterFor(admin: Address, profile: TokenProfile): Promise<JettonMaster> {
  return JettonMaster.fromInit(false, 0n, supplyInUnits(profile), admin, null, buildOnchainContent({ ...profile.metadata }));
}

const launchBody = () => beginCell().store(storeLaunch({ $$type: 'Launch', queryId: 0n })).endCell();

/**
 * Where the token for `admin` lives. The address follows from the code, the
 * admin, the metadata and the supply, so it is known before anything is
 * deployed and is the same on testnet and mainnet.
 */
export async function deploymentAddresses(admin: Address, profile: TokenProfile): Promise<{ master: Address; adminWallet: Address }> {
  const master = await masterFor(admin, profile);
  const adminWallet = await JettonWallet.fromInit(0n, admin, master.address);
  return { master: master.address, adminWallet: adminWallet.address };
}

/**
 * Computes the one message that deploys and launches the token, and proves on
 * a local in-memory blockchain that sending it from `admin` deploys the
 * reviewed code and gives the admin the whole supply. Throws if anything is
 * off, so a request that is returned has already been seen to work.
 *
 * Only the admin can launch (the contract checks the sender), so the request
 * names the admin as the wallet that must send it.
 */
export async function prepareDeployment(options: PrepareOptions): Promise<PreparedDeployment> {
  const { network, admin, profile } = options;
  const value = options.value ?? DEFAULT_DEPLOY_VALUE;
  if (admin.workChain !== 0) throw new Error('The admin wallet must be in the basechain (workchain 0).');
  if (admin.equals(ZERO_ADDRESS)) throw new Error('The admin address is the zero address. Nobody could ever use the tokens.');
  if (value < MIN_DEPLOY_VALUE) throw new Error('The launch needs at least 1 TON. It stays on the token contract as storage rent.');
  if (value > MAX_DEPLOY_VALUE) {
    throw new Error('Refusing to send more than 5 TON: nothing can be withdrawn from the token contract. 1 TON is enough for decades.');
  }

  const pinned = assertPinnedCode();
  const master = await masterFor(admin, profile);
  if (!master.init) throw new Error('The compiled master has no init state.');
  const { adminWallet } = await deploymentAddresses(admin, profile);
  const body = launchBody();

  // Dry run: send exactly this message on a local blockchain, as the admin, and verify
  // the result with the same checks that will later run against the real network.
  const blockchain = await Blockchain.create();
  await blockchain.sendMessage(internal({ from: admin, to: master.address, value, stateInit: master.init, body, bounce: true }));
  const dryRun = await verifyDeployment((address) => blockchain.provider(address), {
    master: master.address,
    admin,
    profile,
    pinned,
    fresh: true,
  });
  if (!dryRun.ok || dryRun.checks.some((c) => c.status !== 'pass')) {
    const failed = dryRun.checks.filter((c) => c.status !== 'pass').map((c) => `${c.name}: ${c.detail}`);
    throw new Error(`The local dry run of this deployment failed, so no request was produced. ${failed.join('; ')}`);
  }

  const testOnly = network === 'testnet';
  return {
    network,
    admin,
    master: master.address,
    adminWallet,
    value,
    codeHashes: pinned,
    request: {
      validUntil: Math.floor(Date.now() / 1000) + REQUEST_VALID_SECONDS,
      network: CHAIN_ID[network],
      from: admin.toRawString(),
      messages: [
        {
          // Bounceable, so a launch that fails returns the Toncoin to the sender.
          address: master.address.toString({ bounceable: true, testOnly }),
          amount: value.toString(),
          stateInit: beginCell().store(storeStateInit(master.init)).endCell().toBoc().toString('base64'),
          payload: body.toBoc().toString('base64'),
        },
      ],
    },
    dryRun: dryRun.checks,
  };
}

// ---------------------------------------------------------------------------
// Testnet rehearsal and the mainnet gate
// ---------------------------------------------------------------------------

/** Tokens moved and tokens burned by the rehearsal, in whole tokens. */
export const REHEARSAL_TOKENS = '1';

/**
 * A request that makes the admin's real wallet exercise the token on testnet:
 * one transfer (to itself, with a notification) and one burn. It is proven on
 * a local sandbox first, like a deployment.
 */
export async function prepareRehearsal(options: { admin: Address; profile: TokenProfile }): Promise<TonConnectRequest> {
  const { admin, profile } = options;
  const pinned = assertPinnedCode();
  const supply = supplyInUnits(profile);
  const amount = toUnits(profile, REHEARSAL_TOKENS);
  const master = await masterFor(admin, profile);
  if (!master.init) throw new Error('The compiled master has no init state.');
  const { adminWallet } = await deploymentAddresses(admin, profile);

  const transferBody = beginCell()
    .store(
      storeJettonTransfer({
        $$type: 'JettonTransfer',
        queryId: 0n,
        amount,
        destination: admin,
        responseDestination: admin,
        customPayload: null,
        forwardTonAmount: 1n,
        forwardPayload: beginCell()
          .storeBit(true)
          .storeRef(beginCell().storeUint(0, 32).storeStringTail(`${profile.metadata.symbol} testnet rehearsal`).endCell())
          .endCell()
          .beginParse(),
      }),
    )
    .endCell();
  const burnBody = beginCell()
    .store(storeJettonBurn({ $$type: 'JettonBurn', queryId: 0n, amount, responseDestination: admin, customPayload: null }))
    .endCell();
  const transferValue = toNano('0.1');
  const burnValue = toNano('0.05');

  // Dry run on a local chain: launch, then send both messages as the admin.
  const blockchain = await Blockchain.create();
  const asAdmin = (to: Address, value: bigint, body: Cell, stateInit?: { code: Cell; data: Cell }) =>
    blockchain.sendMessage(internal({ from: admin, to, value, body, stateInit, bounce: true }));
  await asAdmin(master.address, DEFAULT_DEPLOY_VALUE, launchBody(), master.init);
  await asAdmin(adminWallet, transferValue, transferBody);
  await asAdmin(adminWallet, burnValue, burnBody);
  const after = await verifyDeployment((address) => blockchain.provider(address), {
    master: master.address,
    admin,
    profile,
    pinned,
    fresh: false,
  });
  if (!after.ok || after.totalSupply !== supply - amount) {
    throw new Error('The local dry run of the rehearsal did not burn exactly the expected amount, so no request was produced.');
  }

  const address = adminWallet.toString({ bounceable: true, testOnly: true });
  return {
    validUntil: Math.floor(Date.now() / 1000) + REQUEST_VALID_SECONDS,
    network: CHAIN_ID.testnet,
    from: admin.toRawString(),
    messages: [
      { address, amount: transferValue.toString(), payload: transferBody.toBoc().toString('base64') },
      { address, amount: burnValue.toString(), payload: burnBody.toBoc().toString('base64') },
    ],
  };
}

/**
 * The evidence required before a mainnet request is produced: the same
 * reviewed code is live and launched on testnet with the supply and the
 * metadata of token.json, and a real wallet has transferred and burned there
 * (the supply is below the genesis supply). A token.json edited after the
 * testnet launch fails this on purpose: it has not been rehearsed.
 */
export async function checkMainnetGate(
  provideTestnet: ProviderFactory,
  options: { testnetMaster: Address; profile: TokenProfile; pinned: CodeHashes },
): Promise<{ ok: boolean; checks: Check[] }> {
  const live = await verifyDeployment(provideTestnet, {
    master: options.testnetMaster,
    profile: options.profile,
    pinned: options.pinned,
    fresh: false,
    exactMetadata: true,
    minMasterBalance: 0n,
  });
  const checks = live.checks.map((check) =>
    check.name === 'The metadata is token.json' && check.status === 'fail'
      ? { ...check, detail: `${check.detail}. Launch the testnet token again from the current token.json and rehearse it` }
      : check,
  );
  if (live.launched && live.totalSupply !== undefined) {
    const rehearsed = live.totalSupply < supplyInUnits(options.profile);
    checks.push({
      name: 'A real wallet has burned tokens on testnet',
      status: rehearsed ? 'pass' : 'fail',
      detail: rehearsed
        ? 'the testnet supply is below the genesis supply'
        : 'the testnet supply is untouched: run the rehearsal on the testnet deploy page first',
    });
  }
  return { ok: live.launched && checks.every((c) => c.status !== 'fail'), checks };
}

/** Parses an address typed by a person and checks that it belongs to `network`. */
export function parseAddressFor(network: Network, input: string): Address {
  const text = input.trim();
  if (/^-?[0-9]+:[0-9a-fA-F]{64}$/.test(text)) {
    // Raw form carries no network flag. TON Connect reports connected wallets this way.
    return Address.parseRaw(text);
  }
  let parsed: ReturnType<typeof Address.parseFriendly>;
  try {
    parsed = Address.parseFriendly(text);
  } catch {
    throw new Error(`"${input}" is not a TON address.`);
  }
  if (network === 'testnet' && !parsed.isTestOnly) {
    throw new Error(`"${input}" is a mainnet-format address. On testnet, addresses start with kQ or 0Q.`);
  }
  if (network === 'mainnet' && parsed.isTestOnly) {
    throw new Error(`"${input}" is a testnet-format address. On mainnet, addresses start with EQ or UQ.`);
  }
  return parsed.address;
}
