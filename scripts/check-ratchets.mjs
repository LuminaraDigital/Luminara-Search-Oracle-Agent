#!/usr/bin/env node
// Fails when the working tree makes a file worse than it is on the base branch.
// Usage: node scripts/check-ratchets.mjs [--base <ref>]
// Default base: the merge-base of HEAD and origin/staging.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { findRegressions, parseNameStatus } from './ratchets-lib.mjs';

const root = process.cwd();

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function resolveBase() {
  const flag = process.argv.indexOf('--base');
  if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1];
  return git(['merge-base', 'HEAD', 'origin/staging']).trim();
}

let base;
try {
  base = resolveBase();
  git(['rev-parse', '--verify', `${base}^{commit}`]);
} catch {
  console.error('Ratchets: no base to compare with. Run `git fetch origin staging`, or pass --base <ref>.');
  process.exit(1);
}

const changes = [];
for (const { file, baseFile } of parseNameStatus(git(['diff', '--name-status', '-z', '-M', base]))) {
  let after;
  try {
    after = fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    continue; // deleted in the working tree
  }
  changes.push({ file, before: baseFile === null ? null : git(['show', `${base}:${baseFile}`]), after });
}

const regressions = findRegressions(changes);
if (regressions.length === 0) {
  console.log(`Ratchets OK: ${changes.length} changed file(s) checked against ${base.slice(0, 12)}.`);
  process.exit(0);
}

for (const { file, ratchet, now, allowed } of regressions) {
  console.error(`${file}: ${now} ${ratchet.unit}, the base has ${allowed}. [${ratchet.name}] ${ratchet.fix}`);
}
console.error(`\n${regressions.length} ratchet regression(s). A change may lower these counts but not raise them.`);
process.exit(1);
