/**
 * Queued audits with a project make one hosted paid call (get_domain_overview). It must pass the
 * account budget gate, land one cost event, and never run twice when the queue redelivers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';

const executePaidTool = vi.fn();
vi.mock('../services/tools/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/tools/registry')>()),
  executePaidTool: (...args: unknown[]) => executePaidTool(...args),
}));

const { enqueueAuditJob, processAuditJob } = await import('../worker/auditQueue');
const { getBudgetStatus, recordCostEvent, upsertBudgetPolicy } = await import('../worker/budgets');

const ACCOUNT = 'acct_queue_meter';

const publicDns = (async () =>
  new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
    headers: { 'content-type': 'application/dns-json' },
  })) as unknown as typeof fetch;

function makeEnv() {
  const sent: unknown[] = [];
  const env = {
    DB: createSqliteD1(),
    AUDIT_JOBS: { send: async (m: unknown) => { sent.push(m); } },
  } as unknown as Env;
  return { env, sent };
}

async function queueOne(env: Env, sent: unknown[]) {
  await enqueueAuditJob(env, { accountId: ACCOUNT, targetUrl: 'https://example.com', projectId: 'prj_1' });
  return sent[sent.length - 1] as Parameters<typeof processAuditJob>[1];
}

function runStatus(env: Env, runId: string) {
  return (env.DB as unknown as { sqlite: any }).sqlite
    .prepare(`SELECT status, result_json FROM audit_runs WHERE id = ?`)
    .get(runId) as { status: string; result_json: string | null };
}

afterEach(() => {
  executePaidTool.mockReset();
});

describe('queued audit paid call metering', () => {
  it('records one cost event for a successful hosted paid call', async () => {
    const { env, sent } = makeEnv();
    executePaidTool.mockResolvedValue({ text: 'ok', structuredContent: { measurementStatus: 'measured' } });
    await upsertBudgetPolicy(env, { accountId: ACCOUNT, monthlyBudgetCents: 1000 });
    const msg = await queueOne(env, sent);

    await processAuditJob(env, msg, { dohFetcher: publicDns });

    expect(executePaidTool).toHaveBeenCalledTimes(1);
    expect(runStatus(env, msg.runId).status).toBe('completed');
    expect((await getBudgetStatus(env, ACCOUNT)).spentCents).toBe(1);
  });

  it('skips the paid call when the account is at its hard stop', async () => {
    const { env, sent } = makeEnv();
    await upsertBudgetPolicy(env, { accountId: ACCOUNT, monthlyBudgetCents: 1, hardStopEnabled: true });
    await recordCostEvent(env, { accountId: ACCOUNT, billedCents: 1, toolName: 'seed' });
    const msg = await queueOne(env, sent);

    await processAuditJob(env, msg, { dohFetcher: publicDns });

    expect(executePaidTool).not.toHaveBeenCalled();
    const row = runStatus(env, msg.runId);
    expect(row.status).toBe('completed');
    expect(JSON.parse(row.result_json!).domainOverview).toMatchObject({
      measurementStatus: 'not_measured',
      code: 'BUDGET_HALTED',
    });
  });

  it('does not pay again when the queue redelivers a finished run', async () => {
    const { env, sent } = makeEnv();
    executePaidTool.mockResolvedValue({ text: 'ok', structuredContent: { measurementStatus: 'measured' } });
    const msg = await queueOne(env, sent);

    await processAuditJob(env, msg, { dohFetcher: publicDns });
    await processAuditJob(env, msg, { dohFetcher: publicDns });

    expect(executePaidTool).toHaveBeenCalledTimes(1);
  });

  it('records nothing when the paid call errors', async () => {
    const { env, sent } = makeEnv();
    executePaidTool.mockResolvedValue({ text: 'DataForSEO unavailable', isError: true });
    await upsertBudgetPolicy(env, { accountId: ACCOUNT, monthlyBudgetCents: 1000 });
    const msg = await queueOne(env, sent);

    await processAuditJob(env, msg, { dohFetcher: publicDns });

    expect((await getBudgetStatus(env, ACCOUNT)).spentCents).toBe(0);
  });
});
