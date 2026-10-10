import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateReleaseMerge, firstParentLine, readCommits, readReleaseFacts } from '../scripts/check-release-merge.mjs';

// Each case starts git or node processes, which can take seconds apiece on a busy machine.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * The production deploy runs scripts/check-release-merge.mjs before it migrates or deploys.
 * A release must meet four conditions:
 *   (a) two parents; (b) tree equal to the second parent's tree; (c) the second parent is on
 *   staging's own first-parent line; (d) the commit is the current tip of main.
 *
 * These tests build a real git repository in a temporary directory (no network) and ask the
 * script about each way a commit can reach main. Starting a process is slow on some machines,
 * so the commit graph is written by one `git fast-import` call: it stores ordinary commit
 * objects with the parents and files stated below. The last test makes the two headline shapes
 * with `git merge` itself and gets the same answers.
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

/** The verdict for `commit` when main is at `main` (by default the commit itself) and staging at `staging`. */
function check(commit: string, options: { main?: string; staging?: string } = {}) {
  const facts = readReleaseFacts({ commit, main: options.main ?? commit, staging: options.staging ?? 'origin/staging', cwd: repo, env });
  return { facts, verdict: evaluateReleaseMerge(facts) };
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
  A: 1, B: 2, C: 3, feature: 4, stagingMerge: 5, D: 6, release: 7, squash: 8, direct: 9, featureMerge: 10,
  stray: 11, strayMerge: 12, hotfix: 13, divergedMerge: 14, swapped: 15, octopus: 16, nextRelease: 17,
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

  execFileSync('git', ['init', '--quiet', '--initial-branch=main', repo], { cwd: root, env, stdio: 'ignore' });
  expect(samePath(git('rev-parse', '--show-toplevel'), repo)).toBe(true);

  const m = MARKS;
  const stream = [
    // staging's own line of history (first parents): A - B - C - stagingMerge - D
    //   A is where staging left main; B and C are commits on staging;
    //   stagingMerge is staging merging the feature branch; D is a later commit on staging.
    commitBlock(m.A, 'main', 'A on main', [], ['a.txt']),
    commitBlock(m.B, 'staging', 'B on staging', [m.A], ['b.txt']),
    commitBlock(m.C, 'staging', 'C on staging', [m.B], ['c.txt']),
    commitBlock(m.feature, 'feature', 'F on a feature branch', [m.A], ['f.txt']),
    commitBlock(m.stagingMerge, 'staging', 'staging merges the feature branch', [m.C, m.feature], ['f.txt']),
    commitBlock(m.D, 'staging', 'D on staging, after the release', [m.stagingMerge], ['e.txt']),
    // What a fetch leaves behind. staging has already moved on past C, the commit the release merged.
    `reset refs/remotes/origin/staging\nfrom :${m.D}\n\n`,

    // The release: main merges C, a commit staging was at, with a merge commit.
    commitBlock(m.release, 'release', 'Merge staging into main', [m.A, m.C], ['b.txt', 'c.txt']),
    // (a) fails: a squash merge has staging's files and one parent; a direct push is an ordinary commit.
    commitBlock(m.squash, 'squash', 'Squash of staging', [m.A], ['b.txt', 'c.txt']),
    commitBlock(m.direct, 'direct', 'Direct push to main', [m.A], ['d.txt']),
    // (c) fails: the feature commit reached staging only as the second parent of stagingMerge,
    // so staging itself was never at it. The stray commit never reached staging at all.
    commitBlock(m.featureMerge, 'feature-merge', 'Merge a feature branch into main', [m.A, m.feature], ['f.txt']),
    commitBlock(m.stray, 'stray', 'G on a branch staging never saw', [m.A], ['g.txt']),
    commitBlock(m.strayMerge, 'stray-merge', 'Merge a stray branch into main', [m.A, m.stray], ['g.txt']),
    // (b) fails: main holds a hotfix staging never ran, then merges C. Right parent, different files.
    commitBlock(m.hotfix, 'hotfix', 'H hotfix on main only', [m.A], ['h.txt']),
    commitBlock(m.divergedMerge, 'diverged', 'Merge staging into a main that moved', [m.hotfix, m.C], ['b.txt', 'c.txt']),
    // The staging commit as the first parent instead of the second, and a merge with three parents.
    commitBlock(m.swapped, 'swapped', 'Merge main into staging', [m.C, m.hotfix], ['h.txt']),
    commitBlock(m.octopus, 'octopus', 'Merge staging and a feature at once', [m.A, m.C, m.feature], ['b.txt', 'c.txt', 'f.txt']),
    // (d): a newer release on top of the first one. main is now here.
    commitBlock(m.nextRelease, 'main', 'Merge staging into main again', [m.release, m.D], ['f.txt', 'e.txt']),
    `reset refs/remotes/origin/main\nfrom :${m.nextRelease}\n\n`,
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

describe('release merge check: a release passes', () => {
  it('for a two-parent merge of a commit staging was at, with that commit\'s files, at the tip of main', () => {
    const { facts, verdict } = check(sha.release);
    expect(facts.commit).toBe(sha.release);
    expect(facts.parents).toEqual([sha.A, sha.C]);
    expect(facts.commitTree).toBe(facts.secondParentTree);
    expect(facts.secondParentOnStaging).toBe(true);
    expect(facts.mainTip).toBe(sha.release);
    expect(verdict).toMatchObject({ ok: true, failed: [] });
  });

  it('and still passes after staging has moved on, so a failed deploy can be re-run', () => {
    // The release merged C. Since then staging merged a feature branch and took another commit.
    expect(firstParentLine(sha.D, { cwd: repo, env })).toEqual([sha.D, sha.stagingMerge, sha.C, sha.B, sha.A]);
    expect(check(sha.release, { staging: sha.C }).verdict.ok).toBe(true); // at release time: C was the tip
    expect(check(sha.release, { staging: sha.stagingMerge }).verdict.ok).toBe(true); // one pull request later
    expect(check(sha.release, { staging: sha.D }).verdict.ok).toBe(true); // and another
  });

  it('for the next release too, whose second parent is the tip of staging today', () => {
    const { facts, verdict } = check(sha.nextRelease);
    expect(facts.parents).toEqual([sha.release, sha.D]);
    expect(verdict.ok).toBe(true);
  });
});

describe('release merge check: each condition failing alone', () => {
  it('(a) a squash merge: staging\'s files, one parent', () => {
    const { facts, verdict } = check(sha.squash);
    expect(facts.parents).toEqual([sha.A]);
    expect(verdict.failed).toEqual(['a']);
    expect(verdict.reason).toMatch(/Condition \(a\) failed: .*1 parent\(s\)/);
    expect(verdict.reason).toMatch(/What to do: .*Create a merge commit/);
  });

  it('(a) a direct push, a fast-forward of main to staging, and a merge with three parents', () => {
    expect(check(sha.direct).verdict.failed).toEqual(['a']);
    expect(check(sha.D).verdict.failed).toEqual(['a']);
    const octopus = check(sha.octopus);
    expect(octopus.facts.parents).toEqual([sha.A, sha.C, sha.feature]);
    expect(octopus.verdict.failed).toEqual(['a']);
    expect(octopus.verdict.reason).toMatch(/3 parent\(s\)/);
  });

  it('(b) a merge of a staging commit whose files differ from that commit\'s', () => {
    const { facts, verdict } = check(sha.divergedMerge);
    expect(facts.parents).toEqual([sha.hotfix, sha.C]);
    expect(facts.secondParentOnStaging).toBe(true);
    expect(facts.commitTree).not.toBe(facts.secondParentTree);
    expect(verdict.failed).toEqual(['b']);
    expect(verdict.reason).toMatch(/Condition \(b\) failed: .*differ/);
    expect(verdict.reason).toMatch(/What to do: merge main back into staging/);
  });

  it('(c) a merge of a feature commit that staging merged but was never itself at', () => {
    const { facts, verdict } = check(sha.featureMerge);
    expect(facts.parents).toEqual([sha.A, sha.feature]);
    expect(facts.commitTree).toBe(facts.secondParentTree);
    // The feature commit is in staging's history, only not on staging's own line.
    expect(git('merge-base', '--is-ancestor', sha.feature, sha.D)).toBe('');
    expect(facts.secondParentOnStaging).toBe(false);
    expect(verdict.failed).toEqual(['c']);
    expect(verdict.reason).toMatch(/Condition \(c\) failed: .*staging itself was never at/);
    expect(verdict.reason).toMatch(/What to do: merge that work into staging first/);
  });

  it('(c) a merge of a branch that never reached staging', () => {
    const { facts, verdict } = check(sha.strayMerge);
    expect(facts.commitTree).toBe(facts.secondParentTree);
    expect(verdict.failed).toEqual(['c']);
  });

  it('(d) an older release once main has moved on: a stale re-run', () => {
    const { facts, verdict } = check(sha.release, { main: 'origin/main' });
    expect(facts.mainTip).toBe(sha.nextRelease);
    expect(verdict.failed).toEqual(['d']);
    expect(verdict.reason).toMatch(/Condition \(d\) failed: .*not the current tip of main/);
    expect(verdict.reason).toMatch(/What to do: use the run of the newest release/);
  });
});

describe('release merge check: more than one condition, and facts that cannot be read', () => {
  it('names every condition that failed', () => {
    // staging's commit is the first parent, the hotfix the second: wrong files and not staging's.
    const swapped = check(sha.swapped);
    expect(swapped.facts.parents).toEqual([sha.C, sha.hotfix]);
    expect(swapped.verdict.failed).toEqual(['b', 'c']);
    // A squash that is not even the tip of main.
    expect(check(sha.squash, { main: 'origin/main' }).verdict.failed).toEqual(['a', 'd']);
    expect(check(sha.featureMerge, { main: 'origin/main' }).verdict.failed).toEqual(['c', 'd']);
  });

  it('the pure decision fails each condition alone and passes only when all four hold', () => {
    const good = { commit: 'm1', parents: ['p1', 'p2'], commitTree: 't1', secondParentTree: 't1', secondParentOnStaging: true, mainTip: 'm1' };
    expect(evaluateReleaseMerge(good)).toMatchObject({ ok: true, failed: [] });
    expect(evaluateReleaseMerge({ ...good, parents: ['p1'] }).failed).toEqual(['a']);
    expect(evaluateReleaseMerge({ ...good, parents: ['p1', 'p2', 'p3'] }).failed).toEqual(['a']);
    expect(evaluateReleaseMerge({ ...good, secondParentTree: 't2' }).failed).toEqual(['b']);
    expect(evaluateReleaseMerge({ ...good, secondParentTree: '' }).failed).toEqual(['b']);
    expect(evaluateReleaseMerge({ ...good, secondParentOnStaging: false }).failed).toEqual(['c']);
    expect(evaluateReleaseMerge({ ...good, secondParentOnStaging: undefined }).failed).toEqual(['c']);
    expect(evaluateReleaseMerge({ ...good, mainTip: 'm2' }).failed).toEqual(['d']);
  });

  it('refuses facts it could not read rather than passing them', () => {
    expect(evaluateReleaseMerge(undefined).ok).toBe(false);
    expect(evaluateReleaseMerge({ commit: '', parents: [], commitTree: '', mainTip: '' }).ok).toBe(false);
    expect(evaluateReleaseMerge({ commit: 'm1', parents: ['p1', 'p2'], commitTree: 't1', secondParentTree: 't1', secondParentOnStaging: true, mainTip: '' }).ok).toBe(false);
  });

  it('throws, rather than guessing, on a revision git does not have or one that is not a revision', () => {
    expect(() => readReleaseFacts({ commit: sha.release, main: sha.release, staging: 'origin/never-fetched', cwd: repo, env })).toThrow(/cannot resolve "origin\/never-fetched"/);
    expect(() => readReleaseFacts({ commit: sha.release, main: 'origin/never-fetched', cwd: repo, env })).toThrow(/cannot resolve "origin\/never-fetched"/);
    expect(() => readReleaseFacts({ commit: '--all', cwd: repo, env })).toThrow(/not a revision/);
    expect(() => readReleaseFacts({ commit: 'HEAD\norigin/staging', cwd: repo, env })).toThrow(/not a revision/);
  });

  it('in a shallow clone it reads the real parents, then stops because the history is missing', () => {
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
    expect(() => readReleaseFacts({ commit: 'HEAD', main: 'HEAD', staging: 'HEAD', ...opts })).toThrow(/full history/);
  });
});

describe('release merge check: the command the deploy job runs', () => {
  it('exits 0 on a release, reading HEAD, origin/staging and origin/main by default', () => {
    // HEAD is the branch main, which the import left at the newest release, as is origin/main.
    const res = runCli([]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/\[release-check\] OK/);
  });

  it('exits 1 on a squash merge and says which condition failed and what to do, with nothing on stdout', () => {
    const res = runCli(['--commit', sha.squash, '--main', sha.squash]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/REFUSED\. Condition \(a\) failed/);
    expect(res.stderr).toMatch(/What to do:/);
    expect(res.stdout).toBe('');
  });

  it('exits 1 on a merge of a feature branch, and on a stale older release', () => {
    const feature = runCli(['--commit', sha.featureMerge, '--main', sha.featureMerge]);
    expect(feature.status).toBe(1);
    expect(feature.stderr).toMatch(/Condition \(c\) failed/);
    const stale = runCli(['--commit', sha.release]);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toMatch(/Condition \(d\) failed/);
  });

  it('marks each refusal as an error annotation when it runs in GitHub Actions', () => {
    const res = runCli(['--commit', sha.squash], { GITHUB_ACTIONS: 'true' });
    expect(res.status).toBe(1);
    const lines = res.stderr.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^::error title=Not a release merge::Condition \(a\) failed/);
    expect(lines[1]).toMatch(/^::error title=Not a release merge::Condition \(d\) failed/);
  });

  it('exits 2, not 0, when staging was never fetched or an argument is unknown', () => {
    const missing = runCli(['--staging', 'origin/never-fetched']);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/cannot resolve "origin\/never-fetched"/);
    expect(runCli(['--force']).status).toBe(2);
  });
});

describe('release merge check: the shapes git merge itself writes', () => {
  it('a real --no-ff merge of a staging commit passes; a real --squash merge of it fails (a)', () => {
    git('checkout', '--quiet', '--force', '-b', 'real-release', sha.A);
    git('merge', '--quiet', '--no-ff', '-m', 'Merge staging into main', sha.C);
    git('checkout', '--quiet', '--force', '-b', 'real-squash', sha.A);
    git('merge', '--quiet', '--squash', sha.C);
    git('commit', '--quiet', '-m', 'Squash of staging');

    const merged = check('real-release');
    expect(merged.facts.parents).toEqual([sha.A, sha.C]);
    expect(merged.verdict.ok).toBe(true);

    const squashed = check('real-squash');
    expect(squashed.facts.parents).toEqual([sha.A]);
    expect(squashed.verdict.failed).toEqual(['a']);
  });
});
