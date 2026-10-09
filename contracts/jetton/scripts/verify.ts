/**
 * Checks a deployed Jetton against this package:
 *
 *   npm run verify -- --network=testnet [--master=<address>] [--admin=<address>] [--fresh]
 *
 * It reads the chain through the public Toncenter API and compares the code,
 * the supply, the admin and the metadata with what this package would deploy.
 * Read-only: it sends nothing and needs no key.
 *
 *   --master  Defaults to the address recorded in deployments.json.
 *   --fresh   Use right after launch. Also checks that the admin still holds
 *             the whole supply and that the metadata is exactly token.json.
 *             Needs the admin (from --admin or deployments.json).
 *
 * Exit code 0 when every check passes (warnings allowed), 1 otherwise.
 */
import { parseArgs } from '../src/args';
import { assertPinnedCode, type Network, parseAddressFor, verifyDeployment } from '../src/deployment';
import { loadDeployments } from '../src/deployments';
import { EXPLORER, toncenterProvider } from '../src/network';
import { loadTokenProfile } from '../src/token';

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function orFail<T>(step: () => T): T {
  try {
    return step();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

const args = orFail(() => parseArgs(process.argv.slice(2), { flags: ['fresh'], options: ['network', 'master', 'admin'] }));

const networkInput = args.get('network');
if (networkInput !== 'testnet' && networkInput !== 'mainnet') fail('Pass --network=testnet or --network=mainnet.');
const network: Network = networkInput;
const recorded = loadDeployments()[network];
const fresh = args.has('fresh');

const masterInput = args.get('master') ?? recorded?.master;
if (!masterInput) fail(`Pass --master=<address of the token contract>. deployments.json has no ${network} entry yet.`);
// The recorded admin only applies to the recorded token.
const adminInput = args.get('admin') ?? (masterInput === recorded?.master ? recorded?.admin : undefined);
if (fresh && !adminInput) fail('--fresh needs --admin=<address the token was launched for>.');

const master = orFail(() => parseAddressFor(network, masterInput));
const admin = adminInput ? orFail(() => parseAddressFor(network, adminInput)) : undefined;
const pinned = orFail(assertPinnedCode);
const profile = orFail(loadTokenProfile);
const testOnly = network === 'testnet';

console.log(`\nLuminara Jetton: verifying ${master.toString({ testOnly })} on ${network}`);
let verification;
try {
  verification = await verifyDeployment(toncenterProvider(network), { master, admin, profile, pinned, fresh });
} catch (error) {
  fail(`Could not read the chain: ${error instanceof Error ? error.message : error}`);
}

const label = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' } as const;
for (const check of verification.checks) {
  console.log(`  ${label[check.status]}  ${check.name}`);
  console.log(`        ${check.detail}`);
}
console.log(`\n  ${EXPLORER[network]}/${master.toString({ testOnly })}`);
console.log(verification.ok ? '\nVerified.\n' : '\nNOT verified.\n');
if (!verification.ok) process.exitCode = 1;
