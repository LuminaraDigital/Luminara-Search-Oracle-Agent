import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEPLOY_WORKFLOW_PATH, judgeStagingJob, pickStagingRun, STAGING_JOB_NAME } from '../scripts/check-staging-deploy.mjs';

// The last group starts node processes, which can take seconds apiece on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

/**
 * scripts/check-staging-deploy.mjs: before production migrates or deploys, the commit it is
 * about to run must have a green staging deploy from its push to staging. The script decides
 * from GitHub API JSON on stdin. The fixtures below have the fields of real responses of
 * GET /actions/workflows/{file}/runs and GET /actions/runs/{id}/jobs; no test calls GitHub.
 */

const ROOT = resolve(__dirname, '..');
const SCRIPT = resolve(ROOT, 'scripts', 'check-staging-deploy.mjs');
const SOURCE = readFileSync(SCRIPT, 'utf8');

const SHA = '1111111111111111111111111111111111111111';
const OTHER_SHA = '2222222222222222222222222222222222222222';
const RUN_ID = 38046900797;

type Json = Record<string, unknown>;

const run = (overrides: Json = {}): Json => ({
  id: RUN_ID,
  name: 'Multi-Tier Cloudflare Deployment Safeguard',
  path: '.github/workflows/deploy-cloudflare.yml',
  event: 'push',
  head_branch: 'staging',
  head_sha: SHA,
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
  run_number: 117,
  ...overrides,
});
const runs = (...list: Json[]): Json => ({ total_count: list.length, workflow_runs: list });

const job = (overrides: Json = {}): Json => ({
  id: 114198141273,
  run_id: RUN_ID,
  run_attempt: 1,
  head_sha: SHA,
  head_branch: 'staging',
  name: STAGING_JOB_NAME,
  status: 'completed',
  conclusion: 'success',
  ...overrides,
});
/** On a push to staging the production job is listed too, as skipped. */
const productionJob = (overrides: Json = {}): Json => job({ id: 114198142132, name: 'Production Deployment & Live Verification', conclusion: 'skipped', ...overrides });
const jobs = (...list: Json[]): Json => ({ total_count: list.length, jobs: list });

const API_ERROR = { message: 'Not Found', documentation_url: 'https://docs.github.com/rest', status: '404' };

function runCli(args: string[], input: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  if (!('GITHUB_ACTIONS' in extraEnv)) delete env.GITHUB_ACTIONS;
  return spawnSync(process.execPath, [SCRIPT, ...args], { input, env, encoding: 'utf8' });
}

describe('staging deploy check: which run counts (the runs listing)', () => {
  it('accepts a completed, successful run of the deploy workflow for a push of this commit to staging', () => {
    expect(pickStagingRun(runs(run()), SHA)).toMatchObject({ ok: true, runId: RUN_ID, attempt: 1 });
  });

  it.each(['failure', 'cancelled', 'timed_out', 'skipped', 'action_required', 'neutral', 'stale', null, undefined, 'SUCCESS'])(
    'refuses a finished run that concluded %s',
    (conclusion) => {
      const verdict = pickStagingRun(runs(run({ conclusion })), SHA);
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toMatch(/not success/);
    },
  );

  it.each(['in_progress', 'queued', 'waiting', 'requested', 'pending', undefined])('refuses a run that is still %s, and says to wait', (status) => {
    const verdict = pickStagingRun(runs(run({ status, conclusion: null })), SHA);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/has not finished/);
    expect(verdict.reason).toMatch(/Re-run failed jobs/);
  });

  it('refuses when no run was found', () => {
    const verdict = pickStagingRun(runs(), SHA);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/No run of the deploy workflow was found/);
  });

  it('refuses a successful run that is for a different commit', () => {
    const verdict = pickStagingRun(runs(run({ head_sha: OTHER_SHA })), SHA);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/another commit/);
  });

  it('refuses a successful run of this commit that was not a push to staging', () => {
    for (const other of [{ head_branch: 'main' }, { event: 'workflow_dispatch' }, { event: 'pull_request' }, { path: '.github/workflows/ci.yml' }, { path: undefined }]) {
      const verdict = pickStagingRun(runs(run(other)), SHA);
      expect(verdict.ok, JSON.stringify(other)).toBe(false);
      expect(verdict.reason).toMatch(/none is the deploy workflow running for a push to staging/);
    }
  });

  it('picks the staging run when the same commit was also pushed to main', () => {
    const onMain = run({ id: 38026534929, head_branch: 'main', run_number: 111 });
    const onStaging = run({ id: 38026404508, head_branch: 'staging', run_number: 110 });
    expect(pickStagingRun(runs(onMain, onStaging), SHA)).toMatchObject({ ok: true, runId: 38026404508 });
    // A failed staging deploy is not rescued by the green run on main.
    expect(pickStagingRun(runs(onMain, { ...onStaging, conclusion: 'failure' }), SHA).ok).toBe(false);
  });

  it('counts the latest attempt of a re-run', () => {
    // The listing carries the latest attempt's status and conclusion.
    expect(pickStagingRun(runs(run({ run_attempt: 2, conclusion: 'success' })), SHA)).toMatchObject({ ok: true, attempt: 2 });
    expect(pickStagingRun(runs(run({ run_attempt: 2, conclusion: 'failure' })), SHA).ok).toBe(false);
    expect(pickStagingRun(runs(run({ run_attempt: 3, status: 'in_progress', conclusion: null })), SHA).ok).toBe(false);
  });

  it('with two staging runs for the commit, the newer one decides', () => {
    const older = run({ id: 100, run_number: 5 });
    const newer = run({ id: 200, run_number: 9 });
    expect(pickStagingRun(runs(older, { ...newer, conclusion: 'failure' }), SHA).ok).toBe(false);
    expect(pickStagingRun(runs({ ...newer, conclusion: 'failure' }, older), SHA).ok).toBe(false);
    expect(pickStagingRun(runs({ ...older, conclusion: 'failure' }, newer), SHA)).toMatchObject({ ok: true, runId: 200 });
  });

  it('refuses a list that is incomplete, an API error body, and anything that is not the listing', () => {
    expect(pickStagingRun({ total_count: 150, workflow_runs: [run()] }, SHA).reason).toMatch(/1 of 150 runs/);
    expect(pickStagingRun(API_ERROR, SHA).reason).toMatch(/GitHub answered: "Not Found"/);
    for (const junk of [null, undefined, [], [run()], 'text', 7, {}, { workflow_runs: 'x' }, { workflow_runs: [null] }, { workflow_runs: [[run()]] }, jobs(job())]) {
      expect(pickStagingRun(junk, SHA).ok, JSON.stringify(junk)).toBe(false);
    }
    expect(pickStagingRun(runs(run({ id: undefined })), SHA).ok).toBe(false);
    expect(pickStagingRun(runs(run({ id: '38046900797' })), SHA).ok).toBe(false);
  });

  it('refuses a commit that is not a full SHA', () => {
    for (const bad of ['', '1111111', 'HEAD', undefined, null]) expect(pickStagingRun(runs(run()), bad as string).ok).toBe(false);
  });
});

describe('staging deploy check: the staging job of that run (the jobs listing)', () => {
  it('accepts the staging deploy job completed with success, beside the skipped production job', () => {
    expect(judgeStagingJob(jobs(job(), productionJob()), SHA, RUN_ID).ok).toBe(true);
  });

  it.each(['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', null, undefined])('refuses a staging job that concluded %s', (conclusion) => {
    const verdict = judgeStagingJob(jobs(job({ conclusion }), productionJob()), SHA, RUN_ID);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not success/);
  });

  it.each(['in_progress', 'queued', 'waiting', undefined])('refuses a staging job that is still %s', (status) => {
    const verdict = judgeStagingJob(jobs(job({ status, conclusion: null })), SHA, RUN_ID);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/has not finished/);
  });

  it('refuses a run that has no staging deploy job, even if every job it has succeeded', () => {
    const verdict = judgeStagingJob(jobs(productionJob({ conclusion: 'success' })), SHA, RUN_ID);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/has no job named/);
    expect(judgeStagingJob(jobs(), SHA, RUN_ID).ok).toBe(false);
  });

  it('refuses jobs of another run or another commit', () => {
    expect(judgeStagingJob(jobs(job({ run_id: 999 })), SHA, RUN_ID).reason).toMatch(/another run or another commit/);
    expect(judgeStagingJob(jobs(job({ head_sha: OTHER_SHA })), SHA, RUN_ID).reason).toMatch(/another run or another commit/);
    expect(judgeStagingJob(jobs(job(), productionJob({ head_sha: OTHER_SHA })), SHA, RUN_ID).ok).toBe(false);
  });

  it('counts the latest attempt when every attempt is listed', () => {
    const first = (conclusion: string) => job({ id: 1, run_attempt: 1, conclusion });
    const second = (conclusion: string) => job({ id: 2, run_attempt: 2, conclusion });
    expect(judgeStagingJob(jobs(first('failure'), second('success')), SHA, RUN_ID).ok).toBe(true);
    expect(judgeStagingJob(jobs(second('success'), first('failure')), SHA, RUN_ID).ok).toBe(true);
    expect(judgeStagingJob(jobs(first('success'), second('failure')), SHA, RUN_ID).ok).toBe(false);
    expect(judgeStagingJob(jobs(second('failure'), first('success')), SHA, RUN_ID).ok).toBe(false);
  });

  it('refuses a list that is incomplete, an API error body, and anything that is not the listing', () => {
    expect(judgeStagingJob({ total_count: 40, jobs: [job()] }, SHA, RUN_ID).reason).toMatch(/1 of 40 jobs/);
    expect(judgeStagingJob(API_ERROR, SHA, RUN_ID).reason).toMatch(/GitHub answered: "Not Found"/);
    for (const junk of [null, undefined, [], [job()], 'text', {}, { jobs: 'x' }, { jobs: [null] }, runs(run())]) {
      expect(judgeStagingJob(junk, SHA, RUN_ID).ok, JSON.stringify(junk)).toBe(false);
    }
    expect(judgeStagingJob(jobs(job()), SHA, Number.NaN).ok).toBe(false);
    expect(judgeStagingJob(jobs(job()), 'HEAD', RUN_ID).ok).toBe(false);
  });
});

describe('staging deploy check: tied to the workflow it reads about', () => {
  const workflow = readFileSync(resolve(ROOT, DEPLOY_WORKFLOW_PATH), 'utf8');

  it('looks for the job by the name the workflow gives deploy_staging', () => {
    expect(existsSync(resolve(ROOT, DEPLOY_WORKFLOW_PATH))).toBe(true);
    const match = workflow.match(/^ {2}deploy_staging:\n {4}name: (.+)$/m);
    expect(match?.[1].trim()).toBe(STAGING_JOB_NAME);
  });

  it('reads stdin and nothing else: no network, no process, no file write', () => {
    const imports = SOURCE.split('\n').filter((line) => /^\s*import\b/.test(line));
    expect(imports).toEqual(["import { readFileSync } from 'node:fs';", "import { fileURLToPath } from 'node:url';"]);
    expect(SOURCE).not.toMatch(/\bfetch\s*\(|child_process|\bspawn|\bexecFile|\bimport\s*\(|\brequire\s*\(|node:(http|https|net|tls)\b/);
    expect(SOURCE).not.toMatch(/\b(write|append|unlink|rm|mkdir|rename|copy)(File)?(Sync)?\s*\(|\.write\b/);
    expect(SOURCE.match(/\b\w+Sync\b/g)?.every((name) => name === 'readFileSync')).toBe(true);
  });
});

describe('staging deploy check: as the workflow step runs it', () => {
  it('mode "run" prints only the run id on a green run, and exits 0', () => {
    const res = runCli(['run', '--sha', SHA], JSON.stringify(runs(run())));
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(`${RUN_ID}\n`);
    expect(res.stderr).toMatch(/\[staging-deploy-check\] OK/);
  });

  it('mode "run" prints nothing and exits 1 on a failed run, a run in progress, no run, or another commit', () => {
    for (const listing of [runs(run({ conclusion: 'failure' })), runs(run({ status: 'in_progress', conclusion: null })), runs(), runs(run({ head_sha: OTHER_SHA }))]) {
      const res = runCli(['run', '--sha', SHA], JSON.stringify(listing));
      expect(res.status, JSON.stringify(listing)).toBe(1);
      expect(res.stdout).toBe('');
      expect(res.stderr).toMatch(/REFUSED/);
    }
  });

  it('mode "job" exits 0 on a green staging job and 1 on a failed one', () => {
    const good = runCli(['job', '--sha', SHA, '--run', String(RUN_ID)], JSON.stringify(jobs(job(), productionJob())));
    expect(good.status).toBe(0);
    expect(good.stdout).toBe('');
    const bad = runCli(['job', '--sha', SHA, '--run', String(RUN_ID)], JSON.stringify(jobs(job({ conclusion: 'failure' }), productionJob())));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/concluded "failure"/);
  });

  it('exits 1 when stdin is empty, not JSON, or an API error', () => {
    for (const input of ['', 'gh: Not Found (HTTP 404)', JSON.stringify(API_ERROR)]) {
      const res = runCli(['run', '--sha', SHA], input);
      expect(res.status, input).toBe(1);
      expect(res.stdout).toBe('');
    }
  });

  it('exits 2 on arguments it cannot use, before reading anything', () => {
    expect(runCli([], '').status).toBe(2);
    expect(runCli(['run'], '').status).toBe(2);
    expect(runCli(['run', '--sha', 'HEAD'], '').status).toBe(2);
    expect(runCli(['job', '--sha', SHA], '').status).toBe(2);
    expect(runCli(['job', '--sha', SHA, '--run', 'abc'], '').status).toBe(2);
    expect(runCli(['deploy', '--sha', SHA], '').status).toBe(2);
  });

  it('marks a refusal as an error annotation in GitHub Actions', () => {
    const res = runCli(['run', '--sha', SHA], JSON.stringify(runs()), { GITHUB_ACTIONS: 'true' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/^::error title=Staging deploy not green::/);
  });
});
