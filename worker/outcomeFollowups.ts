/**
 * Schedules a 30, 60 and 90 day re-check when an action is recorded, and
 * runs due rows from the daily cron. A delta is stored only when the
 * follow-up measured the same series as the baseline.
 * shortcut: citation rate, keyword volume and citation-watch share use a later
 * stored snapshot or Not measured. Re-run those live when a Worker entry point
 * exists that does not estimate.
 */
import type { Env } from './env';
import { dataForSeoPost } from './dataForSeoClient';
import { getProject } from './projectService';
import { recordProjectSnapshot } from './projectHistoryService';
import { fetchProjectPage, readProjectSite, type MonitorPageRead } from './projectMonitor';
import { meterDailyUse } from './securityHardening';
import { dfsFirstResult } from '../services/tools/dfsParse';
import { entitlementsFor } from '../services/plans/planEntitlements';
import {
  freezeSignals,
  isSnapshotKind,
  isSnapshotMetric,
  parseSignals,
  type SnapshotKind,
  type SnapshotMetric,
} from '../services/history/snapshotCompare';
import type { MeasuredSnapshot } from '../services/history/snapshotCapture';
import {
  OUTCOME_DAY_MS,
  isOutcomeHorizon,
  judgeFollowUp,
  liveCheckForMetric,
  type OutcomeFollowUpView,
} from '../services/history/outcomeFollowUp';
import {
  measureRealEstate,
  realEstateCoverage,
} from '../services/audit/realEstateChecks';

export const OUTCOME_FOLLOWUP_TICK_CAP = 12;
export const OUTCOME_FOLLOWUP_DAILY_CAP = 6;
export const OUTCOME_FOLLOWUP_MAX_ATTEMPTS = 3;
const BUDGET_MS = 20_000;
const BATCH = 4;
const CONCURRENCY = 4;
const METER_PREFIX = 'outcome-followup';
const SNAPSHOT_SCAN = 200;

export type OrganicMeasure = (domain: string) => Promise<{ ok: true; count: number | null } | { ok: false }>;

export type OutcomeFollowUpTickDeps = {
  now?: number;
  read?: MonitorPageRead;
  measureOrganic?: OrganicMeasure;
  budgetMs?: number;
  startedAt?: number;
};

type PlanAccess = { known: true; apiAccess: boolean } | { known: false };

type FollowUpRow = {
  id: string;
  outcome_id: string;
  horizon_days: number;
  due_at: number;
  status: string;
  before_value: number | null;
  after_value: number | null;
  delta: number | null;
  source_ref: string;
  baseline_measured_at: number | null;
  measured_at: number | null;
  judged_at: number | null;
  note: string;
  followup_snapshot_id?: string | null;
};

type DueRow = {
  id: string;
  account_id: string;
  project_id: string;
  outcome_id: string;
  horizon_days: number;
  due_at: number;
  attempts: number;
};

type Baseline = {
  id: string;
  kind: SnapshotKind;
  metric: SnapshotMetric;
  subject: string;
  score: number;
  measuredAt: number;
};

type LiveResult =
  | { kind: 'measured'; score: number; subject: string; notes: string[] }
  | { kind: 'empty' }
  | { kind: 'failed' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function organicCountFromDfs(body: unknown): number | null {
  const result = dfsFirstResult(body);
  if (isRecord(result) && result._dfsTaskError === true) return null;
  const row = Array.isArray(result) ? (isRecord(result[0]) ? result[0] : null) : isRecord(result) ? result : null;
  if (!row) return null;
  const metrics = isRecord(row.metrics) ? row.metrics : row;
  const organic = isRecord(metrics.organic) ? metrics.organic : metrics;
  return finiteNumber(organic.count);
}

async function readAccountPlan(env: Env, accountId: string): Promise<{ known: true; plan: string } | { known: false }> {
  if (!env.LUMINARA_KV) return { known: false };
  try {
    const sub: unknown = await env.LUMINARA_KV.get(`sub:${accountId}`, 'json');
    if (!isRecord(sub)) return { known: true, plan: 'free' };
    const expiresAt = finiteNumber(sub.expiresAt);
    if (expiresAt === null || expiresAt <= Date.now()) return { known: true, plan: 'free' };
    return { known: true, plan: typeof sub.plan === 'string' ? sub.plan : 'free' };
  } catch {
    return { known: false };
  }
}

function viewFromRow(row: FollowUpRow): OutcomeFollowUpView | null {
  if (!isOutcomeHorizon(row.horizon_days)) return null;
  if (row.status !== 'pending' && row.status !== 'measured' && row.status !== 'not_measured') return null;
  const before = typeof row.before_value === 'number' ? row.before_value : null;
  const after = typeof row.after_value === 'number' ? row.after_value : null;
  const delta = typeof row.delta === 'number' ? row.delta : null;
  const measured =
    row.status === 'measured' &&
    before !== null &&
    after !== null &&
    delta !== null &&
    !!row.followup_snapshot_id &&
    !!row.source_ref &&
    typeof row.measured_at === 'number' &&
    typeof row.baseline_measured_at === 'number';
  const status = row.status === 'pending' ? 'pending' : measured ? 'measured' : 'not_measured';
  return {
    id: row.id,
    outcomeId: row.outcome_id,
    horizonDays: row.horizon_days,
    status,
    dueAt: row.due_at,
    beforeValue: before,
    afterValue: status === 'measured' ? after : null,
    delta: status === 'measured' ? delta : null,
    source: status === 'measured' ? row.source_ref : '',
    baselineMeasuredAt: typeof row.baseline_measured_at === 'number' ? row.baseline_measured_at : null,
    measuredAt: status === 'measured' && typeof row.measured_at === 'number' ? row.measured_at : null,
    judgedAt: typeof row.judged_at === 'number' ? row.judged_at : null,
    note: status === 'not_measured' ? 'Not measured' : '',
  };
}

export async function attachOutcomeFollowUps<T extends { id: string }>(
  env: Env,
  accountId: string,
  projectId: string,
  outcomes: T[],
): Promise<Array<T & { followUps: OutcomeFollowUpView[] }>> {
  const empty = outcomes.map((outcome) => ({ ...outcome, followUps: [] as OutcomeFollowUpView[] }));
  const db = env.DB;
  if (!db || outcomes.length === 0) return empty;
  const ids = outcomes.map((outcome) => outcome.id);
  const res = await db
    .prepare(
      `SELECT id, outcome_id, horizon_days, due_at, status, before_value, after_value, delta,
              source_ref, baseline_measured_at, measured_at, judged_at, note, followup_snapshot_id
       FROM project_outcome_followups
       WHERE account_id = ? AND project_id = ? AND outcome_id IN (${ids.map(() => '?').join(', ')})
       ORDER BY horizon_days ASC`,
    )
    .bind(accountId, projectId, ...ids)
    .all<FollowUpRow>();
  const byOutcome = new Map<string, OutcomeFollowUpView[]>();
  for (const row of res.results || []) {
    const view = viewFromRow(row);
    if (!view) continue;
    const list = byOutcome.get(view.outcomeId) ?? [];
    list.push(view);
    byOutcome.set(view.outcomeId, list);
  }
  return outcomes.map((outcome) => ({ ...outcome, followUps: byOutcome.get(outcome.id) ?? [] }));
}

async function deferRow(env: Env, row: DueRow, now: number): Promise<void> {
  await env.DB!.prepare(
    `UPDATE project_outcome_followups SET due_at = ?, updated_at = ?
     WHERE id = ? AND account_id = ? AND status = 'pending' AND due_at <= ?`,
  )
    .bind(now + OUTCOME_DAY_MS, now, row.id, row.account_id, now)
    .run();
}

async function closeNotMeasured(env: Env, row: DueRow, baseline: Baseline | null, now: number): Promise<void> {
  await env.DB!.prepare(
    `UPDATE project_outcome_followups
     SET status = 'not_measured',
         before_value = ?,
         baseline_snapshot_id = ?,
         baseline_measured_at = ?,
         after_value = NULL,
         delta = NULL,
         followup_snapshot_id = NULL,
         measured_at = NULL,
         judged_at = ?,
         source_ref = 'not_measured',
         note = 'Not measured',
         updated_at = ?
     WHERE id = ? AND account_id = ? AND status = 'pending'`,
  )
    .bind(
      baseline ? baseline.score : null,
      baseline ? baseline.id : null,
      baseline ? baseline.measuredAt : null,
      now,
      now,
      row.id,
      row.account_id,
    )
    .run();
}

async function closeMeasured(
  env: Env,
  row: DueRow,
  baseline: Baseline,
  after: { score: number; delta: number; snapshotId: string; source: string; measuredAt: number },
  now: number,
): Promise<void> {
  await env.DB!.prepare(
    `UPDATE project_outcome_followups
     SET status = 'measured',
         before_value = ?,
         after_value = ?,
         delta = ?,
         baseline_snapshot_id = ?,
         baseline_measured_at = ?,
         followup_snapshot_id = ?,
         measured_at = ?,
         judged_at = ?,
         source_ref = ?,
         note = '',
         updated_at = ?
     WHERE id = ? AND account_id = ? AND status = 'pending'`,
  )
    .bind(
      baseline.score,
      after.score,
      after.delta,
      baseline.id,
      baseline.measuredAt,
      after.snapshotId,
      after.measuredAt,
      now,
      after.source,
      now,
      row.id,
      row.account_id,
    )
    .run();
}

async function loadBaseline(env: Env, row: DueRow): Promise<Baseline | null> {
  const db = env.DB!;
  const outcome = await db
    .prepare(
      `SELECT kind, metric, before_snapshot_id FROM project_action_outcomes
       WHERE account_id = ? AND project_id = ? AND id = ?`,
    )
    .bind(row.account_id, row.project_id, row.outcome_id)
    .first<{ kind: string; metric: string; before_snapshot_id: string | null }>();
  if (!outcome?.before_snapshot_id || !isSnapshotKind(outcome.kind) || !isSnapshotMetric(outcome.metric)) return null;
  const snap = await db
    .prepare(
      `SELECT id, kind, measured_at, source_ref, signals_json FROM project_measurement_snapshots
       WHERE account_id = ? AND project_id = ? AND id = ?`,
    )
    .bind(row.account_id, row.project_id, outcome.before_snapshot_id)
    .first<{ id: string; kind: string; measured_at: number; source_ref: string; signals_json: string }>();
  if (!snap || !isSnapshotKind(snap.kind) || snap.kind !== outcome.kind) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(snap.signals_json);
  } catch {
    parsed = null;
  }
  const signals = parseSignals(parsed);
  if (signals.metric !== outcome.metric || signals.score === null) return null;
  return {
    id: snap.id,
    kind: snap.kind,
    metric: signals.metric,
    subject: signals.subject,
    score: signals.score,
    measuredAt: snap.measured_at,
  };
}

async function findLaterSnapshot(
  env: Env,
  row: DueRow,
  baseline: Baseline,
): Promise<{ id: string; score: number; measuredAt: number; source: string } | null> {
  const res = await env.DB!.prepare(
    `SELECT id, kind, measured_at, source_ref, signals_json FROM project_measurement_snapshots
     WHERE account_id = ? AND project_id = ? AND kind = ?
     ORDER BY measured_at ASC LIMIT ?`,
  )
    .bind(row.account_id, row.project_id, baseline.kind, SNAPSHOT_SCAN)
    .all<{ id: string; kind: string; measured_at: number; source_ref: string; signals_json: string }>();
  for (const snap of res.results || []) {
    if (snap.id === baseline.id || snap.measured_at < row.due_at || !snap.source_ref || snap.source_ref.startsWith('followup:')) {
      continue;
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(snap.signals_json);
    } catch {
      parsed = null;
    }
    const signals = parseSignals(parsed);
    if (signals.metric !== baseline.metric || signals.subject !== baseline.subject || signals.score === null) continue;
    return { id: snap.id, score: signals.score, measuredAt: snap.measured_at, source: snap.source_ref };
  }
  return null;
}

async function finishFromStored(
  env: Env,
  row: DueRow,
  baseline: Baseline,
  now: number,
): Promise<void> {
  const stored = await findLaterSnapshot(env, row, baseline);
  if (!stored) {
    await closeNotMeasured(env, row, baseline, now);
    return;
  }
  const judged = judgeFollowUp(baseline.score, stored.score, true);
  if (judged.status !== 'measured') {
    await closeNotMeasured(env, row, baseline, now);
    return;
  }
  await closeMeasured(
    env,
    row,
    baseline,
    { score: judged.after, delta: judged.delta, snapshotId: stored.id, source: stored.source, measuredAt: stored.measuredAt },
    now,
  );
}

async function remeasureCoverage(domain: string, read: MonitorPageRead): Promise<LiveResult> {
  const pages = await readProjectSite(domain, read);
  if (pages.length === 0) return { kind: 'failed' };
  const coverage = realEstateCoverage(measureRealEstate(pages).checks);
  if (coverage.measurementStatus !== 'measured' || coverage.score === null) return { kind: 'empty' };
  return { kind: 'measured', score: coverage.score, subject: coverage.series, notes: coverage.notes };
}

async function remeasureOrganic(
  env: Env,
  domain: string,
  locationCode: number,
  languageCode: string,
  deps: OutcomeFollowUpTickDeps,
): Promise<LiveResult> {
  if (deps.measureOrganic) {
    try {
      const result = await deps.measureOrganic(domain);
      if (!result.ok) return { kind: 'failed' };
      if (result.count === null) return { kind: 'empty' };
      return { kind: 'measured', score: result.count, subject: '', notes: [] };
    } catch {
      return { kind: 'failed' };
    }
  }
  const res = await dataForSeoPost(
    env,
    '/v3/dataforseo_labs/google/domain_rank_overview/live',
    [{ target: domain, location_code: locationCode, language_code: languageCode }],
    { timeoutMs: 8_000 },
  );
  if (!res.ok) return { kind: 'failed' };
  const count = organicCountFromDfs(res.body);
  if (count === null) return { kind: 'empty' };
  return { kind: 'measured', score: count, subject: '', notes: [] };
}

async function claimRow(env: Env, row: DueRow, now: number): Promise<boolean> {
  const claimed = await env.DB!.prepare(
    `UPDATE project_outcome_followups
     SET attempts = attempts + 1, due_at = ?, updated_at = ?
     WHERE id = ? AND account_id = ? AND status = 'pending' AND due_at <= ? AND attempts < ?`,
  )
    .bind(now + OUTCOME_DAY_MS, now, row.id, row.account_id, now, OUTCOME_FOLLOWUP_MAX_ATTEMPTS)
    .run();
  return Number(claimed.meta?.changes ?? 0) === 1;
}

async function saveLiveSnapshot(
  env: Env,
  row: DueRow,
  baseline: Baseline,
  score: number,
  notes: string[],
  now: number,
): Promise<string | null> {
  const event: MeasuredSnapshot = {
    projectId: row.project_id,
    kind: baseline.kind,
    measuredAt: now,
    sourceRef: `followup:${row.id}`,
    signals: freezeSignals({
      measurementStatus: 'measured',
      metric: baseline.metric,
      subject: baseline.subject,
      score,
      engines: [],
      notes,
    }),
  };
  const saved = await recordProjectSnapshot(env, row.account_id, event, now);
  return saved?.id ?? null;
}

async function settleOne(
  env: Env,
  row: DueRow,
  now: number,
  deps: OutcomeFollowUpTickDeps,
  plans: Map<string, PlanAccess>,
): Promise<void> {
  let access = plans.get(row.account_id);
  if (!access) {
    const read = await readAccountPlan(env, row.account_id);
    access = read.known ? { known: true, apiAccess: entitlementsFor(read.plan).apiAccess } : { known: false };
    plans.set(row.account_id, access);
  }
  if (!access.known) {
    await deferRow(env, row, now);
    return;
  }
  const baseline = await loadBaseline(env, row);
  if (!baseline) {
    await closeNotMeasured(env, row, null, now);
    return;
  }
  if (!isOutcomeHorizon(row.horizon_days)) {
    await closeNotMeasured(env, row, baseline, now);
    return;
  }
  const live = liveCheckForMetric(baseline.metric, access.apiAccess);
  if (live === 'none') {
    await finishFromStored(env, row, baseline, now);
    return;
  }
  if (live === 'paid' && baseline.subject !== '') {
    await closeNotMeasured(env, row, baseline, now);
    return;
  }
  if (row.attempts >= OUTCOME_FOLLOWUP_MAX_ATTEMPTS) {
    await finishFromStored(env, row, baseline, now);
    return;
  }
  const meter = await meterDailyUse(env, METER_PREFIX, row.account_id, OUTCOME_FOLLOWUP_DAILY_CAP, 'Outcome follow-up');
  if (!meter.ok) {
    await deferRow(env, row, now);
    return;
  }
  const attempts = row.attempts + 1;
  if (!(await claimRow(env, row, now))) return;
  const project = await getProject(env, row.account_id, row.project_id);
  if (!project) {
    await closeNotMeasured(env, row, baseline, now);
    return;
  }
  const domain = project.domain.replace(/^www\./, '');
  const result =
    live === 'public'
      ? await remeasureCoverage(domain, deps.read ?? fetchProjectPage)
      : await remeasureOrganic(
          env,
          domain,
          Number(project.defaultLocationCode) || 2840,
          project.defaultLanguageCode || 'en',
          deps,
        );
  if (result.kind === 'failed') {
    if (attempts >= OUTCOME_FOLLOWUP_MAX_ATTEMPTS) await finishFromStored(env, row, baseline, now);
    return;
  }
  if (result.kind === 'empty') {
    await closeNotMeasured(env, row, baseline, now);
    return;
  }
  const storedSubject = freezeSignals({
    measurementStatus: 'measured',
    metric: baseline.metric,
    subject: result.subject,
    score: result.score,
    engines: [],
    notes: result.notes,
  }).subject;
  const judged = judgeFollowUp(baseline.score, result.score, storedSubject === baseline.subject);
  if (judged.status !== 'measured') {
    await closeNotMeasured(env, row, baseline, now);
    return;
  }
  const snapshotId = await saveLiveSnapshot(env, row, baseline, judged.after, result.notes, now);
  if (!snapshotId) {
    if (attempts >= OUTCOME_FOLLOWUP_MAX_ATTEMPTS) await closeNotMeasured(env, row, baseline, now);
    return;
  }
  await closeMeasured(
    env,
    row,
    baseline,
    {
      score: judged.after,
      delta: judged.delta,
      snapshotId,
      source: `followup:${row.id}`,
      measuredAt: now,
    },
    now,
  );
}

async function runPool(rows: DueRow[], run: (row: DueRow) => Promise<void>): Promise<void> {
  const queue = [...rows];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const row = queue.shift();
      if (!row) return;
      try {
        await run(row);
      } catch (err) {
        console.error('[outcome-followup] row failed', err instanceof Error ? err.name : 'error');
      }
    }
  });
  await Promise.all(workers);
}

export async function runOutcomeFollowUpTick(
  env: Env,
  deps: OutcomeFollowUpTickDeps = {},
): Promise<{ checked: number; skipped: 'no_db' | null }> {
  if (!env.DB) return { checked: 0, skipped: 'no_db' };
  const now = deps.now ?? Date.now();
  const started = deps.startedAt ?? Date.now();
  const budget = deps.budgetMs ?? BUDGET_MS;
  const plans = new Map<string, PlanAccess>();
  let checked = 0;
  const seen: string[] = [];
  let first = true;
  while ((first || Date.now() - started < budget) && checked < OUTCOME_FOLLOWUP_TICK_CAP) {
    first = false;
    const room = Math.min(BATCH, OUTCOME_FOLLOWUP_TICK_CAP - checked);
    const exclude = seen.length > 0 ? ` AND id NOT IN (${seen.map(() => '?').join(', ')})` : '';
    const due = await env.DB.prepare(
      `SELECT id, account_id, project_id, outcome_id, horizon_days, due_at, attempts
       FROM project_outcome_followups
       WHERE status = 'pending' AND due_at <= ?${exclude}
       ORDER BY due_at ASC, id ASC LIMIT ?`,
    )
      .bind(...(seen.length > 0 ? [now, ...seen, room] : [now, room]))
      .all<DueRow>();
    const rows = due.results || [];
    if (rows.length === 0) break;
    seen.push(...rows.map((row) => row.id));
    await runPool(rows, (row) => settleOne(env, row, now, deps, plans));
    checked += rows.length;
  }
  return { checked, skipped: null };
}
