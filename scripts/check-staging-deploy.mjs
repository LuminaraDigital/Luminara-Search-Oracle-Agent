#!/usr/bin/env node
/**
 * Did staging's own deploy of this commit go green? (plan rule 2.16, task SW0a-12)
 *
 * scripts/check-release-merge.mjs proves the shape of the release merge. This proves the other
 * half: that the commit production is about to run (the second parent of the release merge)
 * was pushed to staging, and that the staging deploy job of the deploy workflow finished with
 * success for it.
 *
 * It decides from GitHub API JSON given on stdin and never calls the API itself. The workflow
 * step only fetches and pipes, and the tests feed it fixtures. Two calls, two modes:
 *
 *   gh api "repos/<owner>/<repo>/actions/workflows/deploy-cloudflare.yml/runs?head_sha=<sha>&branch=staging&event=push&per_page=100" \
 *     | node scripts/check-staging-deploy.mjs run --sha <sha>
 *       Prints the id of the newest run of the deploy workflow for a push of <sha> to staging,
 *       and only if that run completed with success. A re-run counts as its latest attempt:
 *       the listing carries the latest attempt's status and conclusion.
 *
 *   gh api "repos/<owner>/<repo>/actions/runs/<id>/jobs?filter=latest&per_page=100" \
 *     | node scripts/check-staging-deploy.mjs job --sha <sha> --run <id>
 *       Requires the staging deploy job of that run, in its latest attempt, to have completed
 *       with success.
 *
 * It fails closed. Anything but a clear success exits 1: a failure, a cancelled or skipped job,
 * a run still in progress, no run found, a run for another commit or branch, an API error body,
 * JSON of another shape. A staging deploy started by hand does not count: the listing does not
 * say which environment a manual run named, so only the run of the push to staging is accepted.
 *
 * Exit 0: success (mode "run" prints only the run id on stdout). Exit 1: not a success, reason
 * on stderr. Exit 2: bad arguments.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEPLOY_WORKFLOW_PATH = '.github/workflows/deploy-cloudflare.yml';
/** The `name:` of the deploy_staging job. tests/checkStagingDeploy.test.ts keeps it equal to the workflow's. */
export const STAGING_JOB_NAME = 'Staging Deployment & Pre-Production Smoke Gates';

const SHA = /^[0-9a-f]{40,64}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const refuse = (reason) => ({ ok: false, reason });

/** GitHub answers an error with { message, documentation_url, status }. Say so instead of "unexpected JSON". */
function apiMessage(doc) {
  return isObject(doc) && typeof doc.message === 'string' ? ` GitHub answered: "${doc.message.slice(0, 200)}".` : '';
}

const WAIT = 'Wait for staging to finish, then use "Re-run failed jobs" on this run.';
const GET_GREEN = 'Get a green staging deploy of this commit (re-run it on staging), or release a newer staging commit.';

/**
 * From the runs listing of the deploy workflow, pick the newest run for a push of `sha` to
 * staging and require it to have completed with success. Returns { ok, runId, attempt, reason }.
 */
export function pickStagingRun(listing, sha) {
  if (typeof sha !== 'string' || !SHA.test(sha)) return refuse('The commit to look up is not a full SHA.');
  if (!isObject(listing) || !Array.isArray(listing.workflow_runs)) {
    return refuse(`The input is not a list of workflow runs.${apiMessage(listing)}`);
  }
  const runs = listing.workflow_runs.filter(isObject);
  if (runs.length !== listing.workflow_runs.length) return refuse('The list of workflow runs holds an entry that is not a run.');
  if (typeof listing.total_count === 'number' && listing.total_count > runs.length) {
    return refuse(`The list holds ${runs.length} of ${listing.total_count} runs, so the newest one may be missing.`);
  }
  const forCommit = runs.filter((run) => run.head_sha === sha);
  if (forCommit.length === 0) {
    const what = runs.length === 0 ? 'No run of the deploy workflow was found' : `The ${runs.length} run(s) in the list are for another commit; none was found`;
    return refuse(`${what} for ${sha}. staging never deployed this commit from a push. ${GET_GREEN}`);
  }
  const stagingPushes = forCommit.filter(
    (run) => run.event === 'push' && run.head_branch === 'staging' && String(run.path || '').split('@')[0] === DEPLOY_WORKFLOW_PATH,
  );
  if (stagingPushes.length === 0) {
    const seen = forCommit.map((run) => `${run.event} on ${run.head_branch}`).join(', ');
    return refuse(`${sha} has ${forCommit.length} run(s) (${seen}), but none is the deploy workflow running for a push to staging. ${GET_GREEN}`);
  }
  const newest = stagingPushes.reduce((a, b) => (Number(b.run_number) > Number(a.run_number) ? b : a));
  if (!Number.isInteger(newest.id) || newest.id <= 0) return refuse('The newest staging run has no usable id.');
  const attempt = Number.isInteger(newest.run_attempt) ? newest.run_attempt : 1;
  const label = `Staging run ${newest.id} (attempt ${attempt}) for ${sha.slice(0, 12)}`;
  if (newest.status !== 'completed') return refuse(`${label} has not finished: its status is "${newest.status}". ${WAIT}`);
  if (newest.conclusion !== 'success') return refuse(`${label} concluded "${newest.conclusion}", not success. ${GET_GREEN}`);
  return { ok: true, runId: newest.id, attempt, reason: `${label} completed with success.` };
}

/**
 * From the jobs listing of that run (latest attempt), require the staging deploy job to have
 * completed with success. Returns { ok, reason }.
 */
export function judgeStagingJob(listing, sha, runId) {
  if (typeof sha !== 'string' || !SHA.test(sha)) return refuse('The commit to look up is not a full SHA.');
  if (!Number.isInteger(runId) || runId <= 0) return refuse('The run to look up has no usable id.');
  if (!isObject(listing) || !Array.isArray(listing.jobs)) return refuse(`The input is not a list of jobs.${apiMessage(listing)}`);
  const jobs = listing.jobs.filter(isObject);
  if (jobs.length !== listing.jobs.length) return refuse('The list of jobs holds an entry that is not a job.');
  if (typeof listing.total_count === 'number' && listing.total_count > jobs.length) {
    return refuse(`The list holds ${jobs.length} of ${listing.total_count} jobs, so the staging job may be missing.`);
  }
  const foreign = jobs.filter((job) => job.run_id !== runId || job.head_sha !== sha);
  if (foreign.length > 0) return refuse(`The list holds ${foreign.length} job(s) of another run or another commit than run ${runId} for ${sha}.`);
  const stagingJobs = jobs.filter((job) => job.name === STAGING_JOB_NAME);
  if (stagingJobs.length === 0) return refuse(`Run ${runId} has no job named "${STAGING_JOB_NAME}". ${GET_GREEN}`);
  // filter=latest returns one. If every attempt is listed, the latest attempt is the one that counts.
  const latest = stagingJobs.reduce((a, b) => (Number(b.run_attempt) > Number(a.run_attempt) ? b : a));
  const label = `The staging deploy job of run ${runId} (attempt ${latest.run_attempt})`;
  if (latest.status !== 'completed') return refuse(`${label} has not finished: its status is "${latest.status}". ${WAIT}`);
  if (latest.conclusion !== 'success') return refuse(`${label} concluded "${latest.conclusion}", not success. ${GET_GREEN}`);
  return { ok: true, reason: `${label} completed with success for ${sha.slice(0, 12)}.` };
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const out = { mode, sha: '', run: '' };
  if (mode !== 'run' && mode !== 'job') throw new Error('The first argument must be "run" or "job".');
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i];
    if ((name === '--sha' || name === '--run') && typeof rest[i + 1] === 'string' && rest[i + 1] !== '') {
      out[name.slice(2)] = rest[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument "${name}".`);
    }
  }
  if (!SHA.test(out.sha)) throw new Error('--sha must be a full commit SHA.');
  if (mode === 'job' && !/^[1-9]\d*$/.test(out.run)) throw new Error('--run must be the numeric id of the run.');
  return out;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[staging-deploy-check] ${err instanceof Error ? err.message : err} Usage: check-staging-deploy.mjs run --sha <sha> | job --sha <sha> --run <id>, with the API's JSON on stdin.`);
    process.exit(2);
  }
  let verdict;
  try {
    const doc = JSON.parse(readFileSync(0, 'utf8'));
    verdict = args.mode === 'run' ? pickStagingRun(doc, args.sha) : judgeStagingJob(doc, args.sha, Number(args.run));
  } catch {
    verdict = refuse('The input on stdin is not JSON. The API call before this one may have failed.');
  }
  if (!verdict.ok) {
    const prefix = process.env.GITHUB_ACTIONS === 'true' ? '::error title=Staging deploy not green::' : '[staging-deploy-check] REFUSED. ';
    console.error(`${prefix}${verdict.reason}`);
    process.exit(1);
  }
  console.error(`[staging-deploy-check] OK. ${verdict.reason}`);
  if (args.mode === 'run') console.log(String(verdict.runId));
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
