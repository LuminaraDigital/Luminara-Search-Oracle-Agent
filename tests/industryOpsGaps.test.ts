import { describe, expect, it, vi } from 'vitest';
import { classifyInvoiceDelta, handleBudgetReconcileRoute } from '../worker/invoiceReconcile';
import { assertHonestyLabel } from '../worker/weeklyDecisionService';
import {
  canPulseAsScored,
  freshnessFromCaptures,
  normalizeMeasurementStatus,
} from '../services/wdl/liveHonesty';
import { hashEmbed, resolveVectorProvider, searchMemoryVectors } from '../worker/memoryRag';
import type { Ai, Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';
import { createPrivacyJob, getPrivacyJob } from '../worker/privacyService';
import type { HostedIdentity } from '../worker/userTypes';

function mockKv() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

describe('invoice reconcile classifier and M-11 validation', () => {
  it('classifies ok / warn / reconciliation_required bands and fails closed on NaN/Infinity/negative', () => {
    expect(classifyInvoiceDelta(1000, 1000).status).toBe('ok');
    expect(classifyInvoiceDelta(1000, 1015).status).toBe('warn');
    expect(classifyInvoiceDelta(1000, 1060).status).toBe('reconciliation_required');
    expect(classifyInvoiceDelta(1000, Number.NaN).status).toBe('reconciliation_required');
    expect(classifyInvoiceDelta(Number.POSITIVE_INFINITY, 1000).status).toBe('reconciliation_required');
    expect(classifyInvoiceDelta(1000, -1).status).toBe('reconciliation_required');
    expect(classifyInvoiceDelta(-5, 0).status).toBe('reconciliation_required');
  });

  it('validates body size, invoiceCents bounds, and period window on POST /budgets/self/reconcile', async () => {
    const env = { DB: createSqliteD1() } as Env;
    const now = Date.now();
    const post = (body: string | Record<string, unknown>) =>
      handleBudgetReconcileRoute(
        new Request('https://luminarasuite.com/api/budgets/self/reconcile', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        }),
        env,
        'acct_rec',
        'usr_rec',
        '/budgets/self/reconcile',
      );

    expect((await post('x'.repeat(70_000)))?.status).toBe(413);
    expect((await post('{not-json'))?.status).toBe(400);
    expect((await post({ provider: 'dataforseo', invoiceCents: -10 }))?.status).toBe(400);
    expect((await post({ provider: 'dataforseo', invoiceCents: 12.5 }))?.status).toBe(400);
    expect((await post({ provider: 'dataforseo', invoiceCents: 100_000_001 }))?.status).toBe(400);
    expect((await post({ provider: 'dataforseo', invoiceCents: 0, periodStart: now, periodEnd: now - 1000 }))?.status).toBe(400);
    expect((await post({ provider: 'dataforseo', invoiceCents: 0, periodStart: 1000, periodEnd: now }))?.status).toBe(400);

    const valid = await post({
      provider: 'dataforseo',
      invoiceCents: 0,
      periodStart: now - 3600_000,
      periodEnd: now,
    });
    expect(valid?.status).toBe(200);
    expect(((await valid!.json()) as { status: string }).status).toBe('ok');
  });
});

describe('M-13 migration 0061 SQLite validation triggers', () => {
  it('enforces non-negative amounts, positive quantities, and bounded step indexes via BEFORE INSERT/UPDATE triggers', () => {
    const db = createSqliteD1();
    const exec = (sql: string) => () => db.sqlite.exec(sql);
    const now = Date.now();

    // referral_rewards: positive amount, 0 <= remaining <= amount
    expect(exec(`INSERT INTO referral_rewards (id, account_id, kind, amount, remaining, reason, created_at) VALUES ('r1', 'a', 'k', 0, 0, 'bad', ${now})`)).toThrow();
    expect(exec(`INSERT INTO referral_rewards (id, account_id, kind, amount, remaining, reason, created_at) VALUES ('r2', 'a', 'k', 5, -1, 'bad2', ${now})`)).toThrow();
    expect(exec(`INSERT INTO referral_rewards (id, account_id, kind, amount, remaining, reason, created_at) VALUES ('r3', 'a', 'k', 5, 6, 'bad3', ${now})`)).toThrow();

    // user_progression: non-negative counters
    expect(exec(`INSERT INTO user_progression (account_id, streak_weeks, honest_scout_count, week_scout_count, updated_at) VALUES ('a', -1, 0, 0, ${now})`)).toThrow();

    // cost_events: non-negative billed_cents
    expect(exec(`INSERT INTO cost_events (id, account_id, tool_name, provider, billed_cents, credit_class, created_at) VALUES ('c1', 'a', 't', 'p', -1, 'paid', ${now})`)).toThrow();

    // budget_incidents: positive threshold/limit, non-negative observed
    db.sqlite.exec(`INSERT INTO budget_policies (id, account_id, amount_cents, created_at, updated_at) VALUES ('bp1', 'a', 1000, ${now}, ${now})`);
    expect(exec(`INSERT INTO budget_incidents (id, policy_id, account_id, scope_type, window_start, threshold_percent, threshold_kind, amount_limit_cents, amount_observed_cents, created_at) VALUES ('bi1', 'bp1', 'a', 'account', ${now}, 50, 'soft', 1000, -5, ${now})`)).toThrow();

    // idea_scout_daily: non-negative used
    expect(exec(`INSERT INTO idea_scout_daily (account_id, utc_day, used) VALUES ('a', '2026-10-01', -1)`)).toThrow();

    // invoice_reconcile_runs: non-negative cents and period_start < period_end
    expect(exec(`INSERT INTO invoice_reconcile_runs (id, account_id, provider, period_start, period_end, internal_cents, invoice_cents, delta_cents, status, created_at) VALUES ('ir1', 'a', 'p', ${now}, ${now}, 0, 0, 0, 'ok', ${now})`)).toThrow();
    expect(exec(`INSERT INTO invoice_reconcile_runs (id, account_id, provider, period_start, period_end, internal_cents, invoice_cents, delta_cents, status, created_at) VALUES ('ir2', 'a', 'p', ${now - 1000}, ${now}, 0, -1, 1, 'ok', ${now})`)).toThrow();

    // stripe_credited_sessions: non-negative amount_total and granted_days
    expect(exec(`INSERT INTO stripe_credited_sessions (session_id, plan_id, amount_total, currency, credited_at, granted_days) VALUES ('s1', 'starter', -100, 'aud', ${now}, 30)`)).toThrow();
    expect(exec(`INSERT INTO stripe_credited_sessions (session_id, plan_id, amount_total, currency, credited_at, granted_days) VALUES ('s2', 'starter', 100, 'aud', ${now}, -1)`)).toThrow();

    // stars_charges: positive stars and non-negative attempts
    expect(exec(`INSERT INTO stars_charges (charge_id, payer_tg_id, purpose, ref_id, stars, attempts, created_at, updated_at) VALUES ('sc1', 123, 'plan', 'starter', 100, -1, ${now}, ${now})`)).toThrow();

    // ton_pending_orders: positive integer amount_nano and expires_at > created_at
    expect(exec(`INSERT INTO ton_pending_orders (order_id, memo, account_id, login_id, plan_id, amount_nano, recipient, network, created_at, expires_at) VALUES ('o1', 'm1', 'a', 'a', 'starter', '0', 'UQ', 'testnet', ${now}, ${now + 1000})`)).toThrow();
    expect(exec(`INSERT INTO ton_pending_orders (order_id, memo, account_id, login_id, plan_id, amount_nano, recipient, network, created_at, expires_at) VALUES ('o2', 'm2', 'a', 'a', 'starter', '-5', 'UQ', 'testnet', ${now}, ${now + 1000})`)).toThrow();
    expect(exec(`INSERT INTO ton_pending_orders (order_id, memo, account_id, login_id, plan_id, amount_nano, recipient, network, created_at, expires_at) VALUES ('o3', 'm3', 'a', 'a', 'starter', '1000', 'UQ', 'testnet', ${now}, ${now})`)).toThrow();

    // recovery_runs: bounded step_index 0..2 on both INSERT and UPDATE
    expect(exec(`INSERT INTO recovery_runs (id, account_id, project_id, enquiry_id, contact_id, playbook_id, step_index, created_at, updated_at) VALUES ('rr_bad', 'a', 'p', 'e', 'c', 'pb', 3, ${now}, ${now})`)).toThrow();
    db.sqlite.exec(`INSERT INTO recovery_runs (id, account_id, project_id, enquiry_id, contact_id, playbook_id, step_index, created_at, updated_at) VALUES ('rr_ok', 'a', 'p', 'e', 'c', 'pb', 0, ${now}, ${now})`);
    expect(exec(`UPDATE recovery_runs SET step_index = -1 WHERE id = 'rr_ok'`)).toThrow();
    expect(exec(`UPDATE recovery_runs SET step_index = 3 WHERE id = 'rr_ok'`)).toThrow();

    // memory_vault_snapshots: non-negative leaf_count
    expect(exec(`INSERT INTO memory_vault_snapshots (id, account_id, merkle_root, leaf_count, cid, created_at) VALUES ('mv1', 'a', 'root', -1, 'cid', ${now})`)).toThrow();

    // agent_trace_spans: non-negative token, cost, latency metrics
    expect(exec(`INSERT INTO agent_trace_spans (span_id, run_id, account_id, node_name, kind, input_tokens, output_tokens, cost_cents, latency_ms, created_at) VALUES ('sp1', 'r1', 'a', 'n', 'llm', -1, 0, 0, 0, ${now})`)).toThrow();

    // launchpad_* tables
    expect(exec(`INSERT INTO launchpad_campaigns (id, account_id, business_name, campaign_type, title, description, compliance_status, target_fiat_cents, terms_accepted_at, created_at, updated_at) VALUES ('camp_bad', 'a', 'b', 'closed_loop_loyalty', 't', 'd', 'approved', -10, '2026-01-01', '2026-01-01', '2026-01-01')`)).toThrow();
    db.sqlite.exec(`INSERT INTO launchpad_campaigns (id, account_id, business_name, campaign_type, title, description, compliance_status, target_fiat_cents, terms_accepted_at, created_at, updated_at) VALUES ('camp_ok', 'a', 'b', 'closed_loop_loyalty', 't', 'd', 'approved', 100, '2026-01-01', '2026-01-01', '2026-01-01')`);
    expect(exec(`INSERT INTO launchpad_milestones (id, campaign_id, milestone_index, title, payout_percentage, created_at) VALUES ('ms1', 'camp_ok', 0, 'm', 0, '2026-01-01')`)).toThrow();
    expect(exec(`INSERT INTO launchpad_vouchers (id, campaign_id, voucher_code, item_description, status, issued_by_account_id, issued_at) VALUES ('v1', 'camp_ok', 'VCH-1', 'item', 'hacked', 'a', '2026-01-01')`)).toThrow();
    expect(exec(`INSERT INTO launchpad_subscriptions (id, campaign_id, subscriber_ref, channel, created_at) VALUES ('sub1', 'camp_ok', 'x', 'sms', '2026-01-01')`)).toThrow();
    expect(exec(`INSERT INTO launchpad_snapshots (campaign_id, state, current_milestone, snapshot_json, last_notified_milestone, updated_at) VALUES ('camp_ok', 'Active', -1, '{}', -1, '2026-01-01')`)).toThrow();
  });
});

describe('live honesty', () => {
  it('never pulses not_measured as scored', () => {
    expect(canPulseAsScored('not_measured')).toBe(false);
    expect(canPulseAsScored('measured')).toBe(true);
    expect(normalizeMeasurementStatus('bogus')).toBe('not_measured');
    expect(assertHonestyLabel('estimated')).toBe('estimated');
    expect(freshnessFromCaptures(['not_measured', 'measured'])).toBe('mixed');
  });
});

describe('memory vector helpers', () => {
  it('hashEmbed is stable length and resolveVectorProvider defaults to none', () => {
    expect(hashEmbed('hello brand', 16)).toHaveLength(16);
    expect(resolveVectorProvider({} as Env)).toBe('none');
  });
});

describe('memory history', () => {
  it('records ADD events when creating hosted facts', async () => {
    const env = {
      DB: createSqliteD1(),
      LUMINARA_KV: mockKv(),
      WEBAPP_URL: 'https://luminarasuite.com/',
    } as unknown as Env;
    const user: HostedIdentity = {
      id: 'fb:hist',
      accountId: 'acct_hist',
      source: 'firebase',
    } as HostedIdentity;
    const { createMemoryFact } = await import('../worker/memoryService');
    const req = new Request('https://luminarasuite.com/api/memory/facts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'We prefer plain-language audits for local clients' }),
    });
    const res = await createMemoryFact(req, env, user);
    expect(res.status).toBe(200);
    const row = await env.DB!.prepare(
      `SELECT event, text_snapshot FROM memory_history WHERE account_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind('acct_hist')
      .first<{ event: string; text_snapshot: string }>();
    expect(row?.event).toBe('ADD');
    expect(row?.text_snapshot).toContain('plain-language');
  });
});

describe('memory embeddings stay off (V decision 3)', () => {
  it('calls no embedding model for a memory write or search while no vector index is configured', async () => {
    // Workers AI is bound for the chat fallback only. Its presence must not start embedding.
    const ai: Ai = { run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2]] }) };
    const env = {
      DB: createSqliteD1(),
      LUMINARA_KV: mockKv(),
      WEBAPP_URL: 'https://luminarasuite.com/',
      AI: ai,
    } as unknown as Env;
    const user: HostedIdentity = {
      id: 'fb:embed',
      accountId: 'acct_embed',
      source: 'firebase',
    } as HostedIdentity;
    expect(resolveVectorProvider(env)).toBe('none');

    const { createMemoryFact } = await import('../worker/memoryService');
    const stored = await createMemoryFact(
      new Request('https://luminarasuite.com/api/memory/facts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'We prefer plain-language audits for local clients' }),
      }),
      env,
      user,
    );
    expect(stored.status).toBe(200);

    // The keyword search still finds the fact without a vector.
    const hits = await searchMemoryVectors(env, 'acct_embed', 'plain-language audits', 5);
    expect(hits.length).toBeGreaterThan(0);

    expect(ai.run).not.toHaveBeenCalled();
  });
});

describe('privacy export job', () => {
  it('creates a ready export with download token when KV is bound', async () => {
    const env = {
      DB: createSqliteD1(),
      LUMINARA_KV: mockKv(),
      WEBAPP_URL: 'https://luminarasuite.com/',
    } as unknown as Env;
    const user: HostedIdentity = {
      id: 'fb:test',
      accountId: 'acct_privacy',
      source: 'firebase',
    } as HostedIdentity;
    await env.DB!.prepare(
      `INSERT OR IGNORE INTO users (id, source, account_id, created_at, last_seen_at) VALUES (?, 'firebase', ?, ?, ?)`,
    )
      .bind(user.id, 'acct_privacy', Date.now(), Date.now())
      .run();

    const res = await createPrivacyJob(env, user, 'export');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; jobId?: string; downloadToken?: string; status?: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe('ready');
    expect(body.jobId).toBeTruthy();
    expect(body.downloadToken).toBeTruthy();

    const statusRes = await getPrivacyJob(env, user, body.jobId!);
    const statusBody = (await statusRes.json()) as { ok: boolean; job?: { status: string } };
    expect(statusBody.ok).toBe(true);
    expect(statusBody.job?.status).toBe('ready');
  });
});
