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
  const share = citedCount / promptCount;

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
  const deltaShare = share - prior.citedCount / prior.promptCount;
  const abs = Math.abs(deltaShare);
  if (abs <= threshold.maxConsistentShareDelta) {
    return measuredBase(
      'consistent',
      citedCount,
      promptCount,
      share,
      `Share changed by ${abs}, within ${threshold.maxConsistentShareDelta}.`,
      prior.runId,
      deltaShare,
    );
  }
  return measuredBase(
    'drift',
    citedCount,
    promptCount,
    share,
    `Share changed by ${abs}, above ${threshold.maxConsistentShareDelta}.`,
    prior.runId,
    deltaShare,
  );
}
