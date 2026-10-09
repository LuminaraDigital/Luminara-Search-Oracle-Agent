import { beforeEach, describe, expect, it } from 'vitest';
import { beginCell, toNano } from '@ton/core';
import {
  breakContract,
  burn,
  deployJetton,
  ERR,
  expectTx,
  inboundBody,
  type LocalJetton,
  type LocalNet,
  type LocalWallet,
  OP,
  startLocalNet,
  TEST_SEED,
  toUnits,
  transfer,
} from './harness';

describe('Burns (TEP-74)', () => {
  let net: LocalNet;
  let jetton: LocalJetton;
  let treasury: LocalWallet;
  let alice: LocalWallet;
  let mallory: LocalWallet;
  const tokens = (amount: string) => toUnits(jetton.profile, amount);

  beforeEach(async () => {
    net = await startLocalNet(TEST_SEED);
    jetton = await deployJetton(net);
    ({ treasury, alice, mallory } = net.wallets);
    await transfer(jetton, treasury, { to: alice.address, amount: tokens('100') });
  });

  it('destroys the tokens and lowers the total supply by the same amount', async () => {
    const result = await burn(jetton, alice, { amount: tokens('15') });

    const aliceWallet = await jetton.wallet(alice.address);
    expectTx(result, { from: alice.address, to: aliceWallet.address, op: OP.burn, success: true });
    expectTx(result, { from: aliceWallet.address, to: jetton.master.address, op: OP.burnNotification, success: true });
    expectTx(result, { from: jetton.master.address, to: alice.address, op: OP.excesses, success: true });

    expect(await jetton.balanceOf(alice.address)).toBe(tokens('85'));
    expect(await jetton.totalSupply()).toBe(jetton.supply - tokens('15'));
    expect(await jetton.balanceOf(treasury.address)).toBe(jetton.supply - tokens('100'));
  });

  it('reports the burn to the master with the amount, the holder and the query id', async () => {
    const result = await burn(jetton, alice, { amount: tokens('15'), queryId: 0xabcdef0123n, response: net.wallets.bob.address });

    // burn_notification#7bdd97de query_id:uint64 amount:Coins sender:MsgAddress response_destination:MsgAddress
    const notification = inboundBody(expectTx(result, { to: jetton.master.address, op: OP.burnNotification })).beginParse();
    expect(notification.loadUint(32)).toBe(OP.burnNotification);
    expect(notification.loadUintBig(64)).toBe(0xabcdef0123n);
    expect(notification.loadCoins()).toBe(tokens('15'));
    expect(notification.loadAddress().equals(alice.address)).toBe(true);
    expect(notification.loadAddress().equals(net.wallets.bob.address)).toBe(true);
    expect(notification.remainingBits).toBe(0);

    const excess = inboundBody(expectTx(result, { from: jetton.master.address, to: net.wallets.bob.address, op: OP.excesses })).beginParse();
    excess.skip(32);
    expect(excess.loadUintBig(64)).toBe(0xabcdef0123n);
    expect(excess.remainingBits).toBe(0);
  });

  it('accepts a burn without the optional custom payload field, as some wallet libraries send it', async () => {
    const aliceWallet = await jetton.wallet(alice.address);
    const body = beginCell()
      .storeUint(OP.burn, 32)
      .storeUint(0, 64)
      .storeCoins(tokens('2'))
      .storeAddress(alice.address)
      .endCell();

    const result = await alice.send({ to: aliceWallet.address, value: toNano('0.1'), body });

    expectTx(result, { from: alice.address, to: aliceWallet.address, op: OP.burn, success: true });
    expect(await jetton.balanceOf(alice.address)).toBe(tokens('98'));
    expect(await jetton.totalSupply()).toBe(jetton.supply - tokens('2'));
  });

  it('lets a holder burn everything they hold', async () => {
    await burn(jetton, alice, { amount: tokens('100') });

    expect(await jetton.balanceOf(alice.address)).toBe(0n);
    expect(await jetton.totalSupply()).toBe(jetton.supply - tokens('100'));
  });

  it('rejects a burn from anyone but the owner', async () => {
    const aliceWallet = await jetton.wallet(alice.address);

    // The admin (treasury) cannot burn a holder's tokens either.
    for (const stranger of [mallory, treasury]) {
      const result = await aliceWallet.send(
        stranger.getSender(),
        { value: toNano('0.1') },
        {
          $$type: 'JettonBurn',
          queryId: 0n,
          amount: tokens('100'),
          responseDestination: stranger.address,
          customPayload: null,
        },
      );
      expectTx(result, { from: stranger.address, to: aliceWallet.address, success: false, exitCode: ERR.notOwner });
    }
    expect(await jetton.balanceOf(alice.address)).toBe(tokens('100'));
    expect(await jetton.totalSupply()).toBe(jetton.supply);
  });

  it('rejects burning more than the balance', async () => {
    const result = await burn(jetton, alice, { amount: tokens('100') + 1n });

    expectTx(result, { from: alice.address, success: false, exitCode: ERR.insufficientBalance });
    expect(await jetton.balanceOf(alice.address)).toBe(tokens('100'));
    expect(await jetton.totalSupply()).toBe(jetton.supply);
  });

  it('rejects a burn that cannot pay for the notification to the master', async () => {
    // Enough Toncoin to run the wallet, not enough to also reach the master.
    // tests/toncoin.spec.ts pins the exact amount.
    const result = await burn(jetton, alice, { amount: tokens('1'), value: toNano('0.001') });
    expectTx(result, { from: alice.address, success: false, exitCode: ERR.insufficientTon });

    // Too little even to run the wallet: it runs out of gas (exit -14).
    const dust = await burn(jetton, alice, { amount: tokens('1'), value: toNano('0.0001') });
    expectTx(dust, { from: alice.address, success: false, exitCode: -14 });

    expect(await jetton.balanceOf(alice.address)).toBe(tokens('100'));
    expect(await jetton.totalSupply()).toBe(jetton.supply);
  });

  it('rejects a forged burn notification', async () => {
    // Without this check anyone could shrink the reported supply at will.
    for (const claimedHolder of [treasury.address, alice.address, mallory.address]) {
      const result = await jetton.master.send(
        mallory.getSender(),
        { value: toNano('0.1') },
        {
          $$type: 'JettonBurnNotification',
          queryId: 0n,
          amount: tokens('1000'),
          sender: claimedHolder,
          responseDestination: mallory.address,
        },
      );
      expectTx(result, { from: mallory.address, to: jetton.master.address, success: false, exitCode: ERR.notValidWallet });
    }
    expect(await jetton.totalSupply()).toBe(jetton.supply);
  });

  it('restores the balance when the master rejects the burn', async () => {
    const aliceWallet = await jetton.wallet(alice.address);
    const restoreMaster = await breakContract(net, jetton.master.address);

    const result = await aliceWallet.send(
      alice.getSender(),
      { value: toNano('0.1') },
      { $$type: 'JettonBurn', queryId: 0n, amount: tokens('30'), responseDestination: alice.address, customPayload: null },
    );

    // Exit code 42 is the stand-in contract's refusal (see breakContract).
    expectTx(result, { from: aliceWallet.address, to: jetton.master.address, op: OP.burnNotification, success: false, exitCode: 42 });
    expectTx(result, { from: jetton.master.address, to: aliceWallet.address, inMessageBounced: true, success: true });

    await restoreMaster();
    expect(await jetton.balanceOf(alice.address)).toBe(tokens('100'));
    expect(await jetton.totalSupply()).toBe(jetton.supply);
  });
});
