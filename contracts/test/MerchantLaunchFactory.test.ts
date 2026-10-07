import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { ContractTransactionResponse } from "ethers";
import type { MerchantLaunchFactory } from "../typechain-types";

const E = (n: string | number) => ethers.parseEther(String(n));
const DAY = 24 * 60 * 60;
const FEE = E("0.01");

async function fixture() {
  const [owner, feeRecipient, merchant, alice, bob, newOwner] = await ethers.getSigners();
  const factory = await ethers.deployContract("MerchantLaunchFactory", [feeRecipient.address, FEE]);
  return { factory, owner, feeRecipient, merchant, alice, bob, newOwner };
}

async function deployedAddress(
  factory: MerchantLaunchFactory,
  tx: ContractTransactionResponse,
  eventName: "LoyaltyTokenDeployed" | "PreorderEscrowDeployed",
) {
  const receipt = await tx.wait();
  for (const log of receipt!.logs) {
    const parsed = factory.interface.parseLog(log);
    if (parsed?.name === eventName) return parsed.args[0] as string;
  }
  throw new Error(`${eventName} not emitted`);
}

async function escrowArgs(overrides: { funding?: number; deliveryOffset?: number; window?: number; ms?: number[] } = {}) {
  const funding = overrides.funding ?? 7 * DAY;
  const delivery = (await time.latest()) + funding + (overrides.deliveryOffset ?? 30 * DAY);
  return [E(1), E(10), funding, delivery, overrides.window ?? 7 * DAY, overrides.ms ?? [5000, 5000]] as const;
}

describe("MerchantLaunchFactory", () => {
  it("constructor validates recipient and sets owner", async () => {
    const { factory, owner, feeRecipient } = await loadFixture(fixture);
    expect(await factory.owner()).to.equal(owner.address);
    expect(await factory.platformFeeRecipient()).to.equal(feeRecipient.address);
    expect(await factory.deploymentFee()).to.equal(FEE);
    expect(await factory.defaultPlatformFeeBps()).to.equal(250);
    expect(await factory.MAX_PLATFORM_FEE_BPS()).to.equal(500);
    const F = await ethers.getContractFactory("MerchantLaunchFactory");
    await expect(F.deploy(ethers.ZeroAddress, 0)).to.be.revertedWithCustomError(F, "ZeroAddress");
  });

  describe("loyalty tokens", () => {
    it("deploys a merchant-owned, transfer-restricted token for the exact fee", async () => {
      const { factory, merchant, alice, bob } = await loadFixture(fixture);
      const tx = await factory.connect(merchant).deployLoyaltyToken("Cafe", "CAFE", E(100), E(1000), { value: FEE });
      await expect(tx).to.emit(factory, "LoyaltyTokenDeployed");
      const token = await ethers.getContractAt("LoyaltyVoucherToken", await deployedAddress(factory, tx, "LoyaltyTokenDeployed"));
      expect(await token.merchant()).to.equal(merchant.address);
      expect(await token.balanceOf(merchant.address)).to.equal(E(100));
      expect(await token.transferable()).to.equal(false);
      expect(await factory.accruedFees()).to.equal(FEE);

      // closed loop: customer-to-customer transfers are rejected
      await token.connect(merchant).transfer(alice.address, E(10));
      await expect(token.connect(alice).transfer(bob.address, E(1))).to.be.revertedWithCustomError(
        token,
        "TransferRestricted",
      );
      await token.connect(alice).transfer(merchant.address, E(1));
    });

    it("rejects underpayment and overpayment", async () => {
      const { factory, merchant } = await loadFixture(fixture);
      await expect(
        factory.connect(merchant).deployLoyaltyToken("a", "b", 0, 1, { value: FEE - 1n }),
      ).to.be.revertedWithCustomError(factory, "IncorrectFee");
      await expect(
        factory.connect(merchant).deployLoyaltyToken("a", "b", 0, 1, { value: FEE + 1n }),
      ).to.be.revertedWithCustomError(factory, "IncorrectFee");
      expect(await ethers.provider.getBalance(factory.target)).to.equal(0);
    });

    it("works with zero deployment fee", async () => {
      const { factory, owner, merchant } = await loadFixture(fixture);
      await expect(factory.connect(owner).setDeploymentFee(0)).to.emit(factory, "DeploymentFeeUpdated").withArgs(0);
      await factory.connect(merchant).deployLoyaltyToken("a", "b", 0, 1);
      await expect(factory.withdrawFees()).to.be.revertedWithCustomError(factory, "NothingToWithdraw");
    });
  });

  describe("escrows", () => {
    it("deploys an escrow wired to merchant, recipient, and default fee", async () => {
      const { factory, merchant, feeRecipient } = await loadFixture(fixture);
      const args = await escrowArgs();
      const tx = await factory.connect(merchant).deployPreorderEscrow(...args, { value: FEE });
      const escrow = await ethers.getContractAt(
        "MilestonePreorderEscrow",
        await deployedAddress(factory, tx, "PreorderEscrowDeployed"),
      );
      const fundingDeadline = BigInt((await time.latest()) + args[2]);
      await expect(tx)
        .to.emit(factory, "PreorderEscrowDeployed")
        .withArgs(escrow.target, merchant.address, args[0], args[1], fundingDeadline, args[3], args[4]);
      expect(await escrow.merchant()).to.equal(merchant.address);
      expect(await escrow.platformFeeRecipient()).to.equal(feeRecipient.address);
      expect(await escrow.platformFeeBps()).to.equal(250);
      expect(await escrow.fundingDeadline()).to.equal(fundingDeadline);
      expect(await escrow.milestoneCount()).to.equal(2);
    });

    it("bounds milestone count to 1..10", async () => {
      const { factory, merchant } = await loadFixture(fixture);
      await expect(
        factory.connect(merchant).deployPreorderEscrow(...(await escrowArgs({ ms: [] })), { value: FEE }),
      ).to.be.revertedWithCustomError(factory, "InvalidMilestones");
      await expect(
        factory
          .connect(merchant)
          .deployPreorderEscrow(...(await escrowArgs({ ms: Array(11).fill(909) })), { value: FEE }),
      ).to.be.revertedWithCustomError(factory, "InvalidMilestones");
      await factory.connect(merchant).deployPreorderEscrow(...(await escrowArgs({ ms: Array(10).fill(1000) })), {
        value: FEE,
      });
      await factory.connect(merchant).deployPreorderEscrow(...(await escrowArgs({ ms: [10000] })), { value: FEE });
    });

    it("validates durations and challenge window", async () => {
      const { factory, merchant } = await loadFixture(fixture);
      const go = async (o: Parameters<typeof escrowArgs>[0]) =>
        factory.connect(merchant).deployPreorderEscrow(...(await escrowArgs(o)), { value: FEE });
      await expect(go({ funding: 0 })).to.be.revertedWithCustomError(factory, "InvalidDuration");
      await expect(go({ deliveryOffset: -1 })).to.be.revertedWithCustomError(factory, "InvalidDuration");
      await expect(go({ window: DAY - 1 })).to.be.revertedWithCustomError(factory, "InvalidChallengeWindow");
      await expect(go({ window: 30 * DAY + 1 })).to.be.revertedWithCustomError(factory, "InvalidChallengeWindow");
      await go({ window: DAY });
    });

    it("rejects incorrect fee", async () => {
      const { factory, merchant } = await loadFixture(fixture);
      await expect(
        factory.connect(merchant).deployPreorderEscrow(...(await escrowArgs()), { value: FEE * 2n }),
      ).to.be.revertedWithCustomError(factory, "IncorrectFee");
    });
  });

  describe("platform fee cap", () => {
    it("owner can set default bps up to the cap; new escrows use it", async () => {
      const { factory, owner, merchant } = await loadFixture(fixture);
      await expect(factory.connect(owner).setDefaultPlatformFeeBps(501)).to.be.revertedWithCustomError(
        factory,
        "FeeTooHigh",
      );
      await expect(factory.connect(owner).setDefaultPlatformFeeBps(500))
        .to.emit(factory, "DefaultPlatformFeeBpsUpdated")
        .withArgs(500);
      const tx = await factory.connect(merchant).deployPreorderEscrow(...(await escrowArgs()), { value: FEE });
      const escrow = await ethers.getContractAt(
        "MilestonePreorderEscrow",
        await deployedAddress(factory, tx, "PreorderEscrowDeployed"),
      );
      expect(await escrow.platformFeeBps()).to.equal(500);
    });

    it("admin setters are owner-only", async () => {
      const { factory, alice } = await loadFixture(fixture);
      const f = factory.connect(alice);
      await expect(f.setDefaultPlatformFeeBps(1)).to.be.revertedWithCustomError(factory, "Unauthorized");
      await expect(f.setDeploymentFee(1)).to.be.revertedWithCustomError(factory, "Unauthorized");
      await expect(f.setPlatformFeeRecipient(alice.address)).to.be.revertedWithCustomError(factory, "Unauthorized");
      await expect(f.transferOwnership(alice.address)).to.be.revertedWithCustomError(factory, "Unauthorized");
    });

    it("setPlatformFeeRecipient rejects zero address", async () => {
      const { factory, alice } = await loadFixture(fixture);
      await expect(factory.setPlatformFeeRecipient(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        factory,
        "ZeroAddress",
      );
      await expect(factory.setPlatformFeeRecipient(alice.address))
        .to.emit(factory, "PlatformFeeRecipientUpdated")
        .withArgs(alice.address);
    });
  });

  describe("deployment fee pull withdrawal", () => {
    it("anyone can push accrued fees to the recipient", async () => {
      const { factory, feeRecipient, merchant, bob } = await loadFixture(fixture);
      await factory.connect(merchant).deployLoyaltyToken("a", "b", 0, 1, { value: FEE });
      await factory.connect(merchant).deployPreorderEscrow(...(await escrowArgs()), { value: FEE });
      await expect(factory.connect(bob).withdrawFees())
        .to.emit(factory, "FeesWithdrawn")
        .withArgs(feeRecipient.address, FEE * 2n);
      expect(await factory.accruedFees()).to.equal(0);
      await expect(factory.withdrawFees()).to.be.revertedWithCustomError(factory, "NothingToWithdraw");
    });

    it("reverting recipient cannot block deployments; owner can rotate recipient", async () => {
      const { factory, owner, merchant, alice } = await loadFixture(fixture);
      const bad = await ethers.deployContract("RevertingReceiver");
      await factory.connect(owner).setPlatformFeeRecipient(bad.target);
      await factory.connect(merchant).deployLoyaltyToken("a", "b", 0, 1, { value: FEE });
      await factory.connect(merchant).deployPreorderEscrow(...(await escrowArgs()), { value: FEE });
      await expect(factory.withdrawFees()).to.be.revertedWithCustomError(factory, "TransferFailed");
      expect(await factory.accruedFees()).to.equal(FEE * 2n);
      await factory.connect(owner).setPlatformFeeRecipient(alice.address);
      await expect(factory.withdrawFees()).to.changeEtherBalance(alice, FEE * 2n);
    });
  });

  describe("two-step ownership", () => {
    it("transfer requires acceptance by the pending owner", async () => {
      const { factory, owner, newOwner, alice } = await loadFixture(fixture);
      await expect(factory.transferOwnership(newOwner.address))
        .to.emit(factory, "OwnershipTransferStarted")
        .withArgs(owner.address, newOwner.address);
      expect(await factory.owner()).to.equal(owner.address);
      expect(await factory.pendingOwner()).to.equal(newOwner.address);
      await expect(factory.connect(alice).acceptOwnership()).to.be.revertedWithCustomError(factory, "Unauthorized");
      await expect(factory.connect(newOwner).acceptOwnership())
        .to.emit(factory, "OwnershipTransferred")
        .withArgs(owner.address, newOwner.address);
      expect(await factory.owner()).to.equal(newOwner.address);
      expect(await factory.pendingOwner()).to.equal(ethers.ZeroAddress);
      await expect(factory.connect(owner).setDeploymentFee(0)).to.be.revertedWithCustomError(factory, "Unauthorized");
      await factory.connect(newOwner).setDeploymentFee(0);
    });

    it("pending transfer can be cancelled with address(0)", async () => {
      const { factory, newOwner } = await loadFixture(fixture);
      await factory.transferOwnership(newOwner.address);
      await factory.transferOwnership(ethers.ZeroAddress);
      await expect(factory.connect(newOwner).acceptOwnership()).to.be.revertedWithCustomError(factory, "Unauthorized");
    });
  });
});
