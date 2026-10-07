import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Secrets come from env only. Never hardcode keys.
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

function net(envVar: string, fallbackUrl: string, chainId: number) {
  return { url: process.env[envVar] || fallbackUrl, chainId, accounts };
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    xdcApothem: net("XDC_APOTHEM_RPC_URL", "https://erpc.apothem.network", 51),
    xdc: net("XDC_RPC_URL", "https://erpc.xinfin.network", 50),
    polygonAmoy: net("POLYGON_AMOY_RPC_URL", "https://rpc-amoy.polygon.technology", 80002),
    polygon: net("POLYGON_RPC_URL", "https://polygon-rpc.com", 137),
  },
};

export default config;
