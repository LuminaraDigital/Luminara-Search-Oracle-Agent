// Deterministic evals runner. Node stdlib only, no npm deps.
// Usage: node evals/run-evals.mjs [--dir <path>]

import { readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
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

function isHaCase(kase) {
  return kase.kind === 'high_accuracy_schema' || Object.keys(kase).some((k) => /^candidate\d+$/.test(k));
}

function recordedCandidates(kase) {
  return Object.keys(kase)
    .filter((k) => /^candidate\d+$/.test(k))
    .sort((a, b) => Number(a.slice('candidate'.length)) - Number(b.slice('candidate'.length)))
    .map((k) => String(kase[k]));
}

let highAccuracyModule = null;
async function loadHighAccuracy() {
  if (highAccuracyModule) return highAccuracyModule;
  const srcPath = path.join(repoRoot, 'worker', 'highAccuracySelect.ts');
  const outDir = path.join(os.tmpdir(), `ha-${process.pid}-${Date.now()}`);
  const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(
    process.execPath,
    [
      tsc,
      srcPath,
      '--outDir',
      outDir,
      '--rootDir',
      repoRoot,
      '--module',
      'es2020',
      '--target',
      'es2020',
      '--moduleResolution',
      'bundler',
      '--skipLibCheck',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  rewriteJsImports(outDir);
  const outPath = path.join(outDir, 'worker', 'highAccuracySelect.js');
  highAccuracyModule = await import(pathToFileURL(outPath).href);
  return highAccuracyModule;
}

function rewriteJsImports(dir) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const name of readdirSync(cur)) {
      const p = path.join(cur, name);
      if (statSync(p).isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!name.endsWith('.js')) continue;
      const text = readFileSync(p, 'utf8');
      const next = text.replace(/from (['"])(\.[^'"]+)\1/g, (full, q, spec) => {
        if (spec.endsWith('.js')) return full;
        return `from ${q}${spec}.js${q}`;
      });
      if (next !== text) writeFileSync(p, next);
    }
  }
}

async function evaluateHaCase(mod, kase) {
  const candidates = recordedCandidates(kase);
  const called = [];
  const result = await mod.bestOfN({
    n: candidates.length,
    strategy: kase.strategy === 'parallel' ? 'parallel' : 'escalate',
    generate: async (index) => {
      called.push(index);
      return { text: candidates[index] ?? '', ms: 0 };
    },
    validate: (text) => mod.validateJsonLdCandidate(text, {
      siteHost: String(kase.siteHost ?? ''),
      expectedType: kase.expectedType ? String(kase.expectedType) : undefined,
    }),
  });
  const expect = kase.expect && typeof kase.expect === 'object' ? kase.expect : {};
  const results = {};
  if ('winnerIndex' in expect) {
    const want = expect.winnerIndex === 'none' || expect.winnerIndex === -1 ? null : Number(expect.winnerIndex);
    results.winnerIndex = result.winnerIndex === want;
  }
  if ('calls' in expect) results.calls = called.length === Number(expect.calls);
  if (expect.reason) {
    results.reason = result.attempts.some((a) => a.reasons.includes(String(expect.reason)));
  }
  if (Array.isArray(expect.mustContain)) {
    results.mustContain = Boolean(result.value) && expect.mustContain.every((s) => result.value.includes(String(s)));
  }
  return { results, passed: Object.values(results).every(Boolean) };
}

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

const HA_CHECKS = ['winnerIndex', 'calls', 'reason', 'mustContain'];

function printMatrix(rows, checks) {
  if (rows.length === 0) return;
  const namesWidth = Math.max(...rows.map((r) => r.name.length), 4);
  const colW = Math.max(...checks.map((c) => c.length), 4) + 2;
  const header = 'case'.padEnd(namesWidth) + ' ' + checks.map((c) => c.padEnd(colW)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of rows) {
    const cells = checks.map((c) => {
      const v = c in row.results ? (row.results[c] ? 'PASS' : 'FAIL') : '-';
      return v.padEnd(colW);
    }).join('');
    console.log(row.name.padEnd(namesWidth) + ' ' + cells);
  }
}

export async function run(dir) {
  const mod = await loadValidators();
  const casesDir = dir ?? path.join(here, 'cases');
  const files = readdirSync(casesDir)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
  const rows = [];
  const haRows = [];
  let haMod = null;
  for (const file of files) {
    const cases = parseYamlSubset(readFileSync(path.join(casesDir, file), 'utf8'));
    for (const kase of cases) {
      const name = `${file} :: ${kase.name ?? '(unnamed)'}`;
      if (isHaCase(kase)) {
        if (!haMod) haMod = await loadHighAccuracy();
        const { results, passed } = await evaluateHaCase(haMod, kase);
        haRows.push({ name, results, passed });
        continue;
      }
      const { results, passed } = evaluateCase(mod, kase);
      rows.push({ name, results, passed });
    }
  }

  printMatrix(rows, CHECKS);
  if (haRows.length) {
    console.log('');
    console.log('high-accuracy schema selection');
    printMatrix(haRows, HA_CHECKS);
  }
  const all = [...rows, ...haRows];
  const passed = all.filter((r) => r.passed).length;
  const failed = all.length - passed;
  console.log(`${all.length} cases, ${passed} passed, ${failed} failed`);
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
