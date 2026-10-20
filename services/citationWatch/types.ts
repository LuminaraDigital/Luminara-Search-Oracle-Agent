/**
 * Citation Watch vocabulary.
 * consistent: measured, enough history, share change within the engine threshold.
 * drift: measured, enough history, share change above the threshold.
 * insufficient: measured, but the sample or the history is too small to call a change.
 * not_measured: this run did not observe citations. Counts and share stay null.
 */

export const CITATION_WATCH_ENGINES = ['chatgpt', 'google_aio', 'perplexity'] as const;

export type CitationWatchEngine = (typeof CITATION_WATCH_ENGINES)[number];

export type CitationWatchVerdict = 'consistent' | 'drift' | 'insufficient' | 'not_measured';

export type WatchCadence = 'daily' | 'weekly' | 'monthly';

export type PlanReauditCadence = 'none' | WatchCadence;

export type MeasuredPoint = {
  runId: string;
  citedCount: number;
  promptCount: number;
};

export type WatchMeasurement =
  | { status: 'not_measured'; method: 'none'; reason: string }
  | { status: 'measured'; method: string; modelId: string | null; cited: boolean[] };

export type ClassifiedWatch = {
  verdict: CitationWatchVerdict;
  citedCount: number | null;
  promptCount: number | null;
  share: number | null;
  comparedToRunId: string | null;
  deltaShare: number | null;
  reason: string;
};

export function isCitationWatchEngine(value: string): value is CitationWatchEngine {
  return (CITATION_WATCH_ENGINES as readonly string[]).includes(value);
}

export function isWatchCadence(value: string): value is WatchCadence {
  return value === 'daily' || value === 'weekly' || value === 'monthly';
}
