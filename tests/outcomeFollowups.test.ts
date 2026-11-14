import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { createProject } from '../worker/projectService';
import { listProjectOutcomes, recordProjectSnapshot, recordRecommendedAction } from '../worker/projectHistoryService';
import {
  OUTCOME_FOLLOWUP_DAILY_CAP,
  OUTCOME_FOLLOWUP_MAX_ATTEMPTS,
  OUTCOME_FOLLOWUP_TICK_CAP,
  attachOutcomeFollowUps,
  runOutcomeFollowUpTick,
  type OrganicMeasure,
} from '../worker/outcomeFollowups';
import { readProjectSite } from '../worker/projectMonitor';
import { createSqliteD1 } from './helpers/sqliteD1';
import { measureRealEstate, realEstateCoverage } from '../services/audit/realEstateChecks';
import {
  OUTCOME_DAY_MS,
  followUpDueAt,
  followUpSentence,
  judgeFollowUp,
  liveCheckForMetric,
  type OutcomeFollowUpView,
} from '../services/history/outcomeFollowUp';
import { freezeSignals } from '../services/history/snapshotCompare';

const botToken = '123456:FOLLOWUP_TEST_TOKEN';

function signInitData(fields: Record<string, string>, token = botToken): string {
  const dcs = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    BOT_TOKEN: botToken,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function tgHeaders(userId: number, ip: string) {
  const initData = signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Tester' }),
  });
  return {
    'content-type': 'application/json',
    'x-telegram-init-data': initData,
    'cf-connecting-ip': ip,
  };
}

const PAGE_HTML = `<!doctype html><html><head><title>Example Agency</title>
<script type="application/ld+json">{"@type":"RealEstateAgent","name":"Example Agency","telephone":"03 9000 1111","address":{"streetAddress":"1 Main St","addressLocality":"Richmond","addressRegion":"VIC","postalCode":"3121"},"sameAs":["https://maps.google.com/?cid=123"]}</script>
</head><body>
<a href="https://example.com/team/jane-smith">Jane</a>
<a href="https://example.com/suburbs/richmond">Richmond</a>
<a href="https://example.com/property/1-main">Listing</a>
</body></html>`;

function pendingView(partial: Partial<OutcomeFollowUpView> = {}): OutcomeFollowUpView {
  return {
    id: 'fol_1',
    outcomeId: 'out_1',
    horizonDays: 30,
    status: 'pending',
    dueAt: Date.UTC(2026, 11, 14),
    beforeValue: null,
    afterValue: null,
    delta: null,
    source: '',
    baselineMeasuredAt: null,
    measuredAt: null,
    judgedAt: null,
    note: '',
    ...partial,
  };
}

async function projectFor(env: Env, accountId = 'acct_a', domain = 'example.com') {
  const owned = await createProject(env, accountId, { domain });
  if (!owned.ok) throw new Error(owned.error);
  return owned.project;
}

describe('follow-up judgement', () => {
  it('subtracts two measured scores on the same series', () => {
    expect(judgeFollowUp(10, 14, true)).toEqual({ status: 'measured', before: 10, after: 14, delta: 4 });
    expect(followUpDueAt(1_000, 30)).toBe(1_000 + 30 * OUTCOME_DAY_MS);
    expect(followUpDueAt(1_000, 90)).toBe(1_000 + 90 * OUTCOME_DAY_MS);
  });

  it('does not invent a delta when a score is missing or the series differs', () => {
    expect(judgeFollowUp(10, null, true)).toEqual({ status: 'not_measured' });
    expect(judgeFollowUp(null, 14, true)).toEqual({ status: 'not_measured' });
    expect(judgeFollowUp(10, 14, false)).toEqual({ status: 'not_measured' });
    const sentence = followUpSentence(pendingView({
      status: 'not_measured',
      beforeValue: 10,
      note: 'Not measured',
      judgedAt: Date.UTC(2026, 0, 31),
      baselineMeasuredAt: Date.UTC(2026, 0, 1),
    }));
    expect(sentence).toContain('Not measured');
    expect(sentence).not.toContain('10 to');
  });

  it('keeps page coverage on every plan and organic count on Agency', () => {
    expect(liveCheckForMetric('re_coverage', false)).toBe('public');
    expect(liveCheckForMetric('organic_count', false)).toBe('none');
    expect(liveCheckForMetric('organic_count', true)).toBe('paid');
    expect(liveCheckForMetric('citation_rate', true)).toBe('none');
  });
});

describe('outcome follow-ups', () => {
  it('schedules 30, 60 and 90 days once when an action is recorded', async () => {
    const env = makeEnv();
    const project = await projectFor(env);
    const anchor = 1_700_000_000_000;
    const outcome = await recordRecommendedAction(env, {
      accountId: 'acct_a',
      projectId: project.id,
      actionKey: 'fix:title',
      title: 'Rewrite the title',
      kind: 'audit',
      now: anchor,
    });
    expect(outcome?.id).toBeTruthy();
    await recordRecommendedAction(env, {
      accountId: 'acct_a',
      projectId: project.id,
      actionKey: 'fix:title',
      title: 'Rewrite the title',
      kind: 'audit',
      now: anchor + 5,
    });
    const rows = await env.DB!.prepare(
      `SELECT horizon_days AS horizonDays, due_at AS dueAt, status FROM project_outcome_followups
       WHERE account_id = ? ORDER BY horizon_days ASC`,
    ).bind('acct_a').all<{ horizonDays: number; dueAt: number; status: string }>();
    expect(rows.results).toEqual([
      { horizonDays: 30, dueAt: anchor + 30 * OUTCOME_DAY_MS, status: 'pending' },
      { horizonDays: 60, dueAt: anchor + 60 * OUTCOME_DAY_MS, status: 'pending' },
      { horizonDays: 90, dueAt: anchor + 90 * OUTCOME_DAY_MS, status: 'pending' },
    ]);
  });

  it('stores the page-check delta and leaves later horizons pending', async () => {
    const env = makeEnv();
    const project = await projectFor(env);
    const pages = await readProjectSite(project.domain, async () => ({ status: 200, html: PAGE_HTML }));
    const coverage = realEstateCoverage(measureRealEstate(pages).checks);
    expect(coverage.measurementStatus).toBe('measured');
    expect(coverage.score).not.toBeNull();
    expect(coverage.score).toBeGreaterThan(0);
    const anchor = Date.now() - 31 * OUTCOME_DAY_MS;
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: project.id,
      kind: 'audit',
      measuredAt: anchor,
      sourceRef: 'baseline-page',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 're_coverage',
        subject: coverage.series,
        score: 0,
        engines: [],
        notes: [],
      }),
    });
    await recordRecommendedAction(env, {
      accountId: 'acct_a',
      projectId: project.id,
      actionKey: 'page:listing',
      title: 'Add the missing listing page',
      kind: 'audit',
      metric: 're_coverage',
      now: anchor,
    });
    const now = anchor + 30 * OUTCOME_DAY_MS + 1_000;
    await runOutcomeFollowUpTick(env, {
      now,
      read: async () => ({ status: 200, html: PAGE_HTML }),
    });
    const rows = await env.DB!.prepare(
      `SELECT horizon_days AS horizonDays, status, before_value AS beforeValue, after_value AS afterValue,
              delta, source_ref AS source, baseline_measured_at AS baselineAt, measured_at AS measuredAt
       FROM project_outcome_followups WHERE account_id = ? ORDER BY horizon_days ASC`,
    ).bind('acct_a').all<{
      horizonDays: number;
      status: string;
      beforeValue: number | null;
      afterValue: number | null;
      delta: number | null;
      source: string;
      baselineAt: number | null;
      measuredAt: number | null;
    }>();
    const first = rows.results?.[0];
    expect(first).toMatchObject({
      horizonDays: 30,
      status: 'measured',
      beforeValue: 0,
      afterValue: coverage.score,
      delta: coverage.score,
      baselineAt: anchor,
      measuredAt: now,
    });
    expect(first?.source.startsWith('followup:')).toBe(true);
    expect(rows.results?.slice(1).map((row) => row.status)).toEqual(['pending', 'pending']);
    const listed = await listProjectOutcomes(env, 'acct_a', project.id);
    const report = listed ? await attachOutcomeFollowUps(env, 'acct_a', project.id, listed) : [];
    expect(followUpSentence(report[0].followUps[0])).toContain(`${coverage.score}`);
    expect(followUpSentence(report[0].followUps[0])).toContain('Source followup:');
  });

  it('stores Not measured for a paid metric on a free plan and does not call the provider', async () => {
    const env = makeEnv();
    const project = await projectFor(env);
    const anchor = Date.now() - 31 * OUTCOME_DAY_MS;
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: project.id,
      kind: 'audit',
      measuredAt: anchor,
      sourceRef: 'baseline-organic',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 'organic_count',
        score: 4,
        engines: [],
        notes: [],
      }),
    });
    await recordRecommendedAction(env, {
      accountId: 'acct_a',
      projectId: project.id,
      actionKey: 'audit:organic',
      title: 'Publish the service page',
      kind: 'audit',
      metric: 'organic_count',
      now: anchor,
    });
    let calls = 0;
    const measureOrganic: OrganicMeasure = async () => {
      calls += 1;
      return { ok: true, count: 99 };
    };
    await runOutcomeFollowUpTick(env, { now: anchor + 30 * OUTCOME_DAY_MS + 1_000, measureOrganic });
    expect(calls).toBe(0);
    const row = await env.DB!.prepare(
      `SELECT status, after_value AS afterValue, delta, note FROM project_outcome_followups
       WHERE account_id = ? AND horizon_days = 30`,
    ).bind('acct_a').first<{ status: string; afterValue: number | null; delta: number | null; note: string }>();
    expect(row).toEqual({ status: 'not_measured', afterValue: null, delta: null, note: 'Not measured' });
  });

  it('stores the organic delta for an Agency plan and Not measured when the provider returns no count', async () => {
    const env = makeEnv();
    await env.LUMINARA_KV.put(
      'sub:acct_a',
      JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 10 * OUTCOME_DAY_MS }),
    );
    const project = await projectFor(env);
    const anchor = Date.now() - 31 * OUTCOME_DAY_MS;
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: project.id,
      kind: 'audit',
      measuredAt: anchor,
      sourceRef: 'baseline-organic',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 'organic_count',
        score: 4,
        engines: [],
        notes: [],
      }),
    });
    await recordRecommendedAction(env, {
      accountId: 'acct_a',
      projectId: project.id,
      actionKey: 'audit:organic',
      title: 'Publish the service page',
      kind: 'audit',
      metric: 'organic_count',
      now: anchor,
    });
    const measureOrganic: OrganicMeasure = async () => ({ ok: true, count: null });
    await runOutcomeFollowUpTick(env, { now: anchor + 30 * OUTCOME_DAY_MS + 1_000, measureOrganic });
    const empty = await env.DB!.prepare(
      `SELECT status, after_value AS afterValue FROM project_outcome_followups WHERE account_id = ? AND horizon_days = 30`,
    ).bind('acct_a').first<{ status: string; afterValue: number | null }>();
    expect(empty).toEqual({ status: 'not_measured', afterValue: null });

    const env2 = makeEnv();
    await env2.LUMINARA_KV.put(
      'sub:acct_a',
      JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 10 * OUTCOME_DAY_MS }),
    );
    const project2 = await projectFor(env2);
    await recordProjectSnapshot(env2, 'acct_a', {
      projectId: project2.id,
      kind: 'audit',
      measuredAt: anchor,
      sourceRef: 'baseline-organic',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 'organic_count',
        score: 4,
        engines: [],
        notes: [],
      }),
    });
    await recordRecommendedAction(env2, {
      accountId: 'acct_a',
      projectId: project2.id,
      actionKey: 'audit:organic',
      title: 'Publish the service page',
      kind: 'audit',
      metric: 'organic_count',
      now: anchor,
    });
    await runOutcomeFollowUpTick(env2, {
      now: anchor + 30 * OUTCOME_DAY_MS + 1_000,
      measureOrganic: async () => ({ ok: true, count: 9 }),
    });
    const measured = await env2.DB!.prepare(
      `SELECT status, before_value AS beforeValue, after_value AS afterValue, delta, source_ref AS source
       FROM project_outcome_followups WHERE account_id = ? AND horizon_days = 30`,
    ).bind('acct_a').first<{ status: string; beforeValue: number; afterValue: number; delta: number; source: string }>();
    expect(measured).toMatchObject({ status: 'measured', beforeValue: 4, afterValue: 9, delta: 5 });
    expect(measured?.source.startsWith('followup:')).toBe(true);
  });

  it('retries a failed re-check and then stores Not measured', async () => {
    const env = makeEnv();
    await env.LUMINARA_KV.put(
      'sub:acct_a',
      JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 40 * OUTCOME_DAY_MS }),
    );
    const project = await projectFor(env);
    const anchor = Date.now() - 31 * OUTCOME_DAY_MS;
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: project.id,
      kind: 'audit',
      measuredAt: anchor,
      sourceRef: 'baseline-organic',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 'organic_count',
        score: 4,
        engines: [],
        notes: [],
      }),
    });
    await recordRecommendedAction(env, {
      accountId: 'acct_a',
      projectId: project.id,
      actionKey: 'audit:organic',
      title: 'Publish the service page',
      kind: 'audit',
      metric: 'organic_count',
      now: anchor,
    });
    let now = anchor + 30 * OUTCOME_DAY_MS + 1_000;
    for (let attempt = 1; attempt <= OUTCOME_FOLLOWUP_MAX_ATTEMPTS; attempt += 1) {
      await runOutcomeFollowUpTick(env, {
        now,
        measureOrganic: async () => ({ ok: false }),
      });
      const row = await env.DB!.prepare(
        `SELECT status, attempts, due_at AS dueAt, after_value AS afterValue
         FROM project_outcome_followups WHERE account_id = ? AND horizon_days = 30`,
      ).bind('acct_a').first<{ status: string; attempts: number; dueAt: number; afterValue: number | null }>();
      expect(row?.attempts).toBe(attempt);
      expect(row?.afterValue).toBeNull();
      if (attempt < OUTCOME_FOLLOWUP_MAX_ATTEMPTS) {
        expect(row?.status).toBe('pending');
        now = (row?.dueAt ?? now) + 1_000;
      } else {
        expect(row?.status).toBe('not_measured');
      }
    }
  });

  it('defers a live check once the daily cap is spent', async () => {
    const env = makeEnv();
    const project = await projectFor(env);
    const anchor = Date.now() - 31 * OUTCOME_DAY_MS;
    const pages = await readProjectSite(project.domain, async () => ({ status: 200, html: PAGE_HTML }));
    const coverage = realEstateCoverage(measureRealEstate(pages).checks);
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: project.id,
      kind: 'audit',
      measuredAt: anchor,
      sourceRef: 'baseline-page',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 're_coverage',
        subject: coverage.series,
        score: 0,
        engines: [],
        notes: [],
      }),
    });
    await recordRecommendedAction(env, {
      accountId: 'acct_a',
      projectId: project.id,
      actionKey: 'page:listing',
      title: 'Add the missing listing page',
      kind: 'audit',
      metric: 're_coverage',
      now: anchor,
    });
    const day = new Date().toISOString().slice(0, 10);
    await env.LUMINARA_KV.put(`outcome-followup:acct_a:${day}`, String(OUTCOME_FOLLOWUP_DAILY_CAP));
    const now = anchor + 30 * OUTCOME_DAY_MS + 1_000;
    await runOutcomeFollowUpTick(env, { now, read: async () => ({ status: 200, html: PAGE_HTML }) });
    const row = await env.DB!.prepare(
      `SELECT status, attempts, due_at AS dueAt FROM project_outcome_followups
       WHERE account_id = ? AND horizon_days = 30`,
    ).bind('acct_a').first<{ status: string; attempts: number; dueAt: number }>();
    expect(row).toMatchObject({ status: 'pending', attempts: 0 });
    expect(row?.dueAt).toBeGreaterThan(now);
  });

  it('stops after the tick cap', async () => {
    const env = makeEnv();
    const project = await projectFor(env);
    const anchor = Date.now() - 100 * OUTCOME_DAY_MS;
    for (let i = 0; i < 5; i += 1) {
      await recordRecommendedAction(env, {
        accountId: 'acct_a',
        projectId: project.id,
        actionKey: `fix:${i}`,
        title: `Fix ${i}`,
        kind: 'audit',
        now: anchor,
      });
    }
    const result = await runOutcomeFollowUpTick(env, { now: Date.now() });
    expect(result.checked).toBe(OUTCOME_FOLLOWUP_TICK_CAP);
    const counts = await env.DB!.prepare(
      `SELECT status, COUNT(*) AS n FROM project_outcome_followups WHERE account_id = ? GROUP BY status`,
    ).bind('acct_a').all<{ status: string; n: number }>();
    const byStatus = Object.fromEntries((counts.results || []).map((row) => [row.status, row.n]));
    expect(byStatus.not_measured).toBe(OUTCOME_FOLLOWUP_TICK_CAP);
    expect(byStatus.pending).toBe(15 - OUTCOME_FOLLOWUP_TICK_CAP);
  });

  it('uses a later stored snapshot for a check this job does not re-run', async () => {
    const env = makeEnv();
    const project = await projectFor(env);
    const anchor = Date.now() - 40 * OUTCOME_DAY_MS;
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: project.id,
      kind: 'instant_audit',
      measuredAt: anchor,
      sourceRef: 'audit-baseline',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 'citation_rate',
        score: 20,
        engines: [],
        notes: [],
      }),
    });
    await recordRecommendedAction(env, {
      accountId: 'acct_a',
      projectId: project.id,
      actionKey: 'audit:citation',
      title: 'Run the audit',
      kind: 'instant_audit',
      metric: 'citation_rate',
      now: anchor,
    });
    const followUpAt = anchor + 30 * OUTCOME_DAY_MS + 5_000;
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: project.id,
      kind: 'instant_audit',
      measuredAt: followUpAt,
      sourceRef: 'audit-later',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 'citation_rate',
        score: 35,
        engines: [],
        notes: [],
      }),
    });
    await runOutcomeFollowUpTick(env, { now: followUpAt + 1_000 });
    const row = await env.DB!.prepare(
      `SELECT status, before_value AS beforeValue, after_value AS afterValue, delta, source_ref AS source
       FROM project_outcome_followups WHERE account_id = ? AND horizon_days = 30`,
    ).bind('acct_a').first<{ status: string; beforeValue: number; afterValue: number; delta: number; source: string }>();
    expect(row).toEqual({ status: 'measured', beforeValue: 20, afterValue: 35, delta: 15, source: 'audit-later' });
  });

  it('applies the migration twice', () => {
    const env = makeEnv();
    const sql = readFileSync(resolve(__dirname, '..', 'migrations', '0052_outcome_followups.sql'), 'utf8');
    const db = env.DB as { sqlite?: { exec: (source: string) => void } };
    expect(db.sqlite).toBeTruthy();
    expect(() => db.sqlite?.exec(sql)).not.toThrow();
  });
});

describe('outcome report api', () => {
  it('returns the follow-ups to the owner and hides them from another account', async () => {
    const env = makeEnv();
    const call = (userId: number, ip: string, body: unknown) =>
      worker.fetch(
        new Request('https://luminarasuite.com/api/mcp', {
          method: 'POST',
          headers: tgHeaders(userId, ip),
          body: JSON.stringify(body),
        }),
        env,
        ctx,
      );
    const created = await call(601, '10.40.0.1', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create_project', arguments: { domain: 'report.example', name: 'Report' } },
    });
    const createdBody = (await created.json()) as {
      result?: { structuredContent?: { project?: { id: string } } };
    };
    const projectId = createdBody.result?.structuredContent?.project?.id || '';
    expect(projectId).toMatch(/^proj_/);
    const anchor = Date.now();
    await recordRecommendedAction(env, {
      accountId: '601',
      projectId,
      actionKey: 'fix:title',
      title: 'Rewrite the title',
      kind: 'audit',
      now: anchor,
    });
    const report = await call(601, '10.40.0.2', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_outcome_report', arguments: { projectId } },
    });
    const reportBody = (await report.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }>; structuredContent?: { report?: { outcomes?: Array<{ followUps?: Array<{ horizonDays: number; status: string }> }> } } };
    };
    expect(reportBody.result?.isError ?? false).toBe(false);
    expect(reportBody.result?.content?.[0]?.text).toContain('30 days: pending');
    expect(reportBody.result?.content?.[0]?.text).toContain('90 days: pending');
    expect(reportBody.result?.structuredContent?.report?.outcomes?.[0]?.followUps?.map((row) => row.horizonDays)).toEqual([30, 60, 90]);

    const http = await worker.fetch(
      new Request(`https://luminarasuite.com/api/projects/${projectId}/outcomes/report`, {
        headers: tgHeaders(601, '10.40.0.3'),
      }),
      env,
      ctx,
    );
    expect(http.status).toBe(200);
    const httpBody = (await http.json()) as { report?: { outcomes?: unknown[] } };
    expect(httpBody.report?.outcomes).toHaveLength(1);

    const stranger = await call(602, '10.40.0.4', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_outcome_report', arguments: { projectId } },
    });
    const strangerBody = (await stranger.json()) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
    expect(strangerBody.result?.isError).toBe(true);
    expect(strangerBody.result?.content?.[0]?.text).toBe('Project not found');
  });
});
