import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateReleaseMerge, readCommits, readReleaseFacts } from '../scripts/check-release-merge.mjs';

/**
 * The production deploy runs scripts/check-release-merge.mjs before it migrates or deploys.
 * These tests build a real git repository in a temporary directory (no network) and ask the
 * script about each way a commit can reach main.
 *
 * Starting a process is slow on some machines, so the commit graph is written by one
 * `git fast-import` call: it stores ordinary commit objects with the parents and files stated
 * below. The last test makes the two headline shapes with `git merge` itself and gets the same
 * answers.
 */

const SCRIPT = resolve(__dirname, '..', 'scripts', 'check-release-merge.mjs');

let root = '';
let repo = '';
let env: NodeJS.ProcessEnv = {};

/** Commit SHAs by name, filled in beforeAll. */
const sha: Record<string, string> = {};

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => realpathSync.native(resolve(p)).toLowerCase();
  return norm(a) === norm(b);
}

function runCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, env: { ...env, ...extraEnv }, encoding: 'utf8' });
}

function check(commit: string, staging = 'origin/staging') {
  return evaluateReleaseMerge(readReleaseFacts({ commit, staging, cwd: repo, env }));
}

/**
 * One commit for `git fast-import`. `files` are added on top of the first parent's files; each
 * file holds its own name, so the same file is byte-identical wherever it appears.
 */
function commitBlock(mark: number, ref: string, message: string, parents: number[], files: string[]): string {
  const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}`;
  const lines = [`commit refs/heads/${ref}`, `mark :${mark}`, 'committer Release Check Test <release-check@example.invalid> 1760000000 +0000', data(message)];
  parents.forEach((parent, i) => lines.push(`${i === 0 ? 'from' : 'merge'} :${parent}`));
  for (const file of files) lines.push(`M 100644 inline ${file}`, data(file));
  return `${lines.join('\n')}\n\n`;
}

const MARKS: Record<string, number> = {
  A: 1, B: 2, C: 3, release: 4, squash: 5, direct: 6, oldStaging: 7, feature: 8,
  featureMerge: 9, hotfix: 10, divergedMerge: 11, swapped: 12, octopus: 13, D: 14,
};

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'release-merge-')));
  repo = join(root, 'repo');
  const emptyConfig = join(root, 'empty.gitconfig');
  const marksFile = join(root, 'marks.txt');
  writeFileSync(emptyConfig, '');

  // Git must act on the temporary repository only. A hook that started this test run may have
  // set GIT_DIR or GIT_INDEX_FILE for the project checkout, so every GIT_* variable is dropped,
  // and the machine's own git configuration (signing, hooks, default branch) is not read.
  const base: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(key) && key !== 'GITHUB_ACTIONS') base[key] = value;
  }
  env = {
    ...base,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Release Check Test',
    GIT_AUTHOR_EMAIL: 'release-check@example.invalid',
    GIT_COMMITTER_NAME: 'Release Check Test',
    GIT_COMMITTER_EMAIL: 'release-check@example.invalid',
  };

  // HEAD names the branch "release", which the import below creates.
  execFileSync('git', ['init', '--quiet', '--initial-branch=release', repo], { cwd: root, env, stdio: 'ignore' });
  expect(samePath(git('rev-parse', '--show-toplevel'), repo)).toBe(true);

  const m = MARKS;
  const stream = [
    // main:    A
    // staging: A - B - C        (C is the tip of staging)
    commitBlock(m.A, 'main', 'A on main', [], ['a.txt']),
    commitBlock(m.B, 'staging', 'B on staging', [m.A], ['b.txt']),
    commitBlock(m.C, 'staging', 'C on staging', [m.B], ['c.txt']),
    // What a fetch of the remote leaves behind.
    `reset refs/remotes/origin/staging\nfrom :${m.C}\n\n`,
    // The one shape that is a release: main merges the tip of staging with a merge commit.
    commitBlock(m.release, 'release', 'Merge staging into main', [m.A, m.C], ['b.txt', 'c.txt']),
    // A squash merge: staging's files, one parent.
    commitBlock(m.squash, 'squash', 'Squash of staging', [m.A], ['b.txt', 'c.txt']),
    // A direct push: an ordinary commit on main.
    commitBlock(m.direct, 'direct', 'Direct push to main', [m.A], ['d.txt']),
    // A merge of an older staging commit, and a merge of a feature branch.
    commitBlock(m.oldStaging, 'old-staging', 'Merge an older staging commit', [m.A, m.B], ['b.txt']),
    commitBlock(m.feature, 'feature', 'F on a feature branch', [m.A], ['f.txt']),
    commitBlock(m.featureMerge, 'feature-merge', 'Merge a feature branch', [m.A, m.feature], ['f.txt']),
    // main holds a hotfix staging never ran, then merges the tip of staging: right parent, different files.
    commitBlock(m.hotfix, 'hotfix', 'H hotfix on main only', [m.A], ['h.txt']),
    commitBlock(m.divergedMerge, 'diverged', 'Merge staging into a main that moved', [m.hotfix, m.C], ['b.txt', 'c.txt']),
    // The tip of staging as the first parent instead of the second.
    commitBlock(m.swapped, 'swapped', 'Merge main into staging', [m.C, m.hotfix], ['h.txt']),
    // One merge commit with three parents.
    commitBlock(m.octopus, 'octopus', 'Merge staging and a feature at once', [m.A, m.C, m.feature], ['b.txt', 'c.txt', 'f.txt']),
    // staging moves on after the release merge was made.
    commitBlock(m.D, 'staging-later', 'D on staging, after the release', [m.C], ['e.txt']),
  ].join('');
  execFileSync('git', ['fast-import', '--quiet', `--export-marks=${marksFile}`], { cwd: repo, env, input: stream, stdio: ['pipe', 'ignore', 'pipe'] });

  const byMark = new Map<number, string>();
  for (const line of readFileSync(marksFile, 'utf8').split('\n')) {
    const match = /^:(\d+) ([0-9a-f]{40,64})$/.exec(line.trim());
    if (match) byMark.set(Number(match[1]), match[2]);
  }
  for (const [name, mark] of Object.entries(MARKS)) sha[name] = byMark.get(mark) || '';
  expect(Object.values(sha).every((value) => /^[0-9a-f]{40,64}$/.test(value))).toBe(true);
}, 120_000);

afterAll(() => {
  try {
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // A leftover temporary directory is not a test failure.
  }
});

describe("release merge check: the commit on main must be a merge of the tip of staging, with staging's files", () => {
  it('passes for a merge commit whose second parent is the tip of staging and whose tree equals it', () => {
    const facts = readReleaseFacts({ commit: sha.release, cwd: repo, env });
    expect(facts.commit).toBe(sha.release);
    expect(facts.parents).toEqual([sha.A, sha.C]);
    expect(facts.stagingTip).toBe(sha.C);
    expect(facts.commitTree).toBe(facts.stagingTree);
    expect(evaluateReleaseMerge(facts)).toMatchObject({ ok: true });
  });

  it("fails a squash merge, even though its files equal staging's", () => {
    const facts = readReleaseFacts({ commit: sha.squash, cwd: repo, env });
    expect(facts.commitTree).toBe(facts.stagingTree);
    expect(facts.parents).toEqual([sha.A]);
    const verdict = evaluateReleaseMerge(facts);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/1 parent\(s\)/);
  });

  it('fails a direct push', () => {
    const verdict = check(sha.direct);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/1 parent\(s\)/);
  });

  it('fails a fast-forward of main to the tip of staging', () => {
    expect(check(sha.C).ok).toBe(false);
  });

  it('fails a merge of an older staging commit', () => {
    const verdict = check(sha.oldStaging);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not the tip of staging/);
  });

  it('fails a merge of a branch that is not staging', () => {
    const verdict = check(sha.featureMerge);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not the tip of staging/);
  });

  it("fails a merge of the staging tip whose files differ from staging's", () => {
    const facts = readReleaseFacts({ commit: sha.divergedMerge, cwd: repo, env });
    expect(facts.parents).toEqual([sha.hotfix, sha.C]);
    expect(facts.commitTree).not.toBe(facts.stagingTree);
    const verdict = evaluateReleaseMerge(facts);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/files differ from staging/);
  });

  it('fails when the tip of staging is the first parent, not the second', () => {
    const facts = readReleaseFacts({ commit: sha.swapped, cwd: repo, env });
    expect(facts.parents).toEqual([sha.C, sha.hotfix]);
    expect(evaluateReleaseMerge(facts).ok).toBe(false);
  });

  it('fails a merge commit with three parents', () => {
    const facts = readReleaseFacts({ commit: sha.octopus, cwd: repo, env });
    expect(facts.parents).toEqual([sha.A, sha.C, sha.feature]);
    const verdict = evaluateReleaseMerge(facts);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/3 parent\(s\)/);
  });

  it('fails the same release merge once staging has moved on', () => {
    const verdict = check(sha.release, sha.D);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not the tip of staging/);
  });

  it('refuses facts it could not read rather than passing them', () => {
    expect(evaluateReleaseMerge({ commit: '', parents: [], commitTree: '', stagingTip: '', stagingTree: '' }).ok).toBe(false);
    expect(evaluateReleaseMerge({ commit: 'a', parents: ['b', 'c'], commitTree: '', stagingTip: 'c', stagingTree: '' }).ok).toBe(false);
    expect(evaluateReleaseMerge(undefined).ok).toBe(false);
  });

  it('throws, rather than guessing, on a revision git does not have or one that is not a revision', () => {
    expect(() => readReleaseFacts({ commit: sha.release, staging: 'origin/never-fetched', cwd: repo, env })).toThrow(/cannot resolve "origin\/never-fetched"/);
    expect(() => readReleaseFacts({ commit: '--all', cwd: repo, env })).toThrow(/not a revision/);
    expect(() => readReleaseFacts({ commit: 'HEAD\norigin/staging', cwd: repo, env })).toThrow(/not a revision/);
  });

  it('reads the real parents in a shallow clone, where git itself reports none', () => {
    const shallow = join(root, 'shallow');
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', 'release', pathToFileURL(repo).href, shallow], {
      cwd: root,
      env,
      stdio: 'ignore',
    });
    const opts = { cwd: shallow, env };
    const viaRevList = execFileSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], { ...opts, encoding: 'utf8' }).trim();
    expect(viaRevList.split(' ')).toEqual([sha.release]);
    const [head] = readCommits(['HEAD'], opts);
    expect(head.sha).toBe(sha.release);
    expect(head.parents).toEqual([sha.A, sha.C]);
  });
});

describe('release merge check: the command the deploy job runs', () => {
  it('exits 0 on a release merge, reading HEAD and origin/staging by default', () => {
    const res = runCli([]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/\[release-check\] OK/);
  });

  it('exits 1 on a squash merge and says why, with nothing on stdout', () => {
    const res = runCli(['--commit', sha.squash]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/REFUSED/);
    expect(res.stderr).toMatch(/1 parent\(s\)/);
    expect(res.stderr).toMatch(/pull request/);
    expect(res.stdout).toBe('');
  });

  it('exits 1 on a direct push and on a merge of something other than the staging tip', () => {
    expect(runCli(['--commit', sha.direct]).status).toBe(1);
    expect(runCli(['--commit', sha.featureMerge]).status).toBe(1);
  });

  it('takes both revisions as arguments', () => {
    expect(runCli(['--commit', sha.release, '--staging', sha.C]).status).toBe(0);
    expect(runCli(['--commit', sha.release, '--staging', sha.D]).status).toBe(1);
  });

  it('marks the refusal as an error annotation when it runs in GitHub Actions', () => {
    const res = runCli(['--commit', sha.squash], { GITHUB_ACTIONS: 'true' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/^::error title=Not a release merge::/);
  });

  it('exits 2, not 0, when staging was never fetched or an argument is unknown', () => {
    const missing = runCli(['--commit', sha.release, '--staging', 'origin/never-fetched']);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/cannot resolve "origin\/never-fetched"/);
    expect(runCli(['--force']).status).toBe(2);
  });
});

describe('release merge check: the shapes git merge itself writes', () => {
  it('a real --no-ff merge of the staging tip passes; a real --squash merge of it fails', () => {
    git('checkout', '--quiet', '--force', '-b', 'real-release', sha.A);
    git('merge', '--quiet', '--no-ff', '-m', 'Merge staging into main', sha.C);
    git('checkout', '--quiet', '--force', '-b', 'real-squash', sha.A);
    git('merge', '--quiet', '--squash', sha.C);
    git('commit', '--quiet', '-m', 'Squash of staging');

    const merged = readReleaseFacts({ commit: 'real-release', cwd: repo, env });
    expect(merged.parents).toEqual([sha.A, sha.C]);
    expect(evaluateReleaseMerge(merged).ok).toBe(true);

    const squashed = readReleaseFacts({ commit: 'real-squash', cwd: repo, env });
    expect(squashed.parents).toEqual([sha.A]);
    expect(squashed.commitTree).toBe(squashed.stagingTree);
    expect(evaluateReleaseMerge(squashed).ok).toBe(false);
  });
});
