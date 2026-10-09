import { describe, expect, it } from 'vitest';
import { beginCell, toNano } from '@ton/core';
import type { SendMessageResult } from '@ton/sandbox';
import {
  buildOnchainContent,
  burn,
  commentPayload,
  deployJetton,
  emptyPayload,
  expectConservation,
  expectNoMint,
  expectTx,
  type LocalWallet,
  OP,
  seededRandom,
  startLocalNet,
  TEST_SEED,
  tonBalance,
  toUnits,
  transfer,
  ZERO_ADDRESS,
} from './harness';

/**
 * Hundreds of random messages of every kind the contracts accept, and some
 * they must refuse. After each one:
 *
 * - nothing was minted (the master sent no credit to any wallet);
 * - the supply the master reports equals the sum of all balances, and equals
 *   the launch supply minus what was burned;
 * - the master holds exactly the Toncoin it held before, plus top-ups.
 */
describe('Invariants under random use', () => {
  for (const seed of [20261007, 7, 424242]) {
    it(`holds across 150 random messages (seed ${seed})`, async () => {
      const net = await startLocalNet(`${TEST_SEED}/invariants/${seed}`);
      const jetton = await deployJetton(net);
      const { treasury, alice, bob, merchant, mallory } = net.wallets;
      const holders: LocalWallet[] = [treasury, alice, bob, merchant, mallory];
      const addresses = holders.map((holder) => holder.address);
      const tokens = (amount: string) => toUnits(jetton.profile, amount);
      const random = seededRandom(seed);
      const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
      const value = toNano('0.05');

      // Everyone starts with something, so few steps are wasted on empty wallets.
      for (const holder of [alice, bob, merchant, mallory]) {
        await transfer(jetton, treasury, { to: holder.address, amount: tokens('1000') });
      }

      let burned = 0n;
      let admin: LocalWallet | null = treasury;
      let proposed: LocalWallet | null = null;
      let masterTon = await tonBalance(net, jetton.master.address);
      const counts: Record<string, number> = {};

      for (let step = 0; step < 150; step++) {
        const roll = random();
        const actor = pick(holders);
        let kind: string;
        let result: SendMessageResult;

        if (roll < 0.34) {
          kind = 'transfer';
          const balance = await jetton.balanceOf(actor.address);
          const amount = (balance * BigInt(Math.floor(random() * 60))) / 100n;
          result = await transfer(jetton, actor, {
            to: pick(holders).address,
            amount,
            forwardTon: random() < 0.5 ? 1n : 0n,
            payload: random() < 0.5 ? commentPayload(`step ${step}`) : emptyPayload(),
            response: random() < 0.8 ? actor.address : null,
          });
        } else if (roll < 0.46) {
          kind = 'burn';
          const balance = await jetton.balanceOf(actor.address);
          const amount = (balance * BigInt(Math.floor(random() * 30))) / 100n;
          result = await burn(jetton, actor, { amount });
          burned += amount;
        } else if (roll < 0.52) {
          kind = 'overspend';
          const balance = await jetton.balanceOf(actor.address);
          result = await transfer(jetton, actor, { to: pick(holders).address, amount: balance + 1n });
        } else if (roll < 0.6) {
          kind = 'discovery';
          result = await jetton.master.send(
            actor.getSender(),
            { value },
            { $$type: 'ProvideWalletAddress', queryId: BigInt(step), ownerAddress: pick(holders).address, includeAddress: random() < 0.5 },
          );
        } else if (roll < 0.65) {
          kind = 'top-up';
          const amount = toNano('0.01');
          result = await actor.send({ to: jetton.master.address, value: amount });
          // The master keeps the top-up, less the gas for receiving it.
          const received = expectTx(result, { to: jetton.master.address, success: true, outMessagesCount: 0 });
          masterTon += amount - received.totalFees.coins;
        } else if (roll < 0.72) {
          kind = 'propose admin';
          const next = pick(holders);
          result = await jetton.master.send(actor.getSender(), { value }, { $$type: 'ChangeAdmin', queryId: 0n, nextAdmin: next.address });
          if (admin && actor.address.equals(admin.address)) proposed = next;
        } else if (roll < 0.79) {
          kind = 'claim admin';
          result = await jetton.master.send(actor.getSender(), { value }, { $$type: 'ClaimAdmin', queryId: 0n });
          if (proposed && actor.address.equals(proposed.address)) {
            admin = proposed;
            proposed = null;
          }
        } else if (roll < 0.86) {
          kind = 'update metadata';
          const content = buildOnchainContent({ ...jetton.profile.metadata, description: `step ${step}` });
          result = await jetton.master.send(actor.getSender(), { value }, { $$type: 'UpdateContent', queryId: 0n, content });
        } else if (roll < 0.9) {
          kind = 'launch again';
          result = await jetton.master.send(actor.getSender(), { value: toNano('1') }, { $$type: 'Launch', queryId: 0n });
        } else if (roll < 0.95) {
          kind = 'forged credit';
          const target = await jetton.wallet(pick(holders).address);
          result = await target.send(
            actor.getSender(),
            { value },
            {
              $$type: 'JettonTransferInternal',
              queryId: 0n,
              amount: tokens('1000000'),
              sender: pick(holders).address,
              responseDestination: actor.address,
              forwardTonAmount: 0n,
              forwardPayload: emptyPayload(),
            },
          );
        } else if (roll < 0.985) {
          kind = 'forged burn notification';
          result = await jetton.master.send(
            actor.getSender(),
            { value },
            { $$type: 'JettonBurnNotification', queryId: 0n, amount: tokens('5'), sender: pick(holders).address, responseDestination: actor.address },
          );
        } else {
          kind = 'drop admin';
          result = await jetton.master.send(actor.getSender(), { value }, { $$type: 'DropAdmin', queryId: 0n });
          if (admin && actor.address.equals(admin.address)) {
            admin = null;
            proposed = null;
          }
        }
        counts[kind] = (counts[kind] ?? 0) + 1;

        const context = `step ${step} (${kind})`;
        expectNoMint(jetton, result);
        await expectConservation(jetton, addresses, burned);
        expect(await tonBalance(net, jetton.master.address), context).toBe(masterTon);
        const data = await jetton.master.getGetJettonData();
        expect(data.mintable, context).toBe(false);
        expect(data.adminAddress.equals(admin ? admin.address : ZERO_ADDRESS), context).toBe(true);
        const pending = await jetton.master.getGetNextAdminAddress();
        expect(pending === null ? null : pending.toString(), context).toBe(proposed ? proposed.address.toString() : null);
      }

      // The run really exercised the main paths.
      expect(counts.transfer).toBeGreaterThan(20);
      expect(counts.burn).toBeGreaterThan(5);
      expect(burned).toBeGreaterThan(0n);
      expect(await jetton.master.getGetGenesisSupply()).toBe(jetton.supply);
    });
  }

  it('the master never sends a credit after launch, whatever opcode it receives', async () => {
    const net = await startLocalNet(`${TEST_SEED}/invariants/opcodes`);
    const jetton = await deployJetton(net);
    const { treasury, mallory } = net.wallets;
    const opcodes = [...Object.values(OP), 0, 1, 2, 3, 5, 21, 22, 0x642b7d07, 0xffffffff];

    for (const sender of [treasury, mallory]) {
      for (const opcode of opcodes) {
        const body = beginCell().storeUint(opcode, 32).storeUint(0, 64).storeCoins(toNano('1')).storeAddress(sender.address).storeAddress(sender.address).storeCoins(0).storeBit(false).endCell();
        const result = await sender.send({ to: jetton.master.address, value: toNano('1'), body });
        expectNoMint(jetton, result);
      }
    }
    expect(await jetton.totalSupply()).toBe(jetton.supply);
    expect(await jetton.balanceOf(treasury.address)).toBe(jetton.supply);
    expect(await jetton.balanceOf(mallory.address)).toBe(0n);
  });
});
