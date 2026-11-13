/**
 * Build a snapshot from a measurement the product already returned.
 * Callers pass only numbers and booleans that check produced.
 */
import { freezeSignals, type SnapshotKind, type SnapshotMetric, type SnapshotSignals } from './snapshotCompare';

export type MeasuredSnapshot = {
  projectId: string;
  kind: SnapshotKind;
  measuredAt: number;
  sourceRef: string;
  signals: SnapshotSignals;
};

function measured(input: {
  projectId: string;
  kind: SnapshotKind;
  measuredAt: number;
  sourceRef: string;
  metric: SnapshotMetric;
  score: number | null;
  engines: Array<{ engine: string; cited: boolean }>;
  notes: string[];
  measurementStatus: 'measured' | 'not_measured';
}): MeasuredSnapshot {
  return {
    projectId: input.projectId,
    kind: input.kind,
    measuredAt: input.measuredAt,
    sourceRef: input.sourceRef.slice(0, 200),
    signals: freezeSignals({
      measurementStatus: input.measurementStatus,
      metric: input.metric,
      score: input.score,
      engines: input.engines,
      notes: input.notes,
    }),
  };
}

export function instantAuditSnapshot(input: {
  projectId: string;
  entryId: string;
  measuredAt: number;
  citationRatePercent: number | null;
  schemaGapCount: number | null;
}): MeasuredSnapshot {
  const notes: string[] = [];
  if (input.schemaGapCount !== null) notes.push(`schema gaps ${input.schemaGapCount}`);
  const measuredRate = input.citationRatePercent !== null;
  return measured({
    projectId: input.projectId,
    kind: 'instant_audit',
    measuredAt: input.measuredAt,
    sourceRef: input.entryId,
    metric: 'citation_rate',
    score: input.citationRatePercent,
    engines: [],
    notes,
    measurementStatus: measuredRate ? 'measured' : 'not_measured',
  });
}

export function keywordSnapshot(input: {
  projectId: string;
  measuredAt: number;
  keywords: Array<{ keyword: string; searchVolume: number | null }>;
}): MeasuredSnapshot {
  const first = input.keywords[0];
  const score = first && first.searchVolume !== null ? first.searchVolume : null;
  const notes = input.keywords.slice(0, 5).map((row) =>
    row.searchVolume !== null ? `${row.keyword} vol ${row.searchVolume}` : row.keyword,
  );
  return measured({
    projectId: input.projectId,
    kind: 'keyword',
    measuredAt: input.measuredAt,
    sourceRef: `keyword:${input.projectId}:${input.measuredAt}`,
    metric: 'keyword_volume',
    score,
    engines: [],
    notes,
    measurementStatus: 'measured',
  });
}

export function visibilitySnapshot(input: {
  projectId: string;
  measuredAt: number;
  aggregateCitationRatePercent: number | null;
  engines: Array<{ engine: string; cited: boolean | null; measurementStatus: string }>;
}): MeasuredSnapshot {
  const engines = input.engines
    .filter((row) => row.measurementStatus === 'measured' && typeof row.cited === 'boolean')
    .map((row) => ({ engine: row.engine, cited: row.cited === true }));
  return measured({
    projectId: input.projectId,
    kind: 'ai_visibility',
    measuredAt: input.measuredAt,
    sourceRef: `visibility:${input.projectId}:${input.measuredAt}`,
    metric: 'visibility_rate',
    score: input.aggregateCitationRatePercent,
    engines,
    notes: [],
    measurementStatus: 'measured',
  });
}

export function domainOverviewSnapshot(input: {
  projectId: string;
  measuredAt: number;
  organicCount: number | null;
  organicEtv: number | null;
}): MeasuredSnapshot {
  const notes: string[] = [];
  if (input.organicEtv !== null) notes.push(`organic etv ${input.organicEtv}`);
  return measured({
    projectId: input.projectId,
    kind: 'audit',
    measuredAt: input.measuredAt,
    sourceRef: `domain-overview:${input.projectId}:${input.measuredAt}`,
    metric: 'organic_count',
    score: input.organicCount,
    engines: [],
    notes,
    measurementStatus: 'measured',
  });
}

export function citationWatchSnapshot(input: {
  projectId: string;
  runId: string;
  measuredAt: number;
  engine: string;
  measured: boolean;
  citedCount: number | null;
  share: number | null;
}): MeasuredSnapshot {
  const score = input.measured && input.share !== null ? Math.round(input.share * 1000) / 10 : null;
  return measured({
    projectId: input.projectId,
    kind: 'ai_visibility',
    measuredAt: input.measuredAt,
    sourceRef: input.runId,
    metric: input.measured ? 'watch_share' : 'none',
    score,
    engines:
      input.measured && input.citedCount !== null
        ? [{ engine: input.engine, cited: input.citedCount > 0 }]
        : [],
    notes: [],
    measurementStatus: input.measured ? 'measured' : 'not_measured',
  });
}

export function crawlerFileSnapshot(input: {
  projectId: string;
  host: string;
  measuredAt: number;
  robotsHttpStatus: number | null;
  llmsHttpStatus: number | null;
  aiHttpStatus: number | null;
}): MeasuredSnapshot {
  const notes: string[] = [];
  if (input.robotsHttpStatus !== null) notes.push(`robots.txt HTTP ${input.robotsHttpStatus}`);
  if (input.llmsHttpStatus !== null) notes.push(`llms.txt HTTP ${input.llmsHttpStatus}`);
  if (input.aiHttpStatus !== null) notes.push(`ai.txt HTTP ${input.aiHttpStatus}`);
  const minute = Math.floor(input.measuredAt / 60_000);
  return measured({
    projectId: input.projectId,
    kind: 'ai_visibility',
    measuredAt: input.measuredAt,
    sourceRef: `crawler:${input.host}:${minute}`,
    metric: 'crawler_status',
    score: null,
    engines: [],
    notes,
    measurementStatus: notes.length > 0 ? 'measured' : 'not_measured',
  });
}
