/**
 * Task 1.A.2: sentinel cron -> queued audit run provenance chaining.
 *
 * A sentinel tick opens one 'sentinel' provenance run per owner account, and
 * every drift-triggered audit it enqueues opens a 'queued_audit' run whose
 * parent_run_id points back at the sentinel run. All provenance is best-effort:
 * no DB means zero runs, zero errors, zero behavior change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runSentinelScan, type SentinelTarget } from '../worker/sentinel';
import { processAuditJob } from '../worker/auditQueue';
import { getRunChain } from '../worker/runProvenance';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';

const OWNER = 'acct_sentinel_owner';

function makeTargets(): SentinelTarget[] {
  // lastSecurityTrust 100 vs stubbed edge probe score 40 forces a trust
  // regression (>20 points), so every target takes the drift path.
  return ['alpha.example.com', 'beta.example.org', 'gamma.example.net'].map((domain, i) => ({
    id: `sentinel-t${i}`,
    ownerId: OWNER,
    domain,
    brandName: domain.split('.')[0],
    keywords: [`what is ${domain}`],
    lastSecurityTrust: 100,
  }));
}

function makeKv(): { get: (...args: unknown[]) => Promise<unknown>; put: (...args: unknown[]) => Promise<void> } {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function stubEdgeProbes() {
  // auditSecurityOnEdge issues HEAD/GET probes; answer all with a bare 200 so
  // trustScore lands at the 40-point base and the regression fires.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url || '');
      return {
        ok: true,
        url: url.replace(/^http:\/\//i, 'https://'),
        headers: { get: () => null },
        text: async () => '',
        json: async () => ({}),
      } as unknown as Response;
    }),
  );
}

function makeEnv(): { env: Env; sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  const kv = makeKv();
  const env = {
    DB: createSqliteD1(),
    LUMINARA_KV: kv,
    AUDIT_JOBS: {
      send: vi.fn(async (msg: Record<string, unknown>) => {
        sent.push(msg);
      }),
    },
    // No TAVILY_API_KEY, no BOT_TOKEN: no network provider calls, no alerts.
  } as unknown as Env;
  return { env, sent };
}

async function seedTargets(env: Env, targets: SentinelTarget[]) {
  await env.LUMINARA_KV!.put('sentinel:targets', JSON.stringify(targets));
}

describe('audit run chaining (sentinel -> queued audits)', () => {
  beforeEach(() => {
    stubEdgeProbes();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a sentinel tick over 3 targets creates 1 sentinel run and 3 queued_audit runs chained to it', async () => {
    const { env, sent } = makeEnv();
    await seedTargets(env, makeTargets());

    const result = await runSentinelScan(env);
    expect(result.scanned).toBe(3);
    expect(sent).toHaveLength(3);

    const db = (env.DB as unknown as { sqlite: any }).sqlite;
    const sentinelRuns = db.prepare(`SELECT * FROM run_provenance WHERE surface = 'sentinel'`).all();
    const auditRuns = db.prepare(`SELECT * FROM run_provenance WHERE surface = 'queued_audit'`).all();
    expect(sentinelRuns).toHaveLength(1);
    expect(auditRuns).toHaveLength(3);
    const sentinelRunId = sentinelRuns[0].run_id;
    expect(sentinelRuns[0].status).toBe('completed');
    expect(sentinelRuns[0].wake_reason).toBe('cron_tick');
    expect(sentinelRuns[0].account_id).toBe(OWNER);
    for (const audit of auditRuns) {
      expect(audit.parent_run_id).toBe(sentinelRunId);
      expect(audit.account_id).toBe(OWNER);
      expect(audit.wake_reason).toBe('cron_tick');
    }
    // Queue messages carry the lineage for the drain-side completion path.
    for (const msg of sent) {
      expect(msg.parentRunId).toBe(sentinelRunId);
      expect(typeof msg.provenanceRunId).toBe('string');
    }
  });

  it('completing one audit writes provenance.runId into its result_json', async () => {
    const { env, sent } = makeEnv();
    await seedTargets(env, makeTargets());
    await runSentinelScan(env);
    expect(sent.length).toBeGreaterThan(0);

    const msg = sent[0] as {
      runId: string;
      accountId: string;
      targetUrl: string;
      provenanceRunId: string;
      parentRunId: string;
    };
    await processAuditJob(env, msg);

    const db = (env.DB as unknown as { sqlite: any }).sqlite;
    const row = db.prepare(`SELECT status, result_json, error FROM audit_runs WHERE id = ?`).get(msg.runId);
    expect(row.status).toBe('completed');
    const result = JSON.parse(row.result_json);
    expect(result.provenance).toEqual({ runId: msg.provenanceRunId });
    expect(result.domain).toBe(new URL(msg.targetUrl).hostname);

    const provRow = db.prepare(`SELECT status FROM run_provenance WHERE run_id = ?`).get(msg.provenanceRunId);
    expect(provRow.status).toBe('completed');
  });

  it('a failed audit marks its provenance run failed without result_json enrichment', async () => {
    const { env, sent } = makeEnv();
    await seedTargets(env, makeTargets());
    await runSentinelScan(env);

    const msg = sent[0] as { runId: string; accountId: string; provenanceRunId: string };
    await processAuditJob(env, {
      runId: msg.runId,
      accountId: msg.accountId,
      targetUrl: '::not-a-url::',
      provenanceRunId: msg.provenanceRunId,
    });

    const db = (env.DB as unknown as { sqlite: any }).sqlite;
    const row = db.prepare(`SELECT status, result_json FROM audit_runs WHERE id = ?`).get(msg.runId);
    expect(row.status).toBe('failed');
    expect(row.result_json).toBeNull();
    const provRow = db.prepare(`SELECT status FROM run_provenance WHERE run_id = ?`).get(msg.provenanceRunId);
    expect(provRow.status).toBe('failed');
  });

  it('getRunChain(childRunId) returns the sentinel run first, then the audit run', async () => {
    const { env, sent } = makeEnv();
    await seedTargets(env, makeTargets());
    await runSentinelScan(env);

    const msg = sent[0] as { provenanceRunId: string };
    const chain = await getRunChain(env, msg.provenanceRunId);
    expect(chain).toHaveLength(2);
    expect(chain[0].surface).toBe('sentinel');
    expect(chain[1].surface).toBe('queued_audit');
    expect(chain[1].run_id).toBe(msg.provenanceRunId);
    expect(chain[1].parent_run_id).toBe(chain[0].run_id);
  });

  it('env without DB: zero errors, zero rows, no queue sends', async () => {
    const kv = makeKv();
    await kv.put('sentinel:targets', JSON.stringify(makeTargets()));
    const send = vi.fn(async () => {});
    const env = { LUMINARA_KV: kv, AUDIT_JOBS: { send } } as unknown as Env;

    const result = await runSentinelScan(env);
    expect(result.scanned).toBe(3);
    expect(send).not.toHaveBeenCalled();

    // Drain-side processing on a DB-less env also no-ops provenance.
    await expect(
      processAuditJob(env, { runId: 'aud_x', accountId: OWNER, targetUrl: 'https://alpha.example.com' }),
    ).resolves.toBeUndefined();
  });
});
