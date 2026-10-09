import { beforeEach, describe, expect, it } from 'vitest';
import { Address, beginCell, type Cell, fromNano, type Slice, storeStateInit, toNano } from '@ton/core';
import type { SendMessageResult } from '@ton/sandbox';
import { flattenTransaction } from '@ton/test-utils';
import { JettonWallet } from '../build/LuminaraJetton_JettonWallet';
import {
  advanceTime,
  breakContract,
  burn,
  buildOnchainContent,
  cellStats,
  cheapestAccepted,
  commentPayload,
  contractConstant,
  deployJetton,
  emptyPayload,
  ERR,
  expectNoTx,
  expectTx,
  freezeContract,
  gasUsed,
  inboundForwardFee,
  isActive,
  type LocalJetton,
  type LocalNet,
  type LocalWallet,
  networkFees,
  OP,
  raiseStoragePrices,
  rentOwed,
  rentPaid,
  sendAs,
  startLocalNet,
  TEST_SEED,
  tonBalance,
  toUnits,
  transfer,
  walletStorageReserve,
  YEAR,
} from './harness';

/**
 * Toncoin: what every request must carry, where the unused part goes, and
 * what storage rent does over the years. The checks in the contracts are
 * built on the budgets in contracts/messages.tact; these tests work the same
 * amounts out independently from the network's fee formulas and require an
 * exact match, to the nanoTON.
 */
describe('Toncoin', () => {
  let net: LocalNet;
  let jetton: LocalJetton;
  let treasury: LocalWallet;
  let alice: LocalWallet;
  let bob: LocalWallet;
  let mallory: LocalWallet;
  let reserve: bigint;
  const tokens = (amount: string) => toUnits(jetton.profile, amount);
  // Three times the length of a Luminara invoice memo.
  const longMemo = () => commentPayload(`LUM:${'x'.repeat(120)}:multi_agent_crawl`);

  beforeEach(async () => {
    net = await startLocalNet(TEST_SEED);
    jetton = await deployJetton(net);
    ({ treasury, alice, bob, mallory } = net.wallets);
    reserve = walletStorageReserve(net);
  });

  describe('fee budgets', () => {
    it('every handler stays inside the gas budget the contracts charge for', async () => {
      const transferBudget = contractConstant('GAS_FOR_TRANSFER');
      const burnBudget = contractConstant('GAS_FOR_BURN');
      const discoveryBudget = contractConstant('GAS_FOR_DISCOVERY');

      // Worst case for a transfer: a new recipient wallet, a notification and a long memo.
      const notified = { to: alice.address, amount: tokens('100'), forwardTon: toNano('0.05') };
      const firstTransfer = await transfer(jetton, treasury, { ...notified, payload: longMemo() });
      const repeatTransfer = await transfer(jetton, treasury, { ...notified, payload: longMemo() });
      const burned = await burn(jetton, alice, { amount: tokens('1') });
      const discovered = await jetton.master.send(
        alice.getSender(),
        { value: toNano('0.05') },
        { $$type: 'ProvideWalletAddress', queryId: 0n, ownerAddress: bob.address, includeAddress: true },
      );

      const measured = {
        'transfer: sending wallet': gasUsed(expectTx(firstTransfer, { op: OP.transfer })),
        'transfer: new receiving wallet': gasUsed(expectTx(firstTransfer, { op: OP.internalTransfer })),
        'transfer: existing receiving wallet': gasUsed(expectTx(repeatTransfer, { op: OP.internalTransfer })),
        'burn: wallet': gasUsed(expectTx(burned, { op: OP.burn })),
        'burn: master': gasUsed(expectTx(burned, { op: OP.burnNotification })),
        'discovery: master': gasUsed(expectTx(discovered, { op: OP.provideWalletAddress })),
      };
      if (process.env.JETTON_GAS_REPORT) console.table(measured);

      expect(measured['transfer: sending wallet']).toBeLessThanOrEqual(transferBudget);
      expect(measured['transfer: new receiving wallet']).toBeLessThanOrEqual(transferBudget);
      expect(measured['transfer: existing receiving wallet']).toBeLessThanOrEqual(transferBudget);
      expect(measured['burn: wallet']).toBeLessThanOrEqual(burnBudget);
      expect(measured['burn: master']).toBeLessThanOrEqual(burnBudget);
      expect(measured['discovery: master']).toBeLessThanOrEqual(discoveryBudget);
    });

    // Fails on any change to the wallet code, so the mutation check leaves it out (see scripts/mutation-check.mjs).
    it.skipIf(process.env.JETTON_MUTATION_RUN)('charges for exactly the wallet code and data a transfer carries', async () => {
      const wallet = await JettonWallet.fromInit(0n, alice.address, jetton.master.address);
      if (!wallet.init) throw new Error('Wallet has no init state.');
      const stateInit = beginCell().store(storeStateInit(wallet.init)).endCell();
      if (process.env.JETTON_GAS_REPORT) console.info('wallet init state', cellStats(stateInit));

      expect(cellStats(stateInit)).toEqual({
        cells: Number(contractConstant('WALLET_INIT_CELLS')),
        bits: Number(contractConstant('WALLET_INIT_BITS')),
      });
    });

    it.skipIf(process.env.JETTON_MUTATION_RUN)('sizes the storage reserve for the wallet as the network bills it', async () => {
      await transfer(jetton, treasury, { to: alice.address, amount: (1n << 100n) > jetton.supply ? jetton.supply : 1n << 100n });
      const aliceWallet = await jetton.wallet(alice.address);
      const used = (await net.blockchain.getContract(aliceWallet.address)).account.account?.storageStats.used;
      if (!used) throw new Error('Wallet has no storage statistics.');
      if (process.env.JETTON_GAS_REPORT) console.info('wallet storage used', { cells: used.cells, bits: used.bits });

      // Never smaller than the real wallet, and not padded by more than 2%.
      const cells = contractConstant('WALLET_STORAGE_CELLS');
      const bits = contractConstant('WALLET_STORAGE_BITS');
      expect(cells).toBe(BigInt(used.cells));
      expect(bits).toBeGreaterThanOrEqual(BigInt(used.bits));
      expect(bits * 100n).toBeLessThanOrEqual(BigInt(used.bits) * 102n);
    });
  });

  describe('what a request must carry', () => {
    const shapes: Record<string, { forwardTon: bigint; payload: () => Slice }> = {
      'no notification': { forwardTon: 0n, payload: emptyPayload },
      'a notification of 1 nanoTON, as wallets send by default': { forwardTon: 1n, payload: emptyPayload },
      'a notification with an invoice memo': { forwardTon: toNano('0.05'), payload: () => commentPayload('LUM:ton_1759860000000_ab12cd:starter') },
      'a notification with a long memo': { forwardTon: toNano('0.05'), payload: longMemo },
      'a memo stored inline': {
        forwardTon: toNano('0.01'),
        payload: () => beginCell().storeBit(false).storeUint(0, 32).storeStringTail('inline memo').endCell().beginParse(),
      },
    };

    for (const [name, shape] of Object.entries(shapes)) {
      it(`a transfer with ${name} needs exactly the cost of its route, and then completes`, async () => {
        const fees = networkFees(net);
        const send = (value: bigint, to: LocalWallet = alice) =>
          transfer(jetton, treasury, { to: to.address, amount: tokens('100'), value, forwardTon: shape.forwardTon, payload: shape.payload() });

        const { value, result } = await cheapestAccepted(net, OP.transfer, (attached) => send(attached));

        // The route: the notification, one message fee per message sent, the cost of carrying
        // the recipient's wallet code, gas on both sides, and the recipient's storage reserve.
        const messages = shape.forwardTon > 0n ? 2n : 1n;
        const route =
          shape.forwardTon +
          messages * inboundForwardFee(net, expectTx(result, { op: OP.transfer })) +
          fees.simpleForward(contractConstant('WALLET_INIT_CELLS'), contractConstant('WALLET_INIT_BITS')) +
          2n * fees.compute(contractConstant('GAS_FOR_TRANSFER')) +
          reserve;
        expect(value).toBe(route + 1n);

        const aliceWallet = await jetton.wallet(alice.address);
        expectTx(result, { to: aliceWallet.address, op: OP.internalTransfer, deploy: true, success: true });
        if (shape.forwardTon > 0n) {
          expectTx(result, { from: aliceWallet.address, to: alice.address, op: OP.transferNotification, value: shape.forwardTon });
        }
        expectNoTx(result, { inMessageBounced: true });
        expect(await jetton.balanceOf(alice.address)).toBe(tokens('100'));
        // The new wallet is left with exactly its storage reserve.
        expect(await tonBalance(net, aliceWallet.address)).toBe(reserve);

        // One nanoTON less and the sending wallet refuses. Nothing moves.
        const refused = await send(value - 1n, bob);
        expectTx(refused, { from: treasury.address, success: false, exitCode: ERR.insufficientTon });
        expect(await jetton.balanceOf(bob.address)).toBe(0n);
      });
    }

    it('a burn needs exactly one message fee and gas on both sides, and then reaches the master', async () => {
      const fees = networkFees(net);
      await transfer(jetton, treasury, { to: alice.address, amount: tokens('100') });

      const { value, result } = await cheapestAccepted(net, OP.burn, (attached) => burn(jetton, alice, { amount: tokens('40'), value: attached }));

      const route = inboundForwardFee(net, expectTx(result, { op: OP.burn })) + 2n * fees.compute(contractConstant('GAS_FOR_BURN'));
      expect(value).toBe(route + 1n);
      expectTx(result, { to: jetton.master.address, op: OP.burnNotification, success: true });
      expectNoTx(result, { inMessageBounced: true });
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('60'));
      expect(await jetton.totalSupply()).toBe(jetton.supply - tokens('40'));

      // One nanoTON less, same burn: refused, nothing changes.
      const refused = await burn(jetton, alice, { amount: tokens('40'), value: value - 1n });
      expectTx(refused, { from: alice.address, success: false, exitCode: ERR.insufficientTon });
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('60'));
      expect(await jetton.totalSupply()).toBe(jetton.supply - tokens('40'));
    });

    it('a discovery request needs exactly one message fee and the master gas, and then is answered', async () => {
      const fees = networkFees(net);
      const ask = (value: bigint) =>
        jetton.master.send(alice.getSender(), { value }, { $$type: 'ProvideWalletAddress', queryId: 0n, ownerAddress: bob.address, includeAddress: true });

      const { value, result } = await cheapestAccepted(net, OP.provideWalletAddress, ask);

      const route = inboundForwardFee(net, expectTx(result, { op: OP.provideWalletAddress })) + fees.compute(contractConstant('GAS_FOR_DISCOVERY'));
      expect(value).toBe(route + 1n);
      expectTx(result, { from: jetton.master.address, to: alice.address, op: OP.takeWalletAddress, success: true });

      const refused = await ask(value - 1n);
      expectTx(refused, { to: jetton.master.address, success: false, exitCode: ERR.insufficientTon });
      expectTx(refused, { from: jetton.master.address, to: alice.address, inMessageBounced: true });
    });

    it('bounces a discovery request whose answer cannot be paid for, instead of keeping its Toncoin', async () => {
      // A requester in the masterchain passes the check above but its answer costs far more to deliver.
      const requester = Address.parseRaw(`-1:${'42'.repeat(32)}`);
      const request = beginCell()
        .storeUint(OP.provideWalletAddress, 32)
        .storeUint(9, 64)
        .storeAddress(bob.address)
        .storeBit(true)
        .endCell();
      const before = await tonBalance(net, jetton.master.address);

      // Enough to pay for the bounce (a short message) but not for the answer (a longer one).
      const result = await sendAs(net, requester, jetton.master.address, toNano('0.015'), request);

      expectTx(result, { to: jetton.master.address, op: OP.provideWalletAddress, exitCode: 0, actionResultCode: 37, success: false });
      expectTx(result, { from: jetton.master.address, to: requester, inMessageBounced: true });
      expect(await tonBalance(net, jetton.master.address)).toBe(before);
    });

    it('gives the Toncoin back when the onward message would be too large to send', async () => {
      // The owner's request fits in one message, but the onward message also carries the
      // recipient's wallet code and so exceeds the network's limit of 8,192 cells.
      let counter = 0;
      const tree = (cells: number): Cell => {
        const builder = beginCell().storeUint(counter++, 32);
        let rest = cells - 1;
        for (let child = 4; child > 0 && rest > 0; child--) {
          const share = Math.ceil(rest / child);
          builder.storeRef(tree(share));
          rest -= share;
        }
        return builder.endCell();
      };
      const payload = tree(8_180);
      expect(cellStats(payload).cells).toBe(8_180);
      const treasuryWallet = await jetton.wallet(treasury.address);
      const request = beginCell()
        .storeUint(OP.transfer, 32)
        .storeUint(0, 64)
        .storeCoins(tokens('5'))
        .storeAddress(alice.address)
        .storeAddress(treasury.address)
        .storeBit(false)
        .storeCoins(1n)
        .storeBit(true)
        .storeRef(payload)
        .endCell();

      const result = await sendAs(net, treasury.address, treasuryWallet.address, toNano('5'), request);

      // The wallet ran, could not send, and the whole request was undone and bounced.
      const attempt = expectTx(result, { to: treasuryWallet.address, op: OP.transfer, exitCode: 0, success: false });
      expect(flattenTransaction(attempt).actionResultCode).not.toBe(0);
      expectTx(result, { from: treasuryWallet.address, to: treasury.address, inMessageBounced: true });
      expectNoTx(result, { op: OP.internalTransfer });
      expect(await jetton.balanceOf(treasury.address)).toBe(jetton.supply);
      expect(await jetton.balanceOf(alice.address)).toBe(0n);
    });
  });

  describe('Toncoin never leaks', () => {
    it('the master holds exactly the same Toncoin after burns, discovery and every admin message', async () => {
      await transfer(jetton, treasury, { to: alice.address, amount: tokens('100') });
      const master = jetton.master;
      const value = toNano('0.05');
      const content = buildOnchainContent({ ...jetton.profile.metadata, description: 'Changed' });
      const before = await tonBalance(net, master.address);

      const messages: Record<string, () => Promise<SendMessageResult>> = {
        'a burn': () => burn(jetton, alice, { amount: tokens('1') }),
        'a discovery request from a stranger': () =>
          master.send(mallory.getSender(), { value }, { $$type: 'ProvideWalletAddress', queryId: 0n, ownerAddress: bob.address, includeAddress: true }),
        'a metadata update': () => master.send(treasury.getSender(), { value }, { $$type: 'UpdateContent', queryId: 0n, content }),
        'a handover proposal': () => master.send(treasury.getSender(), { value }, { $$type: 'ChangeAdmin', queryId: 0n, nextAdmin: bob.address }),
        'a claim by a stranger': () => master.send(mallory.getSender(), { value }, { $$type: 'ClaimAdmin', queryId: 0n }),
        'a claim by the proposed admin': () => master.send(bob.getSender(), { value }, { $$type: 'ClaimAdmin', queryId: 0n }),
        'an admin message from a stranger': () => master.send(mallory.getSender(), { value }, { $$type: 'DropAdmin', queryId: 0n }),
        'a second launch': () => master.send(bob.getSender(), { value: toNano('1') }, { $$type: 'Launch', queryId: 0n }),
        'dropping the role': () => master.send(bob.getSender(), { value }, { $$type: 'DropAdmin', queryId: 0n }),
      };

      for (const [name, send] of Object.entries(messages)) {
        const result = await send();
        expectTx(result, { to: master.address });
        expect(await tonBalance(net, master.address), name).toBe(before);
      }
    });

    it('a burn with no response address leaves its unused Toncoin on the master', async () => {
      await transfer(jetton, treasury, { to: alice.address, amount: tokens('100') });
      const before = await tonBalance(net, jetton.master.address);

      const result = await burn(jetton, alice, { amount: tokens('1'), response: null });

      expectTx(result, { to: jetton.master.address, op: OP.burnNotification, success: true, outMessagesCount: 0 });
      expect(await tonBalance(net, jetton.master.address)).toBeGreaterThan(before);
      expect(await jetton.totalSupply()).toBe(jetton.supply - tokens('1'));
    });

    it('returns the unused Toncoin of a transfer to the response address', async () => {
      const bobBefore = await bob.getBalance();
      const result = await transfer(jetton, treasury, { to: alice.address, amount: tokens('1'), value: toNano('1'), response: bob.address });

      const aliceWallet = await jetton.wallet(alice.address);
      const excess = expectTx(result, { from: aliceWallet.address, to: bob.address, op: OP.excesses, success: true });
      // Almost all of the 1 TON comes back: only fees and the new wallet's reserve are kept.
      expect(await bob.getBalance()).toBeGreaterThan(bobBefore + toNano('0.98'));
      expect(excess.inMessage?.info.type === 'internal' ? excess.inMessage.info.value.coins : 0n).toBeGreaterThan(toNano('0.98'));
      expect(await tonBalance(net, aliceWallet.address)).toBe(reserve);
    });

    it('with no response address the unused Toncoin stays in the receiving wallet', async () => {
      const result = await transfer(jetton, treasury, { to: alice.address, amount: tokens('1'), value: toNano('1'), response: null });

      const aliceWallet = await jetton.wallet(alice.address);
      expectNoTx(result, { op: OP.excesses });
      expect(await tonBalance(net, aliceWallet.address)).toBeGreaterThan(toNano('0.98'));
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('1'));
    });

    it('Toncoin parked on a wallet is not swept away by someone else sending to it', async () => {
      await transfer(jetton, treasury, { to: alice.address, amount: tokens('10') });
      const aliceWallet = await jetton.wallet(alice.address);
      const topUp = await alice.send({ to: aliceWallet.address, value: toNano('3') });
      expectTx(topUp, { to: aliceWallet.address, success: true, outMessagesCount: 0 });
      const parked = await tonBalance(net, aliceWallet.address);
      expect(parked).toBeGreaterThan(toNano('2.99'));
      await transfer(jetton, treasury, { to: mallory.address, amount: tokens('10') });
      const malloryBefore = await mallory.getBalance();

      // Mallory sends Alice one unit and names herself for the change.
      const attached = toNano('0.05');
      await transfer(jetton, mallory, { to: alice.address, amount: 1n, value: attached, response: mallory.address });

      expect(await tonBalance(net, aliceWallet.address)).toBe(parked);
      // She gets back less than she attached, never Alice's Toncoin.
      expect(await mallory.getBalance()).toBeLessThan(malloryBefore);
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('10') + 1n);
    });

    it('Toncoin parked on a wallet stays there when its owner transfers or burns', async () => {
      await transfer(jetton, treasury, { to: alice.address, amount: tokens('10') });
      const aliceWallet = await jetton.wallet(alice.address);
      await alice.send({ to: aliceWallet.address, value: toNano('3') });
      const parked = await tonBalance(net, aliceWallet.address);

      await transfer(jetton, alice, { to: bob.address, amount: tokens('1') });
      expect(await tonBalance(net, aliceWallet.address)).toBe(parked);

      await burn(jetton, alice, { amount: tokens('1') });
      expect(await tonBalance(net, aliceWallet.address)).toBe(parked);
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('8'));
    });
  });

  describe('storage rent', () => {
    it('the reserve pays five years of rent at current prices', async () => {
      await transfer(jetton, treasury, { to: alice.address, amount: tokens('1') });
      const aliceWallet = await jetton.wallet(alice.address);
      expect(await tonBalance(net, aliceWallet.address)).toBe(reserve);

      advanceTime(net, 5 * YEAR);
      const later = await transfer(jetton, treasury, { to: alice.address, amount: tokens('1') });
      const rent = rentPaid(expectTx(later, { to: aliceWallet.address, op: OP.internalTransfer, success: true }));
      if (process.env.JETTON_GAS_REPORT) console.info(`wallet rent for five years: ${fromNano(rent)} TON; reserve: ${fromNano(reserve)} TON`);

      // The reserve covered it without the wallet going into debt, with little to spare.
      expect(rent).toBeLessThanOrEqual(reserve);
      expect(rent * 100n).toBeGreaterThanOrEqual(reserve * 95n);
      expect(await rentOwed(net, aliceWallet.address)).toBe(0n);
      // The same transfer topped the reserve back up.
      expect(await tonBalance(net, aliceWallet.address)).toBe(reserve);
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('2'));
    });

    it('never asks a transfer for more than the capped reserve', () => {
      expect(reserve).toBeLessThanOrEqual(contractConstant('MAX_STORAGE_RESERVE'));
      expect(contractConstant('MAX_STORAGE_RESERVE')).toBe(toNano('0.02'));
      expect(contractConstant('STORAGE_RESERVE_SECONDS')).toBe(BigInt(5 * YEAR));
    });

    it('when rent becomes expensive the reserve stops at its cap, and a transfer needs no more than that', async () => {
      const cap = contractConstant('MAX_STORAGE_RESERVE');
      const senderWallet = await jetton.wallet(treasury.address);
      // The admin's wallet was created at today's prices and holds today's reserve.
      expect(await tonBalance(net, senderWallet.address)).toBe(reserve);

      raiseStoragePrices(net, 10n);
      const fees = networkFees(net);
      const fiveYears = fees.storage(
        contractConstant('WALLET_STORAGE_CELLS'),
        contractConstant('WALLET_STORAGE_BITS'),
        contractConstant('STORAGE_RESERVE_SECONDS'),
      );
      // Ten times the rent, give or take the rounding of one nanoTON per calculation.
      expect(fiveYears).toBeGreaterThan(reserve * 10n - 10n);
      expect(fiveYears).toBeLessThanOrEqual(reserve * 10n);
      expect(fiveYears).toBeGreaterThan(cap);
      expect(walletStorageReserve(net)).toBe(cap);

      const { value, result } = await cheapestAccepted(net, OP.transfer, (attached) =>
        transfer(jetton, treasury, { to: alice.address, amount: tokens('100'), value: attached }),
      );

      // The route as before, with the capped reserve for the recipient, plus what brings
      // the sending wallet up from its old reserve to the cap.
      const route =
        cap -
        reserve +
        inboundForwardFee(net, expectTx(result, { op: OP.transfer })) +
        fees.simpleForward(contractConstant('WALLET_INIT_CELLS'), contractConstant('WALLET_INIT_BITS')) +
        2n * fees.compute(contractConstant('GAS_FOR_TRANSFER')) +
        cap;
      expect(value).toBe(route + 1n);

      const aliceWallet = await jetton.wallet(alice.address);
      expectTx(result, { to: aliceWallet.address, op: OP.internalTransfer, deploy: true, success: true });
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('100'));
      // Both wallets end up holding the cap, not five years of the new rent.
      expect(await tonBalance(net, aliceWallet.address)).toBe(cap);
      expect(await tonBalance(net, senderWallet.address)).toBe(cap);
    });

    it('a master launched with 1 TON is funded for more than fifty years', async () => {
      const deposit = await tonBalance(net, jetton.master.address);

      advanceTime(net, YEAR);
      const topUp = await alice.send({ to: jetton.master.address, value: toNano('0.01') });
      const rent = rentPaid(expectTx(topUp, { to: jetton.master.address, success: true }));
      if (process.env.JETTON_GAS_REPORT) {
        console.info(`master rent for one year: ${fromNano(rent)} TON; deposit after a 1 TON launch: ${fromNano(deposit)} TON`);
      }

      expect(rent).toBeGreaterThan(0n);
      expect(deposit / rent).toBeGreaterThan(50n);
    });

    it('a wallet left idle for thirty years settles its rent out of the next incoming transfer', async () => {
      await transfer(jetton, treasury, { to: alice.address, amount: tokens('100') });
      const aliceWallet = await jetton.wallet(alice.address);

      advanceTime(net, 30 * YEAR);
      const result = await transfer(jetton, treasury, { to: alice.address, amount: tokens('1') });

      expectTx(result, { to: aliceWallet.address, op: OP.internalTransfer, success: true });
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('101'));
      // What it still owes is sitting on the wallet, on top of a full reserve.
      const owed = await rentOwed(net, aliceWallet.address);
      expect(owed).toBeGreaterThan(0n);
      expect(await tonBalance(net, aliceWallet.address)).toBe(reserve + owed);
    });

    it('a wallet in debt refuses to send until the debt is covered, then sends', async () => {
      const fees = networkFees(net);
      await transfer(jetton, treasury, { to: alice.address, amount: tokens('100') });
      const aliceWallet = await jetton.wallet(alice.address);
      advanceTime(net, 30 * YEAR);

      // The first touch takes what the wallet had as rent and records the rest as debt.
      const tooLittle = await transfer(jetton, alice, { to: bob.address, amount: tokens('10'), value: toNano('0.02') });
      expectTx(tooLittle, { from: alice.address, to: aliceWallet.address, success: false, exitCode: ERR.insufficientTon });
      const owed = await rentOwed(net, aliceWallet.address);
      expect(owed).toBeGreaterThan(reserve);
      expect(await tonBalance(net, aliceWallet.address)).toBe(0n);
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('100'));

      const { value, result } = await cheapestAccepted(net, OP.transfer, (attached) =>
        transfer(jetton, alice, { to: bob.address, amount: tokens('10'), value: attached }),
      );

      // Exactly the usual route, plus a full reserve for this wallet and its whole debt.
      const route =
        inboundForwardFee(net, expectTx(result, { op: OP.transfer })) +
        fees.simpleForward(contractConstant('WALLET_INIT_CELLS'), contractConstant('WALLET_INIT_BITS')) +
        2n * fees.compute(contractConstant('GAS_FOR_TRANSFER')) +
        reserve;
      expect(value).toBe(route + reserve + owed + 1n);
      expect(await jetton.balanceOf(bob.address)).toBe(tokens('10'));
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('90'));
      expect(await tonBalance(net, aliceWallet.address)).toBe(reserve + owed);
    });

    it('does not lose tokens when a wallet deep in debt has its burn rejected', async () => {
      await transfer(jetton, treasury, { to: alice.address, amount: tokens('100') });
      const aliceWallet = await jetton.wallet(alice.address);
      advanceTime(net, 60 * YEAR);
      const restoreMaster = await breakContract(net, jetton.master.address);
      const burnFrom = (value: bigint) =>
        aliceWallet.send(
          alice.getSender(),
          { value },
          { $$type: 'JettonBurn', queryId: 0n, amount: tokens('40'), responseDestination: alice.address, customPayload: null },
        );

      // Less than the debt: the refund of a rejected burn would be swallowed by rent
      // before it could restore the balance. The wallet must not let the burn start.
      const small = await burnFrom(toNano('0.05'));
      expectTx(small, { from: alice.address, to: aliceWallet.address, success: false, exitCode: ERR.insufficientTon });
      expect(await rentOwed(net, aliceWallet.address)).toBeGreaterThan(toNano('0.05'));
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('100'));

      // Enough to clear the debt: the burn goes out, the master rejects it, and the refund lands.
      const large = await burnFrom(toNano('0.5'));
      expectTx(large, { from: aliceWallet.address, to: jetton.master.address, op: OP.burnNotification, success: false });
      expectTx(large, { from: jetton.master.address, to: aliceWallet.address, inMessageBounced: true, success: true });
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('100'));

      await restoreMaster();
      expect(await jetton.totalSupply()).toBe(jetton.supply);
    });

    it('does not lose tokens when a wallet deep in debt sends to a wallet that rejects the credit', async () => {
      await transfer(jetton, treasury, { to: alice.address, amount: tokens('500') });
      const aliceWallet = await jetton.wallet(alice.address);
      const bobWallet = await jetton.wallet(bob.address);
      advanceTime(net, 60 * YEAR);
      await breakContract(net, bobWallet.address);

      const small = await transfer(jetton, alice, { to: bob.address, amount: tokens('100'), value: toNano('0.05') });
      expectTx(small, { from: alice.address, to: aliceWallet.address, success: false, exitCode: ERR.insufficientTon });
      expect(await rentOwed(net, aliceWallet.address)).toBeGreaterThan(toNano('0.05'));
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('500'));

      const large = await transfer(jetton, alice, { to: bob.address, amount: tokens('100'), value: toNano('0.5') });
      expectTx(large, { from: aliceWallet.address, to: bobWallet.address, op: OP.internalTransfer, success: false });
      expectTx(large, { from: bobWallet.address, to: aliceWallet.address, inMessageBounced: true, success: true });
      expect(await jetton.balanceOf(alice.address)).toBe(tokens('500'));
    });

    it('refunds a transfer to a wallet that has been frozen for unpaid rent', async () => {
      await transfer(jetton, treasury, { to: bob.address, amount: tokens('5') });
      const treasuryWallet = await jetton.wallet(treasury.address);
      const bobWallet = await jetton.wallet(bob.address);
      // At today's prices a wallet would need about ninety idle years to be frozen, so the
      // frozen state is set directly instead of waiting for it.
      await freezeContract(net, bobWallet.address);
      expect(await isActive(net, bobWallet.address)).toBe(false);
      expect(networkFees(net).freezeDueLimit).toBe(toNano('0.1'));
      const before = await jetton.balanceOf(treasury.address);

      const result = await transfer(jetton, treasury, { to: bob.address, amount: tokens('100') });

      expectTx(result, { from: treasuryWallet.address, to: bobWallet.address, op: OP.internalTransfer, success: false });
      expectTx(result, { from: bobWallet.address, to: treasuryWallet.address, inMessageBounced: true, success: true });
      expect(await jetton.balanceOf(treasury.address)).toBe(before);
    });
  });
});
