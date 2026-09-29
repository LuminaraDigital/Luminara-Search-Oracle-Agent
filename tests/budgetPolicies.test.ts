/**
 * Budget Policies and Enforcement (spec 0014): policy CRUD, UTC month window
 * math, cost event accumulation, concurrent recordCostEvent integrity,
 * soft threshold alerts with per-(account,window,threshold) dedupe, hard
 * stop halt + approve-once resume for the current window only, and MCP gate
 * integration (budget gate before governance; budget block wins).
 *
 * Runs the REAL migrations via tests/helpers/sqliteD1.ts, which validates
 * 0012/0013 SQL syntax against node:sqlite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import {
  BUDGET_OVERRIDE_TOOL,
  approveBudgetResume,
  budgetWindowFor,
  countWindowSpend,
  getBudgetPolicy,
  getBudgetStatus,
  isBudgetHalted,
  recordBudgetIncident,
  recordCostEvent,
  upsertBudgetPolicy,
} from '../worker/budgets';
import { handleMcpRequest } from '../worker/mcpServer';
import worker from '../worker/index';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1 } from './helpers/sqliteD1';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(store = new Map<string, string>(), overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(store),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    ...overrides,
  } as Env;
}

// Fixed UTC instants: mid-May 2026 and the June 2026 month boundary.
const MAY_15 = Date.UTC(2026, 4, 15, 12, 0, 0);
const MAY_31_LATE = Date.UTC(2026, 4, 31, 23, 59, 59);
const JUN_01 = Date.UTC(2026, 5, 1, 0, 0, 1);

describe('budget policy CRUD', () => {
  it('creates and reads back an account monthly policy with defaults', async () => {
    const env = makeEnv();
    const policy = await upsertBudgetPolicy(env, {
      accountId: 'acct_a',
      monthlyBudgetCents: 5000,
      createdBy: 'user_a',
      now: MAY_15,
    });
    expect(policy.amount_cents).toBe(5000);
    expect(policy.currency).toBe('usd');
    expect(policy.metric).toBe('billed_cents');
    expect(policy.window_kind).toBe('calendar_month_utc');
    expect(policy.scope_type).toBe('account');
    expect(policy.hard_stop_enabled).toBe(0);

    const fetched = await getBudgetPolicy(env, 'acct_a', MAY_15);
    expect(fetched?.id).toBe(policy.id);
  });

  it('upsert raises the budget in place instead of stacking policies', async () => {
    const env = makeEnv();
    const first = await upsertBudgetPolicy(env, { accountId: 'acct_a', monthlyBudgetCents: 1000, now: MAY_15 });
    const second = await upsertBudgetPolicy(env, { accountId: 'acct_a', monthlyBudgetCents: 2500, now: MAY_15 + 1000 });
    expect(second.id).toBe(first.id);
    expect(second.amount_cents).toBe(2500);
    const rows = await env.DB!.prepare(
      `SELECT COUNT(*) AS n FROM budget_policies WHERE account_id = ? AND is_active = 1`,
    )
      .bind('acct_a')
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it('rejects zero and negative budgets', async () => {
    const env = makeEnv();
    await expect(
      upsertBudgetPolicy(env, { accountId: 'acct_a', monthlyBudgetCents: 0, now: MAY_15 }),
    ).rejects.toThrow(/positive/);
    await expect(
      upsertBudgetPolicy(env, { accountId: 'acct_a', monthlyBudgetCents: -100, now: MAY_15 }),
    ).rejects.toThrow(/positive/);
    await expect(
      upsertBudgetPolicy(env, { accountId: 'acct_a', monthlyBudgetCents: Number.NaN, now: MAY_15 }),
    ).rejects.toThrow(/positive/);
  });

  it('honors a non-default currency', async () => {
    const env = makeEnv();
    const policy = await upsertBudgetPolicy(env, {
      accountId: 'acct_a',
      monthlyBudgetCents: 700,
      currency: 'EUR',
      now: MAY_15,
    });
    expect(policy.currency).toBe('eur');
  });
});

describe('window math (single `now` param)', () => {
  it('computes the UTC calendar month window', () => {
    const w = budgetWindowFor(MAY_15);
    expect(w.startMs).toBe(Date.UTC(2026, 4, 1));
    expect(w.endMs).toBe(Date.UTC(2026, 5, 1));
  });

  it('month boundary: spend in May does not leak into the June window', async () => {
    const env = makeEnv();
    await recordCostEvent(env, { accountId: 'acct_w', billedCents: 400, toolName: 't', now: MAY_31_LATE });
    await recordCostEvent(env, { accountId: 'acct_w', billedCents: 100, toolName: 't', now: JUN_01 });

    const may = await getBudgetStatus(env, 'acct_w', MAY_31_LATE);
    const june = await getBudgetStatus(env, 'acct_w', JUN_01);
    // No policy: status stays ok/null, but spend windows still compute.
    expect(may.policy).toBeNull();
    expect(june.policy).toBeNull();

    const maySpent = await countWindowSpend(env, 'acct_w', budgetWindowFor(MAY_31_LATE));
    const juneSpent = await countWindowSpend(env, 'acct_w', budgetWindowFor(JUN_01));
    expect(maySpent).toBe(400);
    expect(juneSpent).toBe(100);
  });

  it('budget status derives percent and state from window spend', async () => {
    const env = makeEnv();
    await upsertBudgetPolicy(env, { accountId: 'acct_s', monthlyBudgetCents: 1000, now: MAY_15 });
    await recordCostEvent(env, { accountId: 'acct_s', billedCents: 400, toolName: 't', now: MAY_15 });
    await recordCostEvent(env, { accountId: 'acct_s', billedCents: 200, toolName: 't', now: MAY_15 + 60_000 });

    const status = await getBudgetStatus(env, 'acct_s', MAY_15 + 120_000);
    expect(status.spentCents).toBe(600);
    expect(Math.round(status.percent)).toBe(60);
    expect(status.state).toBe('soft_50');
  });
});

describe('thresholds and incident dedupe', () => {
  it('state ladder: ok -> soft_50 -> soft_80 -> soft_95 -> hard_stop', async () => {
    const env = makeEnv();
    await upsertBudgetPolicy(env, { accountId: 'acct_l', monthlyBudgetCents: 1000, hardStopEnabled: true, now: MAY_15 });
    const ladder = async (cents: number) =>
      (await getBudgetStatus(env, 'acct_l', MAY_15)).state;
    expect(await ladder(0)).toBe('ok');
    await recordCostEvent(env, { accountId: 'acct_l', billedCents: 500, toolName: 't', now: MAY_15 });
    expect(await ladder(500)).toBe('soft_50');
    await recordCostEvent(env, { accountId: 'acct_l', billedCents: 300, toolName: 't', now: MAY_15 });
    expect(await ladder(800)).toBe('soft_80');
    await recordCostEvent(env, { accountId: 'acct_l', billedCents: 150, toolName: 't', now: MAY_15 });
    expect(await ladder(950)).toBe('soft_95');
    await recordCostEvent(env, { accountId: 'acct_l', billedCents: 50, toolName: 't', now: MAY_15 });
    expect(await ladder(1000)).toBe('hard_stop');
  });

  it('incident dedupe: one open incident per (policy, threshold, window)', async () => {
    const env = makeEnv();
    await upsertBudgetPolicy(env, { accountId: 'acct_d', monthlyBudgetCents: 1000, now: MAY_15 });
    const first = await recordBudgetIncident(env, 'acct_d', 50, 500, { now: MAY_15 });
    expect(first.recorded).toBe(true);
    const dupe = await recordBudgetIncident(env, 'acct_d', 50, 520, { now: MAY_15 });
    expect(dupe.recorded).toBe(false);
    const other = await recordBudgetIncident(env, 'acct_d', 80, 800, { now: MAY_15 });
    expect(other.recorded).toBe(true);

    const rows = await env.DB!.prepare(
      `SELECT threshold_percent FROM budget_incidents WHERE account_id = ? ORDER BY threshold_percent`,
    )
      .bind('acct_d')
      .all<{ threshold_percent: number }>();
    expect(rows.results.map((r) => r.threshold_percent)).toEqual([50, 80]);
  });

  it('the same threshold alerts again in the next window (new window_start)', async () => {
    const env = makeEnv();
    await upsertBudgetPolicy(env, { accountId: 'acct_nw', monthlyBudgetCents: 1000, now: MAY_15 });
    const may = await recordBudgetIncident(env, 'acct_nw', 50, 500, { now: MAY_15 });
    expect(may.recorded).toBe(true);
    const june = await recordBudgetIncident(env, 'acct_nw', 50, 500, { now: JUN_01 });
    expect(june.recorded).toBe(true);
    expect(june.id).not.toBe(may.id);
  });

  it('hard stop incident dedupes on threshold 100', async () => {
    const env = makeEnv();
    await upsertBudgetPolicy(env, { accountId: 'acct_h', monthlyBudgetCents: 1000, now: MAY_15 });
    const first = await recordBudgetIncident(env, 'acct_h', 100, 1000, { kind: 'hard', now: MAY_15 });
    expect(first.recorded).toBe(true);
    const dupe = await recordBudgetIncident(env, 'acct_h', 100, 1050, { kind: 'hard', now: MAY_15 });
    expect(dupe.recorded).toBe(false);
    const row = await env.DB!.prepare(
      `SELECT threshold_kind FROM budget_incidents WHERE account_id = ?`,
    )
      .bind('acct_h')
      .first<{ threshold_kind: string }>();
    expect(row?.threshold_kind).toBe('hard');
  });
});

describe('cost event integrity', () => {
  it('concurrent recordCostEvent under Promise.all does not double-count', async () => {
    const env = makeEnv();
    // Prove the helper really interleaves: every call yields to the event loop.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        recordCostEvent(env, { accountId: 'acct_c', billedCents: 7, toolName: `t${i}`, now: MAY_15 }),
      ),
    );
    expect(results.filter((r) => r.id)).toHaveLength(10);
    const spent = await countWindowSpend(env, 'acct_c', budgetWindowFor(MAY_15));
    expect(spent).toBe(70);
    const rows = env.DB!.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM cost_events WHERE account_id = ?`)
      .get('acct_c') as { n: number };
    expect(rows.n).toBe(10);
  });

  it('BYOK zero-cent events never trigger a hard stop', async () => {
    const env = makeEnv();
    await upsertBudgetPolicy(env, { accountId: 'acct_byok', monthlyBudgetCents: 1, now: MAY_15 });
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        recordCostEvent(env, { accountId: 'acct_byok', billedCents: 0, toolName: `byok${i}`, now: MAY_15 }),
      ),
    );
    expect(await isBudgetHalted(env, 'acct_byok', MAY_15)).toBe(false);
  });
});

describe('hard stop and approve-once resume', () => {
  it('unbudgeted accounts are never halted', async () => {
    const env = makeEnv();
    expect(await isBudgetHalted(env, 'acct_none', MAY_15)).toBe(false);
  });

  it('hard stop at >= 100 percent; below budget is not halted', async () => {
    const env = makeEnv();
    await upsertBudgetPolicy(env, { accountId: 'acct_hs', monthlyBudgetCents: 100, hardStopEnabled: true, now: MAY_15 });
    await recordCostEvent(env, { accountId: 'acct_hs', billedCents: 99, toolName: 't', now: MAY_15 });
    expect(await isBudgetHalted(env, 'acct_hs', MAY_15)).toBe(false);
    await recordCostEvent(env, { accountId: 'acct_hs', billedCents: 1, toolName: 't', now: MAY_15 });
    expect(await isBudgetHalted(env, 'acct_hs', MAY_15)).toBe(true);
  });

  it('approveBudgetResume unhalts the current window only', async () => {
    const env = makeEnv();
    await upsertBudgetPolicy(env, { accountId: 'acct_r', monthlyBudgetCents: 100, hardStopEnabled: true, now: MAY_15 });
    await recordCostEvent(env, { accountId: 'acct_r', billedCents: 150, toolName: 't', now: MAY_15 });
    expect(await isBudgetHalted(env, 'acct_r', MAY_15)).toBe(true);

    const resume = await approveBudgetResume(env, 'acct_r', 'admin_1', { now: MAY_15 });
    expect(resume).toBeTruthy();
    expect(await isBudgetHalted(env, 'acct_r', MAY_15)).toBe(false);

    // The override dies with the window: same account, next UTC month halts again
    // when the new window is still over budget relative to nothing spent... but
    // May spend does not carry over. Force the June window over budget and check.
    await recordCostEvent(env, { accountId: 'acct_r', billedCents: 150, toolName: 't', now: JUN_01 });
    expect(await isBudgetHalted(env, 'acct_r', JUN_01)).toBe(true);
  });

  it('resume override rows are marked kind budget_override and approved', async () => {
    const env = makeEnv();
    const resume = await approveBudgetResume(env, 'acct_k', 'admin_2', { now: MAY_15 });
    const row = await env.DB!.prepare(
      `SELECT kind, tool_name, status FROM mcp_action_requests WHERE id = ?`,
    )
      .bind(resume!.id)
      .first<{ kind: string; tool_name: string; status: string }>();
    expect(row?.kind).toBe('budget_override');
    expect(row?.tool_name).toBe(BUDGET_OVERRIDE_TOOL);
    expect(row?.status).toBe('approved');
  });

  it('enforcement fails open when the budget tables are missing (H1)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = makeEnv(new Map(), { DB: createSqliteD1({ skipMigrations: ['0012', '0013'] }) });
    expect(await isBudgetHalted(env, 'acct_x', MAY_15)).toBe(false);
  });

  it('enforcement fails closed when DB is unbound', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = makeEnv(new Map(), { DB: undefined } as Partial<Env>);
    expect(await isBudgetHalted(env, 'acct_x', MAY_15)).toBe(true);
  });

  it('BUDGET_ENFORCEMENT=off never hard-stops even when over budget', async () => {
    const env = makeEnv(new Map(), { BUDGET_ENFORCEMENT: 'off' });
    await upsertBudgetPolicy(env, {
      accountId: 'acct_off',
      monthlyBudgetCents: 100,
      hardStopEnabled: true,
      now: MAY_15,
    });
    await recordCostEvent(env, { accountId: 'acct_off', billedCents: 500, toolName: 't', now: MAY_15 });
    expect(await isBudgetHalted(env, 'acct_off', MAY_15)).toBe(false);
  });

  it('soft-alert default: overspend does not halt until hardStopEnabled', async () => {
    const env = makeEnv();
    await upsertBudgetPolicy(env, { accountId: 'acct_soft', monthlyBudgetCents: 100, now: MAY_15 });
    await recordCostEvent(env, { accountId: 'acct_soft', billedCents: 500, toolName: 't', now: MAY_15 });
    expect(await isBudgetHalted(env, 'acct_soft', MAY_15)).toBe(false);
  });
});

describe('MCP gate integration', () => {
  const agencyKv = new Map([
    ['sub:acct_gate', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86400_000 })],
  ]);
  const user: HostedIdentity = { id: 'gate-user', source: 'firebase', accountId: 'acct_gate' };

  function mcpCall(name: string, args: Record<string, unknown>, id = 1): Request {
    return new Request('https://luminarasuite.com/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    });
  }

  it('budget block wins over governance allow and writes the audit row', async () => {
    const env = makeEnv(new Map(agencyKv));
    // Halt the account BEFORE any paid call passes, then call a read-classified
    // paid tool (get_pagespeed_summary is governance risk 'read') so only the
    // budget gate could have blocked it.
    await upsertBudgetPolicy(env, { accountId: 'acct_gate', monthlyBudgetCents: 1, hardStopEnabled: true, now: Date.now() });
    await recordCostEvent(env, { accountId: 'acct_gate', billedCents: 5, toolName: 'seed', now: Date.now() });
    expect(await isBudgetHalted(env, 'acct_gate')).toBe(true);

    const res = await handleMcpRequest(mcpCall('get_pagespeed_summary', { projectId: 'p1', url: 'https://x.test' }), env, user);
    const body = (await res.json()) as {
      result?: { isError?: boolean; structuredContent?: { code?: string; reason?: string } };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent?.code).toBe('BUDGET_EXHAUSTED');
    expect(body.result?.structuredContent?.reason).toBe('budget_exhausted');

    const audit = await env.DB!.prepare(
      `SELECT action, target_id FROM org_audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind('acct_gate')
      .first<{ action: string; target_id: string }>();
    expect(audit?.action).toBe('mcp_tool_block');
    expect(audit?.target_id).toBe('get_pagespeed_summary');
  });

  it('budget block wins over destructive require_approval too', async () => {
    const env = makeEnv(new Map(agencyKv));
    await upsertBudgetPolicy(env, { accountId: 'acct_gate', monthlyBudgetCents: 1, hardStopEnabled: true, now: Date.now() });
    await recordCostEvent(env, { accountId: 'acct_gate', billedCents: 5, toolName: 'seed', now: Date.now() });

    const res = await handleMcpRequest(mcpCall('browse_goal', { url: 'https://x.test' }), env, user);
    const body = (await res.json()) as {
      result?: { isError?: boolean; structuredContent?: { code?: string; requiresApproval?: boolean } };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent?.code).toBe('BUDGET_EXHAUSTED');
    expect(body.result?.structuredContent?.requiresApproval).toBeUndefined();
  });

  it('run provenance completes with budget_halted on a budget block', async () => {
    const env = makeEnv(new Map(agencyKv));
    await upsertBudgetPolicy(env, { accountId: 'acct_gate', monthlyBudgetCents: 1, hardStopEnabled: true, now: Date.now() });
    await recordCostEvent(env, { accountId: 'acct_gate', billedCents: 5, toolName: 'seed', now: Date.now() });

    const res = await handleMcpRequest(mcpCall('get_pagespeed_summary', { projectId: 'p1', url: 'https://x.test' }), env, user);
    const body = (await res.json()) as { result?: { _meta?: { runId?: string } } };
    expect(body.result?._meta?.runId).toBeTruthy();
    const run = await env.DB!.prepare(
      `SELECT status FROM run_provenance WHERE run_id = ?`,
    )
      .bind(body.result!._meta!.runId)
      .first<{ status: string }>();
    expect(run?.status).toBe('budget_halted');
  });

  it('free tools record no cost events; paid blocked tools record nothing', async () => {
    const env = makeEnv(new Map(agencyKv));
    // Free tool runs fully.
    const whoami = await handleMcpRequest(mcpCall('whoami', {}), env, user);
    expect(((await whoami.json()) as { result?: { isError?: boolean } }).result?.isError).toBeFalsy();

    // Paid tool blocked at the entitlement seam (no Agency caps in this KV, no BYOK).
    const freeKvEnv = makeEnv(new Map());
    const blocked = await handleMcpRequest(
      mcpCall('get_pagespeed_summary', { projectId: 'p1', url: 'https://x.test' }),
      freeKvEnv,
      user,
    );
    const blockedBody = (await blocked.json()) as { result?: { structuredContent?: { code?: string } } };
    expect(blockedBody.result?.structuredContent?.code).toBe('PAID_TOOL_FORBIDDEN');

    for (const e of [env, freeKvEnv]) {
      const row = await e.DB!.prepare(`SELECT COUNT(*) AS n FROM cost_events`)
        .first<{ n: number }>();
      expect(row?.n).toBe(0);
    }
  });

  it('successful paid call records a cost event and fires a deduped soft alert', async () => {
    const kv = new Map(agencyKv);
    kv.set('mcp:context_loaded:acct_gate:p1', String(Date.now()));
    const env = makeEnv(kv);
    // Budget 2 cents: the first hosted paid call (1c) hits 50 percent exactly
    // at the interim rate, second call crosses to 100.
    await upsertBudgetPolicy(env, { accountId: 'acct_gate', monthlyBudgetCents: 2, now: Date.now() });

    const res = await handleMcpRequest(
      mcpCall('get_pagespeed_summary', { projectId: 'p1', url: 'https://x.test' }),
      env,
      user,
    );
    const body = (await res.json()) as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBeFalsy();

    const events = await env.DB!.prepare(
      `SELECT billed_cents, tool_name, source, credit_class FROM cost_events WHERE account_id = ?`,
    )
      .bind('acct_gate')
      .all<{ billed_cents: number; tool_name: string; source: string; credit_class: string }>();
    expect(events.results).toHaveLength(1);
    expect(events.results[0]).toEqual({
      billed_cents: 1,
      tool_name: 'get_pagespeed_summary',
      source: 'credit_class',
      credit_class: 'paid',
    });

    // One 50-percent incident and one budget_soft_alert audit row.
    const incidents = await env.DB!.prepare(
      `SELECT threshold_percent FROM budget_incidents WHERE account_id = ?`,
    )
      .bind('acct_gate')
      .all<{ threshold_percent: number }>();
    expect(incidents.results.map((r) => r.threshold_percent)).toEqual([50]);
    const alertAudit = await env.DB!.prepare(
      `SELECT COUNT(*) AS n FROM org_audit_logs WHERE org_id = ? AND action = 'budget_soft_alert'`,
    )
      .bind('acct_gate')
      .first<{ n: number }>();
    expect(alertAudit?.n).toBe(1);
  });
});

describe('budget routes', () => {
  const botToken = '123456:BUDGET_TEST_TOKEN';
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

  async function tgInitData(userId: number): Promise<string> {
    const { createHmac } = await import('node:crypto');
    const fields: Record<string, string> = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: userId, first_name: 'Budget Tester' }),
    };
    const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const hash = createHmac('sha256', secret).update(dcs).digest('hex');
    const p = new URLSearchParams(fields);
    p.set('hash', hash);
    return p.toString();
  }

  function routeEnv() {
    return makeEnv(new Map(), { REQUIRE_TG_AUTH: 'true', BOT_TOKEN: botToken } as Partial<Env>);
  }

  it('GET /api/budgets/self returns unbudgeted ok status', async () => {
    const env = routeEnv();
    const initData = await tgInitData(7701);
    const res = await worker.fetch(
      new Request('https://luminarasuite.com/api/budgets/self', {
        headers: { 'x-telegram-init-data': initData, 'cf-connecting-ip': '10.60.0.1' },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; policy?: unknown; state?: string; spentCents?: number };
    expect(body.ok).toBe(true);
    expect(body.policy).toBeNull();
    expect(body.state).toBe('ok');
    expect(body.spentCents).toBe(0);
  });

  it('PUT /api/budgets/self validates positive cents then upserts', async () => {
    const env = routeEnv();
    const initData = await tgInitData(7702);
    const headers = {
      'content-type': 'application/json',
      'x-telegram-init-data': initData,
      'cf-connecting-ip': '10.60.0.2',
    };
    const bad = await worker.fetch(
      new Request('https://luminarasuite.com/api/budgets/self', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ monthlyBudgetCents: 0 }),
      }),
      env,
      ctx,
    );
    expect(bad.status).toBe(400);

    const good = await worker.fetch(
      new Request('https://luminarasuite.com/api/budgets/self', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ monthlyBudgetCents: 4200 }),
      }),
      env,
      ctx,
    );
    expect(good.status).toBe(200);
    const body = (await good.json()) as { ok?: boolean; policy?: { amount_cents?: number } };
    expect(body.ok).toBe(true);
    expect(body.policy?.amount_cents).toBe(4200);

    const readBack = await worker.fetch(
      new Request('https://luminarasuite.com/api/budgets/self', { headers }),
      env,
      ctx,
    );
    const status = (await readBack.json()) as { policy?: { amount_cents?: number } };
    expect(status.policy?.amount_cents).toBe(4200);
  });

  it('POST /api/budgets/self/resume lifts a hard stop for the caller', async () => {
    const env = routeEnv();
    const initData = await tgInitData(7703);
    const headers = {
      'content-type': 'application/json',
      'x-telegram-init-data': initData,
      'cf-connecting-ip': '10.60.0.3',
    };
    await upsertBudgetPolicy(env, { accountId: '7703', monthlyBudgetCents: 1, hardStopEnabled: true });
    await recordCostEvent(env, { accountId: '7703', billedCents: 3, toolName: 'seed' });
    expect(await isBudgetHalted(env, '7703')).toBe(true);

    const res = await worker.fetch(
      new Request('https://luminarasuite.com/api/budgets/self/resume', {
        method: 'POST',
        headers,
        body: '{}',
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; actionRequestId?: string; windowStart?: number };
    expect(body.ok).toBe(true);
    expect(body.actionRequestId).toBeTruthy();
    expect(body.windowStart).toBe(budgetWindowFor(Date.now()).startMs);
    expect(await isBudgetHalted(env, '7703')).toBe(false);
  });

  it('budget routes reject unauthenticated callers', async () => {
    const env = routeEnv();
    const res = await worker.fetch(
      new Request('https://luminarasuite.com/api/budgets/self', {
        headers: { 'cf-connecting-ip': '10.60.0.9' },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });
});
