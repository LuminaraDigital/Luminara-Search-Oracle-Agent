import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Address, Cell, loadStateInit, toNano } from '@ton/core';
import { Blockchain, internal } from '@ton/sandbox';
import {
  assertPinnedCode,
  CHAIN_ID,
  type Check,
  compiledCodeHashes,
  deploymentAddresses,
  loadPinnedCodeHashes,
  parseAddressFor,
  prepareDeployment,
  type ProviderFactory,
  type TonConnectRequest,
  verifyDeployment,
} from '../src/deployment';
import { loadDeployments, recordDeployment } from '../src/deployments';
import {
  breakContract,
  buildOnchainContent,
  burn,
  deployJetton,
  ERR,
  expectTx,
  type LocalJetton,
  type LocalNet,
  loadTokenProfile,
  OP,
  startLocalNet,
  TEST_SEED,
  toUnits,
  transfer,
  ZERO_ADDRESS,
} from './harness';

const profile = loadTokenProfile();
const failed = (checks: Check[]) => checks.filter((c) => c.status === 'fail').map((c) => c.name);
const warned = (checks: Check[]) => checks.filter((c) => c.status === 'warn').map((c) => c.name);

/** Does what a wallet does with a TON Connect request: sends each message from `from`. */
async function approve(blockchain: Blockchain, from: Address, request: TonConnectRequest) {
  const results = [];
  for (const message of request.messages) {
    results.push(
      await blockchain.sendMessage(
        internal({
          from,
          to: Address.parse(message.address),
          value: BigInt(message.amount),
          stateInit: message.stateInit ? loadStateInit(Cell.fromBase64(message.stateInit).beginParse()) : undefined,
          body: message.payload ? Cell.fromBase64(message.payload) : new Cell(),
          bounce: true,
        }),
      ),
    );
  }
  return results;
}

describe('Pinned contract code', () => {
  // These fail on any change to the contracts at all, so the mutation check leaves them out.
  it.skipIf(process.env.JETTON_MUTATION_RUN)('the compiled contracts are exactly the reviewed ones in code-hashes.json', () => {
    expect(compiledCodeHashes()).toEqual(loadPinnedCodeHashes());
    expect(() => assertPinnedCode()).not.toThrow();
  });

  it('the compiler version is pinned exactly, so the build is reproducible', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies['@tact-lang/compiler']).toBe(loadPinnedCodeHashes().compiler);
  });

  it.skipIf(process.env.JETTON_MUTATION_RUN)('the master hands out exactly the pinned wallet code', async () => {
    const net = await startLocalNet(TEST_SEED);
    const jetton = await deployJetton(net);
    const { jettonWalletCode } = await jetton.master.getGetJettonData();
    expect(jettonWalletCode.hash().toString('hex')).toBe(loadPinnedCodeHashes().wallet);
  });
});

describe.skipIf(process.env.JETTON_MUTATION_RUN)('Verifying a deployed Jetton', () => {
  let net: LocalNet;
  let jetton: LocalJetton;
  let provide: ProviderFactory;
  const pinned = loadPinnedCodeHashes();
  const verify = (options: Partial<Parameters<typeof verifyDeployment>[1]> = {}) =>
    verifyDeployment(provide, { master: jetton.master.address, admin: jetton.admin, profile, pinned, fresh: true, ...options });

  beforeEach(async () => {
    net = await startLocalNet(TEST_SEED);
    jetton = await deployJetton(net);
    provide = (address) => net.blockchain.provider(address);
  });

  it('passes every check on a freshly launched token', async () => {
    const result = await verify();

    expect(result.ok).toBe(true);
    expect(result.launched).toBe(true);
    expect(result.checks.map((c) => c.status)).toEqual(result.checks.map(() => 'pass'));
    expect(result.checks.map((c) => c.name)).toEqual([
      'The token contract exists',
      'The token contract runs the reviewed code',
      'The token has been launched and minting is closed',
      'The genesis supply is the supply in token.json',
      'The whole supply exists',
      'Holders run the reviewed wallet code',
      'The metadata is token.json',
      'The admin is the expected address',
      'The admin wallet exists and runs the reviewed code',
      'The admin holds the whole supply',
      'The token contract is funded for storage rent',
    ]);
    expect(result.totalSupply).toBe(jetton.supply);
    expect(result.admin?.equals(jetton.admin)).toBe(true);
  });

  it('fails when there is no contract at the address', async () => {
    const result = await verify({ master: Address.parseRaw(`0:${'77'.repeat(32)}`) });

    expect(result.ok).toBe(false);
    expect(result.launched).toBe(false);
    expect(failed(result.checks)).toEqual(['The token contract exists']);
  });

  it('fails when the address holds different code', async () => {
    await breakContract(net, jetton.master.address);
    const result = await verify();

    expect(result.ok).toBe(false);
    expect(failed(result.checks)).toEqual(['The token contract runs the reviewed code']);
  });

  it('fails a contract that is deployed but not launched', async () => {
    const fresh = await startLocalNet(`${TEST_SEED}/shell`);
    const shell = await deployJetton(fresh, { first: 'shell' });

    for (const isFresh of [true, false]) {
      const result = await verifyDeployment((address) => fresh.blockchain.provider(address), {
        master: shell.master.address,
        admin: shell.admin,
        profile,
        pinned,
        fresh: isFresh,
      });
      expect(result.ok).toBe(false);
      expect(result.launched).toBe(false);
      expect(failed(result.checks)).toEqual(['The token has been launched and minting is closed']);
    }
  });

  it('fails a token launched with a different supply than token.json', async () => {
    const fresh = await startLocalNet(`${TEST_SEED}/other-supply`);
    const other = await deployJetton(fresh, { supply: toUnits(profile, '1000000') });
    const result = await verifyDeployment((address) => fresh.blockchain.provider(address), {
      master: other.master.address,
      admin: other.admin,
      profile,
      pinned,
      fresh: true,
    });

    expect(result.ok).toBe(false);
    expect(failed(result.checks)).toContain('The genesis supply is the supply in token.json');
  });

  it('fails a fresh check when the token was launched for someone else', async () => {
    const result = await verify({ admin: net.wallets.mallory.address });

    expect(result.ok).toBe(false);
    expect(failed(result.checks)).toContain('The admin is the expected address');
    expect(failed(result.checks)).toContain('The admin wallet exists and runs the reviewed code');
  });

  it('fails a fresh check once tokens have moved, and passes the same token as a live one', async () => {
    await transfer(jetton, net.wallets.treasury, { to: net.wallets.alice.address, amount: toUnits(profile, '10') });
    await burn(jetton, net.wallets.alice, { amount: toUnits(profile, '4') });

    const asFresh = await verify();
    expect(asFresh.ok).toBe(false);
    expect(failed(asFresh.checks)).toEqual(['The whole supply exists', 'The admin holds the whole supply']);

    const asLive = await verify({ fresh: false });
    expect(asLive.ok).toBe(true);
    expect(asLive.totalSupply).toBe(jetton.supply - toUnits(profile, '4'));
    expect(asLive.checks.find((c) => c.name === 'The supply never exceeds the genesis supply')?.detail).toContain('4 burned since launch');
  });

  it('flags changed metadata: fatal when fresh, a warning on a live token', async () => {
    await jetton.master.send(
      net.wallets.treasury.getSender(),
      { value: toNano('0.05') },
      { $$type: 'UpdateContent', queryId: 0n, content: buildOnchainContent({ ...profile.metadata, name: 'Something Else' }) },
    );

    const asFresh = await verify();
    expect(failed(asFresh.checks)).toEqual(['The metadata is token.json']);

    const asLive = await verify({ fresh: false });
    expect(asLive.ok).toBe(true);
    expect(warned(asLive.checks)).toEqual(['The metadata is token.json']);
  });

  it('reports a dropped admin on a live token', async () => {
    await jetton.master.send(net.wallets.treasury.getSender(), { value: toNano('0.05') }, { $$type: 'DropAdmin', queryId: 0n });

    const result = await verify({ fresh: false, admin: undefined });
    expect(result.ok).toBe(true);
    expect(result.admin?.equals(ZERO_ADDRESS)).toBe(true);
    expect(result.checks.find((c) => c.name === 'The admin role')?.detail).toMatch(/dropped forever/);
  });

  it('warns when the token contract is short of storage rent', async () => {
    const result = await verify({ minMasterBalance: toNano('2') });

    expect(result.ok).toBe(true);
    expect(warned(result.checks)).toEqual(['The token contract is funded for storage rent']);
  });

  it('refuses a fresh check without the admin it was launched for', async () => {
    await expect(verify({ admin: undefined })).rejects.toThrow(/admin address/);
  });
});

describe.skipIf(process.env.JETTON_MUTATION_RUN)('Preparing a deployment', () => {
  const admin = Address.parseRaw(`0:${'5a'.repeat(32)}`);
  const stranger = Address.parseRaw(`0:${'6b'.repeat(32)}`);

  it('produces one message that deploys the reviewed code and launches it for the admin', async () => {
    const prepared = await prepareDeployment({ network: 'testnet', admin, profile });

    expect(prepared.dryRun.map((c) => c.status)).toEqual(prepared.dryRun.map(() => 'pass'));
    expect(prepared.request.network).toBe(CHAIN_ID.testnet);
    expect(prepared.request.from).toBe(admin.toRawString());
    expect(prepared.request.messages).toHaveLength(1);
    const [message] = prepared.request.messages;
    expect(message.amount).toBe(toNano('1').toString());
    // TON Connect requires the user-friendly address form. Bounceable, so a failed launch refunds.
    expect(Address.parseFriendly(message.address)).toMatchObject({ isBounceable: true, isTestOnly: true });
    expect(Address.parse(message.address).equals(prepared.master)).toBe(true);
    expect(loadStateInit(Cell.fromBase64(message.stateInit ?? '').beginParse()).code?.hash().toString('hex')).toBe(prepared.codeHashes.master);
    const body = Cell.fromBase64(message.payload ?? '').beginParse();
    expect(body.loadUint(32)).toBe(OP.launch);
    expect(prepared.request.validUntil - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300);

    // Replay the request the way the admin's wallet would, on a separate chain.
    const blockchain = await Blockchain.create();
    await approve(blockchain, admin, prepared.request);
    const onChain = await verifyDeployment((address) => blockchain.provider(address), {
      master: prepared.master,
      admin,
      profile,
      pinned: prepared.codeHashes,
      fresh: true,
    });
    expect(onChain.ok).toBe(true);
    expect(warned(onChain.checks)).toEqual([]);
    expect(await blockchain.provider(prepared.adminWallet).getState()).toMatchObject({ state: { type: 'active' } });
  });

  it('is useless to anyone but the admin: sent from another wallet it launches nothing', async () => {
    const prepared = await prepareDeployment({ network: 'testnet', admin, profile });
    const blockchain = await Blockchain.create();

    const [result] = await approve(blockchain, stranger, prepared.request);

    expectTx(result, { from: stranger, to: prepared.master, success: false, exitCode: ERR.notAdmin });
    const onChain = await verifyDeployment((address) => blockchain.provider(address), {
      master: prepared.master,
      admin,
      profile,
      pinned: prepared.codeHashes,
      fresh: true,
    });
    expect(onChain.launched).toBe(false);
    expect(await blockchain.provider(prepared.adminWallet).getState()).toMatchObject({ state: { type: 'uninit' } });
  });

  it('marks a mainnet request so that a testnet wallet refuses it, and the other way round', async () => {
    const testnet = await prepareDeployment({ network: 'testnet', admin, profile });
    const mainnet = await prepareDeployment({ network: 'mainnet', admin, profile });

    expect(testnet.request.network).toBe('-3');
    expect(mainnet.request.network).toBe('-239');
    expect(Address.parseFriendly(mainnet.request.messages[0].address).isTestOnly).toBe(false);
    // The contract address itself does not depend on the network.
    expect(mainnet.master.equals(testnet.master)).toBe(true);
  });

  it('gives every admin a different token address, and the same admin always the same one', async () => {
    const first = await deploymentAddresses(admin, profile);
    const again = await deploymentAddresses(admin, profile);
    const other = await deploymentAddresses(stranger, profile);
    const prepared = await prepareDeployment({ network: 'testnet', admin, profile });

    expect(again.master.equals(first.master)).toBe(true);
    expect(prepared.master.equals(first.master)).toBe(true);
    expect(prepared.adminWallet.equals(first.adminWallet)).toBe(true);
    expect(other.master.equals(first.master)).toBe(false);
  });

  it('refuses an admin nobody can use, and an amount outside 1 to 5 TON', async () => {
    await expect(prepareDeployment({ network: 'testnet', admin: ZERO_ADDRESS, profile })).rejects.toThrow(/zero address/);
    await expect(
      prepareDeployment({ network: 'testnet', admin: Address.parseRaw(`-1:${'5a'.repeat(32)}`), profile }),
    ).rejects.toThrow(/basechain/);
    await expect(prepareDeployment({ network: 'testnet', admin, profile, value: toNano('1') - 1n })).rejects.toThrow(/at least 1 TON/);
    await expect(prepareDeployment({ network: 'testnet', admin, profile, value: toNano('5') + 1n })).rejects.toThrow(/more than 5 TON/);
    await expect(prepareDeployment({ network: 'testnet', admin, profile, value: toNano('5') })).resolves.toBeTruthy();
  });

  it('refuses a profile whose deployment would not verify', async () => {
    await expect(prepareDeployment({ network: 'testnet', admin, profile: { ...profile, supply: '0' } })).rejects.toThrow(
      /dry run of this deployment failed/,
    );
  });
});

describe('The deployments record', () => {
  const record = (master: string) => ({
    master,
    admin: 'kQBaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWuBg',
    verifiedAt: '2026-10-07T00:00:00.000Z',
    codeHashes: loadPinnedCodeHashes(),
  });
  const emptyFile = () => {
    const file = join(mkdtempSync(join(tmpdir(), 'jetton-deployments-')), 'deployments.json');
    writeFileSync(file, JSON.stringify({ testnet: null, mainnet: null }));
    return file;
  };

  it.skipIf(process.env.JETTON_MUTATION_RUN)('only ever records the pinned code, at an address in the format of its network', () => {
    // Once a token is live its code can never change. If the contracts in this
    // repository are edited after a deployment was recorded, this fails.
    const pinned = loadPinnedCodeHashes();
    for (const network of ['testnet', 'mainnet'] as const) {
      const recorded = loadDeployments()[network];
      if (!recorded) continue;
      expect(recorded.codeHashes, `${network} record`).toEqual(pinned);
      expect(() => parseAddressFor(network, recorded.master)).not.toThrow();
      expect(() => parseAddressFor(network, recorded.admin)).not.toThrow();
    }
  });

  it('records a verified deployment once and keeps the networks apart', () => {
    const file = emptyFile();

    expect(recordDeployment('testnet', record('kQTestnetMaster'), file)).toBe('recorded');
    expect(recordDeployment('testnet', record('kQTestnetMaster'), file)).toBe('unchanged');
    expect(loadDeployments(file)).toMatchObject({ testnet: { master: 'kQTestnetMaster' }, mainnet: null });
  });

  it('never replaces a recorded token address by itself', () => {
    const file = emptyFile();
    recordDeployment('mainnet', record('EQFirst'), file);

    expect(() => recordDeployment('mainnet', record('EQSecond'), file)).toThrow(/already records a different mainnet token/);
    expect(loadDeployments(file).mainnet?.master).toBe('EQFirst');
  });
});

describe('Addresses typed by a person', () => {
  const address = Address.parseRaw(`0:${'5a'.repeat(32)}`);

  it('accepts only the address format of the network in use', () => {
    const testnet = address.toString({ testOnly: true });
    const mainnet = address.toString({ testOnly: false });

    expect(parseAddressFor('testnet', testnet).equals(address)).toBe(true);
    expect(parseAddressFor('mainnet', mainnet).equals(address)).toBe(true);
    expect(() => parseAddressFor('testnet', mainnet)).toThrow(/mainnet-format/);
    expect(() => parseAddressFor('mainnet', testnet)).toThrow(/testnet-format/);
    expect(() => parseAddressFor('testnet', 'not an address')).toThrow(/not a TON address/);
  });

  it('accepts the raw form that wallets report over TON Connect', () => {
    expect(parseAddressFor('mainnet', address.toRawString()).equals(address)).toBe(true);
    expect(parseAddressFor('testnet', ` ${address.toRawString()} `).equals(address)).toBe(true);
  });
});
