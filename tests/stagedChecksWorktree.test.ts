import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Each case starts git and node processes, which can take seconds apiece on a busy machine.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
// Cases that block on child processes back to back never let the event loop turn, and vitest
// then reports a timeout of its own messaging. One turn between cases is enough.
afterEach(() => new Promise<void>((done) => setImmediate(done)));

/**
 * The commit-time checks (`check-secrets.mjs --staged`, `check-forbidden-tokens.mjs --staged`)
 * must read what is being committed, in the repository that is committing.
 *
 * They used to take the staged file names from the committing worktree but read the files from
 * the checkout the script lives in. From a linked worktree a new file with a key in it was not
 * found there, was skipped, and the check said "passed".
 *
 * Here the scripts live in this repository and are run from a linked worktree of a temporary
 * one, which is the same arrangement as a hook directory shared between worktrees.
 */

const SECRETS = resolve(__dirname, '..', 'scripts', 'check-secrets.mjs');
const TOKENS = resolve(__dirname, '..', 'scripts', 'check-forbidden-tokens.mjs');

/** Shaped like a GitHub token so the scanner refuses it. Assembled here so this file holds no such string. */
const KEY_SHAPED = ['gh', 'p_', 'Zz9'.repeat(12)].join('');
/** The one entry of the temporary repository's forbidden-token list. */
const FORBIDDEN = ['zeta', 'internal', 'codename'].join('-');

let root = '';
let mainCheckout = '';
let linked = '';
let env: NodeJS.ProcessEnv = {};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => realpathSync.native(resolve(p)).toLowerCase();
  return norm(a) === norm(b);
}

function write(rel: string, text: string) {
  writeFileSync(join(linked, rel), text);
}

function stage(...rels: string[]) {
  git(linked, 'add', '--', ...rels);
}

function unstageAll() {
  git(linked, 'reset', '--quiet');
}

function runStaged(script: string) {
  return spawnSync(process.execPath, [script, '--staged'], { cwd: linked, env, encoding: 'utf8' });
}

/** Remove the stored content of a staged path, so git can still name it but can no longer read it. */
function loseStagedContent(rel: string) {
  const blob = git(linked, 'rev-parse', `:${rel}`);
  const objectFile = join(mainCheckout, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
  expect(existsSync(objectFile)).toBe(true);
  chmodSync(objectFile, 0o666);
  rmSync(objectFile);
}

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'staged-checks-')));
  mainCheckout = join(root, 'main-checkout');
  linked = join(root, 'linked-worktree');
  const emptyConfig = join(root, 'empty.gitconfig');
  writeFileSync(emptyConfig, '');
  // No GIT_* variable from a hook that started this test run: git must find the temporary
  // repository from the directory each command runs in.
  env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(key)) env[key] = value;
  }
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Staged Check Test',
    GIT_AUTHOR_EMAIL: 'staged-check@example.invalid',
    GIT_COMMITTER_NAME: 'Staged Check Test',
    GIT_COMMITTER_EMAIL: 'staged-check@example.invalid',
    // The machine's own account name is not part of this test.
    FORBIDDEN_TOKENS_SKIP_IDENTITY: '1',
  });

  execFileSync('git', ['init', '--quiet', '--initial-branch=main', mainCheckout], { cwd: root, env, stdio: 'ignore' });
  expect(samePath(git(mainCheckout, 'rev-parse', '--show-toplevel'), mainCheckout)).toBe(true);
  mkdirSync(join(mainCheckout, '.githooks'), { recursive: true });
  writeFileSync(join(mainCheckout, '.githooks', 'forbidden-tokens.txt'), `${FORBIDDEN}\n`);
  writeFileSync(join(mainCheckout, 'README.md'), 'a temporary repository\n');
  git(mainCheckout, 'add', '--', '.githooks/forbidden-tokens.txt', 'README.md');
  git(mainCheckout, 'commit', '--quiet', '-m', 'init');
  git(mainCheckout, 'worktree', 'add', '--quiet', '-b', 'feature', linked);
  expect(samePath(git(linked, 'rev-parse', '--show-toplevel'), linked)).toBe(true);
});

afterAll(() => {
  try {
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // A leftover temporary directory is not a test failure.
  }
});

describe('check-secrets --staged, run from a linked worktree', () => {
  it('fails on a new staged file that holds a key, and on a staged key whose working copy was cleaned up', () => {
    unstageAll();
    write('ok-file.js', 'export const answer = 42;\n');
    write('new-file-with-key.js', `export const token = "${KEY_SHAPED}";\n`);
    write('key-staged-then-removed.js', `export const token = "${KEY_SHAPED}";\n`);
    write('key-added-after-staging.js', 'export const token = process.env.TOKEN;\n');
    stage('ok-file.js', 'new-file-with-key.js', 'key-staged-then-removed.js', 'key-added-after-staging.js');
    // After staging: one working copy is cleaned, another gains a key that is not staged.
    write('key-staged-then-removed.js', 'export const token = process.env.TOKEN;\n');
    write('key-added-after-staging.js', `export const token = "${KEY_SHAPED}";\n`);

    // The new files exist only in the worktree that is committing.
    expect(existsSync(join(mainCheckout, 'new-file-with-key.js'))).toBe(false);

    const res = runStaged(SECRETS);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Secret check failed (staged): 2 finding(s)');
    expect(res.stderr).toContain('new-file-with-key.js');
    // What is checked is what the commit will hold: the staged content, not the working file.
    expect(res.stderr).toContain('key-staged-then-removed.js');
    expect(res.stderr).not.toContain('key-added-after-staging.js');
    expect(res.stderr).not.toContain('ok-file.js');
    expect(`${res.stdout}${res.stderr}`).not.toContain(KEY_SHAPED);
  });

  it('passes on a clean staged file, and counts the staged files of the worktree', () => {
    unstageAll();
    write('ok-file.js', 'export const answer = 42;\n');
    stage('ok-file.js');
    const res = runStaged(SECRETS);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('Secret check passed (staged, 1 file(s)).');
  });

  it('fails, and does not skip, when the staged content of a path cannot be read', () => {
    unstageAll();
    write('lost-content.js', 'export const lost = "content only this file has, 7f3a";\n');
    stage('lost-content.js');
    loseStagedContent('lost-content.js');
    const res = runStaged(SECRETS);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('lost-content.js');
    expect(res.stderr).toContain('staged content could not be read, so it was not checked');
    unstageAll();
  });
});

describe('check-forbidden-tokens --staged, run from a linked worktree', () => {
  it('fails on a new staged file that holds a listed token, and on a staged token whose working copy was cleaned up', () => {
    unstageAll();
    write('t-ok.txt', 'nothing to see\n');
    write('t-new-with-token.txt', `project ${FORBIDDEN} notes\n`);
    write('t-token-staged-then-removed.txt', `line one\nproject ${FORBIDDEN} notes\n`);
    write('t-token-added-after-staging.txt', 'nothing to see\n');
    stage('t-ok.txt', 't-new-with-token.txt', 't-token-staged-then-removed.txt', 't-token-added-after-staging.txt');
    write('t-token-staged-then-removed.txt', 'line one\nnothing to see\n');
    write('t-token-added-after-staging.txt', `project ${FORBIDDEN} notes\n`);

    expect(existsSync(join(mainCheckout, 't-new-with-token.txt'))).toBe(false);

    const res = runStaged(TOKENS);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Forbidden-token check failed (staged): 2 finding(s)');
    expect(res.stderr).toContain('t-new-with-token.txt:1');
    expect(res.stderr).toContain('t-token-staged-then-removed.txt:2');
    expect(res.stderr).not.toContain('t-token-added-after-staging.txt');
    expect(res.stderr).not.toContain('t-ok.txt');
  });

  it('passes on a clean staged file, using the token list of the worktree that is committing', () => {
    unstageAll();
    write('t-ok.txt', 'nothing to see\n');
    stage('t-ok.txt');
    const res = runStaged(TOKENS);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('Forbidden-token check passed (staged, 1 file(s)).');
  });

  it('fails, and does not skip, when the staged content of a path cannot be read', () => {
    unstageAll();
    write('t-lost-content.txt', 'content only this file has, 9c1e\n');
    stage('t-lost-content.txt');
    loseStagedContent('t-lost-content.txt');
    const res = runStaged(TOKENS);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('t-lost-content.txt: staged content could not be read, so it was not checked');
    unstageAll();
  });
});
