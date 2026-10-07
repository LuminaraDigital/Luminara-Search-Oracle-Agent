import { ethers, network } from "hardhat";

/**
 * Deploys MerchantLaunchFactory.
 *
 * Env:
 *   DEPLOYER_PRIVATE_KEY      required for live networks (never commit it)
 *   <NETWORK>_RPC_URL         optional override, see hardhat.config.ts
 *   PLATFORM_FEE_RECIPIENT    required: address that receives deployment + escrow fees
 *   DEPLOYMENT_FEE_WEI        optional, default 0
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network xdcApothem   (chainId 51)
 *   npx hardhat run scripts/deploy.ts --network xdc          (chainId 50)
 *   npx hardhat run scripts/deploy.ts --network polygonAmoy  (chainId 80002)
 *   npx hardhat run scripts/deploy.ts --network polygon      (chainId 137)
 */
const SUPPORTED: Record<number, string> = {
  31337: "hardhat",
  51: "XDC Apothem",
  50: "XDC Mainnet",
  80002: "Polygon Amoy",
  137: "Polygon",
};

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (!SUPPORTED[chainId]) throw new Error(`Unsupported chainId ${chainId}`);

  const signers = await ethers.getSigners();
  if (signers.length === 0) throw new Error("No deployer account. Set DEPLOYER_PRIVATE_KEY.");
  const deployer = signers[0];

  const feeRecipient = process.env.PLATFORM_FEE_RECIPIENT || (chainId === 31337 ? deployer.address : "");
  if (!ethers.isAddress(feeRecipient)) throw new Error("Set PLATFORM_FEE_RECIPIENT to a valid address.");
  const deploymentFee = BigInt(process.env.DEPLOYMENT_FEE_WEI || "0");

  console.log(`Network: ${network.name} (${SUPPORTED[chainId]}, chainId ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Fee recipient: ${feeRecipient}, deployment fee: ${deploymentFee} wei`);

  const factory = await ethers.deployContract("MerchantLaunchFactory", [feeRecipient, deploymentFee], deployer);
  await factory.waitForDeployment();
  console.log(`MerchantLaunchFactory: ${await factory.getAddress()}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
