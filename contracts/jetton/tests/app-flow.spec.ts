import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Address, Cell, toNano } from '@ton/core';
import { loadJettonBurn, loadJettonTransfer } from '../build/LuminaraJetton_JettonWallet';
import {
  cheapestAccepted,
  commentPayload,
  deployJetton,
  ERR,
  expectNoTx,
  expectTx,
  inboundBody,
  isActive,
  type LocalJetton,
  type LocalNet,
  OP,
  readComment,
  sendAs,
  startLocalNet,
  TEST_SEED,
  toUnits,
  transfer,
} from './harness';

/**
 * The payment flow the Luminara checkout is designed around, played against
 * the real contract.
 *
 * The message bodies in tests/fixtures/app-payloads.json are the exact bytes
 * the app's TEP-74 builders produce for one invoice. The first test below
 * decodes them, so this suite stands on its own. The app keeps its side with
 * its own test (tests/jettonContract.test.ts at the repository root, which
 * ships with the checkout code): it rebuilds these bytes with the app's
 * builders and fails if they differ.
 */
const fixture = JSON.parse(readFileSync(new URL('./fixtures/app-payloads.json', import.meta.url), 'utf8')) as {
  payer: string;
  merchant: string;
  orderId: string;
  planId: string;
  memo: string;
  amountUnits: string;
  forwardTonAmount: string;
  attachedTon: string;
  burnRatePercent: number;
  burnUnits: string;
  transferBoc: string;
  burnBoc: string;
};

describe('Luminara payment flow', () => {
  let net: LocalNet;
  let jetton: LocalJetton;
  const payer = Address.parse(fixture.payer);
  const merchant = Address.parse(fixture.merchant);
  const price = BigInt(fixture.amountUnits);
  const burnShare = BigInt(fixture.burnUnits);

  const pay = async () =>
    sendAs(net, payer, (await jetton.wallet(payer)).address, BigInt(fixture.attachedTon), Cell.fromBase64(fixture.transferBoc));

  beforeEach(async () => {
    net = await startLocalNet(TEST_SEED);
    jetton = await deployJetton(net);
    // The customer already holds some tokens. The merchant has never received any.
    await transfer(jetton, net.wallets.treasury, { to: payer, amount: toUnits(jetton.profile, '50') });
  });

  it('uses fixture bytes that decode to the invoice they stand for', () => {
    const transferBody = loadJettonTransfer(Cell.fromBase64(fixture.transferBoc).beginParse());
    expect(transferBody.amount).toBe(price);
    expect(transferBody.destination.equals(merchant)).toBe(true);
    expect(transferBody.responseDestination?.equals(payer)).toBe(true);
    expect(transferBody.customPayload).toBeNull();
    expect(transferBody.forwardTonAmount).toBe(BigInt(fixture.forwardTonAmount));
    expect(readComment(transferBody.forwardPayload)).toBe(fixture.memo);
    expect(fixture.memo).toBe(`LUM:${fixture.orderId}:${fixture.planId}`);

    const burnBody = loadJettonBurn(Cell.fromBase64(fixture.burnBoc).beginParse());
    expect(burnBody.amount).toBe(burnShare);
    expect(burnBody.responseDestination?.equals(merchant)).toBe(true);
    expect(burnBody.customPayload).toBeNull();
    expect(burnShare).toBe((price * BigInt(fixture.burnRatePercent)) / 100n);
  });

  it('prices one audit at one whole token', () => {
    expect(price).toBe(toUnits(jetton.profile, '1'));
  });

  it('delivers the payment and tells the merchant the amount, the payer and the invoice memo', async () => {
    const result = await pay();

    const payerWallet = await jetton.wallet(payer);
    const merchantWallet = await jetton.wallet(merchant);
    expectTx(result, { from: payer, to: payerWallet.address, op: OP.transfer, success: true });
    expectTx(result, { from: payerWallet.address, to: merchantWallet.address, op: OP.internalTransfer, deploy: true, success: true });

    const notification = expectTx(result, {
      from: merchantWallet.address,
      to: merchant,
      op: OP.transferNotification,
      value: BigInt(fixture.forwardTonAmount),
    });
    const body = inboundBody(notification).beginParse();
    body.skip(32 + 64);
    expect(body.loadCoins()).toBe(price);
    expect(body.loadAddress().equals(payer)).toBe(true);
    expect(readComment(body)).toBe(fixture.memo);

    expect(await jetton.balanceOf(merchant)).toBe(price);
    expect(await jetton.balanceOf(payer)).toBe(toUnits(jetton.profile, '50') - price);
  });

  it('works with the Toncoin the app attaches, even for a merchant with no wallet yet', async () => {
    const result = await pay();

    // Nothing bounced, and the unused Toncoin went back to the payer.
    expectNoTx(result, { inMessageBounced: true });
    expectTx(result, { from: (await jetton.wallet(merchant)).address, to: payer, op: OP.excesses });
  });

  it('the Toncoin the app attaches covers the real cost with room to spare', async () => {
    // The same payment sent by a real wallet contract, so every fee is the one the network charges.
    const { alice, bob } = net.wallets;
    await transfer(jetton, net.wallets.treasury, { to: alice.address, amount: toUnits(jetton.profile, '50') });

    const { value: needed } = await cheapestAccepted(net, OP.transfer, (attached) =>
      transfer(jetton, alice, {
        to: bob.address,
        amount: price,
        value: attached,
        forwardTon: BigInt(fixture.forwardTonAmount),
        payload: commentPayload(fixture.memo),
      }),
    );

    const attached = BigInt(fixture.attachedTon);
    expect(attached).toBeGreaterThan(needed);
    // At least a tenth of what is attached is margin for fee changes.
    expect((attached - needed) * 10n).toBeGreaterThan(attached);
  });

  it('must be sent to the payer wallet that the master names', async () => {
    // The app has to look this address up (get_wallet_address or TEP-89).
    // The same body sent to the payer's own account address does nothing.
    const payerWallet = await jetton.wallet(payer);
    expect(payerWallet.address.equals(payer)).toBe(false);
    expect((await payerWallet.getGetWalletData()).owner.equals(payer)).toBe(true);
    expect((await jetton.master.getGetWalletAddress(payer)).equals(payerWallet.address)).toBe(true);

    // The payer's own account is an ordinary wallet, here one with no code at all. It is not a Jetton wallet.
    expect(await isActive(net, payer)).toBe(false);
    const misdirected = await sendAs(net, payer, payer, BigInt(fixture.attachedTon), Cell.fromBase64(fixture.transferBoc));
    expectNoTx(misdirected, { op: OP.internalTransfer });
    expect(await jetton.balanceOf(merchant)).toBe(0n);
    expect(await jetton.balanceOf(payer)).toBe(toUnits(jetton.profile, '50'));
  });

  it('burns the Supply Watcher share and lowers the total supply by exactly that much', async () => {
    await pay();
    expect(burnShare).toBe((price * BigInt(fixture.burnRatePercent)) / 100n);
    const merchantWallet = await jetton.wallet(merchant);

    const result = await sendAs(net, merchant, merchantWallet.address, toNano('0.05'), Cell.fromBase64(fixture.burnBoc));

    expectTx(result, { from: merchant, to: merchantWallet.address, op: OP.burn, success: true });
    expectTx(result, { from: merchantWallet.address, to: jetton.master.address, op: OP.burnNotification, success: true });
    expect(await jetton.totalSupply()).toBe(jetton.supply - burnShare);
    expect(await jetton.balanceOf(merchant)).toBe(price - burnShare);
  });

  it('does not burn anything on its own: the burn is a separate message from the merchant', async () => {
    await pay();

    expect(await jetton.totalSupply()).toBe(jetton.supply);
    expect(await jetton.balanceOf(merchant)).toBe(price);
  });

  it('cannot be burned by anyone but the merchant', async () => {
    await pay();
    const merchantWallet = await jetton.wallet(merchant);

    const result = await sendAs(net, payer, merchantWallet.address, toNano('0.05'), Cell.fromBase64(fixture.burnBoc));

    expectTx(result, { from: payer, to: merchantWallet.address, success: false, exitCode: ERR.notOwner });
    expect(await jetton.totalSupply()).toBe(jetton.supply);
    expect(await jetton.balanceOf(merchant)).toBe(price);
  });
});
