import { beforeEach, describe, expect, it } from 'vitest';
import { Address, beginCell, Cell, type ContractABI, toNano } from '@ton/core';
import { JettonMaster } from '../build/LuminaraJetton_JettonMaster';
import { JettonWallet } from '../build/LuminaraJetton_JettonWallet';
import {
  advanceTime,
  breakContract,
  buildOnchainContent,
  burn,
  contractConstant,
  deployJetton,
  emptyPayload,
  ERR,
  expectNoMint,
  expectNoTx,
  expectTx,
  inboundBody,
  inboundValue,
  isActive,
  launch,
  type LocalJetton,
  type LocalNet,
  type LocalWallet,
  OP,
  sendAs,
  startLocalNet,
  TEST_SEED,
  tonBalance,
  toUnits,
  transfer,
  YEAR,
} from './harness';

const launchBody = (queryId = 0n) => beginCell().storeUint(OP.launch, 32).storeUint(queryId, 64).endCell();

describe('Launch and fixed supply', () => {
  let net: LocalNet;
  let jetton: LocalJetton;
  let admin: LocalWallet;
  let mallory: LocalWallet;

  beforeEach(async () => {
    net = await startLocalNet(TEST_SEED);
    jetton = await deployJetton(net);
    admin = net.wallets.treasury;
    mallory = net.wallets.mallory;
  });

  /** A fresh chain with the contract code on it and nothing launched. */
  async function shell(label: string, options: Parameters<typeof deployJetton>[1] = {}) {
    const fresh = await startLocalNet(`${TEST_SEED}/${label}`);
    const unlaunched = await deployJetton(fresh, { ...options, first: 'shell' });
    expectTx(unlaunched.deployment, { to: unlaunched.master.address, deploy: true, success: true });
    return { fresh, unlaunched };
  }

  async function expectNotLaunched(on: LocalNet, token: LocalJetton) {
    const data = await token.master.getGetJettonData();
    expect(data.totalSupply).toBe(0n);
    expect(data.mintable).toBe(true);
    expect(await isActive(on, (await token.wallet(token.admin)).address)).toBe(false);
  }

  it('deploys and launches in one message from the admin', async () => {
    const adminWallet = await jetton.wallet(admin.address);

    expectTx(jetton.deployment, { from: admin.address, to: jetton.master.address, op: OP.launch, deploy: true, success: true });
    expectTx(jetton.deployment, {
      from: jetton.master.address,
      to: adminWallet.address,
      op: OP.internalTransfer,
      value: contractConstant('GENESIS_TON'),
      deploy: true,
      success: true,
    });

    const data = await jetton.master.getGetJettonData();
    expect(data.totalSupply).toBe(jetton.supply);
    expect(data.mintable).toBe(false);
    expect(data.adminAddress.equals(admin.address)).toBe(true);
    expect(await jetton.master.getGetGenesisSupply()).toBe(jetton.supply);
    expect(await jetton.balanceOf(admin.address)).toBe(jetton.supply);
  });

  it('gives the admin wallet the address the master reports', async () => {
    const local = await jetton.wallet(admin.address);
    expect((await jetton.master.getGetWalletAddress(admin.address)).equals(local.address)).toBe(true);
    const data = await local.getGetWalletData();
    expect(data.owner.equals(admin.address)).toBe(true);
    expect(data.master.equals(jetton.master.address)).toBe(true);
  });

  it('tells the truth before launch: no supply yet, and one mint still to come', async () => {
    const { fresh, unlaunched } = await shell('truth');

    await expectNotLaunched(fresh, unlaunched);
    expect(await unlaunched.master.getGetGenesisSupply()).toBe(unlaunched.supply);
    expect((await unlaunched.master.getGetJettonData()).adminAddress.equals(unlaunched.admin)).toBe(true);
  });

  it('before launch accepts only the launch and plain Toncoin top-ups', async () => {
    const { fresh, unlaunched } = await shell('gated');
    const { treasury, alice } = fresh.wallets;
    const master = unlaunched.master;
    const value = toNano('0.05');
    const content = buildOnchainContent({ ...unlaunched.profile.metadata, description: 'Too early' });

    const early = [
      await master.send(treasury.getSender(), { value }, { $$type: 'ChangeAdmin', queryId: 0n, nextAdmin: alice.address }),
      await master.send(alice.getSender(), { value }, { $$type: 'ClaimAdmin', queryId: 0n }),
      await master.send(treasury.getSender(), { value }, { $$type: 'DropAdmin', queryId: 0n }),
      await master.send(treasury.getSender(), { value }, { $$type: 'UpdateContent', queryId: 0n, content }),
      await master.send(alice.getSender(), { value }, { $$type: 'ProvideWalletAddress', queryId: 0n, ownerAddress: alice.address, includeAddress: false }),
      await master.send(
        alice.getSender(),
        { value },
        { $$type: 'JettonBurnNotification', queryId: 0n, amount: 0n, sender: alice.address, responseDestination: null },
      ),
    ];
    for (const result of early) {
      expectTx(result, { to: master.address, success: false, exitCode: ERR.notLaunched });
    }

    const topUp = await alice.send({ to: master.address, value: toNano('0.5') });
    expectTx(topUp, { to: master.address, success: true, outMessagesCount: 0 });
    await expectNotLaunched(fresh, unlaunched);
    expect((await master.getGetJettonData()).jettonContent.equals(buildOnchainContent({ ...unlaunched.profile.metadata }))).toBe(true);
  });

  it('lets only the admin launch', async () => {
    const { fresh, unlaunched } = await shell('admin-only');

    for (const stranger of [fresh.wallets.mallory, fresh.wallets.deployer]) {
      const attempt = await launch(unlaunched, stranger);
      expectTx(attempt, { from: stranger.address, to: unlaunched.master.address, success: false, exitCode: ERR.notAdmin });
      expectNoMint(unlaunched, attempt);
    }
    await expectNotLaunched(fresh, unlaunched);

    const real = await launch(unlaunched, fresh.wallets.treasury);
    expectTx(real, { from: fresh.wallets.treasury.address, to: unlaunched.master.address, success: true });
    expect(await unlaunched.totalSupply()).toBe(unlaunched.supply);
    expect(await unlaunched.balanceOf(fresh.wallets.treasury.address)).toBe(unlaunched.supply);
    expect(await unlaunched.balanceOf(fresh.wallets.deployer.address)).toBe(0n);
  });

  it('launches only once', async () => {
    const again = await launch(jetton, admin);

    expectTx(again, { from: admin.address, to: jetton.master.address, success: false, exitCode: ERR.alreadyLaunched });
    expectNoMint(jetton, again);
    expect(await jetton.totalSupply()).toBe(jetton.supply);
    expect(await jetton.balanceOf(admin.address)).toBe(jetton.supply);
  });

  it('cannot be launched again after the whole supply has been burned', async () => {
    await burn(jetton, admin, { amount: jetton.supply });
    expect(await jetton.totalSupply()).toBe(0n);

    const again = await launch(jetton, admin);
    expectTx(again, { to: jetton.master.address, success: false, exitCode: ERR.alreadyLaunched });
    expectNoMint(jetton, again);
    expect(await jetton.totalSupply()).toBe(0n);
    expect(await jetton.balanceOf(admin.address)).toBe(0n);
    expect((await jetton.master.getGetJettonData()).mintable).toBe(false);
  });

  it('refuses to launch with less than 1 TON on the contract, and launches once it is funded', async () => {
    const minimum = contractConstant('MIN_TONS_FOR_LAUNCH');
    expect(minimum).toBe(toNano('1'));
    const fresh = await startLocalNet(`${TEST_SEED}/underfunded`);
    const attempt = await deployJetton(fresh, { value: minimum - 1n });

    expectTx(attempt.deployment, {
      from: fresh.wallets.treasury.address,
      to: attempt.master.address,
      success: false,
      exitCode: ERR.insufficientTon,
    });
    expectTx(attempt.deployment, { from: attempt.master.address, to: fresh.wallets.treasury.address, inMessageBounced: true });
    expectNoMint(attempt, attempt.deployment);
    await expectNotLaunched(fresh, attempt);

    // Anyone can fund the contract. Only the admin can then launch it.
    await fresh.wallets.alice.send({ to: attempt.master.address, value: minimum });
    const funded = await launch(attempt, fresh.wallets.treasury, toNano('0.05'));
    expectTx(funded, { to: attempt.master.address, op: OP.launch, success: true });
    expect(await attempt.totalSupply()).toBe(attempt.supply);
    expect(await attempt.balanceOf(fresh.wallets.treasury.address)).toBe(attempt.supply);
  });

  it('a launch that failed can be tried again with the same 1 TON, even once the address owes rent', async () => {
    const fresh = await startLocalNet(`${TEST_SEED}/retry`);
    const attempt = await deployJetton(fresh, { value: toNano('1') - 1n });
    expectTx(attempt.deployment, { to: attempt.master.address, success: false, exitCode: ERR.insufficientTon });

    // The failed attempt left the contract in place with nothing on it, so it runs up rent.
    expect(await tonBalance(fresh, attempt.master.address)).toBe(0n);
    advanceTime(fresh, YEAR);

    // The page sends the same request again: exactly 1 TON, bounceable.
    const retry = await launch(attempt, fresh.wallets.treasury, toNano('1'));

    expectTx(retry, { to: attempt.master.address, op: OP.launch, success: true });
    expectNoTx(retry, { inMessageBounced: true });
    expect(await attempt.totalSupply()).toBe(attempt.supply);
    expect(await attempt.balanceOf(fresh.wallets.treasury.address)).toBe(attempt.supply);
    expect((await attempt.master.getGetJettonData()).mintable).toBe(false);
  });

  it('sends the first wallet enough Toncoin even if rent rises to the reserve cap, and the admin gets the rest back', async () => {
    const carried = contractConstant('GENESIS_TON');
    expect(carried).toBe(toNano('0.05'));
    const adminWallet = await jetton.wallet(admin.address);
    expectTx(jetton.deployment, { from: jetton.master.address, to: adminWallet.address, op: OP.internalTransfer, value: carried, success: true });

    // What the first wallet used: its storage reserve and its fees. The rest went back to the admin.
    const reserve = await tonBalance(net, adminWallet.address);
    const returned = inboundValue(expectTx(jetton.deployment, { from: adminWallet.address, to: admin.address, op: OP.excesses }));
    const fees = carried - returned - reserve;
    expect(reserve).toBeGreaterThan(0n);
    expect(fees).toBeGreaterThan(0n);
    expect(returned).toBeGreaterThan(carried / 2n);

    // Enough for the largest reserve a wallet can ever keep, and for fees five times today's.
    expect(carried).toBeGreaterThanOrEqual(contractConstant('MAX_STORAGE_RESERVE') + 5n * fees);
  });

  it('keeps the launch deposit on the contract as storage rent', async () => {
    const adminWallet = await jetton.wallet(admin.address);

    // Only the first wallet returns change (what the genesis mint did not need). The master returns nothing.
    expectTx(jetton.deployment, { from: adminWallet.address, to: admin.address, op: OP.excesses });
    expectNoTx(jetton.deployment, { from: jetton.master.address, to: admin.address });
    expect(await tonBalance(net, jetton.master.address)).toBeGreaterThan(toNano('0.9'));
  });

  it('refuses a supply of zero', async () => {
    const fresh = await startLocalNet(`${TEST_SEED}/zero-supply`);
    const attempt = await deployJetton(fresh, { supply: 0n });

    expectTx(attempt.deployment, { to: attempt.master.address, success: false, exitCode: ERR.invalidSupply });
    expectNoMint(attempt, attempt.deployment);
    await expectNotLaunched(fresh, attempt);
  });

  it('accepts the largest supply a Jetton balance can hold', async () => {
    const fresh = await startLocalNet(`${TEST_SEED}/max-supply`);
    const largest = (1n << 120n) - 1n;
    const huge = await deployJetton(fresh, { supply: largest });

    expectTx(huge.deployment, { to: huge.master.address, op: OP.launch, success: true });
    expect(await huge.totalSupply()).toBe(largest);
    expect(await huge.balanceOf(fresh.wallets.treasury.address)).toBe(largest);
  });

  it('refuses an admin outside the basechain', async () => {
    const masterchainAdmin = Address.parseRaw(`-1:${'ab'.repeat(32)}`);
    const { fresh, unlaunched } = await shell('masterchain-admin', { adminAddress: masterchainAdmin });

    const attempt = await sendAs(fresh, masterchainAdmin, unlaunched.master.address, toNano('1'), launchBody());
    expectTx(attempt, { to: unlaunched.master.address, success: false, exitCode: ERR.notBasechain });
    expectNoMint(unlaunched, attempt);
    expect((await unlaunched.master.getGetJettonData()).mintable).toBe(true);
  });

  it('refuses to launch with metadata that is not on-chain TEP-64 with decimals', async () => {
    const profile = jetton.profile;
    const { decimals: _decimals, ...withoutDecimals } = profile.metadata;
    const bad: Record<string, Cell> = {
      'unknown tag': beginCell().storeUint(7, 8).endCell(),
      'off-chain link to a hosted file': beginCell().storeUint(1, 8).storeStringTail('https://example.com/lora.json').endCell(),
      'on-chain without decimals': buildOnchainContent(withoutDecimals),
      'empty cell': beginCell().endCell(),
    };

    for (const [name, content] of Object.entries(bad)) {
      const fresh = await startLocalNet(`${TEST_SEED}/bad-content/${name}`);
      const attempt = await deployJetton(fresh, { content });
      expectTx(attempt.deployment, { to: attempt.master.address, success: false, exitCode: ERR.invalidContent });
      expectNoMint(attempt, attempt.deployment);
      expect((await attempt.master.getGetJettonData()).mintable, name).toBe(true);
    }
  });

  it('reports a supply of zero if the first wallet rejects the genesis mint', async () => {
    // Only an emulator can put foreign code at the admin wallet's address.
    // It is done here to prove the accounting stays honest if genesis fails:
    // no tokens exist, so the master must not claim that any do.
    const { fresh, unlaunched } = await shell('genesis-bounce');
    const adminWallet = (await unlaunched.wallet(fresh.wallets.treasury.address)).address;
    await breakContract(fresh, adminWallet);

    const attempt = await launch(unlaunched, fresh.wallets.treasury);

    expectTx(attempt, { from: unlaunched.master.address, to: adminWallet, op: OP.internalTransfer, success: false });
    expectTx(attempt, { from: adminWallet, to: unlaunched.master.address, inMessageBounced: true, success: true });
    const data = await unlaunched.master.getGetJettonData();
    expect(data.totalSupply).toBe(0n);
    expect(data.mintable).toBe(false);

    // It stays launched: there is no second chance to mint.
    const again = await launch(unlaunched, fresh.wallets.treasury);
    expectTx(again, { to: unlaunched.master.address, success: false, exitCode: ERR.alreadyLaunched });
    expectNoMint(unlaunched, again);
  });

  it('has no mint after launch: every known mint message is rejected, even from the admin', async () => {
    const credit = beginCell()
      .storeUint(OP.internalTransfer, 32)
      .storeUint(0, 64)
      .storeCoins(toNano('1000'))
      .storeAddress(admin.address)
      .storeAddress(admin.address)
      .storeCoins(0)
      .storeBit(false)
      .endCell();

    const attempts: Record<string, Cell> = {
      'reference minter mint (op 21)': beginCell()
        .storeUint(21, 32)
        .storeUint(0, 64)
        .storeAddress(admin.address)
        .storeCoins(toNano('0.05'))
        .storeRef(credit)
        .endCell(),
      'stablecoin minter mint (op 0x642b7d07)': beginCell()
        .storeUint(0x642b7d07, 32)
        .storeUint(0, 64)
        .storeAddress(admin.address)
        .storeCoins(toNano('0.05'))
        .storeRef(credit)
        .endCell(),
      'LUMI v1 text command': beginCell().storeUint(0, 32).storeStringTail('MintInitialSupply').endCell(),
      'raw internal transfer sent to the master': credit,
    };

    for (const [name, body] of Object.entries(attempts)) {
      const result = await admin.send({ to: jetton.master.address, value: toNano('0.2'), body });
      expectTx(result, { to: jetton.master.address, success: false, exitCode: ERR.unknownMessage });
      expectNoMint(jetton, result);
      expect(await jetton.totalSupply(), name).toBe(jetton.supply);
      expect(await jetton.balanceOf(admin.address), name).toBe(jetton.supply);
    }
  });

  it('exposes exactly the expected message handlers and getters, and nothing else', () => {
    // A handler for external messages would show up here as "external:...".
    const handlers = (abi: ContractABI) =>
      (abi.receivers ?? [])
        .map((r) => `${r.receiver}:${r.message.kind === 'typed' ? r.message.type : r.message.kind}`)
        .sort();
    const getters = (abi: ContractABI) => (abi.getters ?? []).map((g) => g.name).sort();
    const master = JettonMaster.fromAddress(jetton.master.address).abi;
    const wallet = JettonWallet.fromAddress(jetton.master.address).abi;

    expect(handlers(master)).toEqual([
      'internal:ChangeAdmin',
      'internal:ClaimAdmin',
      'internal:DropAdmin',
      'internal:JettonBurnNotification',
      'internal:Launch',
      'internal:ProvideWalletAddress',
      'internal:UpdateContent',
      'internal:empty',
    ]);
    expect(getters(master)).toEqual(['get_genesis_supply', 'get_jetton_data', 'get_next_admin_address', 'get_wallet_address']);
    expect(handlers(wallet)).toEqual([
      'internal:JettonBurn',
      'internal:JettonTransfer',
      'internal:JettonTransferInternal',
      'internal:empty',
    ]);
    expect(getters(wallet)).toEqual(['get_wallet_data']);
  });

  it('accepts the launch as the raw bytes a wallet sends, and passes the query id on', async () => {
    const { fresh, unlaunched } = await shell('raw-launch');
    const { treasury } = fresh.wallets;

    const result = await treasury.send({ to: unlaunched.master.address, value: toNano('1'), body: launchBody(77n) });

    const mint = expectTx(result, { from: unlaunched.master.address, op: OP.internalTransfer, success: true });
    const body = inboundBody(mint).beginParse();
    body.skip(32);
    expect(body.loadUintBig(64)).toBe(77n);
    expect(body.loadCoins()).toBe(unlaunched.supply);
    expect(body.loadAddress().equals(unlaunched.master.address)).toBe(true);
    expect(body.loadAddress().equals(treasury.address)).toBe(true);
    expect(body.loadCoins()).toBe(0n);
  });

  it('accepts plain Toncoin top-ups without changing any token state', async () => {
    const before = await tonBalance(net, jetton.master.address);
    const dataBefore = await jetton.master.getGetJettonData();

    const topUp = await net.wallets.alice.send({ to: jetton.master.address, value: toNano('1') });

    expectTx(topUp, { to: jetton.master.address, success: true, outMessagesCount: 0 });
    expect(await tonBalance(net, jetton.master.address)).toBeGreaterThan(before + toNano('0.99'));
    const dataAfter = await jetton.master.getGetJettonData();
    expect(dataAfter.totalSupply).toBe(dataBefore.totalSupply);
    expect(dataAfter.adminAddress.equals(dataBefore.adminAddress)).toBe(true);
    expect(dataAfter.jettonContent.equals(dataBefore.jettonContent)).toBe(true);
  });

  it('bounces a Toncoin transfer that carries a comment, so it is not kept by mistake', async () => {
    const comment = beginCell().storeUint(0, 32).storeStringTail('for rent').endCell();
    const result = await net.wallets.alice.send({ to: jetton.master.address, value: toNano('1'), body: comment, bounce: true });

    expectTx(result, { to: jetton.master.address, success: false, exitCode: ERR.unknownMessage });
    expectTx(result, { from: jetton.master.address, to: net.wallets.alice.address, inMessageBounced: true });
  });

  it('only lets the master or a sibling wallet credit a wallet', async () => {
    const { alice } = net.wallets;
    await transfer(jetton, admin, { to: alice.address, amount: toUnits(jetton.profile, '10') });
    const aliceWallet = await jetton.wallet(alice.address);

    const forged = (claimedSender: Address) =>
      aliceWallet.send(
        mallory.getSender(),
        { value: toNano('0.1') },
        {
          $$type: 'JettonTransferInternal',
          queryId: 0n,
          amount: toUnits(jetton.profile, '1000000'),
          sender: claimedSender,
          responseDestination: mallory.address,
          forwardTonAmount: 0n,
          forwardPayload: emptyPayload(),
        },
      );

    for (const claimedSender of [mallory.address, admin.address, jetton.master.address]) {
      const result = await forged(claimedSender);
      expectTx(result, { from: mallory.address, to: aliceWallet.address, success: false, exitCode: ERR.notValidWallet });
    }
    expect(await jetton.balanceOf(alice.address)).toBe(toUnits(jetton.profile, '10'));
    expect(await jetton.totalSupply()).toBe(jetton.supply);
  });

  it('ignores tokens from a look-alike master', async () => {
    const { alice } = net.wallets;
    // Mallory deploys the same code with herself as admin. It lives at a different address.
    const fake = await deployJetton(net, { admin: mallory });
    expectTx(fake.deployment, { to: fake.master.address, op: OP.launch, deploy: true, success: true });
    expect(fake.master.address.equals(jetton.master.address)).toBe(false);

    await transfer(fake, mallory, { to: alice.address, amount: toUnits(fake.profile, '500') });

    // Alice now holds the fake token in a different wallet, and none of the real one.
    expect(await fake.balanceOf(alice.address)).toBe(toUnits(fake.profile, '500'));
    expect(await jetton.balanceOf(alice.address)).toBe(0n);

    // Even a message sent from the genuine fake wallet cannot credit the real wallet.
    await transfer(jetton, admin, { to: alice.address, amount: 1n });
    const realAliceWallet = await jetton.wallet(alice.address);
    const fakeMalloryWallet = await fake.wallet(mallory.address);
    const credit = beginCell()
      .storeUint(OP.internalTransfer, 32)
      .storeUint(0, 64)
      .storeCoins(toUnits(jetton.profile, '500'))
      .storeAddress(mallory.address)
      .storeAddress(mallory.address)
      .storeCoins(0)
      .storeBit(false)
      .endCell();
    const result = await sendAs(net, fakeMalloryWallet.address, realAliceWallet.address, toNano('0.1'), credit);

    expectTx(result, { to: realAliceWallet.address, success: false, exitCode: ERR.notValidWallet });
    expect(await jetton.balanceOf(alice.address)).toBe(1n);
    expect(await jetton.totalSupply()).toBe(jetton.supply);
  });
});
