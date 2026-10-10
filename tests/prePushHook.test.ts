import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The cases that run the hook start git, sh, node and npm, which can take seconds apiece on a busy machine.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * .githooks/pre-push refuses a direct push to main. Its refusal must not tell the reader how to
 * get past it (plan hazard 18, task SW0a-12). Its checks must run on the working tree that is
 * being pushed, even when the hook file itself lives in another checkout: this repository sets
 * core.hooksPath to one absolute directory that every worktree shares.
 */

const HOOK = resolve(__dirname, '..', '.githooks', 'pre-push');
const SOURCE = readFileSync(HOOK, 'utf8');

let root = '';
let env: NodeJS.ProcessEnv = {};

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => realpathSync.native(resolve(p)).toLowerCase();
  return norm(a) === norm(b);
}

function initRepo(name: string, branch: string): string {
  const repo = join(root, name);
  execFileSync('git', ['init', '--quiet', `--initial-branch=${branch}`, repo], { cwd: root, env, stdio: 'ignore' });
  return repo;
}

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'pre-push-hook-')));
  const emptyConfig = join(root, 'empty.gitconfig');
  writeFileSync(emptyConfig, '');
  // Act on temporary repositories only, as a developer's machine would: no GIT_* variable from
  // a hook that started this test run, no CI marker, and the bypass variable unset.
  env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(key) && key !== 'CI' && key !== 'ALLOW_DIRECT_PROD_PUSH') env[key] = value;
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

describe('pre-push hook: the refusal message', () => {
  const printed = SOURCE.split('\n').filter((line) => /^\s*(echo|printf)\b/.test(line));

  it('prints nothing that names the bypass variable or explains a bypass', () => {
    expect(printed.length).toBeGreaterThan(0);
    for (const line of printed) {
      expect(line).not.toContain('ALLOW_DIRECT_PROD_PUSH');
      expect(line).not.toMatch(/bypass|emergenc|override|skip/i);
      expect(line).not.toMatch(/[A-Z][A-Z0-9_]{3,}=\S/); // no VARIABLE=value recipe of any kind
    }
  });

  it('says the push is refused and to open a pull request', () => {
    const refusal = printed.slice(0, 2).join('\n');
    expect(refusal).toMatch(/direct push to '\$current_branch' is refused/i);
    expect(refusal).toMatch(/pull request/i);
  });

  it('enforces what it enforced before: the branch guard, the secret scan, typecheck, tests and the smoke dry run', () => {
    expect(SOURCE).toContain('if [ "$current_branch" = "main" ] || [ "$current_branch" = "prod" ]; then');
    expect(SOURCE).toContain('if [ "$ALLOW_DIRECT_PROD_PUSH" != "1" ] && [ -z "$CI" ]; then');
    expect(SOURCE).toContain('scripts/check-secrets.mjs" --all || exit 1');
    expect(SOURCE).toContain('npm run typecheck || exit 1');
    expect(SOURCE).toContain('npm test || exit 1');
    expect(SOURCE).toContain('scripts/smoke-check.mjs" --dry-run || exit 1');
  });
});

describe('pre-push hook: run by git on a branch called main', () => {
  it('exits 1 and its whole output names no bypass', () => {
    const repo = initRepo('on-main', 'main');
    const installed = join(repo, '.git', 'hooks', 'pre-push');
    copyFileSync(HOOK, installed);
    chmodSync(installed, 0o755);

    const res = spawnSync('git', ['hook', 'run', 'pre-push'], { cwd: repo, env, encoding: 'utf8' });
    const output = `${res.stdout}\n${res.stderr}`;
    expect(res.status).toBe(1);
    expect(output).toMatch(/direct push to 'main' is refused/i);
    expect(output).toMatch(/pull request/i);
    expect(output).not.toContain('ALLOW_DIRECT_PROD_PUSH');
    expect(output).not.toMatch(/bypass/i);
    // It stopped at the branch guard: none of the later checks started.
    expect(output).not.toMatch(/\[Pre-Push\]/);
  });
});

describe('pre-push hook: its checks run on the tree being pushed, not on the checkout the hook file is in', () => {
  it('finds the scripts from the top level of the working tree, never from its own location', () => {
    expect(SOURCE).toContain('top=$(git rev-parse --show-toplevel 2>/dev/null)');
    expect(SOURCE).toContain('cd "$top" || exit 1');
    expect(SOURCE).toContain('node "$top/scripts/check-secrets.mjs" --all || exit 1');
    expect(SOURCE).toContain('node "$top/scripts/smoke-check.mjs" --dry-run || exit 1');
    expect(SOURCE).not.toMatch(/dirname "\$0"|\$0\b/);
  });

  it('with the hook shared from another checkout, it runs the pushing tree\'s secret check and smoke check', () => {
    // "other-checkout" plays the main checkout: it holds the shared hook directory, and its own
    // copies of the two scripts. They must NOT be the ones that run.
    const other = join(root, 'other-checkout');
    mkdirSync(join(other, '.githooks'), { recursive: true });
    mkdirSync(join(other, 'scripts'), { recursive: true });
    const sharedHook = join(other, '.githooks', 'pre-push');
    copyFileSync(HOOK, sharedHook);
    chmodSync(sharedHook, 0o755);
    const wrongTree = "console.log('WRONG TREE: ' + process.argv[1]); process.exit(1);\n";
    writeFileSync(join(other, 'scripts', 'check-secrets.mjs'), wrongTree);
    writeFileSync(join(other, 'scripts', 'smoke-check.mjs'), wrongTree);

    // The tree being pushed: a feature branch with stand-ins for the four checks.
    const repo = initRepo('pushing-tree', 'feature/hook-root');
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    const stub = "console.log('STUB ' + process.argv.slice(2).join(' ') + ' cwd=' + process.cwd());\n";
    writeFileSync(join(repo, 'scripts', 'stub.mjs'), stub);
    writeFileSync(join(repo, 'scripts', 'check-secrets.mjs'), "process.argv.splice(2, 0, 'secrets');\n" + stub);
    writeFileSync(join(repo, 'scripts', 'smoke-check.mjs'), "process.argv.splice(2, 0, 'smoke');\n" + stub);
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'hook-fixture', private: true, scripts: { typecheck: 'node scripts/stub.mjs typecheck', test: 'node scripts/stub.mjs test' } }),
    );

    const res = spawnSync('git', ['-c', `core.hooksPath=${join(other, '.githooks')}`, 'hook', 'run', 'pre-push'], { cwd: repo, env, encoding: 'utf8' });
    const output = `${res.stdout}\n${res.stderr}`;
    expect(output).not.toContain('WRONG TREE');
    expect(res.status, output).toBe(0);

    const stubs = [...output.matchAll(/^STUB (.+) cwd=(.+)$/gm)].map((m) => ({ what: m[1].trim(), cwd: m[2].trim() }));
    expect(stubs.map((s) => s.what)).toEqual(['secrets --all', 'typecheck', 'test', 'smoke --dry-run']);
    for (const s of stubs) expect(samePath(s.cwd, repo), `${s.what} ran in ${s.cwd}`).toBe(true);
    expect(output).toMatch(/All branch safeguards and smoke checks passed/);
  });
});
