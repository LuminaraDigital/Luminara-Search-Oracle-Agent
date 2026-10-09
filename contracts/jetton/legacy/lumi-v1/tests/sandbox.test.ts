import { describe, it, expect, beforeEach } from 'vitest';
import { findTransaction } from '@ton/test-utils';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, beginCell } from '@ton/core';
import { FixedSupplyJettonMaster } from '../build/FixedSupplyJetton_FixedSupplyJettonMaster';
import { JettonDefaultWallet } from '../build/FixedSupplyJetton_JettonDefaultWallet';
import { buildOnChainMetadataCell } from '../scripts/deploy';

describe('Local TON Sandbox: Luminara ($LUMI) Fixed-Supply Jetton', () => {
  let blockchain: Blockchain;
  let deployer: SandboxContract<TreasuryContract>;
  let alice: SandboxContract<TreasuryContract>;
  let bob: SandboxContract<TreasuryContract>;
  let treasury: SandboxContract<TreasuryContract>;
  let stakingPool: SandboxContract<TreasuryContract>;
  let master: SandboxContract<FixedSupplyJettonMaster>;

  const TOTAL_SUPPLY = 100_000_000n * 10n ** 9n; // 100 Million LUMI
  const METADATA_URI =
    'https://raw.githubusercontent.com/LuminaraDigital/Luminara-Search-Oracle-Agent/main/contracts/jetton/metadata.json';

  beforeEach(async () => {
    // 1. Initialize local in-memory simulated TON blockchain (Sandbox)
    blockchain = await Blockchain.create();

    // 2. Generate disposable local test wallets with simulated pre-funded balances
    deployer = await blockchain.treasury('deployer');
    alice = await blockchain.treasury('alice');
    bob = await blockchain.treasury('bob');
    treasury = await blockchain.treasury('treasury');
    stakingPool = await blockchain.treasury('staking_pool');

    // 3. Deploy FixedSupplyJettonMaster contract to the local sandbox
    const content = buildOnChainMetadataCell(METADATA_URI);
    const masterContract = await FixedSupplyJettonMaster.fromInit(
      deployer.address,
      content,
      TOTAL_SUPPLY,
      treasury.address,
      stakingPool.address,
    );
    master = blockchain.openContract(masterContract);

    const deployResult = await master.send(
      deployer.getSender(),
      { value: toNano('0.05') },
      { $$type: 'Deploy', queryId: 0n },
    );
    expect(
      findTransaction(deployResult.transactions, {
        from: deployer.address,
        to: master.address,
        deploy: true,
        success: true,
      }),
    ).toBeDefined();
  });

  it('verifies on-chain metadata and initial state via getters', async () => {
    const data = await master.getGetJettonData();
    expect(data.total_supply).toBe(TOTAL_SUPPLY);
    expect(data.mintable).toBe(true); // True before initial mint
    expect(data.admin_address.equals(deployer.address)).toBe(true);

    const taxConfig = await master.getGetTaxConfig();
    expect(taxConfig.tax_rate_bps).toBe(300n); // 3.0%
    expect(taxConfig.burn_rate_bps).toBe(100n); // 1.0%
    expect(taxConfig.staking_rate_bps).toBe(100n); // 1.0%
    expect(taxConfig.treasury_address.equals(treasury.address)).toBe(true);
    expect(taxConfig.staking_rewards_address.equals(stakingPool.address)).toBe(true);
  });

  it('mints initial supply to deployer and permanently locks minting', async () => {
    // Deployer triggers initial mint
    const mintResult = await master.send(
      deployer.getSender(),
      { value: toNano('0.1') },
      'MintInitialSupply',
    );

    expect(
      findTransaction(mintResult.transactions, {
        from: deployer.address,
        to: master.address,
        success: true,
      }),
    ).toBeDefined();

    // Check master state: mintable is now permanently FALSE
    const postData = await master.getGetJettonData();
    expect(postData.mintable).toBe(false);

    // Verify deployer's JettonDefaultWallet holds 100% of supply
    const deployerWalletAddr = await master.getGetWalletAddress(deployer.address);
    const deployerWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(deployerWalletAddr));
    const walletData = await deployerWallet.getGetWalletData();
    expect(walletData.balance).toBe(TOTAL_SUPPLY);
    expect(walletData.owner.equals(deployer.address)).toBe(true);

    // Attempt second mint by deployer: MUST fail (minting is permanently locked)
    const secondMint = await master.send(
      deployer.getSender(),
      { value: toNano('0.1') },
      'MintInitialSupply',
    );
    expect(
      findTransaction(secondMint.transactions, {
        from: deployer.address,
        to: master.address,
        success: false,
      }),
    ).toBeDefined();

    // Attempt mint by unauthorized user (Alice): MUST fail
    const aliceMint = await master.send(
      alice.getSender(),
      { value: toNano('0.1') },
      'MintInitialSupply',
    );
    expect(
      findTransaction(aliceMint.transactions, {
        from: alice.address,
        to: master.address,
        success: false,
      }),
    ).toBeDefined();
  });

  it('executes token transfer from deployer to alice in local sandbox', async () => {
    // 1. Initial mint to deployer
    await master.send(deployer.getSender(), { value: toNano('0.1') }, 'MintInitialSupply');

    const deployerWalletAddr = await master.getGetWalletAddress(deployer.address);
    const deployerWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(deployerWalletAddr));

    const transferAmount = 10_000n * 10n ** 9n; // 10,000 LUMI

    // 2. Deployer transfers 10,000 LUMI to Alice
    const transferResult = await deployerWallet.send(
      deployer.getSender(),
      { value: toNano('0.3') },
      {
        $$type: 'TokenTransfer',
        query_id: 1n,
        amount: transferAmount,
        destination: alice.address,
        response_destination: deployer.address,
        custom_payload: null,
        forward_ton_amount: toNano('0.01'),
        forward_payload: beginCell().endCell().beginParse(),
      },
    );

    // 3. Verify Alice's wallet received the tokens
    const aliceWalletAddr = await master.getGetWalletAddress(alice.address);
    const aliceWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(aliceWalletAddr));

    expect(
      findTransaction(transferResult.transactions, {
        from: deployer.address,
        to: deployerWallet.address,
        success: true,
      }),
    ).toBeDefined();

    expect(
      findTransaction(transferResult.transactions, {
        from: deployerWallet.address,
        to: aliceWalletAddr,
        success: true,
      }),
    ).toBeDefined();

    const aliceData = await aliceWallet.getGetWalletData();
    expect(aliceData.balance).toBe(transferAmount);

    // 4. Verify deployer's balance decremented
    const deployerData = await deployerWallet.getGetWalletData();
    expect(deployerData.balance).toBe(TOTAL_SUPPLY - transferAmount);
  });

  it('enforces administrator permission limits on tax configuration', async () => {
    // Owner can set valid tax <= 500 bps (5.0%)
    const validTaxUpdate = await master.send(
      deployer.getSender(),
      { value: toNano('0.05') },
      {
        $$type: 'SetTaxConfig',
        tax_rate_bps: 400, // 4.0%
        burn_rate_bps: 150,
        staking_rate_bps: 150,
      },
    );
    expect(
      findTransaction(validTaxUpdate.transactions, {
        from: deployer.address,
        to: master.address,
        success: true,
      }),
    ).toBeDefined();

    const updatedConfig = await master.getGetTaxConfig();
    expect(updatedConfig.tax_rate_bps).toBe(400n);

    // Attempt to raise tax above hardcoded 5% safety cap (600 bps): MUST revert
    const invalidTaxUpdate = await master.send(
      deployer.getSender(),
      { value: toNano('0.05') },
      {
        $$type: 'SetTaxConfig',
        tax_rate_bps: 600, // 6.0% > 5.0%
        burn_rate_bps: 200,
        staking_rate_bps: 200,
      },
    );
    expect(
      findTransaction(invalidTaxUpdate.transactions, {
        from: deployer.address,
        to: master.address,
        success: false,
      }),
    ).toBeDefined();

    // Unauthorized non-owner (Alice) attempting to modify tax: MUST revert
    const unauthTaxUpdate = await master.send(
      alice.getSender(),
      { value: toNano('0.05') },
      {
        $$type: 'SetTaxConfig',
        tax_rate_bps: 200,
        burn_rate_bps: 50,
        staking_rate_bps: 50,
      },
    );
    expect(
      findTransaction(unauthTaxUpdate.transactions, {
        from: alice.address,
        to: master.address,
        success: false,
      }),
    ).toBeDefined();
  });
});
