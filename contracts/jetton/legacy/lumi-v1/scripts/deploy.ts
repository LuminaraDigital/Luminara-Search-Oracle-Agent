/**
 * =========================================================================
 *     LUMINARA ($LUMI) - ZERO-CUSTODY TONKEEPER DEPLOYMENT SCRIPT
 * =========================================================================
 * SAFETY GUARANTEES:
 * 1. ZERO SEED PHRASE: Never prompts for or touches your mnemonic or private key.
 * 2. TRANSACTION PAUSE: Displays exact contract address, tax parameters, and
 *    payload details before asking you to sign with Tonkeeper.
 * 3. TRANSPARENT LINKS: Generates Tonkeeper deep links & QR code links.
 * =========================================================================
 */

import { beginCell, toNano, Address, Cell, storeStateInit } from '@ton/core';
import { FixedSupplyJettonMaster } from '../build/FixedSupplyJetton_FixedSupplyJettonMaster';

export function buildOnChainMetadataCell(metadataUri: string): Cell {
  return beginCell()
    .storeUint(0x01, 8) // 0x01 = off-chain URI prefix per TEP-64
    .storeStringTail(metadataUri)
    .endCell();
}

export function calculateTransferTax(
  amount: bigint,
  taxBps: number = 300,
  burnBps: number = 100,
  stakingBps: number = 100,
): {
  taxTotal: bigint;
  burnAmount: bigint;
  stakingAmount: bigint;
  treasuryAmount: bigint;
  netRecipientAmount: bigint;
} {
  const taxTotal = (amount * BigInt(taxBps)) / 10000n;
  const burnAmount = (amount * BigInt(burnBps)) / 10000n;
  const stakingAmount = (amount * BigInt(stakingBps)) / 10000n;
  const treasuryAmount = taxTotal - burnAmount - stakingAmount;
  const netRecipientAmount = amount - taxTotal;
  return { taxTotal, burnAmount, stakingAmount, treasuryAmount, netRecipientAmount };
}

async function main() {
  console.log('================================================================');
  console.log('       LUMINARA ($LUMI) JETTON: ZERO-CUSTODY DEPLOYMENT         ');
  console.log('================================================================\n');

  const TOKEN_NAME = 'Luminara';
  const TOKEN_SYMBOL = 'LUMI';
  const DECIMALS = 9;
  const TOTAL_SUPPLY_TOKENS = 100_000_000n; // 100,000,000 fixed supply
  const TOTAL_SUPPLY_COINS = TOTAL_SUPPLY_TOKENS * 10n ** BigInt(DECIMALS);

  const METADATA_URI =
    'https://raw.githubusercontent.com/LuminaraDigital/Luminara-Search-Oracle-Agent/main/contracts/jetton/metadata.json';

  const args = process.argv.slice(2);
  const ownerAddressInput =
    args.find((a) => a.startsWith('--owner='))?.split('=')[1] || process.env.OWNER_ADDRESS;

  if (!ownerAddressInput) {
    console.error('❌ Missing --owner address argument!');
    console.log('\nUsage:');
    console.log('  npm run deploy:testnet -- --owner=<YOUR_TONKEEPER_TESTNET_ADDRESS>\n');
    console.log('Example:');
    console.log('  npm run deploy:testnet -- --owner=0QClpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpYQf\n');
    process.exit(1);
  }

  const ownerAddress = Address.parse(ownerAddressInput);
  const isTestnet = !args.includes('--mainnet');

  const treasuryAddressInput = args.find((a) => a.startsWith('--treasury='))?.split('=')[1];
  const stakingAddressInput = args.find((a) => a.startsWith('--staking='))?.split('=')[1];

  const treasuryAddress = treasuryAddressInput ? Address.parse(treasuryAddressInput) : ownerAddress;
  const stakingAddress = stakingAddressInput ? Address.parse(stakingAddressInput) : ownerAddress;

  const content = buildOnChainMetadataCell(METADATA_URI);
  const masterContract = await FixedSupplyJettonMaster.fromInit(
    ownerAddress,
    content,
    TOTAL_SUPPLY_COINS,
    treasuryAddress,
    stakingAddress,
  );

  const masterContractAddress = masterContract.address;

  console.log(`📋 10x Tokenomics Configuration:`);
  console.log(`   Name:                 ${TOKEN_NAME} ($${TOKEN_SYMBOL})`);
  console.log(`   Decimals:             ${DECIMALS}`);
  console.log(`   Fixed Supply:         ${TOTAL_SUPPLY_TOKENS.toLocaleString()} ${TOKEN_SYMBOL}`);
  console.log(`   Transfer Tax:         3.0% (300 bps)`);
  console.log(`     ├── Auto-Burn:             1.0% (continual deflation)`);
  console.log(`     ├── Staking Pool:          1.0% (real yield for stakers)`);
  console.log(`     └── Treasury / POL:        1.0% (protocol-owned liquidity)`);
  console.log(`   Safety Cap:           Max 5.0% (hardcoded contract invariant)`);
  console.log(`   Blacklist:            None (open and censorship-resistant)`);
  console.log(`   Metadata URI:         ${METADATA_URI}`);
  console.log(`   Deployer Admin:       ${ownerAddress.toString({ testOnly: isTestnet })}`);
  console.log(`   Treasury Address:     ${treasuryAddress.toString({ testOnly: isTestnet })}`);
  console.log(`   Staking Pool:         ${stakingAddress.toString({ testOnly: isTestnet })}\n`);

  console.log('----------------------------------------------------------------');
  console.log('🔒 ZERO-CUSTODY GUARANTEE:');
  console.log('   This script NEVER asks for your 24-word seed phrase or private key.');
  console.log('   You will review and confirm this transaction safely inside Tonkeeper.');
  console.log('----------------------------------------------------------------\n');

  const deployTonAmount = toNano('0.15'); // 0.15 TON for deployment storage reserve and master contract initialization

  // Serialize StateInit BOC
  const stateInitCell = beginCell().store(storeStateInit(masterContract.init!)).endCell();
  const stateInitBoc = stateInitCell.toBoc().toString('base64');

  // Serialize Body Payload BOC (Deploy query)
  const bodyCell = beginCell().storeUint(0x946a98b6, 32).storeUint(0, 64).endCell(); // Deploy message op
  const bodyBoc = bodyCell.toBoc().toString('base64');

  console.log('📦 DETERMINISTIC CONTRACT ADDRESS & DEPLOYMENT SPECS:');
  console.log(`   Target Contract Address: ${masterContractAddress.toString({ testOnly: isTestnet })}`);
  console.log(`   Raw Format:              ${masterContractAddress.toRawString()}`);
  console.log(`   Network:                 ${isTestnet ? 'TON Testnet' : 'TON Mainnet'}`);
  console.log(`   Gas / Deposit Value:     0.15 TON`);
  console.log(`   Post-Deploy State:       Minting is locked permanently after supply creation.\n`);

  const deepLink = `ton://transfer/${masterContractAddress.toString({ testOnly: isTestnet })}?amount=${deployTonAmount.toString()}&bin=${encodeURIComponent(bodyBoc)}&init=${encodeURIComponent(stateInitBoc)}`;
  const tonkeeperUniversalLink = `https://app.tonkeeper.com/transfer/${masterContractAddress.toString({ testOnly: isTestnet })}?amount=${deployTonAmount.toString()}&bin=${encodeURIComponent(bodyBoc)}&init=${encodeURIComponent(stateInitBoc)}`;

  console.log('🚀 READY TO SIGN WITH TONKEEPER:');
  console.log('   Step 1: Open Tonkeeper on your device.');
  console.log('   Step 2: Ensure Tonkeeper network is set to Testnet.');
  console.log('   Step 3: Click or copy this universal link:');
  console.log(`\n   👉 ${tonkeeperUniversalLink}\n`);
  console.log(`   Or Deep Link:\n   👉 ${deepLink}\n`);

  console.log('📱 TON CONNECT 2.0 TRANSACTION PAYLOAD (For OpenMask / TonConnect):');
  const tonConnectPayload = {
    validUntil: Math.floor(Date.now() / 1000) + 900,
    messages: [
      {
        address: masterContractAddress.toString({ testOnly: isTestnet }),
        amount: deployTonAmount.toString(),
        stateInit: stateInitBoc,
        payload: bodyBoc,
      },
    ],
  };
  console.log(JSON.stringify(tonConnectPayload, null, 2));

  console.log('\n================================================================');
  console.log('Verify contract on Tonviewer once signed:');
  console.log(`https://${isTestnet ? 'testnet.' : ''}tonviewer.com/${masterContractAddress.toString({ testOnly: isTestnet })}`);
  console.log('================================================================\n');
}

if (process.argv[1] && /deploy\.(ts|js)$/.test(process.argv[1])) {
  main().catch(console.error);
}
