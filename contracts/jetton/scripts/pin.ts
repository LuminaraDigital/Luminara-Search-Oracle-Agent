/**
 * `npm run pin` records the code hashes of the compiled contracts in
 * code-hashes.json, the lockfile for contract code.
 *
 * The tests, the deploy tool and the verify script all refuse to work with
 * code that differs from the pin. So a contract change only takes effect once
 * someone runs this on purpose, and the change of hash shows up in review.
 * Run it after a deliberate change has passed `npm test` and
 * `npm run test:mutation`, never to make a failing check go away.
 *
 * Without --write it only reports whether the build matches the pin.
 */
import { writeFileSync } from 'node:fs';
import { compiledCodeHashes, loadPinnedCodeHashes } from '../src/deployment';

const compiled = compiledCodeHashes();
let pinned: ReturnType<typeof loadPinnedCodeHashes> | null = null;
try {
  pinned = loadPinnedCodeHashes();
} catch {
  pinned = null;
}

const same = pinned !== null && (['compiler', 'master', 'wallet'] as const).every((key) => pinned[key] === compiled[key]);

console.log(`compiler  @tact-lang/compiler ${compiled.compiler}`);
console.log(`master    ${compiled.master}`);
console.log(`wallet    ${compiled.wallet}`);

if (same) {
  console.log('\nThe build matches code-hashes.json.');
} else if (process.argv.includes('--write')) {
  writeFileSync(new URL('../code-hashes.json', import.meta.url), `${JSON.stringify(compiled, null, 2)}\n`);
  console.log('\ncode-hashes.json updated. Commit it together with the contract change.');
} else {
  console.log('\nThe build does NOT match code-hashes.json:');
  console.log(pinned ? JSON.stringify(pinned, null, 2) : '(no pin recorded yet)');
  console.log('Run "npm run pin -- --write" only if the contracts were changed on purpose and all checks pass.');
  process.exitCode = 1;
}
