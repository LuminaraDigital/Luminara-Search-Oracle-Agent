import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const E = (n: string | number) => ethers.parseEther(String(n));

describe("LoyaltyVoucherToken", () => {
  async function deploy(transferable: boolean) {
    const [merchant, alice, bob, spender] = await ethers.getSigners();
    const token = await ethers.deployContract("LoyaltyVoucherToken", [
      "Cafe Points",
      "CAFE",
      E(1000),
      E(10000),
      merchant.address,
      transferable,
    ]);
    return { token, merchant, alice, bob, spender };
  }
  const restricted = () => deploy(false);
  const open = () => deploy(true);

  describe("constructor", () => {
    it("mints initial supply to merchant and stores config", async () => {
      const { token, merchant } = await loadFixture(restricted);
      expect(await token.name()).to.equal("Cafe Points");
      expect(await token.symbol()).to.equal("CAFE");
      expect(await token.decimals()).to.equal(18);
      expect(await token.totalSupply()).to.equal(E(1000));
      expect(await token.maxSupply()).to.equal(E(10000));
      expect(await token.balanceOf(merchant.address)).to.equal(E(1000));
      expect(await token.merchant()).to.equal(merchant.address);
      expect(await token.transferable()).to.equal(false);
    });

    it("rejects zero merchant, zero max supply, initial > max", async () => {
      const [m] = await ethers.getSigners();
      const F = await ethers.getContractFactory("LoyaltyVoucherToken");
      await expect(F.deploy("a", "b", 0, 1, ethers.ZeroAddress, false)).to.be.revertedWithCustomError(F, "ZeroAddress");
      await expect(F.deploy("a", "b", 0, 0, m.address, false)).to.be.revertedWithCustomError(F, "ExceedsMaxSupply");
      await expect(F.deploy("a", "b", 2, 1, m.address, false)).to.be.revertedWithCustomError(F, "ExceedsMaxSupply");
    });

    it("zero initial supply emits no mint", async () => {
      const [m] = await ethers.getSigners();
      const token = await ethers.deployContract("LoyaltyVoucherToken", ["a", "b", 0, 5, m.address, false]);
      expect(await token.totalSupply()).to.equal(0);
      const receipt = await token.deploymentTransaction()!.wait();
      expect(receipt!.logs.length).to.equal(0);
    });
  });

  describe("transfer restriction (transferable = false)", () => {
    it("merchant -> customer and customer -> merchant succeed", async () => {
      const { token, merchant, alice } = await loadFixture(restricted);
      await expect(token.transfer(alice.address, E(10)))
        .to.emit(token, "Transfer")
        .withArgs(merchant.address, alice.address, E(10));
      await token.connect(alice).transfer(merchant.address, E(4));
      expect(await token.balanceOf(alice.address)).to.equal(E(6));
    });

    it("customer -> customer reverts with TransferRestricted", async () => {
      const { token, alice, bob } = await loadFixture(restricted);
      await token.transfer(alice.address, E(10));
      await expect(token.connect(alice).transfer(bob.address, E(1))).to.be.revertedWithCustomError(
        token,
        "TransferRestricted",
      );
    });

    it("transferFrom customer -> customer reverts even when the merchant is the spender", async () => {
      const { token, merchant, alice, bob } = await loadFixture(restricted);
      await token.transfer(alice.address, E(10));
      await token.connect(alice).approve(merchant.address, E(10));
      await expect(token.transferFrom(alice.address, bob.address, E(1))).to.be.revertedWithCustomError(
        token,
        "TransferRestricted",
      );
      // but pulling back to the merchant is allowed
      await token.transferFrom(alice.address, merchant.address, E(1));
      expect(await token.balanceOf(alice.address)).to.equal(E(9));
    });
  });

  describe("transferable = true", () => {
    it("customers can transfer freely", async () => {
      const { token, alice, bob } = await loadFixture(open);
      await token.transfer(alice.address, E(10));
      await token.connect(alice).transfer(bob.address, E(3));
      expect(await token.balanceOf(bob.address)).to.equal(E(3));
    });
  });

  describe("ERC-20 semantics", () => {
    it("transfer guards: zero address, insufficient balance", async () => {
      const { token, alice } = await loadFixture(open);
      await expect(token.transfer(ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(token, "ZeroAddress");
      await expect(token.connect(alice).transfer(token.target, 1)).to.be.revertedWithCustomError(
        token,
        "InsufficientBalance",
      );
    });

    it("self transfer keeps balance", async () => {
      const { token, merchant } = await loadFixture(restricted);
      await token.transfer(merchant.address, E(5));
      expect(await token.balanceOf(merchant.address)).to.equal(E(1000));
    });

    it("approve: zero spender reverts, emits Approval, overwrites", async () => {
      const { token, merchant, spender } = await loadFixture(open);
      await expect(token.approve(ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(token, "ZeroAddress");
      await expect(token.approve(spender.address, 5))
        .to.emit(token, "Approval")
        .withArgs(merchant.address, spender.address, 5);
      await token.approve(spender.address, 2);
      expect(await token.allowance(merchant.address, spender.address)).to.equal(2);
    });

    it("transferFrom decrements finite allowance and rejects over-allowance", async () => {
      const { token, merchant, alice, spender } = await loadFixture(open);
      await token.approve(spender.address, E(5));
      await token.connect(spender).transferFrom(merchant.address, alice.address, E(2));
      expect(await token.allowance(merchant.address, spender.address)).to.equal(E(3));
      await expect(
        token.connect(spender).transferFrom(merchant.address, alice.address, E(4)),
      ).to.be.revertedWithCustomError(token, "InsufficientAllowance");
    });

    it("infinite allowance is not decremented", async () => {
      const { token, merchant, alice, spender } = await loadFixture(open);
      await token.approve(spender.address, ethers.MaxUint256);
      await token.connect(spender).transferFrom(merchant.address, alice.address, E(2));
      expect(await token.allowance(merchant.address, spender.address)).to.equal(ethers.MaxUint256);
    });

    it("transferFrom with insufficient balance and from zero address revert", async () => {
      const { token, merchant, alice, spender } = await loadFixture(open);
      await token.approve(spender.address, ethers.MaxUint256);
      await expect(
        token.connect(spender).transferFrom(merchant.address, alice.address, E(1001)),
      ).to.be.revertedWithCustomError(token, "InsufficientBalance");
      await expect(token.transferFrom(ethers.ZeroAddress, alice.address, 0)).to.be.revertedWithCustomError(
        token,
        "ZeroAddress",
      );
    });
  });

  describe("mint", () => {
    it("only merchant, not to zero address", async () => {
      const { token, alice } = await loadFixture(restricted);
      await expect(token.connect(alice).mint(alice.address, 1)).to.be.revertedWithCustomError(token, "Unauthorized");
      await expect(token.mint(ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(token, "ZeroAddress");
    });

    it("mints exactly up to maxSupply and no further", async () => {
      const { token, alice } = await loadFixture(restricted);
      await expect(token.mint(alice.address, E(9000)))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, alice.address, E(9000));
      expect(await token.totalSupply()).to.equal(E(10000));
      await expect(token.mint(alice.address, 1)).to.be.revertedWithCustomError(token, "ExceedsMaxSupply");
    });

    it("huge amount reverts with ExceedsMaxSupply, not an overflow panic", async () => {
      const { token, alice } = await loadFixture(restricted);
      await expect(token.mint(alice.address, ethers.MaxUint256)).to.be.revertedWithCustomError(
        token,
        "ExceedsMaxSupply",
      );
    });
  });

  describe("redeem", () => {
    it("burns, emits Transfer + VoucherRedeemed, frees supply headroom", async () => {
      const { token, merchant, alice } = await loadFixture(restricted);
      await token.mint(alice.address, E(9000));
      const tx = token.connect(alice).redeem(E(100), "COFFEE-001");
      await expect(tx).to.emit(token, "Transfer").withArgs(alice.address, ethers.ZeroAddress, E(100));
      await expect(tx).to.emit(token, "VoucherRedeemed");
      expect(await token.totalSupply()).to.equal(E(9900));
      expect(await token.balanceOf(alice.address)).to.equal(E(8900));
      await token.connect(merchant).mint(alice.address, E(100));
      expect(await token.totalSupply()).to.equal(E(10000));
    });

    it("rejects zero amount and insufficient balance", async () => {
      const { token, alice } = await loadFixture(restricted);
      await expect(token.connect(alice).redeem(0, "x")).to.be.revertedWithCustomError(token, "ZeroAmount");
      await expect(token.connect(alice).redeem(1, "x")).to.be.revertedWithCustomError(token, "InsufficientBalance");
    });
  });
});
