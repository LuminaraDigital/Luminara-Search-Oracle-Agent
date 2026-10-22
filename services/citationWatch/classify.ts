import type { CitationWatchThresholds } from './thresholds';
import type { CitationWatchEngine, ClassifiedWatch, MeasuredPoint, WatchMeasurement } from './types';

function notMeasured(reason: string): ClassifiedWatch {
  return {
    verdict: 'not_measured',
    citedCount: null,
    promptCount: null,
    share: null,
    comparedToRunId: null,
    deltaShare: null,
    reason,
  };
}

function measuredBase(
  verdict: ClassifiedWatch['verdict'],
  citedCount: number,
  promptCount: number,
  share: number,
  reason: string,
  comparedToRunId: string | null = null,
  deltaShare: number | null = null,
): ClassifiedWatch {
  return { verdict, citedCount, promptCount, share, comparedToRunId, deltaShare, reason };
}

/**
 * Classifies one run against earlier measured runs of the same watch.
 * priorMeasured is oldest first. Only the latest run that itself met minPrompts is the comparison.
 * Share is cited/prompts for that run. It is omitted entirely when the run was not measured.
 */
export function classifyCitationWatch(input: {
  engine: CitationWatchEngine;
  measurement: WatchMeasurement;
  priorMeasured: MeasuredPoint[];
  thresholds: CitationWatchThresholds;
}): ClassifiedWatch {
  if (input.measurement.status === 'not_measured') return notMeasured(input.measurement.reason);
  const cited = input.measurement.cited;
  if (cited.length === 0) return notMeasured('No prompt observations were recorded.');

  const threshold = input.thresholds[input.engine];
  const citedCount = cited.filter(Boolean).length;
  const promptCount = cited.length;
  const share = roundShare(citedCount / promptCount);

  if (promptCount < threshold.minPrompts) {
    return measuredBase(
      'insufficient',
      citedCount,
      promptCount,
      share,
      `Measured ${citedCount} of ${promptCount} prompts. Need ${threshold.minPrompts} before a change call.`,
    );
  }

  const qualifying = input.priorMeasured.filter(
    (point) => point.promptCount >= threshold.minPrompts && point.citedCount >= 0 && point.citedCount <= point.promptCount,
  );
  if (qualifying.length < threshold.minPriorRuns) {
    return measuredBase(
      'insufficient',
      citedCount,
      promptCount,
      share,
      `Measured ${citedCount} of ${promptCount} prompts. Need ${threshold.minPriorRuns} earlier measured runs before a change call.`,
    );
  }

  const prior = qualifying[qualifying.length - 1];
  const deltaShare = roundShare(share - prior.citedCount / prior.promptCount);
  const absLabel = formatShare(Math.abs(deltaShare));
  const limitLabel = formatShare(threshold.maxConsistentShareDelta);
  if (withinConsistentDelta(citedCount, promptCount, prior.citedCount, prior.promptCount, threshold.maxConsistentShareDelta)) {
    return measuredBase(
      'consistent',
      citedCount,
      promptCount,
      share,
      `Share changed by ${absLabel}, within ${limitLabel}.`,
      prior.runId,
      deltaShare,
    );
  }
  return measuredBase(
    'drift',
    citedCount,
    promptCount,
    share,
    `Share changed by ${absLabel}, above ${limitLabel}.`,
    prior.runId,
    deltaShare,
  );
}

function roundShare(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function formatShare(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** Integer cross-multiply so a delta of exactly maxDelta stays consistent (0.8 - 0.5 is not above 0.3). */
function withinConsistentDelta(
  cited: number,
  prompts: number,
  priorCited: number,
  priorPrompts: number,
  maxDelta: number,
): boolean {
  const diff = Math.abs(cited * priorPrompts - priorCited * prompts);
  const limit = maxDelta * prompts * priorPrompts;
  return diff <= limit + 1e-6;
}
