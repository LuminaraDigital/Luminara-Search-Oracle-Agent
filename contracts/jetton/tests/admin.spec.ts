import { beforeEach, describe, expect, it } from 'vitest';
import { beginCell, type Cell, toNano } from '@ton/core';
import {
  buildOnchainContent,
  deployJetton,
  emptyPayload,
  ERR,
  expectConservation,
  expectNoMint,
  expectTx,
  type LocalJetton,
  type LocalNet,
  type LocalWallet,
  OP,
  parseOnchainContent,
  startLocalNet,
  TEST_SEED,
  tonBalance,
  toUnits,
  transfer,
  ZERO_ADDRESS,
} from './harness';

describe('Administrator permissions', () => {
  let net: LocalNet;
  let jetton: LocalJetton;
  let admin: LocalWallet;
  let deployer: LocalWallet;
  let alice: LocalWallet;
  let bob: LocalWallet;
  let mallory: LocalWallet;
  const tokens = (amount: string) => toUnits(jetton.profile, amount);

  const value = toNano('0.05');
  const changeAdmin = (from: LocalWallet, nextAdmin: LocalWallet | null) =>
    jetton.master.send(from.getSender(), { value }, { $$type: 'ChangeAdmin', queryId: 0n, nextAdmin: nextAdmin?.address ?? null });
  const claimAdmin = (from: LocalWallet) =>
    jetton.master.send(from.getSender(), { value }, { $$type: 'ClaimAdmin', queryId: 0n });
  const dropAdmin = (from: LocalWallet) =>
    jetton.master.send(from.getSender(), { value }, { $$type: 'DropAdmin', queryId: 0n });
  const setContent = (from: LocalWallet, content: Cell) =>
    jetton.master.send(from.getSender(), { value }, { $$type: 'UpdateContent', queryId: 0n, content });
  const updateContent = (from: LocalWallet, description: string) =>
    setContent(from, buildOnchainContent({ ...jetton.profile.metadata, description }));

  const currentAdmin = async () => (await jetton.master.getGetJettonData()).adminAddress;
  const metadata = async () => parseOnchainContent((await jetton.master.getGetJettonData()).jettonContent).fields;
  const accepted = (result: Awaited<ReturnType<typeof dropAdmin>>, from: LocalWallet) =>
    expectTx(result, { from: from.address, to: jetton.master.address, success: true, exitCode: 0 });
  const rejected = (result: Awaited<ReturnType<typeof dropAdmin>>, from: LocalWallet, exitCode: number) =>
    expectTx(result, { from: from.address, to: jetton.master.address, success: false, exitCode });

  beforeEach(async () => {
    net = await startLocalNet(TEST_SEED);
    jetton = await deployJetton(net);
    ({ treasury: admin, deployer, alice, bob, mallory } = net.wallets);
  });

  it('starts with the admin that launched the token and no pending handover', async () => {
    expect((await currentAdmin()).equals(admin.address)).toBe(true);
    expect(await jetton.master.getGetNextAdminAddress()).toBeNull();
  });

  it('rejects every admin message from anyone who is not the admin', async () => {
    for (const stranger of [mallory, alice, deployer]) {
      rejected(await changeAdmin(stranger, stranger), stranger, ERR.notAdmin);
      rejected(await dropAdmin(stranger), stranger, ERR.notAdmin);
      rejected(await updateContent(stranger, 'Hijacked'), stranger, ERR.notAdmin);
      rejected(await claimAdmin(stranger), stranger, ERR.notNextAdmin);
    }

    expect((await currentAdmin()).equals(admin.address)).toBe(true);
    expect(await jetton.master.getGetNextAdminAddress()).toBeNull();
    expect(await metadata()).toEqual(jetton.profile.metadata);
  });

  it('hands the role over in two steps', async () => {
    accepted(await changeAdmin(admin, bob), admin);

    // Proposing changes nothing yet: a typo in the new address cannot lock the role away.
    expect((await currentAdmin()).equals(admin.address)).toBe(true);
    expect((await jetton.master.getGetNextAdminAddress())?.equals(bob.address)).toBe(true);

    accepted(await claimAdmin(bob), bob);
    expect((await currentAdmin()).equals(bob.address)).toBe(true);
    expect(await jetton.master.getGetNextAdminAddress()).toBeNull();

    // The previous admin is now a stranger.
    rejected(await updateContent(admin, 'Old admin'), admin, ERR.notAdmin);
    rejected(await dropAdmin(admin), admin, ERR.notAdmin);
    accepted(await updateContent(bob, 'New admin'), bob);
    expect((await metadata()).description).toBe('New admin');
  });

  it('lets only the proposed address claim the role', async () => {
    rejected(await claimAdmin(mallory), mallory, ERR.notNextAdmin);

    await changeAdmin(admin, bob);
    rejected(await claimAdmin(mallory), mallory, ERR.notNextAdmin);
    rejected(await claimAdmin(admin), admin, ERR.notNextAdmin);

    expect((await currentAdmin()).equals(admin.address)).toBe(true);
    expect((await jetton.master.getGetNextAdminAddress())?.equals(bob.address)).toBe(true);
  });

  it('lets the admin cancel a pending handover', async () => {
    await changeAdmin(admin, bob);
    accepted(await changeAdmin(admin, null), admin);

    expect(await jetton.master.getGetNextAdminAddress()).toBeNull();
    rejected(await claimAdmin(bob), bob, ERR.notNextAdmin);
    expect((await currentAdmin()).equals(admin.address)).toBe(true);
  });

  it('lets the admin replace the name, symbol, description and image', async () => {
    const changed = {
      ...jetton.profile.metadata,
      name: 'Luminara Oracle',
      symbol: 'LORAX',
      description: 'Updated description',
      image: 'https://luminarasuite.com/icon-180.png',
    };

    accepted(await setContent(admin, buildOnchainContent(changed)), admin);

    expect(await metadata()).toEqual(changed);
  });

  it('never lets the decimals change, because wallets would show every balance wrongly', async () => {
    const result = await setContent(admin, buildOnchainContent({ ...jetton.profile.metadata, decimals: '6' }));

    rejected(result, admin, ERR.decimalsAreFixed);
    expect((await metadata()).decimals).toBe(jetton.profile.metadata.decimals);
  });

  it('never lets the metadata leave the chain or lose its decimals', async () => {
    const { decimals: _decimals, ...withoutDecimals } = jetton.profile.metadata;
    const invalid: Record<string, Cell> = {
      'a link to a hosted file': beginCell().storeUint(1, 8).storeStringTail('https://example.com/lora.json').endCell(),
      'no decimals field': buildOnchainContent(withoutDecimals),
      'an unknown format': beginCell().storeUint(7, 8).endCell(),
      'an empty cell': beginCell().endCell(),
    };
    for (const content of Object.values(invalid)) {
      rejected(await setContent(admin, content), admin, ERR.invalidContent);
    }

    // The on-chain tag followed by something that is not a dictionary.
    const garbage = await setContent(admin, beginCell().storeUint(0, 8).storeUint(0xffffffff, 32).endCell());
    expectTx(garbage, { from: admin.address, to: jetton.master.address, success: false });

    expect(await metadata()).toEqual(jetton.profile.metadata);
  });

  it('drops the role forever', async () => {
    accepted(await dropAdmin(admin), admin);

    expect((await currentAdmin()).equals(ZERO_ADDRESS)).toBe(true);
    for (const anyone of [admin, bob, mallory]) {
      rejected(await changeAdmin(anyone, anyone), anyone, ERR.notAdmin);
      rejected(await dropAdmin(anyone), anyone, ERR.notAdmin);
      rejected(await updateContent(anyone, 'After drop'), anyone, ERR.notAdmin);
      rejected(await claimAdmin(anyone), anyone, ERR.notNextAdmin);
    }
    expect((await currentAdmin()).equals(ZERO_ADDRESS)).toBe(true);
    expect(await metadata()).toEqual(jetton.profile.metadata);
  });

  it('cancels a pending handover when the role is dropped', async () => {
    await changeAdmin(admin, bob);
    accepted(await dropAdmin(admin), admin);

    expect(await jetton.master.getGetNextAdminAddress()).toBeNull();
    rejected(await claimAdmin(bob), bob, ERR.notNextAdmin);
    expect((await currentAdmin()).equals(ZERO_ADDRESS)).toBe(true);
  });

  it('leaves tokens working normally after the role is dropped', async () => {
    accepted(await dropAdmin(admin), admin);
    expect((await currentAdmin()).equals(ZERO_ADDRESS)).toBe(true);

    await transfer(jetton, admin, { to: alice.address, amount: tokens('7') });

    expect(await jetton.balanceOf(alice.address)).toBe(tokens('7'));
    expect(await jetton.totalSupply()).toBe(jetton.supply);
  });

  it('no admin message creates, moves or destroys a single token', async () => {
    await transfer(jetton, admin, { to: alice.address, amount: tokens('50') });
    const holders = [admin.address, alice.address, bob.address, mallory.address];

    const steps = [
      await updateContent(admin, 'Step one'),
      await changeAdmin(admin, bob),
      await changeAdmin(admin, null),
      await changeAdmin(admin, bob),
      await claimAdmin(bob),
      await updateContent(bob, 'Step two'),
      await changeAdmin(bob, mallory),
      await claimAdmin(mallory),
      await dropAdmin(mallory),
    ];
    for (const result of steps) {
      expectTx(result, { to: jetton.master.address, success: true });
      expectNoMint(jetton, result);
    }

    await expectConservation(jetton, holders, 0n);
    expect(await jetton.balanceOf(alice.address)).toBe(tokens('50'));
    expect(await jetton.balanceOf(bob.address)).toBe(0n);
    expect(await jetton.balanceOf(mallory.address)).toBe(0n);
  });

  it('gives the admin no power over the supply or over other holders', async () => {
    await transfer(jetton, admin, { to: alice.address, amount: tokens('50') });
    const aliceWallet = await jetton.wallet(alice.address);
    const adminBalance = await jetton.balanceOf(admin.address);

    // Take Alice's tokens.
    const take = await aliceWallet.send(
      admin.getSender(),
      { value: toNano('0.1') },
      {
        $$type: 'JettonTransfer',
        queryId: 0n,
        amount: tokens('50'),
        destination: admin.address,
        responseDestination: admin.address,
        customPayload: null,
        forwardTonAmount: 0n,
        forwardPayload: emptyPayload(),
      },
    );
    expectTx(take, { from: admin.address, to: aliceWallet.address, success: false, exitCode: ERR.notOwner });

    // Burn Alice's tokens.
    const burnHers = await aliceWallet.send(
      admin.getSender(),
      { value: toNano('0.1') },
      { $$type: 'JettonBurn', queryId: 0n, amount: tokens('50'), responseDestination: admin.address, customPayload: null },
    );
    expectTx(burnHers, { from: admin.address, to: aliceWallet.address, success: false, exitCode: ERR.notOwner });

    // Credit the admin's own wallet out of thin air.
    const adminWallet = await jetton.wallet(admin.address);
    const credit = await adminWallet.send(
      admin.getSender(),
      { value: toNano('0.1') },
      {
        $$type: 'JettonTransferInternal',
        queryId: 0n,
        amount: tokens('1000000'),
        sender: admin.address,
        responseDestination: admin.address,
        forwardTonAmount: 0n,
        forwardPayload: emptyPayload(),
      },
    );
    expectTx(credit, { from: admin.address, to: adminWallet.address, success: false, exitCode: ERR.notValidWallet });

    // Write the supply down without burning anything.
    const fakeBurn = await jetton.master.send(
      admin.getSender(),
      { value: toNano('0.1') },
      { $$type: 'JettonBurnNotification', queryId: 0n, amount: tokens('1000'), sender: alice.address, responseDestination: null },
    );
    expectTx(fakeBurn, { from: admin.address, to: jetton.master.address, success: false, exitCode: ERR.notValidWallet });

    expect(await jetton.balanceOf(alice.address)).toBe(tokens('50'));
    expect(await jetton.balanceOf(admin.address)).toBe(adminBalance);
    expect(await jetton.totalSupply()).toBe(jetton.supply);
  });

  it('returns what the admin attached and never the Toncoin the master holds', async () => {
    const before = await tonBalance(net, jetton.master.address);

    // Each accepted admin message sends the unused Toncoin back with an empty message.
    const steps: [Awaited<ReturnType<typeof dropAdmin>>, LocalWallet][] = [
      [await updateContent(admin, 'One'), admin],
      [await changeAdmin(admin, bob), admin],
      [await claimAdmin(bob), bob],
      [await dropAdmin(bob), bob],
    ];
    for (const [result, sender] of steps) {
      accepted(result, sender);
      const change = expectTx(result, { from: jetton.master.address, to: sender.address, success: true, inMessageBounced: false });
      const returned = change.inMessage?.info.type === 'internal' ? change.inMessage.info.value.coins : 0n;
      expect(returned).toBeGreaterThan(0n);
      expect(returned).toBeLessThan(value);
      expect(await tonBalance(net, jetton.master.address)).toBe(before);
    }
  });

  it('accepts the admin messages as the raw bytes of their documented layout', async () => {
    const send = (from: LocalWallet, body: Cell) => from.send({ to: jetton.master.address, value, body });

    // change_admin#6501f354 query_id:uint64 new_admin:MsgAddress
    await send(admin, beginCell().storeUint(OP.changeAdmin, 32).storeUint(1, 64).storeAddress(bob.address).endCell());
    expect((await jetton.master.getGetNextAdminAddress())?.equals(bob.address)).toBe(true);

    // claim_admin#fb88e119 query_id:uint64
    await send(bob, beginCell().storeUint(OP.claimAdmin, 32).storeUint(2, 64).endCell());
    expect((await currentAdmin()).equals(bob.address)).toBe(true);

    // update_content#00000004 query_id:uint64 content:^Cell
    const content = buildOnchainContent({ ...jetton.profile.metadata, description: 'Raw' });
    await send(bob, beginCell().storeUint(OP.updateContent, 32).storeUint(3, 64).storeRef(content).endCell());
    expect((await metadata()).description).toBe('Raw');

    // drop_admin#7431f221 query_id:uint64
    await send(bob, beginCell().storeUint(OP.dropAdmin, 32).storeUint(4, 64).endCell());
    expect((await currentAdmin()).equals(ZERO_ADDRESS)).toBe(true);
  });
});
