/**
 * Thresholds sit above run-to-run noise so a small flip is not reported as drift.
 * The defaults are a conservative policy, not a measured self-agreement study.
 * Replace them with CITATION_WATCH_THRESHOLDS (JSON) once this product has its own history.
 *
 * maxConsistentShareDelta is an absolute change in share (cited prompts / prompts), from 0 to 1.
 * A change at or under it is consistent. A larger change is drift.
 */
import {
  isCitationWatchEngine,
  type CitationWatchEngine,
  type PlanReauditCadence,
  type WatchCadence,
} from './types';

export type EngineThreshold = {
  minPrompts: number;
  minPriorRuns: number;
  maxConsistentShareDelta: number;
};

export type CitationWatchThresholds = Record<CitationWatchEngine, EngineThreshold>;

export const DEFAULT_CITATION_WATCH_THRESHOLDS: CitationWatchThresholds = {
  chatgpt: { minPrompts: 8, minPriorRuns: 2, maxConsistentShareDelta: 0.3 },
  google_aio: { minPrompts: 8, minPriorRuns: 2, maxConsistentShareDelta: 0.25 },
  perplexity: { minPrompts: 8, minPriorRuns: 2, maxConsistentShareDelta: 0.2 },
};

const CADENCE_RANK: Record<PlanReauditCadence, number> = {
  none: 0,
  monthly: 1,
  weekly: 2,
  daily: 3,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function own(value: object, key: string): unknown {
  if (!Object.hasOwn(value, key)) return undefined;
  return Reflect.get(value, key);
}

function integerIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function deltaIn(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) return null;
  return value;
}

function cloneDefaults(): CitationWatchThresholds {
  return {
    chatgpt: { ...DEFAULT_CITATION_WATCH_THRESHOLDS.chatgpt },
    google_aio: { ...DEFAULT_CITATION_WATCH_THRESHOLDS.google_aio },
    perplexity: { ...DEFAULT_CITATION_WATCH_THRESHOLDS.perplexity },
  };
}

/** Parses the env override. A bad document or a bad field keeps that default. */
export function citationWatchThresholds(raw: string | undefined): CitationWatchThresholds {
  const next = cloneDefaults();
  const text = String(raw || '').trim();
  if (!text) return next;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return next;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return next;
  for (const engine of Object.keys(parsed)) {
    if (!isCitationWatchEngine(engine)) continue;
    const row = own(parsed, engine);
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const minPrompts = integerIn(own(row, 'minPrompts'), 1, 50);
    const minPriorRuns = integerIn(own(row, 'minPriorRuns'), 1, 10);
    const maxConsistentShareDelta = deltaIn(own(row, 'maxConsistentShareDelta'));
    if (minPrompts !== null) next[engine].minPrompts = minPrompts;
    if (minPriorRuns !== null) next[engine].minPriorRuns = minPriorRuns;
    if (maxConsistentShareDelta !== null) next[engine].maxConsistentShareDelta = maxConsistentShareDelta;
  }
  return next;
}

export function watchCadenceAllowed(plan: PlanReauditCadence, requested: WatchCadence): boolean {
  return CADENCE_RANK[requested] > 0 && CADENCE_RANK[requested] <= CADENCE_RANK[plan];
}

/** Monthly is 30 days. The cron is daily, so calendar-month edges are not required. */
export function cadenceIntervalMs(cadence: WatchCadence): number {
  if (cadence === 'daily') return DAY_MS;
  if (cadence === 'weekly') return 7 * DAY_MS;
  return 30 * DAY_MS;
}
