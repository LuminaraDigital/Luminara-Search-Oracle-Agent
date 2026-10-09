/**
 * Local sandbox run: `npm run sandbox`
 *
 * Starts an in-memory TON blockchain, creates disposable wallets, deploys the
 * Jetton from token.json and walks through the flows the Luminara app relies
 * on, checking each one. Nothing here can reach testnet or mainnet: neither
 * this script nor anything it imports opens a network connection, and no
 * seed phrase or private key is created, read or stored.
 *
 * Options:
 *   --seed=<label>   Reuse a set of wallet addresses. Default: a new random label per run.
 *   --json           Print the result as JSON instead of text.
 */
import { randomBytes } from 'node:crypto';
import { beginCell, toNano } from '@ton/core';
import { flattenTransaction } from '@ton/test-utils';
import {
  burn,
  commentPayload,
  deployJetton,
  emptyPayload,
  LOCAL_WALLET_NAMES,
  type LocalJetton,
  type LocalNet,
  readComment,
  startLocalNet,
  transfer,
} from '../src/localnet';
import { parseArgs } from '../src/args';
import { formatUnits, parseOnchainContent, toUnits } from '../src/token';

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

let args;
try {
  args = parseArgs(process.argv.slice(2), { flags: ['json'], options: ['seed'] });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const asJson = args.has('json');
const seed = args.get('seed') ?? `run-${randomBytes(4).toString('hex')}`;

// Addresses are printed in their test-only form (kQ...) so they cannot be mistaken for mainnet addresses.
const show = (address: { toString(options: { testOnly: boolean }): string }) => address.toString({ testOnly: true });

type Sent = { transactions: Parameters<typeof flattenTransaction>[0][] };

/** True when one of the transactions was sent to `to` and failed with `exitCode`. */
function rejectedWith(result: Sent, to: { equals(other: never): boolean }, exitCode: number): boolean {
  return result.transactions.map(flattenTransaction).some((tx) => tx.to?.equals(to as never) && tx.exitCode === exitCode);
}

async function runSteps(net: LocalNet, jetton: LocalJetton): Promise<Step[]> {
  const { treasury, merchant, alice, bob, mallory } = net.wallets;
  const symbol = jetton.profile.metadata.symbol;
  const tokens = (amount: string) => toUnits(jetton.profile, amount);
  const fmt = (units: bigint) => `${formatUnits(jetton.profile, units)} ${symbol}`;
  const steps: Step[] = [];
  const step = (name: string, ok: boolean, detail: string) => steps.push({ name, ok, detail });

  // 1. Launch.
  step(
    'Launch: one message from the admin deploys the token and creates the whole supply for the admin',
    (await jetton.balanceOf(treasury.address)) === jetton.supply && (await jetton.totalSupply()) === jetton.supply,
    `treasury holds ${fmt(await jetton.balanceOf(treasury.address))}`,
  );

  // 2. A plain transfer.
  await transfer(jetton, treasury, { to: alice.address, amount: tokens('1000') });
  step(
    'Transfer: treasury sends 1,000 to alice and alice receives exactly 1,000',
    (await jetton.balanceOf(alice.address)) === tokens('1000'),
    `alice holds ${fmt(await jetton.balanceOf(alice.address))}`,
  );

  // 3. A payment with an invoice memo, the way the app's checkout sends it.
  const memo = 'LUM:ton_1759860000000_ab12cd:starter';
  const payment = await transfer(jetton, alice, {
    to: merchant.address,
    amount: tokens('29'),
    forwardTon: toNano('0.05'),
    payload: commentPayload(memo),
  });
  const notification = payment.transactions
    .map((tx) => ({ tx, flat: flattenTransaction(tx) }))
    .find(({ flat }) => flat.op === 0x7362d09c && flat.to?.equals(merchant.address));
  let receivedMemo: string | null = null;
  if (notification?.tx.inMessage) {
    const body = notification.tx.inMessage.body.beginParse();
    body.skip(32 + 64);
    body.loadCoins();
    body.loadAddress();
    receivedMemo = readComment(body);
  }
  step(
    'Payment: alice pays the merchant 29 with an invoice memo and the merchant is notified',
    (await jetton.balanceOf(merchant.address)) === tokens('29') && receivedMemo === memo,
    `merchant received memo "${receivedMemo}"`,
  );

  // 4. The merchant burns the Supply Watcher share (15%).
  const burnShare = (tokens('29') * 15n) / 100n;
  await burn(jetton, merchant, { amount: burnShare });
  step(
    'Burn: the merchant burns 15% of the payment and the total supply falls by the same amount',
    (await jetton.totalSupply()) === jetton.supply - burnShare && (await jetton.balanceOf(merchant.address)) === tokens('29') - burnShare,
    `burned ${fmt(burnShare)}, total supply is now ${fmt(await jetton.totalSupply())}`,
  );

  // 5. A stranger cannot move someone else's tokens.
  const aliceWallet = await jetton.wallet(alice.address);
  const theft = await aliceWallet.send(
    mallory.getSender(),
    { value: toNano('0.1') },
    {
      $$type: 'JettonTransfer',
      queryId: 0n,
      amount: tokens('100'),
      destination: mallory.address,
      responseDestination: mallory.address,
      customPayload: null,
      forwardTonAmount: 0n,
      forwardPayload: emptyPayload(),
    },
  );
  step(
    'Ownership: mallory cannot move alice\'s tokens',
    rejectedWith(theft, aliceWallet.address, 705) && (await jetton.balanceOf(mallory.address)) === 0n,
    'rejected with exit code 705 (not the owner)',
  );

  // 6. Nobody can mint after launch, the admin included.
  const relaunch = await jetton.master.send(treasury.getSender(), { value: toNano('1') }, { $$type: 'Launch', queryId: 0n });
  step(
    'Fixed supply: the token cannot be launched a second time',
    rejectedWith(relaunch, jetton.master.address, 715) && (await jetton.totalSupply()) === jetton.supply - burnShare,
    'rejected with exit code 715 (already launched)',
  );

  const mint = await treasury.send({
    to: jetton.master.address,
    value: toNano('0.2'),
    body: beginCell().storeUint(21, 32).storeUint(0, 64).storeAddress(treasury.address).storeCoins(tokens('1000000')).endCell(),
  });
  step(
    'Fixed supply: a mint message from the admin is rejected',
    rejectedWith(mint, jetton.master.address, 130) && (await jetton.totalSupply()) === jetton.supply - burnShare,
    'rejected with exit code 130 (the contract has no such message)',
  );

  // 7. A stranger cannot use admin messages.
  const hijack = await jetton.master.send(mallory.getSender(), { value: toNano('0.05') }, { $$type: 'DropAdmin', queryId: 0n });
  step(
    'Admin: mallory cannot send admin messages',
    rejectedWith(hijack, jetton.master.address, 710) && (await jetton.master.getGetJettonData()).adminAddress.equals(treasury.address),
    'rejected with exit code 710 (not the admin)',
  );

  // 8. The admin role moves in two steps.
  await jetton.master.send(treasury.getSender(), { value: toNano('0.05') }, { $$type: 'ChangeAdmin', queryId: 0n, nextAdmin: bob.address });
  const stillTreasury = (await jetton.master.getGetJettonData()).adminAddress.equals(treasury.address);
  await jetton.master.send(bob.getSender(), { value: toNano('0.05') }, { $$type: 'ClaimAdmin', queryId: 0n });
  step(
    'Admin: the role is handed to bob only after bob claims it',
    stillTreasury && (await jetton.master.getGetJettonData()).adminAddress.equals(bob.address),
    'treasury proposed, bob claimed',
  );

  // 9. Conservation.
  let held = 0n;
  for (const name of LOCAL_WALLET_NAMES) held += await jetton.balanceOf(net.wallets[name].address);
  step(
    'Accounting: the balances of all wallets add up to the total supply',
    held === (await jetton.totalSupply()),
    `${fmt(held)} held, ${fmt(await jetton.totalSupply())} total supply`,
  );

  return steps;
}

async function main(): Promise<void> {
  const net = await startLocalNet(seed);
  const jetton = await deployJetton(net);
  const deployed = jetton.deployment.transactions
    .map(flattenTransaction)
    .some((tx) => tx.to?.equals(jetton.master.address) && tx.deploy && tx.success);
  if (!deployed) throw new Error('The Jetton did not deploy and launch in the local sandbox.');

  const steps = await runSteps(net, jetton);
  // Read after the steps: one of them hands the admin role to bob.
  const data = await jetton.master.getGetJettonData();
  const metadata = parseOnchainContent(data.jettonContent).fields;

  const balances: Record<string, string> = {};
  for (const name of LOCAL_WALLET_NAMES) {
    balances[name] = formatUnits(jetton.profile, await jetton.balanceOf(net.wallets[name].address));
  }
  const wallets = Object.fromEntries(LOCAL_WALLET_NAMES.map((name) => [name, show(net.wallets[name].address)]));
  const passed = steps.every((s) => s.ok);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          network: 'local sandbox (in-memory, no network connection)',
          seed,
          wallets,
          master: show(jetton.master.address),
          admin: show(data.adminAddress),
          metadata,
          launchSupply: formatUnits(jetton.profile, jetton.supply),
          totalSupply: formatUnits(jetton.profile, await jetton.totalSupply()),
          mintable: data.mintable,
          balances,
          steps,
          passed,
        },
        null,
        2,
      ),
    );
  } else {
    const line = (label: string, value: string) => console.log(`  ${label.padEnd(16)}${value}`);
    console.log('\nLuminara Jetton: local sandbox');
    line('Network', 'in-memory emulator. Nothing leaves this machine.');
    line('Keys', 'none. These wallets have no seed phrase or private key.');
    line('Wallet label', `${seed}   (reuse with --seed=${seed})`);

    console.log('\nDisposable wallets');
    for (const name of LOCAL_WALLET_NAMES) line(name, wallets[name]);

    console.log('\nDeployed Jetton');
    line('Master', show(jetton.master.address));
    line('Name', `${metadata.name} (${metadata.symbol})`);
    line('Decimals', metadata.decimals);
    line('Supply', `${formatUnits(jetton.profile, jetton.supply)} ${metadata.symbol}, created once at launch for treasury`);
    line('Mintable', String(data.mintable));
    line('Image', metadata.image);

    console.log('\nChecks');
    for (const s of steps) {
      console.log(`  ${s.ok ? 'PASS' : 'FAIL'}  ${s.name}`);
      console.log(`        ${s.detail}`);
    }

    console.log('\nFinal balances');
    for (const name of LOCAL_WALLET_NAMES) line(name, `${balances[name]} ${metadata.symbol}`);
    line('Total supply', `${formatUnits(jetton.profile, await jetton.totalSupply())} ${metadata.symbol}`);
    console.log(passed ? '\nAll checks passed.\n' : '\nSome checks FAILED.\n');
  }

  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
