import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { MilestonePreorderEscrow } from "../typechain-types";

const E = (n: string | number) => ethers.parseEther(String(n));
const DAY = 24 * 60 * 60;
const FUNDING = 7 * DAY;
const WINDOW = 7 * DAY;
const DELIVERY_AFTER_FUNDING = 60 * DAY;
const FEE_BPS = 250n;
const BPS = 10_000n;
const MILESTONES = [3000, 3000, 4000];

enum State {
  Funding,
  Active,
  Completed,
  Failed,
}

async function deployEscrow(opts: {
  merchant: string;
  feeRecipient: string;
  feeBps?: bigint;
  softCap?: bigint;
  hardCap?: bigint;
  milestones?: number[];
}) {
  const deliveryDeadline = (await time.latest()) + FUNDING + DELIVERY_AFTER_FUNDING;
  const escrow = await ethers.deployContract("MilestonePreorderEscrow", [
    opts.merchant,
    opts.feeRecipient,
    opts.feeBps ?? FEE_BPS,
    opts.softCap ?? E(10),
    opts.hardCap ?? E(100),
    FUNDING,
    deliveryDeadline,
    WINDOW,
    opts.milestones ?? MILESTONES,
  ]);
  return { escrow, deliveryDeadline };
}

async function baseFixture() {
  const [deployer, merchant, feeRecipient, alice, bob, carol, dave] = await ethers.getSigners();
  const { escrow, deliveryDeadline } = await deployEscrow({
    merchant: merchant.address,
    feeRecipient: feeRecipient.address,
  });
  return { escrow, deliveryDeadline, deployer, merchant, feeRecipient, alice, bob, carol, dave };
}

/** alice 30, bob 25, carol 45 => hard cap 100 reached, auto Active. */
async function activeFixture() {
  const f = await baseFixture();
  await f.escrow.connect(f.alice).pledge({ value: E(30) });
  await f.escrow.connect(f.bob).pledge({ value: E(25) });
  await f.escrow.connect(f.carol).pledge({ value: E(45) });
  return f;
}

async function submit(escrow: MilestonePreorderEscrow, merchant: { address: string }, i: number) {
  const signer = await ethers.getSigner(merchant.address);
  return escrow.connect(signer).submitMilestoneProof(i, `ipfs://proof-${i}`, ethers.id(`proof-${i}`));
}

async function submitAndDisburse(escrow: MilestonePreorderEscrow, merchant: { address: string }, i: number) {
  await submit(escrow, merchant, i);
  await time.increase(WINDOW);
  await escrow.disburseMilestone(i);
}

describe("MilestonePreorderEscrow", () => {
  describe("constructor validation", () => {
    it("rejects bad parameters", async () => {
      const [, m, r] = await ethers.getSigners();
      const F = await ethers.getContractFactory("MilestonePreorderEscrow");
      const now = await time.latest();
      const okDelivery = now + FUNDING + DELIVERY_AFTER_FUNDING;
      const args = (o: Partial<Record<string, unknown>> = {}) =>
        [
          o.m ?? m.address,
          o.r ?? r.address,
          o.fee ?? 250,
          o.soft ?? E(1),
          o.hard ?? E(2),
          o.fund ?? FUNDING,
          o.delivery ?? okDelivery,
          o.window ?? WINDOW,
          o.ms ?? MILESTONES,
        ] as unknown as Parameters<typeof F.deploy>;

      await expect(F.deploy(...args({ m: ethers.ZeroAddress }))).to.be.revertedWithCustomError(F, "ZeroAddress");
      await expect(F.deploy(...args({ r: ethers.ZeroAddress }))).to.be.revertedWithCustomError(F, "ZeroAddress");
      await expect(F.deploy(...args({ fee: 501 }))).to.be.revertedWithCustomError(F, "InvalidFee");
      await expect(F.deploy(...args({ soft: 0 }))).to.be.revertedWithCustomError(F, "InvalidCap");
      await expect(F.deploy(...args({ soft: E(3) }))).to.be.revertedWithCustomError(F, "InvalidCap");
      await expect(F.deploy(...args({ fund: 0 }))).to.be.revertedWithCustomError(F, "InvalidDuration");
      await expect(F.deploy(...args({ delivery: now + 1 }))).to.be.revertedWithCustomError(F, "InvalidDuration");
      await expect(F.deploy(...args({ window: DAY - 1 }))).to.be.revertedWithCustomError(F, "InvalidChallengeWindow");
      await expect(F.deploy(...args({ window: 30 * DAY + 1 }))).to.be.revertedWithCustomError(
        F,
        "InvalidChallengeWindow",
      );
      await expect(F.deploy(...args({ ms: [] }))).to.be.revertedWithCustomError(F, "InvalidMilestones");
      await expect(F.deploy(...args({ ms: Array(11).fill(909) }))).to.be.revertedWithCustomError(
        F,
        "InvalidMilestones",
      );
      await expect(F.deploy(...args({ ms: [10000, 0] }))).to.be.revertedWithCustomError(F, "InvalidMilestones");
      await expect(F.deploy(...args({ ms: [5000, 4999] }))).to.be.revertedWithCustomError(F, "InvalidMilestones");
      // boundaries accepted: 1 day window, 30 day window, 10 milestones, max fee
      await F.deploy(...args({ window: DAY, fee: 500, ms: Array(10).fill(1000) }));
      await F.deploy(...args({ window: 30 * DAY }));
    });

    it("stores config", async () => {
      const { escrow, merchant, feeRecipient, deliveryDeadline } = await loadFixture(baseFixture);
      expect(await escrow.merchant()).to.equal(merchant.address);
      expect(await escrow.platformFeeRecipient()).to.equal(feeRecipient.address);
      expect(await escrow.platformFeeBps()).to.equal(FEE_BPS);
      expect(await escrow.deliveryDeadline()).to.equal(deliveryDeadline);
      expect(await escrow.challengeWindow()).to.equal(WINDOW);
      expect(await escrow.milestoneCount()).to.equal(3);
      expect(await escrow.state()).to.equal(State.Funding);
      const m0 = await escrow.milestones(0);
      expect(m0.payoutBps).to.equal(3000);
    });
  });

  describe("funding", () => {
    it("records pledges and auto-activates at hard cap", async () => {
      const { escrow, alice, carol, bob } = await loadFixture(baseFixture);
      await expect(escrow.connect(alice).pledge({ value: E(30) }))
        .to.emit(escrow, "PledgeReceived")
        .withArgs(alice.address, E(30), E(30));
      await escrow.connect(bob).pledge({ value: E(25) });
      await expect(escrow.connect(carol).pledge({ value: E(45) }))
        .to.emit(escrow, "StateChanged")
        .withArgs(State.Active);
      expect(await escrow.totalPledged()).to.equal(E(100));
      expect(await escrow.pledges(alice.address)).to.equal(E(30));
    });

    it("rejects zero, merchant, over hard cap, after deadline, after activation", async () => {
      const { escrow, merchant, alice, bob } = await loadFixture(baseFixture);
      await expect(escrow.connect(alice).pledge({ value: 0 })).to.be.revertedWithCustomError(escrow, "ZeroAmount");
      await expect(escrow.connect(merchant).pledge({ value: 1 })).to.be.revertedWithCustomError(
        escrow,
        "Unauthorized",
      );
      await expect(escrow.connect(alice).pledge({ value: E(101) })).to.be.revertedWithCustomError(
        escrow,
        "HardCapExceeded",
      );
      await escrow.connect(alice).pledge({ value: E(1) });
      await time.increase(FUNDING);
      await expect(escrow.connect(bob).pledge({ value: E(1) })).to.be.revertedWithCustomError(escrow, "FundingClosed");
    });

    it("cannot pledge once Active", async () => {
      const { escrow, dave } = await loadFixture(activeFixture);
      await expect(escrow.connect(dave).pledge({ value: 1 })).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("finalizeFunding: too early reverts; anyone finalizes to Active when soft cap met", async () => {
      const { escrow, alice, dave } = await loadFixture(baseFixture);
      await escrow.connect(alice).pledge({ value: E(10) });
      await expect(escrow.finalizeFunding()).to.be.revertedWithCustomError(escrow, "FundingStillOpen");
      await time.increase(FUNDING);
      await expect(escrow.connect(dave).finalizeFunding()).to.emit(escrow, "StateChanged").withArgs(State.Active);
      await expect(escrow.finalizeFunding()).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("finalizeFunding below soft cap fails with a full refund pool", async () => {
      const { escrow, alice, bob } = await loadFixture(baseFixture);
      await escrow.connect(alice).pledge({ value: E(4) });
      await escrow.connect(bob).pledge({ value: E(5) });
      await time.increase(FUNDING);
      await expect(escrow.finalizeFunding()).to.emit(escrow, "CampaignFailed").withArgs(E(9));
      expect(await escrow.state()).to.equal(State.Failed);
      expect(await escrow.refundableAmount(alice.address)).to.equal(E(4));
      await expect(escrow.connect(alice).claimRefund()).to.changeEtherBalances([alice, escrow], [E(4), -E(4)]);
      await expect(escrow.connect(bob).claimRefund()).to.changeEtherBalances([bob, escrow], [E(5), -E(5)]);
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(0);
    });

    it("failure with zero pledges: refundableAmount is 0", async () => {
      const { escrow, alice } = await loadFixture(baseFixture);
      await time.increase(FUNDING);
      await escrow.finalizeFunding();
      expect(await escrow.refundableAmount(alice.address)).to.equal(0);
      await expect(escrow.connect(alice).claimRefund()).to.be.revertedWithCustomError(escrow, "NothingToRefund");
    });
  });

  describe("happy path", () => {
    it("submit -> window -> disburse (no early release) -> complete -> pull withdraw", async () => {
      const { escrow, merchant, feeRecipient, alice, dave } = await loadFixture(activeFixture);

      // Milestone 0: only the merchant can submit, only the current index
      await expect(
        escrow.connect(alice).submitMilestoneProof(0, "x", ethers.ZeroHash),
      ).to.be.revertedWithCustomError(escrow, "Unauthorized");
      await expect(submit(escrow, merchant, 1)).to.be.revertedWithCustomError(escrow, "InvalidMilestones");
      await expect(escrow.disburseMilestone(0)).to.be.revertedWithCustomError(escrow, "MilestoneNotSubmitted");
      await expect(submit(escrow, merchant, 0)).to.emit(escrow, "MilestoneSubmitted");
      await expect(submit(escrow, merchant, 0)).to.be.revertedWithCustomError(escrow, "MilestoneAlreadySubmitted");

      // Merchant cannot self-approve: disbursement blocked during window
      await expect(escrow.connect(dave).disburseMilestone(0)).to.be.revertedWithCustomError(
        escrow,
        "ChallengeWindowOpen",
      );
      await time.increase(WINDOW);
      const gross0 = (E(100) * 3000n) / BPS;
      const fee0 = (gross0 * FEE_BPS) / BPS;
      await expect(escrow.connect(dave).disburseMilestone(0))
        .to.emit(escrow, "MilestoneDisbursed")
        .withArgs(0, gross0 - fee0, fee0);
      expect(await escrow.withdrawable(merchant.address)).to.equal(gross0 - fee0);
      expect(await escrow.withdrawable(feeRecipient.address)).to.equal(fee0);
      expect(await escrow.currentMilestone()).to.equal(1);
      await expect(escrow.disburseMilestone(0)).to.be.revertedWithCustomError(escrow, "InvalidMilestones");

      // Milestone 1: no early release, disbursement waits for the full window
      await submit(escrow, merchant, 1);
      await time.increase(WINDOW - 5);
      await expect(escrow.disburseMilestone(1)).to.be.revertedWithCustomError(escrow, "ChallengeWindowOpen");
      await time.increase(5);
      await escrow.disburseMilestone(1);

      // Milestone 2 completes the campaign
      await submit(escrow, merchant, 2);
      await time.increase(WINDOW);
      await expect(escrow.disburseMilestone(2)).to.emit(escrow, "StateChanged").withArgs(State.Completed);
      expect(await escrow.totalDisbursed()).to.equal(E(100));

      const totalFee = (E(100) * FEE_BPS) / BPS;
      expect(await escrow.withdrawable(feeRecipient.address)).to.equal(totalFee);
      expect(await escrow.withdrawable(merchant.address)).to.equal(E(100) - totalFee);

      await expect(escrow.connect(merchant).withdraw())
        .to.emit(escrow, "Withdrawal")
        .withArgs(merchant.address, E(100) - totalFee);
      await expect(escrow.connect(feeRecipient).withdraw()).to.changeEtherBalance(feeRecipient, totalFee);
      await expect(escrow.connect(merchant).withdraw()).to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(0);

      // Terminal: nothing else works
      await expect(escrow.disburseMilestone(2)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.markFailed()).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(alice).claimRefund()).to.be.revertedWithCustomError(escrow, "InvalidState");
      expect(await escrow.refundableAmount(alice.address)).to.equal(0);
    });

    it("last milestone takes exact remainder (no dust locked)", async () => {
      const [, merchant, feeRecipient, alice, bob] = await ethers.getSigners();
      const { escrow } = await deployEscrow({
        merchant: merchant.address,
        feeRecipient: feeRecipient.address,
        milestones: [3333, 3333, 3334],
        softCap: 1n,
        hardCap: E(1000),
      });
      await escrow.connect(alice).pledge({ value: E(10) + 7n });
      await escrow.connect(bob).pledge({ value: 13n });
      await time.increase(FUNDING);
      await escrow.finalizeFunding();
      for (let i = 0; i < 3; i++) await submitAndDisburse(escrow, merchant, i);
      expect(await escrow.totalDisbursed()).to.equal(await escrow.totalPledged());
      await escrow.connect(merchant).withdraw();
      await escrow.connect(feeRecipient).withdraw();
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(0);
    });

    it("zero platform fee credits nothing to the fee recipient", async () => {
      const [, merchant, feeRecipient, alice] = await ethers.getSigners();
      const { escrow } = await deployEscrow({
        merchant: merchant.address,
        feeRecipient: feeRecipient.address,
        feeBps: 0n,
        milestones: [10000],
        softCap: E(1),
        hardCap: E(1),
      });
      await escrow.connect(alice).pledge({ value: E(1) });
      await submitAndDisburse(escrow, merchant, 0);
      expect(await escrow.withdrawable(feeRecipient.address)).to.equal(0);
      expect(await escrow.withdrawable(merchant.address)).to.equal(E(1));
    });
  });

  describe("challenge window voting", () => {
    it("vote guards", async () => {
      const { escrow, merchant, alice, dave } = await loadFixture(activeFixture);
      await expect(escrow.connect(alice).object(0)).to.be.revertedWithCustomError(escrow, "MilestoneNotSubmitted");
      await submit(escrow, merchant, 0);
      await expect(escrow.connect(alice).object(1)).to.be.revertedWithCustomError(escrow, "InvalidMilestones");
      await expect(escrow.connect(dave).object(0)).to.be.revertedWithCustomError(escrow, "NotBacker");
      await expect(escrow.connect(merchant).object(0)).to.be.revertedWithCustomError(escrow, "NotBacker");
      await escrow.connect(alice).object(0);
      expect(await escrow.hasObjected(0, alice.address)).to.equal(true);
      expect(await escrow.hasObjected(0, dave.address)).to.equal(false);
      await expect(escrow.connect(alice).object(0)).to.be.revertedWithCustomError(escrow, "AlreadyObjected");
      await time.increase(WINDOW);
      await expect(escrow.connect(dave).object(0)).to.be.revertedWithCustomError(escrow, "ChallengeWindowClosed");
    });

    it("cannot vote outside Active", async () => {
      const { escrow, alice } = await loadFixture(baseFixture);
      await expect(escrow.connect(alice).object(0)).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("minority objection (<= 50%) does not block disbursement after the window", async () => {
      const { escrow, merchant, carol } = await loadFixture(activeFixture);
      await submit(escrow, merchant, 0);
      await expect(escrow.connect(carol).object(0))
        .to.emit(escrow, "MilestoneObjected")
        .withArgs(0, carol.address, E(45), E(45));
      expect(await escrow.state()).to.equal(State.Active);
      await time.increase(WINDOW);
      await escrow.disburseMilestone(0);
      expect(await escrow.currentMilestone()).to.equal(1);
    });

    it("exactly 50% objection is not enough to fail", async () => {
      const [, merchant, feeRecipient, alice, bob] = await ethers.getSigners();
      const { escrow } = await deployEscrow({ merchant: merchant.address, feeRecipient: feeRecipient.address });
      await escrow.connect(alice).pledge({ value: E(50) });
      await escrow.connect(bob).pledge({ value: E(50) });
      await submit(escrow, merchant, 0);
      await escrow.connect(alice).object(0);
      expect(await escrow.state()).to.equal(State.Active);
    });

    it("objection > 50% fails the campaign with full refunds before any disbursement", async () => {
      const { escrow, merchant, alice, bob, carol } = await loadFixture(activeFixture);
      await submit(escrow, merchant, 0);
      await escrow.connect(carol).object(0); // 45
      await expect(escrow.connect(bob).object(0)) // 70
        .to.emit(escrow, "CampaignFailed")
        .withArgs(E(100));
      expect(await escrow.state()).to.equal(State.Failed);
      await expect(escrow.disburseMilestone(0)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(alice).object(0)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(alice).claimRefund()).to.changeEtherBalance(alice, E(30));
    });

    it("objection > 50% after one disbursement: pro-rata refund of undisbursed pool is exact", async () => {
      const { escrow, merchant, feeRecipient, alice, bob, carol } = await loadFixture(activeFixture);
      await submitAndDisburse(escrow, merchant, 0); // 30 disbursed
      await submit(escrow, merchant, 1);
      await escrow.connect(carol).object(1);
      await escrow.connect(bob).object(1);
      expect(await escrow.state()).to.equal(State.Failed);
      expect(await escrow.remainingPoolAtFailure()).to.equal(E(70));

      expect(await escrow.refundableAmount(alice.address)).to.equal(E(21));
      await expect(escrow.connect(alice).claimRefund())
        .to.emit(escrow, "RefundClaimed")
        .withArgs(alice.address, E(21));
      await expect(escrow.connect(bob).claimRefund()).to.changeEtherBalance(bob, E("17.5"));
      await expect(escrow.connect(carol).claimRefund()).to.changeEtherBalance(carol, E("31.5"));
      expect(await escrow.totalRefunded()).to.equal(E(70));
      expect(await escrow.refundedAmounts(carol.address)).to.equal(E("31.5"));
      await expect(escrow.connect(alice).claimRefund()).to.be.revertedWithCustomError(escrow, "AlreadyRefunded");
      expect(await escrow.refundableAmount(alice.address)).to.equal(0);

      // Merchant and fee recipient can still pull what milestone 0 earned
      await escrow.connect(merchant).withdraw();
      await escrow.connect(feeRecipient).withdraw();
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(0);
    });

    it("pro-rata refunds round down, never exceed the pool, and leave only dust", async () => {
      const [, merchant, feeRecipient, a, b, c, d] = await ethers.getSigners();
      const { escrow } = await deployEscrow({
        merchant: merchant.address,
        feeRecipient: feeRecipient.address,
        softCap: 1n,
        hardCap: E(1000),
      });
      const pledges = [E(3) + 1n, E(7) + 3n, E(11) + 5n, 1n];
      const backers = [a, b, c, d];
      for (let i = 0; i < 4; i++) await escrow.connect(backers[i]).pledge({ value: pledges[i] });
      await time.increase(FUNDING);
      await escrow.finalizeFunding();
      await submitAndDisburse(escrow, merchant, 0);
      await submit(escrow, merchant, 1);
      await escrow.connect(c).object(1); // c alone holds > 50% of weight
      expect(await escrow.state()).to.equal(State.Failed);

      const total = pledges.reduce((x, y) => x + y, 0n);
      const remaining = await escrow.remainingPoolAtFailure();
      expect(remaining).to.equal(total - (total * 3000n) / BPS);
      let paid = 0n;
      for (let i = 0; i < 3; i++) {
        const expected = (pledges[i] * remaining) / total;
        await expect(escrow.connect(backers[i]).claimRefund()).to.changeEtherBalance(backers[i], expected);
        paid += expected;
      }
      // 1 wei pledge rounds to zero refund
      await expect(escrow.connect(d).claimRefund()).to.be.revertedWithCustomError(escrow, "NothingToRefund");
      expect(paid).to.be.lte(remaining);
      await escrow.connect(merchant).withdraw();
      await escrow.connect(feeRecipient).withdraw();
      const dust = await ethers.provider.getBalance(escrow.target);
      expect(dust).to.equal(remaining - paid);
      expect(dust).to.be.lt(4n);
    });
  });

  describe("delivery deadline", () => {
    it("markFailed only after deadline and when no proof is pending", async () => {
      const { escrow, merchant, deliveryDeadline, alice, dave } = await loadFixture(activeFixture);
      await expect(escrow.markFailed()).to.be.revertedWithCustomError(escrow, "DeliveryDeadlineNotReached");

      // proof submitted before deadline protects the merchant until its window resolves
      await time.increaseTo(deliveryDeadline - 10);
      await submit(escrow, merchant, 0);
      await time.increaseTo(deliveryDeadline + 1);
      await expect(escrow.markFailed()).to.be.revertedWithCustomError(escrow, "MilestonePending");
      await time.increase(WINDOW);
      await escrow.disburseMilestone(0);

      // no new proofs after the deadline; anyone can now fail it
      await expect(submit(escrow, merchant, 1)).to.be.revertedWithCustomError(escrow, "DeliveryDeadlinePassed");
      await expect(escrow.connect(dave).markFailed()).to.emit(escrow, "CampaignFailed").withArgs(E(70));
      await expect(escrow.connect(alice).claimRefund()).to.changeEtherBalance(alice, E(21));
      await expect(escrow.markFailed()).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("abandoned campaign with zero milestones delivered refunds everything", async () => {
      const { escrow, deliveryDeadline, carol } = await loadFixture(activeFixture);
      await time.increaseTo(deliveryDeadline + 1);
      await escrow.markFailed();
      await expect(escrow.connect(carol).claimRefund()).to.changeEtherBalance(carol, E(45));
    });

    it("submitting proof requires Active", async () => {
      const { escrow, merchant } = await loadFixture(baseFixture);
      await expect(submit(escrow, merchant, 0)).to.be.revertedWithCustomError(escrow, "InvalidState");
    });
  });

  describe("pull payments and reentrancy", () => {
    it("reverting fee recipient cannot block merchant payout", async () => {
      const [, merchant, alice] = await ethers.getSigners();
      const bad = await ethers.deployContract("RevertingReceiver");
      const { escrow } = await deployEscrow({
        merchant: merchant.address,
        feeRecipient: await bad.getAddress(),
        milestones: [10000],
      });
      await escrow.connect(alice).pledge({ value: E(100) });
      await submitAndDisburse(escrow, merchant, 0);
      expect(await escrow.state()).to.equal(State.Completed);
      await expect(escrow.connect(merchant).withdraw()).to.changeEtherBalance(merchant, E("97.5"));

      // the bad recipient's own withdraw reverts but keeps its credit
      const data = escrow.interface.encodeFunctionData("withdraw");
      await expect(bad.execute(escrow.target, 0, data)).to.be.revertedWithCustomError(escrow, "TransferFailed");
      expect(await escrow.withdrawable(bad.target)).to.equal(E("2.5"));
    });

    it("claimRefund to a reverting backer reverts and preserves the claim", async () => {
      const [, merchant, feeRecipient] = await ethers.getSigners();
      const bad = await ethers.deployContract("RevertingReceiver");
      const { escrow } = await deployEscrow({ merchant: merchant.address, feeRecipient: feeRecipient.address });
      await bad.execute(escrow.target, E(1), escrow.interface.encodeFunctionData("pledge"), { value: E(1) });
      await time.increase(FUNDING);
      await escrow.finalizeFunding();
      await expect(
        bad.execute(escrow.target, 0, escrow.interface.encodeFunctionData("claimRefund")),
      ).to.be.revertedWithCustomError(escrow, "TransferFailed");
      expect(await escrow.refundableAmount(bad.target)).to.equal(E(1));
    });

    it("attacker cannot reenter claimRefund or withdraw during a refund", async () => {
      const [, merchant, feeRecipient, alice] = await ethers.getSigners();
      const attacker = await ethers.deployContract("ReentrantAttacker");
      const { escrow } = await deployEscrow({ merchant: merchant.address, feeRecipient: feeRecipient.address });
      const iface = escrow.interface;
      await attacker.execute(escrow.target, E(5), iface.encodeFunctionData("pledge"), { value: E(5) });
      await escrow.connect(alice).pledge({ value: E(4) });
      await time.increase(FUNDING);
      await escrow.finalizeFunding(); // 9 < soft cap 10 => Failed

      const guard = iface.getError("ReentrancyGuard")!.selector;
      await attacker.setReentry(escrow.target, iface.encodeFunctionData("claimRefund"));
      await expect(
        attacker.execute(escrow.target, 0, iface.encodeFunctionData("claimRefund")),
      ).to.changeEtherBalance(attacker, E(5));
      expect(await attacker.reentryAttempts()).to.equal(1);
      expect(await attacker.lastReentrySucceeded()).to.equal(false);
      expect(await attacker.lastReentryReturn()).to.equal(guard);
      expect(await escrow.totalRefunded()).to.equal(E(5));
      await expect(escrow.connect(alice).claimRefund()).to.changeEtherBalance(alice, E(4));
    });

    it("malicious merchant cannot reenter withdraw", async () => {
      const [, feeRecipient, alice] = await ethers.getSigners();
      const attacker = await ethers.deployContract("ReentrantAttacker");
      const { escrow } = await deployEscrow({
        merchant: await attacker.getAddress(),
        feeRecipient: feeRecipient.address,
        milestones: [10000],
      });
      const iface = escrow.interface;
      await escrow.connect(alice).pledge({ value: E(100) });
      await attacker.execute(
        escrow.target,
        0,
        iface.encodeFunctionData("submitMilestoneProof", [0, "ipfs://x", ethers.ZeroHash]),
      );
      await time.increase(WINDOW);
      await escrow.disburseMilestone(0);

      await attacker.setReentry(escrow.target, iface.encodeFunctionData("withdraw"));
      await expect(attacker.execute(escrow.target, 0, iface.encodeFunctionData("withdraw"))).to.changeEtherBalance(
        attacker,
        E("97.5"),
      );
      expect(await attacker.lastReentrySucceeded()).to.equal(false);
      expect(await attacker.lastReentryReturn()).to.equal(iface.getError("ReentrancyGuard")!.selector);
      expect(await escrow.withdrawable(attacker.target)).to.equal(0);
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(E("2.5"));
    });
  });
});
