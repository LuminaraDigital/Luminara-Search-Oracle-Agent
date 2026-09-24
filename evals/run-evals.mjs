// Deterministic evals runner. Node stdlib only, no npm deps.
// Usage: node evals/run-evals.mjs [--dir <path>]

import { readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseYamlSubset } from './yaml-subset.mjs';

export { parseYamlSubset };

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function argDir(argv) {
  const idx = argv.indexOf('--dir');
  if (idx === -1) return null;
  const v = argv[idx + 1];
  if (!v) throw new Error('--dir requires a path argument');
  return v;
}

// Compile the TS validator module to a temp ESM .mjs once per process, then import it.
let validatorsModule = null;
async function loadValidators() {
  if (validatorsModule) return validatorsModule;
  const srcPath = path.join(repoRoot, 'worker', 'agentOutputValidators.ts');
  const outDir = path.join(os.tmpdir(), `aov-${process.pid}-${Date.now()}`);
  const outPath = path.join(outDir, 'agentOutputValidators.js');
  const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(
    process.execPath,
    [
      tsc,
      srcPath,
      '--outDir',
      outDir,
      '--module',
      'es2020',
      '--target',
      'es2020',
      '--skipLibCheck',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const mod = await import(pathToFileURL(outPath).href);
  try {
    unlinkSync(outPath);
  } catch {
    /* best effort */
  }
  validatorsModule = mod;
  return mod;
}

const CHECKS = ['ok', 'maxBlock', 'maxWarn', 'mustNotContain', 'mustContain'];

function evaluateCase(mod, kase) {
  const evidenceNumbers = Array.isArray(kase.evidenceNumbers)
    ? kase.evidenceNumbers.map(Number)
    : undefined;
  const { ok, findings } = mod.runAllValidators(String(kase.response ?? ''), {
    evidenceNumbers,
  });
  const counts = mod.summarizeFindings(findings);
  const expect = kase.expect && typeof kase.expect === 'object' ? kase.expect : {};
  const response = String(kase.response ?? '');

  const results = {};
  if ('ok' in expect) results.ok = ok === Boolean(expect.ok);
  if ('maxBlock' in expect || 'ok' in expect) {
    const maxBlock = 'maxBlock' in expect ? Number(expect.maxBlock) : 0;
    results.maxBlock = counts.block <= maxBlock;
  }
  if ('maxWarn' in expect) results.maxWarn = counts.warn <= Number(expect.maxWarn);
  if (Array.isArray(expect.mustNotContain)) {
    results.mustNotContain = expect.mustNotContain.every(
      (s) => !response.includes(String(s)),
    );
  }
  if (Array.isArray(expect.mustContain)) {
    results.mustContain = expect.mustContain.every((s) =>
      response.includes(String(s)),
    );
  }
  const passed = Object.values(results).every(Boolean);
  return { results, passed, ok, counts };
}

export async function run(dir) {
  const mod = await loadValidators();
  const casesDir = dir ?? path.join(here, 'cases');
  const files = readdirSync(casesDir)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
  const rows = [];
  for (const file of files) {
    const cases = parseYamlSubset(readFileSync(path.join(casesDir, file), 'utf8'));
    for (const kase of cases) {
      const name = `${file} :: ${kase.name ?? '(unnamed)'}`;
      const { results, passed } = evaluateCase(mod, kase);
      rows.push({ name, results, passed });
    }
  }

  const namesWidth = Math.max(...rows.map((r) => r.name.length), 4);
  const colW = Math.max(...CHECKS.map((c) => c.length), 4) + 2;
  const header =
    'case'.padEnd(namesWidth) + ' ' + CHECKS.map((c) => c.padEnd(colW)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of rows) {
    const cells = CHECKS.map((c) => {
      const v = c in row.results ? (row.results[c] ? 'PASS' : 'FAIL') : '-';
      return v.padEnd(colW);
    }).join('');
    console.log(row.name.padEnd(namesWidth) + ' ' + cells);
  }
  const passed = rows.filter((r) => r.passed).length;
  const failed = rows.length - passed;
  console.log(`${rows.length} cases, ${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

const invokedAsMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  run(argDir(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err?.stack ?? String(err));
      process.exit(2);
    });
}
