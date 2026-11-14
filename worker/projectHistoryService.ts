/**
 * Account-scoped project history. Every read and write filters on account_id.
 * shortcut: keep the latest 200 snapshots of each kind per project, upgrade when a plan defines retention days.
 * The insert and that delete share one batch, so a failed trim rolls the new row back.
 */
import type { Env } from './env';
import { findProjectByDomain, getProject } from './projectService';
import { randomId } from '../services/projects/projectUtils';
import type { MeasuredSnapshot } from '../services/history/snapshotCapture';
import {
  compareSnapshots,
  isSnapshotKind,
  isSnapshotMetric,
  metricForKind,
  outcomeLift,
  parseSignals,
  trendsFromSnapshots,
  type CompareLabel,
  type SnapshotDelta,
  type SnapshotKind,
  type SnapshotMetric,
  type SnapshotPoint,
  type SnapshotSignals,
  type SnapshotTrend,
} from '../services/history/snapshotCompare';
import { OUTCOME_HORIZONS, followUpDueAt } from '../services/history/outcomeFollowUp';

export const SNAPSHOT_CAP = 200;
export const HISTORY_RETENTION_NOTE =
  'History keeps the latest 200 checks of each kind per project. Plan retention is not set.';

export type HistorySnapshot = SnapshotPoint;

export type ProjectHistory = {
  projectId: string;
  retentionNote: string;
  snapshots: HistorySnapshot[];
  trends: SnapshotTrend[];
};

export type OutcomeStatus = 'recommended' | 'done' | 'detected';

export type ProjectOutcome = {
  id: string;
  projectId: string;
  actionKey: string;
  title: string;
  kind: SnapshotKind;
  metric: SnapshotMetric;
  status: OutcomeStatus;
  beforeValue: number | null;
  afterValue: number | null;
  lift: number | null;
  dataLabel: CompareLabel;
  recommendedAt: number;
  resolvedAt: number | null;
};

type SnapshotRow = {
  id: string;
  kind: string;
  measured_at: number;
  signals_json: string;
};

type OutcomeRow = {
  id: string;
  project_id: string;
  action_key: string;
  title: string;
  kind: string;
  metric: string;
  status: string;
  before_value: number | null;
  after_value: number | null;
  lift: number | null;
  data_label: string;
  recommended_at: number;
  resolved_at: number | null;
};

function dbOf(env: Env) {
  return env.DB ?? null;
}

function pointFromRow(row: SnapshotRow): SnapshotPoint | null {
  if (!isSnapshotKind(row.kind)) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.signals_json);
  } catch {
    parsed = null;
  }
  return {
    id: row.id,
    kind: row.kind,
    measuredAt: row.measured_at,
    signals: parseSignals(parsed),
  };
}

const SCHEDULE_FOLLOWUP_SQL = `INSERT INTO project_outcome_followups (
  id, account_id, project_id, outcome_id, horizon_days, due_at, status, attempts,
  baseline_snapshot_id, before_value, baseline_measured_at, source_ref, note, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, '', '', ?, ?)
ON CONFLICT(account_id, outcome_id, horizon_days) DO UPDATE SET
  baseline_snapshot_id = COALESCE(project_outcome_followups.baseline_snapshot_id, excluded.baseline_snapshot_id),
  before_value = COALESCE(project_outcome_followups.before_value, excluded.before_value),
  baseline_measured_at = COALESCE(project_outcome_followups.baseline_measured_at, excluded.baseline_measured_at),
  updated_at = excluded.updated_at
WHERE project_outcome_followups.status = 'pending'`;

async function scheduleFollowUps(env: Env, accountId: string, projectId: string, outcomeId: string): Promise<void> {
  try {
    await insertFollowUps(env, accountId, projectId, outcomeId);
  } catch (err) {
    console.error('[outcome-followup] schedule failed', err instanceof Error ? err.name : 'error');
  }
}

async function insertFollowUps(env: Env, accountId: string, projectId: string, outcomeId: string): Promise<void> {
  const db = dbOf(env);
  if (!db) return;
  const outcome = await db
    .prepare(
      `SELECT recommended_at, before_snapshot_id, before_value
       FROM project_action_outcomes WHERE account_id = ? AND project_id = ? AND id = ?`,
    )
    .bind(accountId, projectId, outcomeId)
    .first<{ recommended_at: number; before_snapshot_id: string | null; before_value: number | null }>();
  if (!outcome || !Number.isFinite(outcome.recommended_at)) return;
  let baselineMeasuredAt: number | null = null;
  if (outcome.before_snapshot_id) {
    const snap = await db
      .prepare(
        `SELECT measured_at FROM project_measurement_snapshots
         WHERE account_id = ? AND project_id = ? AND id = ?`,
      )
      .bind(accountId, projectId, outcome.before_snapshot_id)
      .first<{ measured_at: number }>();
    baselineMeasuredAt = snap && Number.isFinite(snap.measured_at) ? snap.measured_at : null;
  }
  const now = Date.now();
  const before = typeof outcome.before_value === 'number' ? outcome.before_value : null;
  await db.batch(
    OUTCOME_HORIZONS.map((horizon) =>
      db.prepare(SCHEDULE_FOLLOWUP_SQL).bind(
        randomId('fol'),
        accountId,
        projectId,
        outcomeId,
        horizon,
        followUpDueAt(outcome.recommended_at, horizon),
        outcome.before_snapshot_id,
        before,
        baselineMeasuredAt,
        now,
        now,
      ),
    ),
  );
}

function outcomeFromRow(row: OutcomeRow): ProjectOutcome | null {
  if (!isSnapshotKind(row.kind)) return null;
  const status: OutcomeStatus =
    row.status === 'done' || row.status === 'detected' ? row.status : 'recommended';
  return {
    id: row.id,
    projectId: row.project_id,
    actionKey: row.action_key,
    title: row.title,
    kind: row.kind,
    metric: isSnapshotMetric(row.metric) ? row.metric : 'none',
    status,
    beforeValue: typeof row.before_value === 'number' ? row.before_value : null,
    afterValue: typeof row.after_value === 'number' ? row.after_value : null,
    lift: typeof row.lift === 'number' ? row.lift : null,
    dataLabel: row.data_label === 'measured' ? 'measured' : 'too_little_data',
    recommendedAt: row.recommended_at,
    resolvedAt: typeof row.resolved_at === 'number' ? row.resolved_at : null,
  };
}

async function ownedProject(env: Env, accountId: string, projectId: string) {
  return getProject(env, accountId, projectId);
}

export async function recordProjectSnapshot(
  env: Env,
  accountId: string,
  event: MeasuredSnapshot,
  now = Date.now(),
  options?: { replace?: boolean },
): Promise<{ id: string } | null> {
  const db = dbOf(env);
  if (!db) return null;
  if (!event.sourceRef.trim() || !Number.isFinite(event.measuredAt)) return null;
  const project = await ownedProject(env, accountId, event.projectId);
  if (!project) return null;
  const signals: SnapshotSignals = event.signals;
  const existing = await db
    .prepare(
      `SELECT id FROM project_measurement_snapshots
       WHERE account_id = ? AND project_id = ? AND kind = ? AND source_ref = ?`,
    )
    .bind(accountId, event.projectId, event.kind, event.sourceRef)
    .first<{ id: string }>();
  if (existing?.id) {
    if (options?.replace) {
      await db
        .prepare(
          `UPDATE project_measurement_snapshots
           SET signals_json = ?
           WHERE account_id = ? AND project_id = ? AND id = ?`,
        )
        .bind(JSON.stringify(signals), accountId, event.projectId, existing.id)
        .run();
    }
    return { id: existing.id };
  }

  const id = randomId('snap');
  const score = signals.score;
  const insert = db
    .prepare(
      `INSERT INTO project_measurement_snapshots
        (id, account_id, project_id, kind, measured_at, source_ref, signals_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, project_id, kind, source_ref) DO NOTHING`,
    )
    .bind(
      id,
      accountId,
      event.projectId,
      event.kind,
      event.measuredAt,
      event.sourceRef,
      JSON.stringify(signals),
      now,
    );
  const trim = db
    .prepare(
      `DELETE FROM project_measurement_snapshots
       WHERE account_id = ? AND project_id = ? AND kind = ?
         AND id NOT IN (
           SELECT id FROM project_measurement_snapshots
           WHERE account_id = ? AND project_id = ? AND kind = ?
           ORDER BY measured_at DESC, created_at DESC, id DESC
           LIMIT ?
         )`,
    )
    .bind(accountId, event.projectId, event.kind, accountId, event.projectId, event.kind, SNAPSHOT_CAP);
  const canScore = score !== null && signals.metric !== 'none';
  await db.batch(
    canScore
      ? [
          insert,
          trim,
          db
            .prepare(
              `UPDATE project_action_outcomes
               SET after_snapshot_id = ?,
                   after_value = ?,
                   lift = CASE WHEN before_value IS NOT NULL THEN (? - before_value) ELSE NULL END,
                   data_label = CASE WHEN before_value IS NOT NULL THEN 'measured' ELSE 'too_little_data' END,
                   status = CASE WHEN before_value IS NOT NULL THEN 'detected' ELSE status END,
                   resolved_at = CASE WHEN before_value IS NOT NULL THEN ? ELSE resolved_at END
               WHERE account_id = ? AND project_id = ? AND kind = ? AND metric = ? AND subject = ? AND status = 'recommended'
                 AND before_snapshot_id IS NOT NULL
                 AND before_snapshot_id != ?
                 AND recommended_at < ?
                 AND EXISTS (
                   SELECT 1 FROM project_measurement_snapshots AS saved
                   WHERE saved.id = ?
                     AND saved.account_id = project_action_outcomes.account_id
                     AND saved.project_id = project_action_outcomes.project_id
                 )`,
            )
            .bind(
              id,
              score,
              score,
              now,
              accountId,
              event.projectId,
              event.kind,
              signals.metric,
              signals.subject,
              id,
              event.measuredAt,
              id,
            ),
          db
            .prepare(
              `UPDATE project_action_outcomes
               SET before_snapshot_id = ?, before_value = ?, subject = ?
               WHERE account_id = ? AND project_id = ? AND kind = ? AND metric = ? AND status = 'recommended'
                 AND before_snapshot_id IS NULL
                 AND EXISTS (
                   SELECT 1 FROM project_measurement_snapshots AS saved
                   WHERE saved.id = ?
                     AND saved.account_id = project_action_outcomes.account_id
                     AND saved.project_id = project_action_outcomes.project_id
                 )`,
            )
            .bind(id, score, signals.subject, accountId, event.projectId, event.kind, signals.metric, id),
        ]
      : [insert, trim],
  );
  const stored = await db
    .prepare(
      `SELECT id FROM project_measurement_snapshots
       WHERE account_id = ? AND project_id = ? AND kind = ? AND source_ref = ?`,
    )
    .bind(accountId, event.projectId, event.kind, event.sourceRef)
    .first<{ id: string }>();
  if (!stored?.id) return null;
  return { id: stored.id };
}

export async function mirrorProjectSnapshot(
  env: Env,
  accountId: string,
  event: MeasuredSnapshot,
): Promise<void> {
  try {
    await recordProjectSnapshot(env, accountId, event);
  } catch (err) {
    console.error('[project-history] snapshot failed', err instanceof Error ? err.name : 'error');
  }
}

export async function mirrorSnapshotForDomain(
  env: Env,
  accountId: string,
  domain: string,
  build: (projectId: string) => MeasuredSnapshot,
  options?: { clientId?: string | null; replace?: boolean },
): Promise<void> {
  try {
    const project = await findProjectByDomain(env, accountId, domain, options?.clientId);
    if (!project) return;
    await recordProjectSnapshot(env, accountId, build(project.id), Date.now(), { replace: options?.replace });
  } catch (err) {
    console.error('[project-history] snapshot failed', err instanceof Error ? err.name : 'error');
  }
}

export async function getProjectHistory(
  env: Env,
  accountId: string,
  projectId: string,
  limit = 50,
): Promise<ProjectHistory | null> {
  const db = dbOf(env);
  if (!db) return null;
  const project = await ownedProject(env, accountId, projectId);
  if (!project) return null;
  const capped = Math.min(Math.max(Math.floor(limit) || 50, 1), SNAPSHOT_CAP);
  const res = await db
    .prepare(
      `SELECT id, kind, measured_at, signals_json
       FROM project_measurement_snapshots
       WHERE account_id = ? AND project_id = ?
       ORDER BY measured_at DESC
       LIMIT ?`,
    )
    .bind(accountId, projectId, SNAPSHOT_CAP * 4)
    .all<SnapshotRow>();
  const stored = (res.results || [])
    .map(pointFromRow)
    .filter((row): row is SnapshotPoint => row !== null);
  return {
    projectId,
    retentionNote: HISTORY_RETENTION_NOTE,
    snapshots: stored.slice(0, capped),
    trends: trendsFromSnapshots(stored),
  };
}

export async function compareProjectSnapshots(
  env: Env,
  accountId: string,
  projectId: string,
  earlierId: string,
  laterId: string,
): Promise<SnapshotDelta | null> {
  const db = dbOf(env);
  if (!db) return null;
  const project = await ownedProject(env, accountId, projectId);
  if (!project) return null;
  const res = await db
    .prepare(
      `SELECT id, kind, measured_at, signals_json
       FROM project_measurement_snapshots
       WHERE account_id = ? AND project_id = ? AND id IN (?, ?)`,
    )
    .bind(accountId, projectId, earlierId, laterId)
    .all<SnapshotRow>();
  const points = (res.results || [])
    .map(pointFromRow)
    .filter((row): row is SnapshotPoint => row !== null);
  const earlier = points.find((row) => row.id === earlierId);
  const later = points.find((row) => row.id === laterId);
  if (!earlier || !later) return null;
  return compareSnapshots(earlier, later);
}

async function latestScoredSnapshot(
  env: Env,
  accountId: string,
  projectId: string,
  kind: SnapshotKind,
  metric: SnapshotMetric,
  subject?: string,
): Promise<{ id: string; score: number; measuredAt: number; subject: string } | null> {
  const db = dbOf(env);
  if (!db) return null;
  const res = await db
    .prepare(
      `SELECT id, kind, measured_at, signals_json
       FROM project_measurement_snapshots
       WHERE account_id = ? AND project_id = ? AND kind = ?
       ORDER BY measured_at DESC
       LIMIT ?`,
    )
    .bind(accountId, projectId, kind, SNAPSHOT_CAP)
    .all<SnapshotRow>();
  for (const row of res.results || []) {
    const point = pointFromRow(row);
    if (
      point &&
      point.signals.metric === metric &&
      point.signals.score !== null &&
      (subject === undefined || point.signals.subject === subject)
    ) {
      return { id: point.id, score: point.signals.score, measuredAt: point.measuredAt, subject: point.signals.subject };
    }
  }
  return null;
}

export async function recordRecommendedAction(
  env: Env,
  input: {
    accountId: string;
    projectId: string;
    actionKey: string;
    title: string;
    kind: SnapshotKind;
    metric?: SnapshotMetric;
    now?: number;
  },
): Promise<ProjectOutcome | null> {
  const db = dbOf(env);
  if (!db) return null;
  const project = await ownedProject(env, input.accountId, input.projectId);
  if (!project) return null;
  const now = input.now ?? Date.now();
  const id = randomId('out');
  const title = input.title.trim().slice(0, 300);
  const actionKey = input.actionKey.trim().slice(0, 128);
  if (!title || !actionKey) return null;
  const metric = input.metric ?? metricForKind(input.kind);
  await db
    .prepare(
      `INSERT INTO project_action_outcomes
        (id, account_id, project_id, action_key, title, kind, metric, status, data_label, recommended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'recommended', 'too_little_data', ?)
       ON CONFLICT(account_id, project_id, action_key) DO NOTHING`,
    )
    .bind(id, input.accountId, input.projectId, actionKey, title, input.kind, metric, now)
    .run();
  const baseline = await latestScoredSnapshot(env, input.accountId, input.projectId, input.kind, metric);
  if (baseline) {
    await db
      .prepare(
        `UPDATE project_action_outcomes
         SET before_snapshot_id = ?, before_value = ?, subject = ?
         WHERE account_id = ? AND project_id = ? AND action_key = ? AND status = 'recommended'
           AND before_snapshot_id IS NULL`,
      )
      .bind(baseline.id, baseline.score, baseline.subject, input.accountId, input.projectId, actionKey)
      .run();
  }
  const row = await db
    .prepare(
      `SELECT id, project_id, action_key, title, kind, metric, status, before_value, after_value, lift, data_label, recommended_at, resolved_at
       FROM project_action_outcomes
       WHERE account_id = ? AND project_id = ? AND action_key = ?`,
    )
    .bind(input.accountId, input.projectId, actionKey)
    .first<OutcomeRow>();
  if (row?.id) await scheduleFollowUps(env, input.accountId, input.projectId, row.id);
  return row ? outcomeFromRow(row) : null;
}

export async function listProjectOutcomes(
  env: Env,
  accountId: string,
  projectId: string,
): Promise<ProjectOutcome[] | null> {
  const db = dbOf(env);
  if (!db) return null;
  const project = await ownedProject(env, accountId, projectId);
  if (!project) return null;
  const res = await db
    .prepare(
      `SELECT id, project_id, action_key, title, kind, metric, status, before_value, after_value, lift, data_label, recommended_at, resolved_at
       FROM project_action_outcomes
       WHERE account_id = ? AND project_id = ?
       ORDER BY recommended_at DESC
       LIMIT 50`,
    )
    .bind(accountId, projectId)
    .all<OutcomeRow>();
  return (res.results || [])
    .map(outcomeFromRow)
    .filter((row): row is ProjectOutcome => row !== null);
}

export async function markActionDone(
  env: Env,
  accountId: string,
  projectId: string,
  actionId: string,
  now = Date.now(),
): Promise<ProjectOutcome | null> {
  const db = dbOf(env);
  if (!db) return null;
  const project = await ownedProject(env, accountId, projectId);
  if (!project) return null;
  const row = await db
    .prepare(
      `SELECT id, project_id, action_key, title, kind, metric, status, before_value, after_value, lift, data_label,
              recommended_at, resolved_at, before_snapshot_id, subject
       FROM project_action_outcomes
       WHERE account_id = ? AND project_id = ? AND id = ?`,
    )
    .bind(accountId, projectId, actionId)
    .first<OutcomeRow & { before_snapshot_id: string | null; subject: string }>();
  if (!row || !isSnapshotKind(row.kind) || !isSnapshotMetric(row.metric)) return null;
  if (row.status === 'done' || row.status === 'detected') return outcomeFromRow(row);
  const later = await latestScoredSnapshot(env, accountId, projectId, row.kind, row.metric, row.subject || '');
  const before = typeof row.before_value === 'number' ? row.before_value : null;
  const after =
    later && later.id !== row.before_snapshot_id && later.measuredAt > row.recommended_at ? later.score : null;
  const judged = outcomeLift(before, after);
  await db
    .prepare(
      `UPDATE project_action_outcomes
       SET status = 'done',
           after_snapshot_id = ?,
           after_value = ?,
           lift = ?,
           data_label = ?,
           resolved_at = ?
       WHERE account_id = ? AND project_id = ? AND id = ? AND status = 'recommended'`,
    )
    .bind(
      after !== null && later ? later.id : null,
      after,
      judged.lift,
      judged.label,
      now,
      accountId,
      projectId,
      actionId,
    )
    .run();
  await scheduleFollowUps(env, accountId, projectId, actionId);
  const saved = await db
    .prepare(
      `SELECT id, project_id, action_key, title, kind, metric, status, before_value, after_value, lift, data_label, recommended_at, resolved_at
       FROM project_action_outcomes
       WHERE account_id = ? AND project_id = ? AND id = ?`,
    )
    .bind(accountId, projectId, actionId)
    .first<OutcomeRow>();
  return saved ? outcomeFromRow(saved) : null;
}
