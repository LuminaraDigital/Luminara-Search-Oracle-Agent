#!/usr/bin/env node
/**
 * Points this clone at committed hooks in .githooks/ (secret scan on commit/push).
 * Safe to run repeatedly. Skips when not inside a git work tree.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hooksPath = resolve(root, '.githooks');

if (!existsSync(resolve(root, '.git')) || !existsSync(hooksPath)) {
  process.exit(0);
}

try {
  execSync('git rev-parse --is-inside-work-tree', { cwd: root, stdio: 'ignore' });
} catch {
  process.exit(0);
}

try {
  execSync('git config core.hooksPath .githooks', { cwd: root, stdio: 'ignore' });
  console.log('git hooks: core.hooksPath=.githooks');
} catch (err) {
  console.warn('git hooks: could not set core.hooksPath:', err?.message || err);
  process.exit(0);
}
