#!/usr/bin/env node
/**
 * Release-merge check for the production deploy (plan rule 2.16, task SW0a-12).
 *
 * Production may only run what staging ran. This passes only when the commit being deployed is
 *   1. a merge commit with exactly two parents,
 *   2. whose second parent is the current tip of staging, and
 *   3. whose tree is identical to that tip's tree.
 *
 * So each of these fails, and the deploy job stops before anything is migrated or deployed:
 *   - a squash merge, a rebase merge or a direct push (one parent)
 *   - a fast-forward of main to staging (the commit is the tip, not a merge of it)
 *   - a merge of any commit that is not the tip of staging (a feature branch, an older staging commit)
 *   - a merge whose result differs from staging (main held something staging did not)
 *
 * Usage:
 *   node scripts/check-release-merge.mjs                           # HEAD against origin/staging
 *   node scripts/check-release-merge.mjs --commit <rev> --staging <rev>
 *
 * It reads two commit objects from git and nothing else. Exit 0: a release merge. Exit 1: not one
 * (reason on stderr). Exit 2: git could not answer (for example staging was not fetched).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40,64}$/;
/** Characters a branch, tag, SHA or HEAD~1 style revision is made of. No whitespace, no leading dash. */
const REVISION = /^(?!-)[A-Za-z0-9_./@^~{}-]+$/;

/**
 * Read commit objects by revision, in one git process. Each result is { sha, tree, parents }
 * taken from the raw commit object. The raw object is used, not rev-list, because a shallow
 * clone reports its boundary commit as having no parents while the object still records them.
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
  for (const rev of revisions) {
    const lineEnd = out.indexOf(0x0a, offset);
    const header = out.subarray(offset, lineEnd < 0 ? out.length : lineEnd).toString('utf8');
    const [sha, type, size] = header.split(' ');
    if (lineEnd < 0 || type !== 'commit' || !SHA.test(sha) || !/^\d+$/.test(size || '')) {
      throw new Error(`git cannot resolve "${rev}" to a commit. Is it fetched? The checkout needs origin/staging.`);
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

/** The two SHAs and two trees the decision is made from, read from the repository at `cwd`. */
export function readReleaseFacts({ commit = 'HEAD', staging = 'origin/staging', cwd, env } = {}) {
  const [deployed, stagingTip] = readCommits([commit, staging], { cwd, env });
  return {
    commit: deployed.sha,
    parents: deployed.parents,
    commitTree: deployed.tree,
    stagingTip: stagingTip.sha,
    stagingTree: stagingTip.tree,
  };
}

/** Pure decision. Returns { ok, reason }. */
export function evaluateReleaseMerge(facts) {
  const { commit, parents, commitTree, stagingTip, stagingTree } = facts || {};
  const short = (sha) => String(sha || '').slice(0, 12);
  if (!commit || !stagingTip || !commitTree || !stagingTree || !Array.isArray(parents)) {
    return { ok: false, reason: 'The commit, the staging tip or one of their trees could not be read.' };
  }
  if (parents.length !== 2) {
    return {
      ok: false,
      reason:
        `Commit ${short(commit)} has ${parents.length} parent(s); a release is a merge commit with exactly two. ` +
        'A squash merge, a rebase merge, a fast-forward or a direct push does not qualify.',
    };
  }
  if (parents[1] !== stagingTip) {
    return {
      ok: false,
      reason:
        `Commit ${short(commit)} merges ${short(parents[1])}, which is not the tip of staging (${short(stagingTip)}). ` +
        'Only the current tip of staging may be released.',
    };
  }
  if (commitTree !== stagingTree) {
    return {
      ok: false,
      reason:
        `Commit ${short(commit)} merges the tip of staging but its files differ from staging's ` +
        `(tree ${short(commitTree)} against ${short(stagingTree)}). main holds something staging never ran.`,
    };
  }
  return {
    ok: true,
    reason: `Commit ${short(commit)} is a merge of the staging tip ${short(stagingTip)} and its files are identical to staging's.`,
  };
}

function parseArgs(argv) {
  const out = { commit: 'HEAD', staging: 'origin/staging' };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if ((name === '--commit' || name === '--staging') && typeof argv[i + 1] === 'string' && argv[i + 1] !== '') {
      out[name.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument "${name}". Usage: check-release-merge.mjs [--commit <rev>] [--staging <rev>]`);
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
  const advice = 'Release by merging the tip of staging into main with a merge commit, through a pull request.';
  // In GitHub Actions the ::error:: prefix puts the reason on the run summary.
  const prefix = process.env.GITHUB_ACTIONS === 'true' ? '::error title=Not a release merge::' : '[release-check] REFUSED. ';
  console.error(`${prefix}${verdict.reason} ${advice}`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
