import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import {
  DECISION_CHECKS_LAST_RUN_KEY,
  DECISION_CHECKS_OFF_KEY,
  decisionCheckFlags,
} from '../worker/decisionCheckFlags';
// @ts-expect-error untyped .mjs helper
import { parseJsonc } from '../scripts/lib/jsonc.mjs';

// Allora CL0-4: two flags, the KV off-switch, the health field and the validate-env rule.

const root = resolve(__dirname, '..');
const FLAGS = ['DECISION_CHECKS_ENABLED', 'DECISION_RETEST_ENABLED'] as const;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function kv(values: Record<string, string> = {}, opts: { throws?: boolean } = {}): KVNamespace {
  return {
    get: async (key: string) => {
      if (opts.throws) throw new Error('kv down');
      return values[key] ?? null;
    },
    put: async () => {},
    delete: async () => {},
  } as unknown as KVNamespace;
}

const bothOn = { DECISION_CHECKS_ENABLED: 'true', DECISION_RETEST_ENABLED: 'true' } as const;

describe('wrangler.jsonc declares the decision-check flags', () => {
  const config = parseJsonc(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'));
  const blocks: Array<[string, Record<string, unknown>]> = [
    ['top-level', config.vars],
    ['staging', config.env.staging.vars],
    ['production', config.env.production.vars],
  ];

  it.each(FLAGS)('%s is "true" or "false" in all three blocks', (flag) => {
    for (const [name, vars] of blocks) expect(['true', 'false'], `${name} ${flag}`).toContain(vars[flag]);
  });

  it.each(FLAGS)('%s has the same value at top level and in production', (flag) => {
    expect(config.vars[flag]).toBe(config.env.production.vars[flag]);
  });
});

describe('decisionCheckFlags', () => {
  it('is on only when the var is exactly "true" and no switch is set', async () => {
    expect(await decisionCheckFlags({ ...bothOn, LUMINARA_KV: kv() })).toEqual({
      checksVar: true,
      retestVar: true,
      checksOn: true,
      retestOn: true,
    });
    for (const value of [undefined, 'false', 'TRUE', '1', ' true']) {
      const f = await decisionCheckFlags({ DECISION_CHECKS_ENABLED: value, DECISION_RETEST_ENABLED: value, LUMINARA_KV: kv() });
      expect(f, String(value)).toEqual({ checksVar: false, retestVar: false, checksOn: false, retestOn: false });
    }
  });

  it.each([
    ['checks', { checksOn: false, retestOn: true }],
    ['retest', { checksOn: true, retestOn: false }],
    ['all', { checksOn: false, retestOn: false }],
    ['ALL', { checksOn: false, retestOn: false }],
    ['pause', { checksOn: false, retestOn: false }],
    ['', { checksOn: false, retestOn: false }],
  ])('switch value %j turns off the matching feature even with the var on', async (value, expected) => {
    const f = await decisionCheckFlags({ ...bothOn, LUMINARA_KV: kv({ [DECISION_CHECKS_OFF_KEY]: value }) });
    expect(f).toEqual({ checksVar: true, retestVar: true, ...expected });
  });

  it('a read that throws and an unbound KV each disable both', async () => {
    const off = { checksVar: true, retestVar: true, checksOn: false, retestOn: false };
    expect(await decisionCheckFlags({ ...bothOn, LUMINARA_KV: kv({}, { throws: true }) })).toEqual(off);
    expect(await decisionCheckFlags({ ...bothOn, LUMINARA_KV: undefined as unknown as KVNamespace })).toEqual(off);
  });
});

describe('/api/health decisionChecks', () => {
  function env(extra: Partial<Env>): Env {
    return {
      ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
      WEBAPP_URL: 'https://luminarasuite.com/',
      ALLOWED_ORIGINS: 'https://luminarasuite.com',
      ...extra,
    } as Env;
  }
  async function health(e: Env) {
    const res = await worker.fetch(new Request('https://luminarasuite.com/api/health'), e, ctx);
    expect(res.status).toBe(200);
    return ((await res.json()) as { decisionChecks: unknown }).decisionChecks;
  }

  it('reports vars, effective state and the last run from KV', async () => {
    expect(
      await health(env({ ...bothOn, LUMINARA_KV: kv({ [DECISION_CHECKS_OFF_KEY]: 'retest', [DECISION_CHECKS_LAST_RUN_KEY]: '1763600000000' }) })),
    ).toEqual({ checksVar: true, retestVar: true, checksOn: true, retestOn: false, lastRunAt: 1763600000000 });
  });

  it('reports everything off, with no last run, when the vars are absent', async () => {
    expect(await health(env({ LUMINARA_KV: kv() }))).toEqual({
      checksVar: false,
      retestVar: false,
      checksOn: false,
      retestOn: false,
      lastRunAt: null,
    });
  });
});

describe('scripts/validate-env.mjs decision-check flags', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lum-decision-flags-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const real = readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8');
  const run = (text: string) => {
    const file = join(dir, `wrangler-${Math.random().toString(36).slice(2)}.jsonc`);
    writeFileSync(file, text, 'utf8');
    return spawnSync(process.execPath, [resolve(root, 'scripts', 'validate-env.mjs'), '--staging', `--wrangler=${file}`], {
      cwd: root,
      encoding: 'utf8',
    });
  };

  it('passes the real config', () => {
    expect(run(real).status).toBe(0);
  });

  it('rejects a present but unknown value', () => {
    const typo = real.replace('"DECISION_RETEST_ENABLED": "false"', '"DECISION_RETEST_ENABLED": "ture"');
    expect(typo).not.toBe(real);
    const result = run(typo);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/DECISION_RETEST_ENABLED must be "true" or "false"/);
  });

  it('stays silent when the vars are absent', () => {
    const absent = real.replace(/^\s*"DECISION_(CHECKS|RETEST)_ENABLED": "false",\r?\n/gm, '');
    expect(absent).not.toMatch(/DECISION_(CHECKS|RETEST)_ENABLED/);
    const result = run(absent);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/DECISION_/);
  });
});
