import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Each case starts git and node processes, which can take seconds apiece on a busy machine.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * `scripts/check-secrets.mjs --all` must scan the working tree it is run in, not the checkout
 * the script file is in. The pre-push hook is shared by every worktree of this repository, so
 * a push from one worktree used to scan another one's files.
 *
 * Each test runs this repository's copy of the script from inside a temporary git repository.
 */

const SCRIPT = resolve(__dirname, '..', 'scripts', 'check-secrets.mjs');

/** Shaped like a GitHub token so the scanner refuses it. Assembled here so this file holds no such string. */
const KEY_SHAPED = ['gh', 'p_', 'Zz9'.repeat(12)].join('');

let root = '';
let env: NodeJS.ProcessEnv = {};

function makeRepo(name: string, files: Record<string, string>): string {
  const repo = join(root, name);
  execFileSync('git', ['init', '--quiet', '--initial-branch=feature', repo], { cwd: root, env, stdio: 'ignore' });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(repo, rel, '..'), { recursive: true });
    writeFileSync(join(repo, rel), text);
  }
  return repo;
}

function runAll(cwd: string) {
  return spawnSync(process.execPath, [SCRIPT, '--all'], { cwd, env, encoding: 'utf8' });
}

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'check-secrets-root-')));
  const emptyConfig = join(root, 'empty.gitconfig');
  writeFileSync(emptyConfig, '');
  // No GIT_* variable from a hook that started this test run: git must find each repository
  // from the directory the script is run in.
  env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(key)) env[key] = value;
  }
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_TERMINAL_PROMPT: '0' });
});

afterAll(() => {
  try {
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // A leftover temporary directory is not a test failure.
  }
});

describe('check-secrets --all scans the working tree it is run in', () => {
  it('passes on a clean tree and counts that tree\'s files, not this repository\'s', () => {
    const repo = makeRepo('clean', { 'notes.txt': 'nothing to see\n', 'src/app.js': 'export const answer = 42;\n' });
    const res = runAll(repo);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('Secret check passed (all, 2 file(s)).');
  });

  it('fails on a key-shaped string in that tree, names the file, and does not print the string', () => {
    const repo = makeRepo('leaky', { 'notes.txt': 'nothing to see\n', 'config/settings.js': `export const token = "${KEY_SHAPED}";\n` });
    const res = runAll(repo);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Secret check failed (all): 1 finding(s)');
    expect(res.stderr).toContain('config/settings.js');
    expect(`${res.stdout}${res.stderr}`).not.toContain(KEY_SHAPED);
  });

  it('scans from the top level when it is run in a subdirectory of the tree', () => {
    const repo = makeRepo('nested', { 'notes.txt': 'nothing to see\n', 'deep/inside/settings.js': `export const token = "${KEY_SHAPED}";\n` });
    mkdirSync(join(repo, 'elsewhere'), { recursive: true });
    const res = runAll(join(repo, 'elsewhere'));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('deep/inside/settings.js');
  });

  it('two trees side by side are judged separately: the leak in one does not fail the other', () => {
    const clean = makeRepo('side-clean', { 'a.txt': 'clean\n' });
    const leaky = makeRepo('side-leaky', { 'a.txt': `${KEY_SHAPED}\n` });
    expect(runAll(clean).status).toBe(0);
    expect(runAll(leaky).status).toBe(1);
    expect(runAll(clean).status).toBe(0);
  });
});
