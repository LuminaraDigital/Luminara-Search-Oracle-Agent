import { beforeEach, describe, expect, it } from 'vitest';
import { Address, beginCell, type Slice, toNano } from '@ton/core';
import {
  breakContract,
  commentPayload,
  deployJetton,
  emptyPayload,
  ERR,
  expectNoTx,
  expectTx,
  inboundBody,
  type LocalJetton,
  type LocalNet,
  type LocalWallet,
  OP,
  readComment,
  sendAs,
  startLocalNet,
  TEST_SEED,
  toUnits,
  transfer,
} from './harness';

describe('Transfers (TEP-74)', () => {
  let net: LocalNet;
  let jetton: LocalJetton;
  let treasury: LocalWallet;
  let alice: LocalWallet;
  let bob: LocalWallet;
  let merchant: LocalWallet;
  let mallory: LocalWallet;
  const tokens = (amount: string) => toUnits(jetton.profile, amount);

  beforeEach(async () => {
    net = await startLocalNet(TEST_SEED);
    jetton = await deployJetton(net);
    ({ treasury, alice, bob, merchant, mallory } = net.wallets);
  });

  it('moves exactly the amount sent: no tax, fee or rounding', async () => {
    const amount = tokens('1000.123456789');
    const result = await transfer(jetton, treasury, { to: alice.address, amount });

    const treasuryWallet = await jetton.wallet(treasury.address);
    const aliceWallet = await jetton.wallet(alice.address);
    expectTx(result, { from: treasury.address, to: treasuryWallet.address, op: OP.transfer, success: true });
    expectTx(result, {
      from: treasuryWallet.address,
      to: aliceWallet.address,
      op: OP.internalTransfer,
      deploy: true,
      success: true,
    });

    expect(await jetton.balanceOf(alice.address)).toBe(amount);
    expect(await jetton.balanceOf(treasury.address)).toBe(jetton.supply - amount);
    expect(await jetton.totalSupply()).toBe(jetton.supply);
  });

  it('creates the recipient wallet at the address the master predicts', async () => {
    await transfer(jetton, treasury, { to: alice.address, amount: tokens('5') });

    const aliceWallet = await jetton.wallet(alice.address);
    const data = await aliceWallet.getGetWalletData();
    expect(data.owner.equals(alice.address)).toBe(true);
    expect(data.master.equals(jetton.master.address)).toBe(true);
    expect(data.balance).toBe(tokens('5'));
  });

  it('notifies the recipient with the amount, the sender and the memo', async () => {
    const result = await transfer(jetton, treasury, {
      to: merchant.address,
      amount: tokens('29'),
      forwardTon: toNano('0.05'),
      payload: commentPayload('LUM:ton_1759860000000_ab12cd:starter'),
      queryId: 42n,
    });

    const merchantWallet = await jetton.wallet(merchant.address);
    const notification = expectTx(result, {
      from: merchantWallet.address,
      to: merchant.address,
      op: OP.transferNotification,
      value: toNano('0.05'),
      success: true,
    });
    const body = inboundBody(notification).beginParse();
    body.loadUint(32);
    expect(body.loadUintBig(64)).toBe(42n);
    expect(body.loadCoins()).toBe(tokens('29'));
    expect(body.loadAddress().equals(treasury.address)).toBe(true);
    expect(readComment(body)).toBe('LUM:ton_1759860000000_ab12cd:starter');
  });

  it('sends no notification when no Toncoin is forwarded', async () => {
    const result = await transfer(jetton, treasury, { to: alice.address, amount: tokens('1'), forwardTon: 0n });

    expectNoTx(result, { op: OP.transferNotification });
    expect(await jetton.balanceOf(alice.address)).toBe(tokens('1'));
  });

  it('returns unused Toncoin to the response address', async () => {
    const result = await transfer(jetton, treasury, { to: alice.address, amount: tokens('1'), response: bob.address });

    const aliceWallet = await jetton.wallet(alice.address);
    expectTx(result, { from: aliceWallet.address, to: bob.address, op: OP.excesses, success: true });
  });

  it('keeps unused Toncoin in the receiving wallet when there is no response address', async () => {
    const result = await transfer(jetton, treasury, { to: alice.address, amount: tokens('1'), response: null });

    expectNoTx(result, { op: OP.excesses });
    expect(await jetton.balanceOf(alice.address)).toBe(tokens('1'));
  });

  it('lets a recipient pass tokens on', async () => {
    await transfer(jetton, treasury, { to: alice.address, amount: tokens('100') });
    await transfer(jetton, alice, { to: bob.address, amount: tokens('40') });
    await transfer(jetton, bob, { to: merchant.address, amount: tokens('15') });

    expect(await jetton.balanceOf(alice.address)).toBe(tokens('60'));
    expect(await jetton.balanceOf(bob.address)).toBe(tokens('25'));
    expect(await jetton.balanceOf(merchant.address)).toBe(tokens('15'));
    expect(await jetton.totalSupply()).toBe(jetton.supply);
  });

  it('can move an entire balance', async () => {
    await transfer(jetton, treasury, { to: alice.address, amount: jetton.supply });

    expect(await jetton.balanceOf(treasury.address)).toBe(0n);
    expect(await jetton.balanceOf(alice.address)).toBe(jetton.supply);
  });

  it('leaves the balance unchanged after a transfer to yourself', async () => {
    await transfer(jetton, treasury, { to: alice.address, amount: tokens('10') });
    const result = await transfer(jetton, alice, { to: alice.address, amount: tokens('4') });

    const aliceWallet = await jetton.wallet(alice.address);
    expectTx(result, { from: aliceWallet.address, to: aliceWallet.address, op: OP.internalTransfer, success: true });
    expect(await jetton.balanceOf(alice.address)).toBe(tokens('10'));
  });

  it('rejects a transfer from anyone but the owner', async () => {
    await transfer(jetton, treasury, { to: alice.address, amount: tokens('10') });
    const aliceWallet = await jetton.wallet(alice.address);

    // The admin (treasury) has no more right to Alice's tokens than a stranger does.
    for (const thief of [mallory, treasury, net.wallets.deployer]) {
      const result = await aliceWallet.send(
        thief.getSender(),
        { value: toNano('0.1') },
        {
          $$type: 'JettonTransfer',
          queryId: 0n,
          amount: tokens('10'),
          destination: thief.address,
          responseDestination: thief.address,
          customPayload: null,
          forwardTonAmount: 0n,
          forwardPayload: emptyPayload(),
        },
      );
      expectTx(result, { from: thief.address, to: aliceWallet.address, success: false, exitCode: ERR.notOwner });
    }
    expect(await jetton.balanceOf(alice.address)).toBe(tokens('10'));
    expect(await jetton.balanceOf(mallory.address)).toBe(0n);
  });

  it('rejects spending more than the balance', async () => {
    await transfer(jetton, treasury, { to: alice.address, amount: tokens('10') });
    const result = await transfer(jetton, alice, { to: bob.address, amount: tokens('10') + 1n });

    expectTx(result, { from: alice.address, success: false, exitCode: ERR.insufficientBalance });
    expect(await jetton.balanceOf(alice.address)).toBe(tokens('10'));
    expect(await jetton.balanceOf(bob.address)).toBe(0n);
  });

  it('rejects a transfer that cannot pay for the whole route', async () => {
    // Enough to run the wallet, far too little for the route. tests/toncoin.spec.ts pins the exact amount.
    const tooLittle = await transfer(jetton, treasury, { to: alice.address, amount: tokens('1'), value: toNano('0.003') });
    expectTx(tooLittle, { from: treasury.address, success: false, exitCode: ERR.insufficientTon });

    // Forwarding 1 TON needs more than 1 TON attached.
    const forwardTooMuch = await transfer(jetton, treasury, {
      to: alice.address,
      amount: tokens('1'),
      value: toNano('1'),
      forwardTon: toNano('1'),
    });
    expectTx(forwardTooMuch, { from: treasury.address, success: false, exitCode: ERR.insufficientTon });

    expect(await jetton.balanceOf(alice.address)).toBe(0n);
    expect(await jetton.balanceOf(treasury.address)).toBe(jetton.supply);
  });

  it('rejects a malformed forward payload', async () => {
    const malformed: Record<string, Slice> = {
      'missing Either tag': beginCell().endCell().beginParse(),
      'by-reference tag without a reference': beginCell().storeBit(true).endCell().beginParse(),
      'by-reference tag with trailing data': beginCell()
        .storeBit(true)
        .storeRef(beginCell().endCell())
        .storeUint(1, 8)
        .endCell()
        .beginParse(),
      'by-reference tag with two references': beginCell()
        .storeBit(true)
        .storeRef(beginCell().storeUint(1, 8).endCell())
        .storeRef(beginCell().storeUint(2, 8).endCell())
        .endCell()
        .beginParse(),
    };

    for (const [name, payload] of Object.entries(malformed)) {
      const result = await transfer(jetton, treasury, { to: alice.address, amount: tokens('1'), payload });
      expectTx(result, { from: treasury.address, success: false, exitCode: ERR.malformedForwardPayload });
      expect(await jetton.balanceOf(alice.address), name).toBe(0n);
    }
    expect(await jetton.balanceOf(treasury.address)).toBe(jetton.supply);
  });

  it('rejects a destination outside the basechain', async () => {
    const masterchain = Address.parseRaw(`-1:${'cd'.repeat(32)}`);
    const result = await transfer(jetton, treasury, { to: masterchain, amount: tokens('1') });

    expectTx(result, { from: treasury.address, success: false, exitCode: ERR.notBasechain });
    expect(await jetton.balanceOf(treasury.address)).toBe(jetton.supply);
  });

  it('refunds the sender when the recipient wallet rejects the credit', async () => {
    const treasuryWallet = await jetton.wallet(treasury.address);
    const bobWallet = await jetton.wallet(bob.address);
    await breakContract(net, bobWallet.address);

    const result = await transfer(jetton, treasury, { to: bob.address, amount: tokens('250') });

    // Exit code 42 is the stand-in contract's refusal (see breakContract).
    expectTx(result, { from: treasuryWallet.address, to: bobWallet.address, op: OP.internalTransfer, success: false, exitCode: 42 });
    expectTx(result, { from: bobWallet.address, to: treasuryWallet.address, inMessageBounced: true, success: true });
    expect(await jetton.balanceOf(treasury.address)).toBe(jetton.supply);
    expect(await jetton.totalSupply()).toBe(jetton.supply);
  });

  it('ignores a custom payload, as the standard allows', async () => {
    const result = await transfer(jetton, treasury, {
      to: alice.address,
      amount: tokens('3'),
      customPayload: beginCell().storeUint(0xdeadbeef, 32).endCell(),
    });

    expectTx(result, { from: treasury.address, op: OP.transfer, success: true });
    expect(await jetton.balanceOf(alice.address)).toBe(tokens('3'));
  });

  it('forwards a memo stored inline in the payload unchanged', async () => {
    const inline = beginCell().storeBit(false).storeUint(0, 32).storeStringTail('inline memo').endCell().beginParse();
    const result = await transfer(jetton, treasury, { to: merchant.address, amount: tokens('2'), forwardTon: 1n, payload: inline });

    const merchantWallet = await jetton.wallet(merchant.address);
    const notification = expectTx(result, { from: merchantWallet.address, to: merchant.address, op: OP.transferNotification, value: 1n });
    const body = inboundBody(notification).beginParse();
    body.skip(32 + 64);
    body.loadCoins();
    body.loadAddress();
    expect(readComment(body)).toBe('inline memo');
  });

  it('carries the query id through to the notification and to the returned Toncoin', async () => {
    const result = await transfer(jetton, treasury, {
      to: alice.address,
      amount: tokens('1'),
      forwardTon: 1n,
      response: bob.address,
      queryId: 0xfeedfacecafen,
    });

    const aliceWallet = await jetton.wallet(alice.address);
    const notification = inboundBody(expectTx(result, { to: alice.address, op: OP.transferNotification })).beginParse();
    notification.skip(32);
    expect(notification.loadUintBig(64)).toBe(0xfeedfacecafen);

    // excesses#d53276db query_id:uint64, and nothing after it.
    const excess = inboundBody(expectTx(result, { from: aliceWallet.address, to: bob.address, op: OP.excesses })).beginParse();
    expect(excess.loadUint(32)).toBe(OP.excesses);
    expect(excess.loadUintBig(64)).toBe(0xfeedfacecafen);
    expect(excess.remainingBits).toBe(0);
    expect(excess.remainingRefs).toBe(0);
  });

  it('bounces a credit whose notification cannot be paid for instead of half-applying it', async () => {
    await transfer(jetton, treasury, { to: alice.address, amount: tokens('10') });
    const treasuryWallet = await jetton.wallet(treasury.address);
    const aliceWallet = await jetton.wallet(alice.address);

    // A real sending wallet refuses to send this (see the route check above).
    // The emulator injects it anyway to exercise the receiving wallet's safety net.
    const underfunded = beginCell()
      .storeUint(OP.internalTransfer, 32)
      .storeUint(0, 64)
      .storeCoins(tokens('5'))
      .storeAddress(treasury.address)
      .storeAddress(treasury.address)
      .storeCoins(toNano('10'))
      .storeBit(false)
      .endCell();
    const result = await sendAs(net, treasuryWallet.address, aliceWallet.address, toNano('0.05'), underfunded);

    // The wallet ran (exit 0) but could not fund the notification (action result 37, not enough Toncoin).
    expectTx(result, { to: aliceWallet.address, op: OP.internalTransfer, success: false, exitCode: 0, actionResultCode: 37 });
    expectTx(result, { from: aliceWallet.address, to: treasuryWallet.address, inMessageBounced: true });
    expectNoTx(result, { op: OP.transferNotification });
    expect(await jetton.balanceOf(alice.address)).toBe(tokens('10'));
  });
});
