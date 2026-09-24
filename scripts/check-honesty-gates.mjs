#!/usr/bin/env node
// CI gate: honesty checks with grandfathered baseline.
// Usage: node scripts/check-honesty-gates.mjs [--write-baseline]

import process from 'node:process';
import {
  runAllChecks,
  loadBaseline,
  filterNewViolations,
  serializeBaseline,
} from './honesty-gates-lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const baselinePath = path.join(root, '.honesty-baseline.json');
const writeBaseline = process.argv.includes('--write-baseline');

const all = runAllChecks(root);
const baselineKeys = loadBaseline(baselinePath);
const { fresh, grandfathered } = filterNewViolations(all, baselineKeys);

const rules = [...new Set(all.map((v) => v.rule))].sort();
for (const rule of rules) {
  const g = grandfathered.filter((v) => v.rule === rule).length;
  const n = fresh.filter((v) => v.rule === rule).length;
  console.log(`${rule}: ${g + n} total (${g} grandfathered, ${n} NEW)`);
}

if (writeBaseline) {
  fs.writeFileSync(baselinePath, serializeBaseline(all), 'utf8');
  console.log(`Wrote baseline with ${all.length} violations to ${baselinePath}`);
  process.exit(0);
}

if (fresh.length > 0) {
  console.error('\nNEW violations:');
  for (const v of fresh) {
    console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.snippet}`);
  }
  console.error(`\n${fresh.length} new violation(s) found.`);
  process.exit(1);
}

console.log('No new violations.');
process.exit(0);
