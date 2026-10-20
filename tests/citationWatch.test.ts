import { describe, expect, it } from 'vitest';
import { classifyCitationWatch } from '../services/citationWatch/classify';
import { citationWatchThresholds, DEFAULT_CITATION_WATCH_THRESHOLDS } from '../services/citationWatch/thresholds';
import type { MeasuredPoint } from '../services/citationWatch/types';
import { handleCitationWatchRoute, runCitationWatchTick, type CitationProbe } from '../worker/citationWatch';
import { createPrivacyJob } from '../worker/privacyService';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1 } from './helpers/sqliteD1';

const eight = (cited: number): boolean[] => Array.from({ length: 8 }, (_, i) => i < cited);
const priors = (...points: MeasuredPoint[]) => points;

describe('classifyCitationWatch', () => {
  const thresholds = DEFAULT_CITATION_WATCH_THRESHOLDS;

  it('leaves counts null when the run was not measured', () => {
    expect(
      classifyCitationWatch({
        engine: 'chatgpt',
        measurement: { status: 'not_measured', method: 'none', reason: 'No probe.' },
        priorMeasured: priors({ runId: 'r1', citedCount: 8, promptCount: 8 }, { runId: 'r2', citedCount: 8, promptCount: 8 }),
        thresholds,
      }),
    ).toEqual({
      verdict: 'not_measured',
      citedCount: null,
      promptCount: null,
      share: null,
      comparedToRunId: null,
      deltaShare: null,
      reason: 'No probe.',
    });
  });

  it('stores the measured share and withholds a change call when history is short', () => {
    expect(
      classifyCitationWatch({
        engine: 'chatgpt',
        measurement: { status: 'measured', method: 'fixture', modelId: null, cited: eight(4) },
        priorMeasured: priors({ runId: 'r1', citedCount: 8, promptCount: 8 }),
        thresholds,
      }),
    ).toMatchObject({
      verdict: 'insufficient',
      citedCount: 4,
      promptCount: 8,
      share: 0.5,
      comparedToRunId: null,
      deltaShare: null,
    });
  });

  it('calls consistent inside the chatgpt default and drift above it', () => {
    const prior = priors({ runId: 'r1', citedCount: 8, promptCount: 8 }, { runId: 'r2', citedCount: 8, promptCount: 8 });
    expect(
      classifyCitationWatch({
        engine: 'chatgpt',
        measurement: { status: 'measured', method: 'fixture', modelId: null, cited: eight(6) },
        priorMeasured: prior,
        thresholds,
      }),
    ).toMatchObject({ verdict: 'consistent', citedCount: 6, share: 0.75, comparedToRunId: 'r2', deltaShare: -0.25 });
    expect(
      classifyCitationWatch({
        engine: 'chatgpt',
        measurement: { status: 'measured', method: 'fixture', modelId: null, cited: eight(4) },
        priorMeasured: prior,
        thresholds,
      }),
    ).toMatchObject({ verdict: 'drift', citedCount: 4, share: 0.5, comparedToRunId: 'r2', deltaShare: -0.5 });
  });

  it('ignores an earlier run that was too small to qualify', () => {
    expect(
      classifyCitationWatch({
        engine: 'perplexity',
        measurement: { status: 'measured', method: 'fixture', modelId: null, cited: eight(8) },
        priorMeasured: priors({ runId: 'big', citedCount: 8, promptCount: 8 }, { runId: 'tiny', citedCount: 1, promptCount: 2 }),
        thresholds,
      }).verdict,
    ).toBe('insufficient');
  });
});

describe('citationWatchThresholds', () => {
  it('applies one valid override and rejects a zero delta', () => {
    const custom = citationWatchThresholds('{"perplexity":{"maxConsistentShareDelta":0.5,"minPrompts":4}}');
    expect(custom.perplexity).toMatchObject({ maxConsistentShareDelta: 0.5, minPrompts: 4, minPriorRuns: 2 });
    expect(custom.chatgpt.maxConsistentShareDelta).toBe(0.3);
    expect(citationWatchThresholds('{"chatgpt":{"maxConsistentShareDelta":0}}').chatgpt.maxConsistentShareDelta).toBe(0.3);
    expect(citationWatchThresholds('not json').google_aio).toEqual(DEFAULT_CITATION_WATCH_THRESHOLDS.google_aio);
  });
});

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw == null) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(plan: string | null, live = false): { env: Env; kv: Map<string, string> } {
  const kv = new Map<string, string>();
  if (plan) kv.set('sub:acct_1', JSON.stringify({ plan, expiresAt: Date.now() + 86_400_000 }));
  const env = {
    ASSETS: { fetch: async () => new Response('ok') },
    LUMINARA_KV: mockKv(kv),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    CITATION_WATCH_LIVE: live ? 'true' : 'false',
  } as Env;
  return { env, kv };
}

const user: HostedIdentity = { id: 'fb:user', source: 'firebase', accountId: 'acct_1' };
const prompts = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

function post(body: unknown): Request {
  return new Request('https://luminarasuite.com/api/citation-watches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('citation watch routes and cron', () => {
  it('refuses a free plan and a cadence faster than the plan', async () => {
    const free = makeEnv(null);
    const refused = await handleCitationWatchRoute(post({ domain: 'acme.com', engine: 'chatgpt', prompts }), free.env, user, '/citation-watches');
    expect(refused.status).toBe(402);

    const starter = makeEnv('starter');
    const tooFast = await handleCitationWatchRoute(
      post({ domain: 'acme.com', engine: 'chatgpt', prompts, cadence: 'daily' }),
      starter.env,
      user,
      '/citation-watches',
    );
    expect(tooFast.status).toBe(402);
    expect(await starter.env.DB!.prepare(`SELECT COUNT(*) AS n FROM citation_watches`).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('records null counts for an unmeasured run, then drift once three measured runs exist', async () => {
    const { env } = makeEnv('agency');
    const created = await handleCitationWatchRoute(post({ domain: 'acme.com', engine: 'chatgpt', prompts, clientId: 'client-a' }), env, user, '/citation-watches');
    expect(created.status).toBe(201);
    const { watch } = (await created.json()) as { watch: { id: string } };

    const idle = await runCitationWatchTick(env);
    expect(idle).toEqual({ checked: 0, skipped: 'live_off' });
    expect(await env.DB!.prepare(`SELECT COUNT(*) AS n FROM citation_watch_runs`).first<{ n: number }>()).toEqual({ n: 0 });

    const unmeasured = await handleCitationWatchRoute(
      new Request('https://luminarasuite.com/api/citation-watches/' + watch.id + '/run', { method: 'POST' }),
      env,
      user,
      `/citation-watches/${watch.id}/run`,
    );
    expect(await unmeasured.json()).toMatchObject({
      ok: true,
      run: { verdict: 'not_measured', measurementStatus: 'not_measured', citedCount: null, promptCount: null, share: null, deltaShare: null },
    });

    const measured: CitationProbe = async () => ({ status: 'measured', method: 'fixture', modelId: 'fixture-model', cited: eight(8) });
    const driftProbe: CitationProbe = async () => ({ status: 'measured', method: 'fixture', modelId: 'fixture-model', cited: eight(4) });
    await handleCitationWatchRoute(new Request('https://luminarasuite.com/', { method: 'POST' }), env, user, `/citation-watches/${watch.id}/run`, { probe: measured });
    await handleCitationWatchRoute(new Request('https://luminarasuite.com/', { method: 'POST' }), env, user, `/citation-watches/${watch.id}/run`, { probe: measured });
    const third = await handleCitationWatchRoute(new Request('https://luminarasuite.com/', { method: 'POST' }), env, user, `/citation-watches/${watch.id}/run`, { probe: driftProbe });
    expect(await third.json()).toMatchObject({ ok: true, run: { verdict: 'drift', citedCount: 4, promptCount: 8, share: 0.5, deltaShare: -0.5 } });

    env.CITATION_WATCH_LIVE = 'true';
    const firstTick = await runCitationWatchTick(env, { now: () => Date.now() + 10 });
    const secondTick = await runCitationWatchTick(env, { now: () => Date.now() + 10 });
    expect(firstTick.checked).toBe(1);
    expect(secondTick).toEqual({ checked: 0, skipped: null });
    const stored = await env.DB!.prepare(
      `SELECT verdict, cited_count, share FROM citation_watch_runs WHERE measurement_status = 'not_measured' ORDER BY ran_at ASC`,
    ).all<{ verdict: string; cited_count: number | null; share: number | null }>();
    expect(stored.results?.[0]).toEqual({ verdict: 'not_measured', cited_count: null, share: null });
    expect(stored.results?.filter((row) => row.cited_count !== null)).toEqual([]);
  });

  it('exports the prompt set and deletes the watch with the account', async () => {
    const { env, kv } = makeEnv('agency');
    const created = await handleCitationWatchRoute(post({ domain: 'acme.com', engine: 'perplexity', prompts: ['where is acme'] }), env, user, '/citation-watches');
    const { watch } = (await created.json()) as { watch: { id: string } };
    const exported = await createPrivacyJob(env, user, 'export');
    const { jobId } = (await exported.json()) as { jobId: string };
    const body = JSON.parse(kv.get(`privacy:export:${jobId}`) || '{}') as { processors: string[]; citationWatches: Array<{ id: string; prompts_json: string }> };
    expect(body.processors).toContain('citation_watches');
    expect(body.citationWatches).toEqual([expect.objectContaining({ id: watch.id, prompts_json: JSON.stringify(['where is acme']) })]);
    const deleted = await createPrivacyJob(env, user, 'delete');
    expect(deleted.status).toBe(200);
    expect(await env.DB!.prepare(`SELECT COUNT(*) AS n FROM citation_watches`).first<{ n: number }>()).toEqual({ n: 0 });
  });
});
