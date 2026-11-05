import { describe, expect, it, vi } from 'vitest';
import { acceptWatchAction, groqWatchAction } from '../services/citationWatch/agentNote';
import { handleCitationWatchRoute, runCitationWatchTick, type CitationProbe } from '../worker/citationWatch';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1 } from './helpers/sqliteD1';

const user: HostedIdentity = { id: 'fb:user', source: 'firebase', accountId: 'acct_1' };
const prompts = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const DAY = 86_400_000;
const eight = (cited: number): boolean[] => Array.from({ length: 8 }, (_, i) => i < cited);

function makeEnv(agent = true): Env {
  const kv = new Map<string, string>([['sub:acct_1', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 10 * DAY * 365 })]]);
  return {
    ASSETS: { fetch: async () => new Response('ok') },
    LUMINARA_KV: {
      get: async (key: string, type?: string) => (kv.has(key) ? (type === 'json' ? JSON.parse(kv.get(key)!) : kv.get(key)) : null),
      put: async (key: string, value: string) => void kv.set(key, value),
      delete: async (key: string) => void kv.delete(key),
    } as unknown as KVNamespace,
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    CITATION_WATCH_LIVE: 'true',
    WATCH_AGENT_ENABLED: agent ? 'true' : 'false',
  } as Env;
}

async function createWatch(env: Env, now: number, domain = 'acme.com', body: Record<string, unknown> = {}): Promise<string> {
  const res = await handleCitationWatchRoute(
    new Request('https://luminarasuite.com/api/citation-watches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain, engine: 'chatgpt', prompts, ...body }),
    }),
    env,
    user,
    '/citation-watches',
    { now: () => now },
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { watch: { id: string } }).watch.id;
}

const measured = (n: number): CitationProbe => async () => ({ status: 'measured', method: 'fixture', modelId: null, cited: eight(n) });
const failing: CitationProbe = async () => ({ status: 'not_measured', method: 'none', reason: 'Probe is down.' });

const noteCount = (env: Env) =>
  env.DB!.prepare(`SELECT COUNT(*) AS n FROM citation_watch_runs WHERE json_extract(observations_json, '$.agentNote') IS NOT NULL`).first<{ n: number }>();

/** Runs one daily tick per probe and returns the day index used. */
async function ticks(env: Env, start: number, probes: CitationProbe[], watchAction?: (r: unknown) => Promise<string | null>) {
  for (let i = 0; i < probes.length; i += 1) {
    const at = start + i * DAY;
    await runCitationWatchTick(env, { now: () => at, scheduledAt: at, probe: probes[i], watchAction: watchAction as never });
  }
}

const start = Date.UTC(2026, 9, 2, 8, 0, 0);

describe('watch notes', () => {
  it('writes one note on the first measured run, none on identical repeats, one on a change', async () => {
    const env = makeEnv();
    const id = await createWatch(env, start);
    const action = vi.fn(async () => 'Keep your best pages current.');
    await ticks(env, start, [measured(4), measured(4)], action);
    expect((await noteCount(env))!.n).toBe(1);
    // Third run has two priors, so insufficient -> consistent is a change and writes the second note.
    await ticks(env, start + 2 * DAY, [measured(4)], action);
    expect((await noteCount(env))!.n).toBe(2);
    // consistent -> drift on a rise to 8 of 8.
    await ticks(env, start + 3 * DAY, [measured(8)], action);
    expect((await noteCount(env))!.n).toBe(3);
    const runs = await handleCitationWatchRoute(new Request('https://x/api'), env, user, `/citation-watches/${id}`);
    const body = (await runs.json()) as { runs: { agentNote: { sentence: string; action: string; actionSource: string; kind: string } | null }[] };
    const latest = body.runs[0].agentNote!;
    expect(latest.sentence).toMatch(/rose to 100% \(8 of 8 prompts\), from 50% \(4 of 8\)/);
    expect(latest.action).toBe('Keep your best pages current.');
    expect(latest.actionSource).toBe('model');
    expect(body.runs[1].agentNote!.kind).toBe('same');
    expect(body.runs[2].agentNote).toBeNull();
  });

  it('counts insufficient to consistent as a change', async () => {
    const env = makeEnv();
    await createWatch(env, start);
    await ticks(env, start, [measured(4), measured(4), measured(4), measured(4)]);
    // runs 1 note; run 2 and 3 insufficient (no note); run 4 consistent -> note
    expect((await noteCount(env))!.n).toBe(2);
  });

  it('writes one note for repeated failures after a measured run, and one for the first failure only', async () => {
    const env = makeEnv();
    await createWatch(env, start);
    await ticks(env, start, [measured(4), failing, failing, failing]);
    expect((await noteCount(env))!.n).toBe(2);
    const note = await env.DB!.prepare(
      `SELECT json_extract(observations_json, '$.agentNote.sentence') AS s, json_extract(observations_json, '$.agentNote.action') AS a FROM citation_watch_runs WHERE json_extract(observations_json, '$.agentNote.kind') = 'check_failed'`,
    ).first<{ s: string; a: string }>();
    expect(note!.s).toContain('The check failed');
    expect(note!.a).toMatch(/Look into why this check failed/);
  });

  it('does not note a watch that has only ever failed', async () => {
    const env = makeEnv();
    await createWatch(env, start);
    await ticks(env, start, [failing, failing]);
    expect((await noteCount(env))!.n).toBe(0);
  });

  it('falls back to the template for an unmeasured number or an unknown domain', async () => {
    for (const bad of ['Raise your share to 90% this week.', 'Ask rival.com to link to you.', 'Try Semrush for the missing prompts.']) {
      const env = makeEnv();
      await createWatch(env, start);
      await ticks(env, start, [measured(4)], async () => bad);
      const row = await env.DB!.prepare(`SELECT json_extract(observations_json, '$.agentNote.actionSource') AS s, json_extract(observations_json, '$.agentNote.action') AS a FROM citation_watch_runs`).first<{ s: string; a: string }>();
      expect(row!.s).toBe('template');
      expect(row!.a).not.toBe(bad);
    }
  });

  it('accepts an action that uses only stored numbers and the watch domain', () => {
    const allowed = { numbers: { citedCount: 4, promptCount: 8, sharePercent: 50 }, domain: 'acme.com', prompts, reason: '' };
    expect(acceptWatchAction('Check why acme.com is cited in only 4 of 8 prompts.', allowed)).not.toBeNull();
    expect(acceptWatchAction('Check 5 pages. Then wait.', allowed)).toBeNull();
  });

  it('falls back to the template when the model throws or times out', async () => {
    const env = makeEnv();
    await createWatch(env, start);
    await ticks(env, start, [measured(4)], async () => {
      throw new Error('boom');
    });
    expect((await noteCount(env))!.n).toBe(1);
    const slow = await groqWatchAction(
      'key',
      { system: 's', user: 'u' },
      {
        timeoutMs: 20,
        fetchImpl: ((_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))) as never,
      },
    );
    expect(slow).toBeNull();
    expect(await groqWatchAction(undefined, { system: 's', user: 'u' })).toBeNull();
  });

  it('keeps the run and next_run_at when note storage fails', async () => {
    const env = makeEnv();
    const id = await createWatch(env, start);
    const db = env.DB!;
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      if (/json_set/.test(sql)) throw new Error('note write failed');
      return prepare(sql);
    }) as never;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await runCitationWatchTick(env, { now: () => start, scheduledAt: start, probe: measured(4), watchAction: async () => null });
    spy.mockRestore();
    expect(res.checked).toBe(1);
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM citation_watch_runs`).first<{ n: number }>())!.n).toBe(1);
    expect((await db.prepare(`SELECT next_run_at FROM citation_watches WHERE id = ?`).bind(id).first<{ next_run_at: number }>())!.next_run_at).toBe(start + DAY);
    // The next tick that touches this watch retries the note.
    db.prepare = prepare as never;
    await runCitationWatchTick(env, { now: () => start + DAY, scheduledAt: start + DAY, probe: measured(4), watchAction: async () => null });
    expect((await noteCount(env))!.n).toBe(1);
  });

  it('changes nothing when the flag is off', async () => {
    const env = makeEnv(false);
    await createWatch(env, start);
    const action = vi.fn(async () => 'x');
    await ticks(env, start, [measured(4)], action);
    expect(action).not.toHaveBeenCalled();
    expect((await noteCount(env))!.n).toBe(0);
  });

  it('cannot double-write the same run', async () => {
    const env = makeEnv();
    await createWatch(env, start);
    const concurrent = { v: 'written by another worker' };
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runCitationWatchTick(env, {
      now: () => start,
      scheduledAt: start,
      probe: measured(4),
      // Another tick lands its note while this one is waiting on the model.
      watchAction: async () => {
        await env.DB!.prepare(`UPDATE citation_watch_runs SET observations_json = json_set(observations_json, '$.agentNote', json(?))`)
          .bind(JSON.stringify({ at: 1, sentence: concurrent.v, action: 'a' }))
          .run();
        return 'Keep your best pages current.';
      },
    });
    const noteLogs = logs.mock.calls.filter((c) => String(c[0]).includes('oracle_watch_note'));
    logs.mockRestore();
    expect(noteLogs).toHaveLength(0);
    const row = await env.DB!.prepare(`SELECT json_extract(observations_json, '$.agentNote.sentence') AS s FROM citation_watch_runs`).first<{ s: string }>();
    expect(row!.s).toBe(concurrent.v);
  });

  it('writes at most 50 notes per tick', async () => {
    const env = makeEnv();
    for (let i = 0; i < 55; i += 1) {
      await env.DB!.prepare(
        `INSERT INTO citation_watches (id, account_id, client_id, domain, engine, prompts_json, prompts_sha256, cadence, active, next_run_at, created_at)
         VALUES (?, 'acct_1', '', ?, 'chatgpt', ?, ?, 'daily', 1, ?, ?)`,
      )
        .bind(`cw_${String(i).padStart(32, '0')}`, `site${i}.com`, JSON.stringify(prompts), `sha${i}`, start, start)
        .run();
    }
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runCitationWatchTick(env, { now: () => start, scheduledAt: start, probe: measured(4), watchAction: async () => null });
    logs.mockRestore();
    expect((await noteCount(env))!.n).toBe(50);
    // The five left over get their notes on a later tick, through the retry lookup.
    await env.DB!.prepare(`UPDATE citation_watches SET next_run_at = ?`).bind(start + DAY).run();
    await runCitationWatchTick(env, { now: () => start + DAY, scheduledAt: start + DAY, probe: measured(4), watchAction: async () => null });
    expect((await noteCount(env))!.n).toBe(55);
  });
});
