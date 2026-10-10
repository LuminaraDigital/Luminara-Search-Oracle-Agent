#!/usr/bin/env node
/**
 * Release-merge check for the production deploy (plan rule 2.16, task SW0a-12).
 *
 * Production may only run what staging ran. The commit being deployed must meet all four:
 *   (a) it is a merge commit with exactly two parents;
 *   (b) its tree is identical to its second parent's tree;
 *   (c) its second parent is on staging's own line of history: it appears in
 *       `git rev-list --first-parent origin/staging`, so it is a commit staging itself was at,
 *       not a feature commit that staging merged;
 *   (d) it is the current tip of origin/main, so a stale re-run of an older release cannot
 *       deploy over a newer one.
 *
 * So each of these fails, and the deploy job stops before anything is migrated or deployed:
 *   - a squash merge, a rebase merge, a fast-forward or a direct push (a)
 *   - a merge whose result differs from what it merged: main held something staging did not (b)
 *   - a merge of a feature branch, or of any commit that was never staging's own (c)
 *   - an older release, once main has moved on (d)
 *
 * The second parent does not have to be the tip of staging today. A release that passed, migrated
 * D1 and then failed at deploy or smoke must stay re-runnable after staging has moved on;
 * otherwise production is left with a new schema under old code. Whether staging's own deploy of
 * that commit went green is a separate step (scripts/check-staging-deploy.mjs).
 *
 * Usage:
 *   node scripts/check-release-merge.mjs          # HEAD against origin/staging and origin/main
 *   node scripts/check-release-merge.mjs --commit <rev> --staging <rev> --main <rev>
 *
 * It reads git and nothing else, and needs full history (fetch-depth: 0). Exit 0: a release.
 * Exit 1: not one (each failed condition and what to do, on stderr). Exit 2: git could not answer.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40,64}$/;
/** Characters a branch, tag, SHA or HEAD~1 style revision is made of. No whitespace, no leading dash. */
const REVISION = /^(?!-)[A-Za-z0-9_./@^~{}-]+$/;
const NEEDS_HISTORY = 'The checkout needs full history (fetch-depth: 0) with origin/staging and origin/main fetched.';

/**
 * Read commit objects by revision, in one git process. Each result is { sha, tree, parents }
 * taken from the raw commit object, or null when git cannot resolve the revision to a commit.
 * The raw object is used, not rev-list, because a shallow clone reports its boundary commit as
 * having no parents while the object still records them.
 */
export function readCommits(revisions, { cwd, env } = {}) {
  for (const rev of revisions) {
    if (typeof rev !== 'string' || !REVISION.test(rev)) throw new Error(`"${rev}" is not a revision this check accepts.`);
  }
  const out = execFileSync('git', ['cat-file', '--batch'], {
    cwd,
    env,
    input: revisions.map((rev) => `${rev}^{commit}\n`).join(''),
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const commits = [];
  let offset = 0;
  for (let i = 0; i < revisions.length; i++) {
    const lineEnd = out.indexOf(0x0a, offset);
    if (lineEnd < 0) throw new Error('git cat-file ended early.');
    const [sha, type, size] = out.subarray(offset, lineEnd).toString('utf8').split(' ');
    if (type !== 'commit' || !SHA.test(sha) || !/^\d+$/.test(size || '')) {
      commits.push(null); // "<name> missing": one line, no object follows
      offset = lineEnd + 1;
      continue;
    }
    const bodyStart = lineEnd + 1;
    const body = out.subarray(bodyStart, bodyStart + Number(size)).toString('utf8');
    offset = bodyStart + Number(size) + 1; // one line feed follows each object
    let tree = '';
    const parents = [];
    for (const line of body.split('\n')) {
      if (line === '') break; // end of the commit header; the message follows
      const match = /^(tree|parent) ([0-9a-f]{40,64})$/.exec(line);
      if (!match) continue;
      if (match[1] === 'tree') tree = match[2];
      else parents.push(match[2]);
    }
    commits.push({ sha, tree, parents });
  }
  return commits;
}

/** Every commit staging itself was at: the first-parent line from its tip back to the root. */
export function firstParentLine(tipSha, { cwd, env } = {}) {
  const out = execFileSync('git', ['rev-list', '--first-parent', tipSha], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
  return out.split('\n').filter(Boolean);
}

/** The facts the decision is made from, read from the repository at `cwd`. */
export function readReleaseFacts({ commit = 'HEAD', staging = 'origin/staging', main = 'origin/main', cwd, env } = {}) {
  const opts = { cwd, env };
  const revisions = [commit, main, staging, `${commit}^2`];
  const [deployed, mainTip, stagingTip, secondParent] = readCommits(revisions, opts);
  for (const [found, rev] of [[deployed, commit], [mainTip, main], [stagingTip, staging]]) {
    if (!found) throw new Error(`git cannot resolve "${rev}" to a commit. ${NEEDS_HISTORY}`);
  }
  const facts = {
    commit: deployed.sha,
    parents: deployed.parents,
    commitTree: deployed.tree,
    secondParentTree: '',
    secondParentOnStaging: false,
    mainTip: mainTip.sha,
    stagingTip: stagingTip.sha,
  };
  if (deployed.parents.length === 2) {
    // The object names two parents; git must be able to hand over the second one.
    if (!secondParent || secondParent.sha !== deployed.parents[1]) {
      throw new Error(`git cannot read ${deployed.parents[1]}, the second parent of ${deployed.sha}. ${NEEDS_HISTORY}`);
    }
    facts.secondParentTree = secondParent.tree;
    facts.secondParentOnStaging = firstParentLine(stagingTip.sha, opts).includes(secondParent.sha);
  }
  return facts;
}

/**
 * Pure decision. Returns { ok, failed, problems, reason }: `failed` lists the letters of the
 * conditions that failed, `problems` says for each what is wrong and what to do.
 */
export function evaluateReleaseMerge(facts) {
  const { commit, parents, commitTree, secondParentTree, secondParentOnStaging, mainTip } = facts || {};
  const short = (sha) => String(sha || '').slice(0, 12);
  if (!commit || !commitTree || !mainTip || !Array.isArray(parents)) {
    const reason = 'The commit, its tree or the tip of main could not be read.';
    return { ok: false, failed: ['unreadable'], problems: [{ condition: 'unreadable', message: reason }], reason };
  }
  const problems = [];
  if (parents.length !== 2) {
    problems.push({
      condition: 'a',
      message:
        `Condition (a) failed: commit ${short(commit)} has ${parents.length} parent(s); a release is a merge commit with exactly two. ` +
        'A squash merge, a rebase merge, a fast-forward or a direct push does not qualify. ' +
        'What to do: merge staging into main through a pull request with "Create a merge commit".',
    });
  } else {
    if (!secondParentTree || commitTree !== secondParentTree) {
      problems.push({
        condition: 'b',
        message:
          `Condition (b) failed: the files of commit ${short(commit)} differ from the files of ${short(parents[1])}, the commit it merged ` +
          `(tree ${short(commitTree)} against ${short(secondParentTree)}). main holds something staging never ran. ` +
          'What to do: merge main back into staging with a pull request, let staging deploy, then release staging again.',
      });
    }
    if (secondParentOnStaging !== true) {
      problems.push({
        condition: 'c',
        message:
          `Condition (c) failed: commit ${short(commit)} merges ${short(parents[1])}, which staging itself was never at ` +
          '(it is not on the first-parent line of origin/staging). Only a commit staging deployed may be released. ' +
          'What to do: merge that work into staging first, then release with a pull request from staging into main.',
      });
    }
  }
  if (commit !== mainTip) {
    problems.push({
      condition: 'd',
      message:
        `Condition (d) failed: commit ${short(commit)} is not the current tip of main (${short(mainTip)}). ` +
        'This is a stale run of an older release, and it must not deploy over a newer one. ' +
        'What to do: use the run of the newest release. To go back to older code, use "wrangler rollback", not this workflow.',
    });
  }
  if (problems.length > 0) {
    return { ok: false, failed: problems.map((p) => p.condition), problems, reason: problems.map((p) => p.message).join(' ') };
  }
  return {
    ok: true,
    failed: [],
    problems: [],
    reason:
      `Commit ${short(commit)} is the tip of main, a two-parent merge of ${short(parents[1])}, ` +
      'which staging was at, and its files are identical to that commit\'s.',
  };
}

function parseArgs(argv) {
  const out = { commit: 'HEAD', staging: 'origin/staging', main: 'origin/main' };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (['--commit', '--staging', '--main'].includes(name) && typeof argv[i + 1] === 'string' && argv[i + 1] !== '') {
      out[name.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument "${name}". Usage: check-release-merge.mjs [--commit <rev>] [--staging <rev>] [--main <rev>]`);
    }
  }
  return out;
}

function main() {
  let facts;
  try {
    facts = readReleaseFacts(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(`[release-check] ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }
  const verdict = evaluateReleaseMerge(facts);
  if (verdict.ok) {
    console.log(`[release-check] OK. ${verdict.reason}`);
    process.exit(0);
  }
  // In GitHub Actions the ::error:: prefix puts each reason on the run summary.
  const prefix = process.env.GITHUB_ACTIONS === 'true' ? '::error title=Not a release merge::' : '[release-check] REFUSED. ';
  for (const problem of verdict.problems) console.error(`${prefix}${problem.message}`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
