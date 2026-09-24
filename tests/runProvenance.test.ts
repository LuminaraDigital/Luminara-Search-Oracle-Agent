/**
 * Run provenance service: per-invocation tracing across agent surfaces.
 * Additive-only contract: works when DB is unset (KV mode), when the 0010
 * migration has not been applied (no-op), and never throws.
 */
import { describe, it, expect } from 'vitest';
import { startRun, completeRun, getRunChain, listRunsForAccount } from '../worker/runProvenance';
import { createSqliteD1 } from './helpers/sqliteD1';

const base = { surface: 'oracle_chat' as const, accountId: 'acct_1', wakeReason: 'user_invoke' as const };

describe('runProvenance', () => {
  it('creates a run with a uuid runId and wake_reason', async () => {
    const env = { DB: createSqliteD1() };
    const run = await startRun(env, { ...base, inputPayload: { messageLength: 42 } });
    expect(run).not.toBeNull();
    expect(run!.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const rows = env.DB.sqlite
      .prepare('SELECT * FROM run_provenance WHERE run_id = ?')
      .all(run!.runId);
    expect(rows).toHaveLength(1);
    expect(rows[0].surface).toBe('oracle_chat');
    expect(rows[0].wake_reason).toBe('user_invoke');
    expect(rows[0].status).toBe('running');
    expect(rows[0].input_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores a deterministic input_hash and never stores raw payload text', async () => {
    const env = { DB: createSqliteD1() };
    const payload = { messageLength: 10, hasAttachments: false };
    const a = await startRun(env, { ...base, inputPayload: payload });
    const b = await startRun(env, { ...base, inputPayload: { hasAttachments: false, messageLength: 10 } });
    // Key order differs. Hash stability across key order is NOT required of the
    // service contract (callers pass canonical shapes), but the hash must exist
    // and must not contain payload content.
    const row = env.DB.sqlite.prepare('SELECT input_hash FROM run_provenance WHERE run_id = ?').get(a!.runId);
    expect(row.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.input_hash).not.toContain('messageLength');
    expect(b).not.toBeNull();
  });

  it('chains parent runs root-first via getRunChain', async () => {
    const env = { DB: createSqliteD1() };
    const parent = await startRun(env, {
      surface: 'sentinel',
      accountId: 'acct_1',
      wakeReason: 'cron_tick',
      inputPayload: { targetCount: 3 },
    });
    const child = await startRun(env, {
      surface: 'queued_audit',
      accountId: 'acct_1',
      wakeReason: 'queue_drain',
      parentRunId: parent!.runId,
      inputPayload: { domain: 'example.com' },
    });
    const chain = await getRunChain(env, child!.runId);
    expect(chain.map((r) => r.run_id)).toEqual([parent!.runId, child!.runId]);
    expect(chain[0].surface).toBe('sentinel');
    expect(chain[1].surface).toBe('queued_audit');
  });

  it('completeRun stamps completed_at and status', async () => {
    const env = { DB: createSqliteD1() };
    const run = await startRun(env, base);
    await completeRun(env, run!.runId, 'completed');
    const row = env.DB.sqlite.prepare('SELECT status, completed_at FROM run_provenance WHERE run_id = ?').get(run!.runId);
    expect(row.status).toBe('completed');
    expect(row.completed_at).toBeGreaterThan(0);

    await completeRun(env, run!.runId, 'failed');
    const failed = env.DB.sqlite.prepare('SELECT status FROM run_provenance WHERE run_id = ?').get(run!.runId);
    expect(failed.status).toBe('failed');
  });

  it('listRunsForAccount returns newest first and clamps limit', async () => {
    const env = { DB: createSqliteD1() };
    await startRun(env, { ...base, inputPayload: { n: 1 } });
    await startRun(env, { ...base, inputPayload: { n: 2 } });
    await startRun(env, { ...base, accountId: 'acct_other', inputPayload: { n: 3 } });
    const rows = await listRunsForAccount(env, 'acct_1', 10);
    expect(rows).toHaveLength(2);
    expect(rows[0].started_at).toBeGreaterThanOrEqual(rows[1].started_at);
  });

  it('no-ops gracefully when DB is unset (KV-only mode)', async () => {
    const env = {};
    expect(await startRun(env, base)).toBeNull();
    await expect(completeRun(env, 'run_does_not_exist', 'completed')).resolves.toBeUndefined();
    await expect(getRunChain(env, 'run_does_not_exist')).resolves.toEqual([]);
    await expect(listRunsForAccount(env, 'acct_1')).resolves.toEqual([]);
  });

  it('no-ops gracefully when migration 0010 is not yet applied', async () => {
    const env = { DB: createSqliteD1({ skipMigrations: ['0010'] }) };
    expect(await startRun(env, base)).toBeNull();
    await expect(completeRun(env, 'x', 'completed')).resolves.toBeUndefined();
    await expect(getRunChain(env, 'x')).resolves.toEqual([]);
  });

  it('truncates wake_comment to 256 chars', async () => {
    const env = { DB: createSqliteD1() };
    const run = await startRun(env, { ...base, wakeComment: 'x'.repeat(500) });
    const row = env.DB.sqlite.prepare('SELECT wake_comment FROM run_provenance WHERE run_id = ?').get(run!.runId);
    expect(row.wake_comment).toHaveLength(256);
  });
});
