/**
 * Plan cadence for scheduled project checks, and the lift or regression call
 * that snapshot compare already computed.
 */
import { normalizePlanId } from '../plans/planEntitlements';
import type { CompareLabel } from '../history/snapshotCompare';

export const MONITOR_CADENCES = ['monthly', 'weekly', 'daily'] as const;
export type MonitorCadence = (typeof MONITOR_CADENCES)[number];

const SPEED: Record<MonitorCadence, number> = { monthly: 0, weekly: 1, daily: 2 };

export function isMonitorCadence(value: string): value is MonitorCadence {
  return (MONITOR_CADENCES as readonly string[]).includes(value);
}

/** Free and Starter: monthly. Growth: weekly. Agency: daily. */
export function planMonitorCadence(plan: string | null | undefined): MonitorCadence {
  const id = normalizePlanId(plan);
  if (id === 'agency') return 'daily';
  if (id === 'growth') return 'weekly';
  return 'monthly';
}

export function monitorCadenceAllowed(plan: string | null | undefined, requested: string): requested is MonitorCadence {
  if (!isMonitorCadence(requested)) return false;
  return SPEED[requested] <= SPEED[planMonitorCadence(plan)];
}

export function monitorIntervalMs(cadence: MonitorCadence): number {
  if (cadence === 'daily') return 86_400_000;
  if (cadence === 'weekly') return 7 * 86_400_000;
  return 30 * 86_400_000;
}

/** Cron start time moves. One hour of slack keeps the next 08:00 fire inside the due window. */
export const MONITOR_TICK_SLACK_MS = 60 * 60 * 1000;

export function nextMonitorRunAt(scheduledAt: number, cadence: MonitorCadence): number {
  return scheduledAt + monitorIntervalMs(cadence) - MONITOR_TICK_SLACK_MS;
}

export function monitorAlertKind(delta: {
  label: CompareLabel;
  scoreDelta: number | null;
  droppedEngines: readonly string[];
  gainedEngines: readonly string[];
}): 'regression' | 'lift' | null {
  if (delta.label !== 'measured') return null;
  if (delta.droppedEngines.length > 0) return 'regression';
  if (delta.scoreDelta === null || delta.scoreDelta === 0) {
    return delta.gainedEngines.length > 0 ? 'lift' : null;
  }
  return delta.scoreDelta < 0 ? 'regression' : 'lift';
}
