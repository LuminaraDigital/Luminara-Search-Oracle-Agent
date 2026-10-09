/**
 * Deploy tool. Starts a page on this computer where you connect your own
 * wallet and approve the launch in the wallet app.
 *
 *   npm run deploy:testnet
 *   npm run deploy:mainnet -- --confirm-mainnet
 *
 * This tool cannot deploy anything by itself. It holds no keys, never asks
 * for a seed phrase and cannot sign. It computes the launch message, proves
 * it on a local sandbox, shows it to your wallet through TON Connect, and
 * afterwards reads the chain to check the result.
 *
 * The wallet you connect becomes the admin and receives the whole supply.
 * There is no option to name a different admin: the contract only lets its
 * admin launch it, so the supply can only go to a wallet that can sign.
 *
 * Options
 *   --port=<n>       Port for the local page. Default 4780.
 *   --value=<TON>    Toncoin to send, from 1 to 5. Default 1. It stays on the
 *                    token contract as storage rent.
 *
 * Mainnet only
 *   --confirm-mainnet            Required. A mainnet Jetton cannot be changed.
 *   --testnet-master=<address>   The same code, already launched and rehearsed
 *                                on testnet. Defaults to the testnet entry in
 *                                deployments.json. Checked on-chain before
 *                                the mainnet page will start.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toNano } from '@ton/core';
import { parseArgs } from '../src/args';
import { createDeployServer } from '../src/deployServer';
import {
  assertPinnedCode,
  checkMainnetGate,
  type CodeHashes,
  MAX_DEPLOY_VALUE,
  MIN_DEPLOY_VALUE,
  type Network,
  parseAddressFor,
} from '../src/deployment';
import { loadDeployments, recordDeployment } from '../src/deployments';
import { toncenterProvider } from '../src/network';
import { loadTokenProfile } from '../src/token';

const MANIFEST_URL = 'https://luminarasuite.com/tonconnect-manifest.json';

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** Runs `step` and stops the command with its message if it throws. */
function orFail<T>(step: () => T): T {
  try {
    return step();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

/** The TON Connect browser bundle ships with the app's dependencies at the repository root. */
function findTonConnectBundle(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(directory, 'node_modules', '@tonconnect', 'ui', 'dist', 'tonconnect-ui.min.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) {
      fail('Could not find @tonconnect/ui. Run "npm install" at the repository root, then try again.');
    }
    directory = parent;
  }
}

const args = orFail(() =>
  parseArgs(process.argv.slice(2), {
    flags: ['testnet', 'mainnet', 'confirm-mainnet'],
    options: ['port', 'value', 'testnet-master'],
  }),
);

if (args.has('mainnet') === args.has('testnet')) fail('Pass exactly one of --testnet or --mainnet.');
const network: Network = args.has('mainnet') ? 'mainnet' : 'testnet';
if (network === 'testnet' && (args.has('confirm-mainnet') || args.get('testnet-master'))) {
  fail('--confirm-mainnet and --testnet-master only apply to --mainnet.');
}

const port = Number(args.get('port') ?? 4780);
if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('--port must be a whole number from 1024 to 65535.');

const valueInput = args.get('value') ?? '1';
if (!/^[0-9]+(\.[0-9]{1,9})?$/.test(valueInput)) fail(`--value must be an amount of TON such as 1 or 1.5, not "${valueInput}".`);
const value = toNano(valueInput);
if (value < MIN_DEPLOY_VALUE || value > MAX_DEPLOY_VALUE) {
  fail('--value must be from 1 to 5 TON. It stays on the token contract as storage rent and cannot be withdrawn.');
}

const pinned: CodeHashes = orFail(assertPinnedCode);
const profile = orFail(loadTokenProfile);

if (network === 'mainnet') {
  // The testnet address comes from the command line, or from the record the testnet page wrote.
  const testnetMasterInput = args.get('testnet-master') ?? loadDeployments().testnet?.master;
  if (!args.has('confirm-mainnet') || !testnetMasterInput) {
    fail(
      [
        'A mainnet Jetton cannot be changed or recalled, so the mainnet page only starts when:',
        '  1. the same code is already launched on testnet and has been rehearsed there, and',
        '  2. you pass --confirm-mainnet (and --testnet-master=<address> if deployments.json has no testnet entry):',
        '',
        '     npm run jetton:deploy:mainnet -- --confirm-mainnet',
        '',
        'Start with: npm run jetton:deploy:testnet',
      ].join('\n'),
    );
  }
  const testnetMaster = orFail(() => parseAddressFor('testnet', testnetMasterInput));
  console.log('\nChecking the testnet token before starting the mainnet page ...');
  let gate;
  try {
    gate = await checkMainnetGate(toncenterProvider('testnet'), { testnetMaster, profile, pinned });
  } catch (error) {
    fail(`Could not read testnet: ${error instanceof Error ? error.message : error}`);
  }
  const label = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' } as const;
  for (const check of gate.checks) console.log(`  ${label[check.status]}  ${check.name}: ${check.detail}`);
  if (!gate.ok) fail('The testnet token does not qualify. The mainnet page was not started.');
}

let lastPrinted = '';

const server = createDeployServer({
  network,
  profile,
  value,
  provide: toncenterProvider(network),
  manifestUrl: MANIFEST_URL,
  tonConnectBundle: findTonConnectBundle(),
  onPrepared: ({ admin, master, value: amount }) => {
    // The page prepares more than once for the same wallet. Print each launch once.
    if (lastPrinted === `${admin} ${master}`) return;
    lastPrinted = `${admin} ${master}`;
    console.log(
      [
        '',
        '  Launch prepared for the connected wallet',
        `    Admin and first holder   ${admin}`,
        `    Token contract           ${master}`,
        `    Amount                   ${amount} TON`,
        '  Your wallet app must show this token contract address and this amount. If it shows anything else, reject.',
        '',
      ].join('\n'),
    );
  },
  onVerified: ({ master, admin }) => {
    try {
      const outcome = recordDeployment(network, { master, admin, verifiedAt: new Date().toISOString(), codeHashes: pinned });
      if (outcome === 'recorded') {
        console.log(`\n  Verified on ${network}: ${master}\n  Recorded in contracts/jetton/deployments.json. Commit that file.\n`);
      }
    } catch (error) {
      console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
    }
  },
});

server.on('error', (error: NodeJS.ErrnoException) => {
  fail(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Pass --port=<another port>.` : error.message);
});

server.listen(port, '127.0.0.1', () => {
  console.log(
    [
      '',
      `Luminara Jetton: ${network.toUpperCase()} deploy page`,
      `  Token      ${profile.metadata.name} (${profile.metadata.symbol})`,
      `  Code       master ${pinned.master}`,
      `  Open       http://127.0.0.1:${port}/`,
      '',
      `  1. Put your wallet app in ${network === 'testnet' ? 'Testnet' : 'Mainnet'} mode.`,
      '  2. Open the page, connect the wallet that will own the token, review, and approve in the wallet app.',
      '  3. The page checks the result on-chain.',
      '',
      '  This tool holds no keys and never asks for a recovery phrase.',
      '  Press Ctrl+C to stop.',
      '',
    ].join('\n'),
  );
});
