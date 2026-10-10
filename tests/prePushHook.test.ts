import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * .githooks/pre-push refuses a direct push to main. Its refusal must not tell the reader how to
 * get past it (plan hazard 18, task SW0a-12). What the hook enforces is unchanged.
 */

const HOOK = resolve(__dirname, '..', '.githooks', 'pre-push');
const SOURCE = readFileSync(HOOK, 'utf8');

let root = '';

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
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'pre-push-hook-')));
    const repo = join(root, 'repo');
    const emptyConfig = join(root, 'empty.gitconfig');
    writeFileSync(emptyConfig, '');

    // Act on the temporary repository only, as a developer's machine would: no GIT_* variable
    // from a hook that started this test run, no CI marker, and the bypass variable unset.
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!/^GIT_/i.test(key) && key !== 'CI' && key !== 'ALLOW_DIRECT_PROD_PUSH') env[key] = value;
    }
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_TERMINAL_PROMPT: '0' });

    execFileSync('git', ['init', '--quiet', '--initial-branch=main', repo], { cwd: root, env, stdio: 'ignore' });
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
