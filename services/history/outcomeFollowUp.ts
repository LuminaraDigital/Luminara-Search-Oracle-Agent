/**
 * 30, 60 and 90 day follow-ups. A delta exists only when both scores were
 * measured on the same series. Anything else is Not measured.
 */
import { outcomeLift, type SnapshotMetric } from './snapshotCompare';

export const OUTCOME_HORIZONS = [30, 60, 90] as const;
export type OutcomeHorizon = (typeof OUTCOME_HORIZONS)[number];
export const OUTCOME_DAY_MS = 86_400_000;

export type OutcomeFollowUpStatus = 'pending' | 'measured' | 'not_measured';

export type OutcomeFollowUpView = {
  id: string;
  outcomeId: string;
  horizonDays: OutcomeHorizon;
  status: OutcomeFollowUpStatus;
  dueAt: number;
  beforeValue: number | null;
  afterValue: number | null;
  delta: number | null;
  source: string;
  baselineMeasuredAt: number | null;
  measuredAt: number | null;
  judgedAt: number | null;
  note: string;
};

export type FollowUpJudgement =
  | { status: 'measured'; before: number; after: number; delta: number }
  | { status: 'not_measured' };

export type LiveCheck = 'public' | 'paid' | 'none';

export function isOutcomeHorizon(value: number): value is OutcomeHorizon {
  return value === 30 || value === 60 || value === 90;
}

export function followUpDueAt(anchorAt: number, horizonDays: OutcomeHorizon): number {
  return anchorAt + horizonDays * OUTCOME_DAY_MS;
}

/** Public page coverage can be re-read on every plan. Organic count needs Agency apiAccess. */
export function liveCheckForMetric(metric: SnapshotMetric, apiAccess: boolean): LiveCheck {
  if (metric === 're_coverage') return 'public';
  if (metric === 'organic_count' && apiAccess) return 'paid';
  return 'none';
}

export function judgeFollowUp(before: number | null, after: number | null, sameSeries: boolean): FollowUpJudgement {
  if (!sameSeries) return { status: 'not_measured' };
  const lift = outcomeLift(before, after);
  if (lift.label !== 'measured' || lift.lift === null || before === null || after === null) {
    return { status: 'not_measured' };
  }
  return { status: 'measured', before, after, delta: lift.lift };
}

function day(ts: number | null): string {
  if (ts === null || !Number.isFinite(ts)) return '';
  return new Date(ts).toISOString().slice(0, 10);
}

function signed(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return rounded > 0 ? `+${text}` : text;
}

/** One line for the UI and MCP. Measured lines include both values, both times, and the source. */
export function followUpSentence(row: OutcomeFollowUpView): string {
  const baseline = row.baselineMeasuredAt !== null ? ` Baseline ${day(row.baselineMeasuredAt)}.` : '';
  if (row.status === 'pending') {
    return `${row.horizonDays} days: pending, due ${day(row.dueAt)}.${baseline}`;
  }
  if (
    row.status === 'measured' &&
    row.beforeValue !== null &&
    row.afterValue !== null &&
    row.delta !== null &&
    row.baselineMeasuredAt !== null &&
    row.measuredAt !== null &&
    row.source
  ) {
    return `${row.horizonDays} days: ${row.beforeValue} to ${row.afterValue} (change ${signed(row.delta)}). Baseline ${day(row.baselineMeasuredAt)}. Follow-up ${day(row.measuredAt)}. Source ${row.source}.`;
  }
  const checked = row.judgedAt !== null ? ` Checked ${day(row.judgedAt)}.` : '';
  return `${row.horizonDays} days: Not measured.${baseline}${checked}`;
}
