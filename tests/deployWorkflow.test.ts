import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Release safety of .github/workflows/deploy-cloudflare.yml (plan tasks SW0a-12 and SW0a-13).
 *
 * Nothing here runs GitHub Actions. The workflow is read as text, and each job's `if:` is
 * evaluated by the small interpreter below, which implements only the operators those
 * conditions use (== != && || ! and parentheses) with GitHub's comparison rules for strings
 * and null. It is a check of the conditions' logic, not of GitHub's own evaluator.
 */

const WORKFLOW = readFileSync(resolve(__dirname, '..', '.github', 'workflows', 'deploy-cloudflare.yml'), 'utf8').replace(/\r\n/g, '\n');

type Context = { event: 'push' | 'workflow_dispatch'; ref: string; target: 'staging' | 'production' | null };
type Value = string | boolean | null;

/** The text of one job: from its `  <id>:` line to the next line at that indent that is not a comment. */
function jobBlock(id: string, source = WORKFLOW): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === `  ${id}:`);
  if (start < 0) throw new Error(`job ${id} not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {0,2}[^\s#]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function jobIds(source = WORKFLOW): string[] {
  const jobs = source.slice(source.indexOf('\njobs:\n'));
  return [...jobs.matchAll(/^ {2}([A-Za-z_][\w-]*):$/gm)].map((m) => m[1]);
}

function jobIf(id: string, source = WORKFLOW): string {
  const match = jobBlock(id, source).match(/^ {4}if: (.+)$/m);
  if (!match) throw new Error(`job ${id} has no single-line if:`);
  return match[1].trim();
}

/** The steps of a job, in order, each as its own text. */
function steps(id: string): Array<{ name: string; text: string }> {
  const block = jobBlock(id);
  const body = block.slice(block.indexOf('\n    steps:\n') + '\n    steps:\n'.length);
  const out: Array<{ name: string; text: string }> = [];
  for (const line of body.split('\n')) {
    const start = line.match(/^ {6}- (?:name: (.*)|.*)$/);
    if (start) out.push({ name: (start[1] || '').trim(), text: line });
    else if (out.length && !/^ {6}#/.test(line)) out[out.length - 1].text += `\n${line}`;
  }
  return out;
}

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  const re = /\s*(&&|\|\||==|!=|!|\(|\)|'(?:[^']|'')*'|[A-Za-z_][\w.]*)/y;
  let pos = 0;
  while (pos < expr.length) {
    if (/^\s*$/.test(expr.slice(pos))) break;
    re.lastIndex = pos;
    const match = re.exec(expr);
    if (!match) throw new Error(`cannot read the condition at: ${expr.slice(pos)}`);
    tokens.push(match[1]);
    pos = re.lastIndex;
  }
  return tokens;
}

function lookup(name: string, ctx: Context): Value {
  if (name === 'github.event_name') return ctx.event;
  if (name === 'github.ref') return ctx.ref;
  // On a push there are no inputs: the property reads as null.
  if (name === 'inputs.target_env') return ctx.event === 'workflow_dispatch' ? ctx.target : null;
  throw new Error(`the condition reads "${name}", which this test does not know`);
}

const truthy = (v: Value) => v !== null && v !== false && v !== '';

/** GitHub compares strings without regard to case, and coerces mismatched types to numbers. */
function looseEquals(a: Value, b: Value): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  const num = (v: Value) => (v === null || v === '' ? 0 : v === true ? 1 : v === false ? 0 : Number(v));
  return num(a) === num(b);
}

function evaluate(expr: string, ctx: Context): boolean {
  const tokens = tokenize(expr);
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];

  function primary(): Value {
    const token = take();
    if (token === undefined) throw new Error('the condition ends early');
    if (token === '(') {
      const value = or();
      if (take() !== ')') throw new Error('missing )');
      return value;
    }
    if (token === '!') return !truthy(primary());
    if (token.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
    if (/^[A-Za-z_]/.test(token)) return lookup(token, ctx);
    throw new Error(`unexpected ${token}`);
  }
  function comparison(): Value {
    const left = primary();
    if (peek() === '==' || peek() === '!=') {
      const op = take();
      const right = primary();
      return op === '==' ? looseEquals(left, right) : !looseEquals(left, right);
    }
    return left;
  }
  function and(): Value {
    let left = comparison();
    while (peek() === '&&') {
      take();
      const right = comparison();
      left = truthy(left) ? right : left;
    }
    return left;
  }
  function or(): Value {
    let left = and();
    while (peek() === '||') {
      take();
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  }
  const result = or();
  if (i !== tokens.length) throw new Error(`unexpected ${peek()}`);
  return truthy(result);
}

const MAIN = 'refs/heads/main';
const STAGING = 'refs/heads/staging';
const FEATURE = 'refs/heads/feature/something';
const TAG = 'refs/tags/v1.2.3';

function jobsThatRun(conditions: Record<string, string>, ctx: Context): string[] {
  return Object.keys(conditions).filter((id) => evaluate(conditions[id], ctx)).sort();
}

const CONDITIONS: Record<string, string> = Object.fromEntries(jobIds().map((id) => [id, jobIf(id)]));

/** The two conditions as they were before SW0a-13, kept to show this test can see the fault. */
const CONDITIONS_BEFORE_THE_FIX: Record<string, string> = {
  deploy_staging: "github.ref == 'refs/heads/staging' || (github.event_name == 'workflow_dispatch' && inputs.target_env == 'staging')",
  deploy_production: "github.ref == 'refs/heads/main' || (github.event_name == 'workflow_dispatch' && inputs.target_env == 'production')",
};

describe('deploy workflow: which job runs for which trigger', () => {
  it('has exactly the two deploy jobs and the job that refuses, each with a one-line condition', () => {
    expect(jobIds().sort()).toEqual(['deploy_production', 'deploy_staging', 'refuse_production_off_main']);
    for (const id of jobIds()) expect(jobIf(id).length).toBeGreaterThan(0);
  });

  it.each<[string, Context, string[]]>([
    ['a push to staging', { event: 'push', ref: STAGING, target: null }, ['deploy_staging']],
    ['a push to main', { event: 'push', ref: MAIN, target: null }, ['deploy_production']],
    ['a manual run naming staging, from main', { event: 'workflow_dispatch', ref: MAIN, target: 'staging' }, ['deploy_staging']],
    ['a manual run naming staging, from staging', { event: 'workflow_dispatch', ref: STAGING, target: 'staging' }, ['deploy_staging']],
    ['a manual run naming staging, from a feature branch', { event: 'workflow_dispatch', ref: FEATURE, target: 'staging' }, ['deploy_staging']],
    ['a manual run naming production, from main', { event: 'workflow_dispatch', ref: MAIN, target: 'production' }, ['deploy_production']],
    ['a manual run naming production, from staging', { event: 'workflow_dispatch', ref: STAGING, target: 'production' }, ['refuse_production_off_main']],
    ['a manual run naming production, from a feature branch', { event: 'workflow_dispatch', ref: FEATURE, target: 'production' }, ['refuse_production_off_main']],
    ['a manual run naming production, from a tag', { event: 'workflow_dispatch', ref: TAG, target: 'production' }, ['refuse_production_off_main']],
  ])('%s runs %j', (_label, ctx, expected) => {
    expect(jobsThatRun(CONDITIONS, ctx)).toEqual(expected);
  });

  it('over every combination: never both deploys, production only from main, and a manual run deploys only what it names', () => {
    const events = ['push', 'workflow_dispatch'] as const;
    const targets = ['staging', 'production', null] as const;
    for (const event of events) {
      for (const ref of [MAIN, STAGING, FEATURE, TAG]) {
        for (const target of targets) {
          if (event === 'workflow_dispatch' && target === null) continue; // the input is required
          const ctx: Context = { event, ref, target };
          const ran = jobsThatRun(CONDITIONS, ctx);
          const label = JSON.stringify(ctx);
          expect(ran.includes('deploy_staging') && ran.includes('deploy_production'), label).toBe(false);
          if (ran.includes('deploy_production')) expect(ref, label).toBe(MAIN);
          if (event === 'workflow_dispatch') {
            expect(ran.includes('deploy_staging'), label).toBe(target === 'staging');
            expect(ran.includes('deploy_production'), label).toBe(target === 'production' && ref === MAIN);
          }
        }
      }
    }
  });

  it('sees the fault the old conditions had: a manual staging run from main also deployed production', () => {
    const ctx: Context = { event: 'workflow_dispatch', ref: MAIN, target: 'staging' };
    expect(jobsThatRun(CONDITIONS_BEFORE_THE_FIX, ctx)).toEqual(['deploy_production', 'deploy_staging']);
    expect(jobsThatRun(CONDITIONS, ctx)).toEqual(['deploy_staging']);
  });

  it('the job that refuses fails loudly, and touches no environment, secret or checkout', () => {
    const block = jobBlock('refuse_production_off_main');
    expect(block).toMatch(/::error /);
    expect(block).toMatch(/exit 1/);
    expect(block).not.toMatch(/environment:|secrets\.|uses:|wrangler/);
  });

  it('still deploys on a push to staging or main, and offers the two environments for a manual run', () => {
    const head = WORKFLOW.slice(0, WORKFLOW.indexOf('\njobs:\n'));
    expect(head).toMatch(/push:\n\s+branches:\n\s+- staging\n\s+- main\n/);
    expect(head).toMatch(/options:\n\s+- staging\n\s+- production\n/);
  });
});

describe('deploy workflow: one deploy per environment at a time, never cancelled once started', () => {
  it.each([
    ['deploy_staging', 'cloudflare-deploy-staging'],
    ['deploy_production', 'cloudflare-deploy-production'],
  ])('%s is in its own concurrency group with cancel-in-progress off', (id, group) => {
    const block = jobBlock(id);
    expect(block).toContain(`\n    concurrency:\n      group: ${group}\n      cancel-in-progress: false\n`);
    expect(block.match(/cancel-in-progress:/g)).toHaveLength(1);
  });

  it('nothing in the workflow cancels a run in progress', () => {
    expect(WORKFLOW).not.toMatch(/cancel-in-progress:\s*(true|\$)/);
  });
});

describe('deploy workflow: the log holds a restore point before every migration', () => {
  it.each([
    ['deploy_staging', 'luminara-users-staging', 'staging'],
    ['deploy_production', 'luminara-users', 'production'],
  ])('%s prints the Time Travel bookmark of %s immediately before it migrates, and deploys after', (id, database, env) => {
    const list = steps(id);
    const bookmark = list.findIndex((s) => s.text.includes(`wrangler d1 time-travel info ${database} --env ${env}`));
    const migrate = list.findIndex((s) => s.text.includes(`d1 migrations apply ${database} --remote --env ${env}`));
    const deploy = list.findIndex((s) => s.text.includes(`command: deploy --env ${env}`));
    expect(bookmark).toBeGreaterThanOrEqual(0);
    expect(migrate).toBe(bookmark + 1);
    expect(deploy).toBeGreaterThan(migrate);
    // It can only print if it can sign in, and a failed print must stop the job.
    expect(list[bookmark].text).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(list[bookmark].text).not.toMatch(/continue-on-error|\|\| true/);
    // A bookmark is only printed, never restored, by a deploy.
    expect(jobBlock(id)).not.toMatch(/time-travel restore [a-z]/);
  });
});

describe('deploy workflow: production runs only a release merge whose staging deploy went green', () => {
  const list = steps('deploy_production');
  const check = list.findIndex((s) => s.text.includes('node scripts/check-release-merge.mjs'));
  const green = list.findIndex((s) => s.text.includes('node scripts/check-staging-deploy.mjs'));

  it('checks out full history, which the release check needs', () => {
    const checkout = list.find((s) => s.text.includes('uses: actions/checkout@'));
    expect(checkout?.text).toMatch(/fetch-depth: 0/);
  });

  it('runs the release check against HEAD and freshly fetched origin/staging and origin/main', () => {
    expect(check).toBeGreaterThanOrEqual(0);
    expect(list[check].text).toContain(
      'git fetch --no-tags --quiet origin +refs/heads/staging:refs/remotes/origin/staging +refs/heads/main:refs/remotes/origin/main',
    );
    expect(list[check].text).toContain('node scripts/check-release-merge.mjs --commit HEAD --staging origin/staging --main origin/main');
    expect(list[check].text).not.toMatch(/continue-on-error|\|\| true|if:/);
  });

  it('then requires a green staging deploy of the merged commit, fetching with the job token and piping to the script', () => {
    expect(green).toBe(check + 1);
    const text = list[green].text;
    expect(text).toContain('GH_TOKEN: ${{ github.token }}');
    expect(text).toContain(`sha="$(git rev-parse --verify 'HEAD^2')"`);
    // Two reads of the Actions API, each piped straight into the script that decides.
    expect(text).toContain(
      'gh api "${api}/workflows/deploy-cloudflare.yml/runs?head_sha=${sha}&branch=staging&event=push&per_page=100" | node scripts/check-staging-deploy.mjs run --sha "${sha}"',
    );
    expect(text).toContain('gh api "${api}/runs/${run_id}/jobs?filter=latest&per_page=100" | node scripts/check-staging-deploy.mjs job --sha "${sha}" --run "${run_id}"');
    expect(text.match(/gh api /g)).toHaveLength(2);
    // It only reads: no request method, no request body, no other gh command, no secret.
    expect(text).not.toMatch(/--method|-X |--field|-f |-F |--input|gh (run|workflow|pr|release|secret|variable) /);
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/continue-on-error|\|\| true|if:/);
  });

  it('runs both checks before anything is installed, built, migrated or deployed', () => {
    expect(check).toBeGreaterThanOrEqual(0);
    expect(green).toBeGreaterThan(check);
    const later = list.findIndex((s) => /npm (ci|run|test)|npx |wrangler|scripts\/(?!check-release-merge|check-staging-deploy)/.test(s.text));
    expect(later).toBeGreaterThan(green);
    for (const [index, step] of list.entries()) {
      if (/d1 |deploy --env|wrangler-action|npm ci/.test(step.text)) expect(index, step.name).toBeGreaterThan(green);
    }
  });

  it('gives the production job read access to actions and contents, and nothing more', () => {
    expect(jobBlock('deploy_production')).toContain('\n    permissions:\n      actions: read\n      contents: read\n    steps:\n');
    // The workflow default stays read-only on contents, and no job asks for write access or the id token.
    expect(WORKFLOW).toContain('\npermissions:\n  contents: read\n');
    expect(WORKFLOW.match(/^\s*permissions:/gm)).toHaveLength(2);
    expect(WORKFLOW).not.toMatch(/:\s*write\b|write-all|id-token/);
  });

  it('puts neither check on the staging job, which deploys any commit pushed to staging', () => {
    expect(jobBlock('deploy_staging')).not.toMatch(/check-release-merge|check-staging-deploy|GH_TOKEN/);
  });
});

describe('dependency updates go to staging, never straight to main', () => {
  it('every Dependabot entry targets staging', () => {
    const dependabot = readFileSync(resolve(__dirname, '..', '.github', 'dependabot.yml'), 'utf8').replace(/\r\n/g, '\n');
    const entries = dependabot.split(/\n(?= {2}- package-ecosystem: )/).slice(1);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const entry of entries) {
      expect(entry, entry.split('\n')[0]).toMatch(/\n {4}target-branch: "staging"\n/);
      expect(entry.match(/target-branch:/g)).toHaveLength(1);
    }
  });
});
