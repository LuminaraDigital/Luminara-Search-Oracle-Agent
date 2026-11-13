import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';
import { createProject } from '../worker/projectService';
import {
  compareProjectSnapshots,
  getProjectHistory,
  listProjectOutcomes,
  markActionDone,
  recordProjectSnapshot,
  recordRecommendedAction,
  SNAPSHOT_CAP,
} from '../worker/projectHistoryService';
import { listMcpToolCatalogue } from '../worker/mcpServer';
import { instantAuditSnapshot } from '../services/history/snapshotCapture';
import { compareSnapshots, freezeSignals, metricForKind, outcomeLift } from '../services/history/snapshotCompare';
import type { SnapshotPoint } from '../services/history/snapshotCompare';

const botToken = '123456:HISTORY_TEST_TOKEN';

function signInitData(fields: Record<string, string>, token = botToken): string {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
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

function point(partial: {
  id: string;
  kind: SnapshotPoint['kind'];
  measuredAt: number;
  score: number | null;
  engines: Array<{ engine: string; cited: boolean }>;
}): SnapshotPoint {
  return {
    id: partial.id,
    kind: partial.kind,
    measuredAt: partial.measuredAt,
    signals: freezeSignals({
      measurementStatus: 'measured',
      metric: metricForKind(partial.kind),
      score: partial.score,
      engines: partial.engines,
      notes: [],
    }),
  };
}

describe('snapshot compare', () => {
  it('reports the score change and engines that dropped out', () => {
    const delta = compareSnapshots(
      point({
        id: 'early',
        kind: 'ai_visibility',
        measuredAt: 10,
        score: 40,
        engines: [
          { engine: 'chatgpt', cited: true },
          { engine: 'perplexity', cited: true },
        ],
      }),
      point({
        id: 'late',
        kind: 'ai_visibility',
        measuredAt: 20,
        score: 25,
        engines: [{ engine: 'perplexity', cited: true }],
      }),
    );
    expect(delta).toEqual({
      kind: 'ai_visibility',
      earlierId: 'early',
      laterId: 'late',
      earlierScore: 40,
      laterScore: 25,
      scoreDelta: -15,
      droppedEngines: ['chatgpt'],
      gainedEngines: [],
      label: 'measured',
    });
  });

  it('withholds lift when a score is missing', () => {
    expect(outcomeLift(40, null)).toEqual({ lift: null, label: 'too_little_data' });
    const delta = compareSnapshots(
      point({ id: 'early', kind: 'audit', measuredAt: 10, score: 40, engines: [] }),
      point({ id: 'late', kind: 'keyword', measuredAt: 20, score: 40, engines: [] }),
    );
    expect(delta.scoreDelta).toBeNull();
    expect(delta.label).toBe('too_little_data');
  });

  it('keeps an Instant Audit cite-worthiness number out of the measured score', () => {
    const empty = instantAuditSnapshot({
      projectId: 'p',
      entryId: 'e',
      measuredAt: 1,
      citationRatePercent: null,
      schemaGapCount: 2,
    });
    expect(empty.signals.score).toBeNull();
    expect(empty.signals.measurementStatus).toBe('not_measured');
    const rated = instantAuditSnapshot({
      projectId: 'p',
      entryId: 'e2',
      measuredAt: 2,
      citationRatePercent: 33,
      schemaGapCount: null,
    });
    expect(rated.signals).toMatchObject({
      measurementStatus: 'measured',
      metric: 'citation_rate',
      score: 33,
    });
  });

  it('drops a score that arrived on a not-measured check', () => {
    expect(
      freezeSignals({
        measurementStatus: 'not_measured',
        score: 80,
        engines: [{ engine: 'chatgpt', cited: true }],
        notes: ['ignored'],
      }),
    ).toEqual({
      measurementStatus: 'not_measured',
      metric: 'none',
      score: null,
      engines: [],
      notes: ['ignored'],
    });
  });
});

describe('project history store', () => {
  it('keeps one account from reading another account history', async () => {
    const env = { DB: createSqliteD1() } as Env;
    const owned = await createProject(env, 'acct_a', { domain: 'alpha.example' });
    const other = await createProject(env, 'acct_b', { domain: 'beta.example' });
    expect(owned.ok).toBe(true);
    expect(other.ok).toBe(true);
    if (!owned.ok || !other.ok) return;

    const first = await recordProjectSnapshot(env, 'acct_a', {
      projectId: owned.project.id,
      kind: 'ai_visibility',
      measuredAt: 1_700_000_000_000,
      sourceRef: 'run-1',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 'visibility_rate',
        score: 40,
        engines: [
          { engine: 'chatgpt', cited: true },
          { engine: 'perplexity', cited: true },
        ],
        notes: [],
      }),
    });
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: owned.project.id,
      kind: 'ai_visibility',
      measuredAt: 1_700_000_100_000,
      sourceRef: 'run-2',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 'visibility_rate',
        score: 25,
        engines: [{ engine: 'perplexity', cited: true }],
        notes: [],
      }),
    });
    const again = await recordProjectSnapshot(env, 'acct_a', {
      projectId: owned.project.id,
      kind: 'ai_visibility',
      measuredAt: 1_700_000_000_000,
      sourceRef: 'run-1',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 'visibility_rate',
        score: 99,
        engines: [],
        notes: [],
      }),
    });

    const history = await getProjectHistory(env, 'acct_a', owned.project.id);
    expect(first?.id).toMatch(/^snap_/);
    expect(again).toEqual(first);
    expect(history?.snapshots.map((row) => row.signals.score)).toEqual([25, 40]);
    expect(history?.trends.find((row) => row.kind === 'ai_visibility')?.latestDelta).toMatchObject({
      scoreDelta: -15,
      droppedEngines: ['chatgpt'],
      label: 'measured',
    });
    const later = history?.snapshots[0];
    const earlier = history?.snapshots[1];
    expect(
      await compareProjectSnapshots(env, 'acct_a', owned.project.id, earlier?.id || '', later?.id || ''),
    ).toMatchObject({ scoreDelta: -15, droppedEngines: ['chatgpt'], label: 'measured' });
    expect(await getProjectHistory(env, 'acct_b', owned.project.id)).toBeNull();
    expect(await compareProjectSnapshots(env, 'acct_b', owned.project.id, first?.id || '', 'missing')).toBeNull();
    expect(await getProjectHistory(env, 'acct_b', other.project.id)).toEqual({
      projectId: other.project.id,
      retentionNote: 'History keeps the latest 200 checks of each kind per project. Plan retention is not set.',
      snapshots: [],
      trends: [],
    });
  });

  it('records lift only after a later measured snapshot', async () => {
    const env = { DB: createSqliteD1() } as Env;
    const owned = await createProject(env, 'acct_a', { domain: 'alpha.example' });
    if (!owned.ok) throw new Error('project');
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: owned.project.id,
      kind: 'instant_audit',
      measuredAt: 1000,
      sourceRef: 'audit-1',
      signals: freezeSignals({ measurementStatus: 'measured', metric: 'citation_rate', score: 40, engines: [], notes: [] }),
    });
    const open = await recordRecommendedAction(env, {
      accountId: 'acct_a',
      projectId: owned.project.id,
      actionKey: 'fix-schema',
      title: 'Add FAQ schema',
      kind: 'instant_audit',
      now: 1500,
    });
    expect(open).toMatchObject({
      title: 'Add FAQ schema',
      status: 'recommended',
      beforeValue: 40,
      afterValue: null,
      lift: null,
      dataLabel: 'too_little_data',
    });

    await recordProjectSnapshot(env, 'acct_a', {
      projectId: owned.project.id,
      kind: 'instant_audit',
      measuredAt: 2000,
      sourceRef: 'audit-2',
      signals: freezeSignals({ measurementStatus: 'measured', metric: 'citation_rate', score: 55, engines: [], notes: [] }),
    });
    const settled = await listProjectOutcomes(env, 'acct_a', owned.project.id);
    expect(settled).toEqual([
      expect.objectContaining({
        status: 'detected',
        beforeValue: 40,
        afterValue: 55,
        lift: 15,
        dataLabel: 'measured',
      }),
    ]);
    expect(await listProjectOutcomes(env, 'acct_b', owned.project.id)).toBeNull();

    await recordProjectSnapshot(env, 'acct_a', {
      projectId: owned.project.id,
      kind: 'ai_visibility',
      measuredAt: 3000,
      sourceRef: 'visibility-40',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 'visibility_rate',
        score: 40,
        engines: [],
        notes: [],
      }),
    });
    await recordRecommendedAction(env, {
      accountId: 'acct_a',
      projectId: owned.project.id,
      actionKey: 'visibility-fix',
      title: 'Get cited',
      kind: 'ai_visibility',
      now: 3100,
    });
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: owned.project.id,
      kind: 'ai_visibility',
      measuredAt: 3200,
      sourceRef: 'watch-100',
      signals: freezeSignals({
        measurementStatus: 'measured',
        metric: 'watch_share',
        score: 100,
        engines: [{ engine: 'chatgpt', cited: true }],
        notes: [],
      }),
    });
    const mixed = (await listProjectOutcomes(env, 'acct_a', owned.project.id))?.find(
      (row) => row.actionKey === 'visibility-fix',
    );
    expect(mixed).toMatchObject({
      status: 'recommended',
      beforeValue: 40,
      afterValue: null,
      lift: null,
      dataLabel: 'too_little_data',
    });
  });

  it('does not close an action when the same check is saved twice at once', async () => {
    const env = { DB: createSqliteD1() } as Env;
    const owned = await createProject(env, 'acct_a', { domain: 'alpha.example' });
    if (!owned.ok) throw new Error('project');
    await recordRecommendedAction(env, {
      accountId: 'acct_a',
      projectId: owned.project.id,
      actionKey: 'race',
      title: 'Race',
      kind: 'instant_audit',
      now: 1000,
    });
    const event = {
      projectId: owned.project.id,
      kind: 'instant_audit' as const,
      measuredAt: 2000,
      sourceRef: 'audit-same',
      signals: freezeSignals({
        measurementStatus: 'measured' as const,
        metric: 'citation_rate' as const,
        score: 40,
        engines: [],
        notes: [],
      }),
    };
    await Promise.all([
      recordProjectSnapshot(env, 'acct_a', event),
      recordProjectSnapshot(env, 'acct_a', event),
    ]);
    const rows = await listProjectOutcomes(env, 'acct_a', owned.project.id);
    expect(rows?.[0]).toMatchObject({
      status: 'recommended',
      beforeValue: 40,
      afterValue: null,
      lift: null,
      dataLabel: 'too_little_data',
    });
  });

  it('marks an action done without inventing lift', async () => {
    const env = { DB: createSqliteD1() } as Env;
    const owned = await createProject(env, 'acct_a', { domain: 'alpha.example' });
    const other = await createProject(env, 'acct_b', { domain: 'beta.example' });
    if (!owned.ok || !other.ok) throw new Error('project');
    const open = await recordRecommendedAction(env, {
      accountId: 'acct_a',
      projectId: owned.project.id,
      actionKey: 'fix-title',
      title: 'Rewrite the title',
      kind: 'audit',
      now: 1000,
    });
    if (!open) throw new Error('outcome');
    expect(await markActionDone(env, 'acct_b', owned.project.id, open.id)).toBeNull();
    const done = await markActionDone(env, 'acct_a', owned.project.id, open.id, 2000);
    expect(done).toMatchObject({
      status: 'done',
      lift: null,
      dataLabel: 'too_little_data',
      beforeValue: null,
      afterValue: null,
    });
    const rows = await listProjectOutcomes(env, 'acct_a', owned.project.id);
    expect(rows?.[0]?.status).toBe('done');
  });

  it('keeps the latest 200 snapshots for the project', async () => {
    const env = { DB: createSqliteD1() } as Env;
    const owned = await createProject(env, 'acct_a', { domain: 'alpha.example' });
    if (!owned.ok) throw new Error('project');
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: owned.project.id,
      kind: 'audit',
      measuredAt: 1,
      sourceRef: 'audit-keep',
      signals: freezeSignals({ measurementStatus: 'measured', metric: 'organic_count', score: 7, engines: [], notes: [] }),
    });
    for (let i = 0; i < SNAPSHOT_CAP + 1; i += 1) {
      await recordProjectSnapshot(env, 'acct_a', {
        projectId: owned.project.id,
        kind: 'keyword',
        measuredAt: 10_000 + i,
        sourceRef: `kw-${i}`,
        signals: freezeSignals({ measurementStatus: 'measured', metric: 'keyword_volume', score: i, engines: [], notes: [] }),
      });
    }
    const count = await env.DB!.prepare(
      `SELECT COUNT(*) AS n FROM project_measurement_snapshots WHERE account_id = ?`,
    )
      .bind('acct_a')
      .first<{ n: number }>();
    const oldest = await env.DB!.prepare(
      `SELECT source_ref FROM project_measurement_snapshots WHERE account_id = ? AND source_ref = ?`,
    )
      .bind('acct_a', 'kw-0')
      .first<{ source_ref: string }>();
    expect(count).toEqual({ n: SNAPSHOT_CAP + 1 });
    expect(oldest).toBeNull();
    const keptAudit = await env.DB!.prepare(
      `SELECT source_ref FROM project_measurement_snapshots WHERE account_id = ? AND source_ref = ?`,
    )
      .bind('acct_a', 'audit-keep')
      .first<{ source_ref: string }>();
    expect(keptAudit).toEqual({ source_ref: 'audit-keep' });
  });

  it('compares the last two audits even when newer keyword checks fill the page', async () => {
    const env = { DB: createSqliteD1() } as Env;
    const owned = await createProject(env, 'acct_a', { domain: 'alpha.example' });
    if (!owned.ok) throw new Error('project');
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: owned.project.id,
      kind: 'audit',
      measuredAt: 1,
      sourceRef: 'audit-old',
      signals: freezeSignals({ measurementStatus: 'measured', metric: 'organic_count', score: 10, engines: [], notes: [] }),
    });
    await recordProjectSnapshot(env, 'acct_a', {
      projectId: owned.project.id,
      kind: 'audit',
      measuredAt: 2,
      sourceRef: 'audit-new',
      signals: freezeSignals({ measurementStatus: 'measured', metric: 'organic_count', score: 20, engines: [], notes: [] }),
    });
    for (let i = 0; i < 60; i += 1) {
      await recordProjectSnapshot(env, 'acct_a', {
        projectId: owned.project.id,
        kind: 'keyword',
        measuredAt: 100 + i,
        sourceRef: `kw-page-${i}`,
        signals: freezeSignals({ measurementStatus: 'measured', metric: 'keyword_volume', score: i, engines: [], notes: [] }),
      });
    }
    const history = await getProjectHistory(env, 'acct_a', owned.project.id, 10);
    expect(history?.snapshots).toHaveLength(10);
    expect(history?.snapshots.every((row) => row.kind === 'keyword')).toBe(true);
    expect(history?.trends.find((row) => row.kind === 'audit')).toMatchObject({
      latestScore: 20,
      latestDelta: { scoreDelta: 10, label: 'measured' },
    });
  });
});

describe('project history http and mcp', () => {
  it('lists the history tools and hides another account project', async () => {
    expect(listMcpToolCatalogue().map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'get_project_history',
        'compare_snapshots',
        'get_project_outcomes',
        'mark_project_action_done',
      ]),
    );

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

    const created = await call(501, '10.30.0.1', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create_project', arguments: { domain: 'alpha.example', name: 'Alpha' } },
    });
    const createdBody = (await created.json()) as {
      result?: { structuredContent?: { project?: { id: string } }; isError?: boolean };
    };
    const projectId = createdBody.result?.structuredContent?.project?.id || '';
    expect(projectId).toMatch(/^proj_/);

    await recordProjectSnapshot(env, '501', {
      projectId,
      kind: 'instant_audit',
      measuredAt: 5_000,
      sourceRef: 'audit-http',
      signals: freezeSignals({ measurementStatus: 'measured', metric: 'citation_rate', score: 62, engines: [], notes: [] }),
    });

    const own = await worker.fetch(
      new Request(`https://luminarasuite.com/api/projects/${projectId}/history`, {
        headers: tgHeaders(501, '10.30.0.2'),
      }),
      env,
      ctx,
    );
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as { history?: { snapshots?: Array<{ signals: { score: number | null } }> } };
    expect(ownBody.history?.snapshots?.[0]?.signals.score).toBe(62);

    const stranger = await worker.fetch(
      new Request(`https://luminarasuite.com/api/projects/${projectId}/history`, {
        headers: tgHeaders(502, '10.30.0.3'),
      }),
      env,
      ctx,
    );
    expect(stranger.status).toBe(404);
    expect(await stranger.json()).toEqual({ ok: false, error: 'Project not found' });

    const strangerOutcomes = await worker.fetch(
      new Request(`https://luminarasuite.com/api/projects/${projectId}/outcomes`, {
        headers: tgHeaders(502, '10.30.0.4'),
      }),
      env,
      ctx,
    );
    expect(strangerOutcomes.status).toBe(404);

    const mcp = await call(501, '10.30.0.5', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_project_history', arguments: { projectId } },
    });
    const mcpBody = (await mcp.json()) as {
      result?: {
        isError?: boolean;
        content?: Array<{ text?: string }>;
        structuredContent?: { history?: { snapshots?: Array<{ signals: { score: number | null } }> } };
      };
    };
    expect(mcpBody.result?.isError ?? false).toBe(false);
    expect(mcpBody.result?.content?.[0]?.text).toBe(
      'instant_audit: 62. Too little data to measure lift.',
    );
    expect(mcpBody.result?.structuredContent?.history?.snapshots?.[0]?.signals.score).toBe(62);

    const denied = await call(502, '10.30.0.6', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_project_history', arguments: { projectId } },
    });
    const deniedBody = (await denied.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(deniedBody.result?.isError).toBe(true);
    expect(deniedBody.result?.content?.[0]?.text).toBe('Project not found');
  });
});
