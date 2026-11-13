/**
 * Comparable project measurements. Scores and engine cites stay null until a real check produced them.
 */

export const SNAPSHOT_KINDS = ['audit', 'keyword', 'ai_visibility', 'instant_audit'] as const;
export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

export type MeasurementLabel = 'measured' | 'not_measured';
export type CompareLabel = 'measured' | 'too_little_data';

export type EngineSignal = {
  engine: string;
  cited: boolean;
};

export const SNAPSHOT_METRICS = [
  'none',
  'citation_rate',
  'watch_share',
  'visibility_rate',
  'organic_count',
  'keyword_volume',
  'crawler_status',
] as const;
export type SnapshotMetric = (typeof SNAPSHOT_METRICS)[number];

export type SnapshotSignals = {
  measurementStatus: MeasurementLabel;
  metric: SnapshotMetric;
  /** Same series only. A citation-watch engine, or the sorted visibility queries. */
  subject: string;
  score: number | null;
  engines: EngineSignal[];
  notes: string[];
};

export type SnapshotPoint = {
  id: string;
  kind: SnapshotKind;
  measuredAt: number;
  signals: SnapshotSignals;
};

export type SnapshotDelta = {
  kind: SnapshotKind;
  earlierId: string;
  laterId: string;
  earlierScore: number | null;
  laterScore: number | null;
  scoreDelta: number | null;
  droppedEngines: string[];
  gainedEngines: string[];
  label: CompareLabel;
};

export type SnapshotTrend = {
  kind: SnapshotKind;
  metric: SnapshotMetric;
  subject: string;
  latestScore: number | null;
  latestDelta: SnapshotDelta | null;
};

export function isSnapshotKind(value: string): value is SnapshotKind {
  return (SNAPSHOT_KINDS as readonly string[]).includes(value);
}

export function isSnapshotMetric(value: string): value is SnapshotMetric {
  return (SNAPSHOT_METRICS as readonly string[]).includes(value);
}

export function metricForKind(kind: SnapshotKind): SnapshotMetric {
  switch (kind) {
    case 'instant_audit':
      return 'citation_rate';
    case 'keyword':
      return 'keyword_volume';
    case 'audit':
      return 'organic_count';
    case 'ai_visibility':
      return 'visibility_rate';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function finiteScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cleanSubject(value: string | undefined): string {
  return (value || '').trim().slice(0, 80);
}

export function freezeSignals(input: {
  measurementStatus: MeasurementLabel;
  metric?: SnapshotMetric;
  subject?: string;
  score: number | null;
  engines: EngineSignal[];
  notes: string[];
}): SnapshotSignals {
  const notes = input.notes
    .filter((note) => note.trim().length > 0)
    .slice(0, 8)
    .map((note) => note.trim().slice(0, 160));
  const metric = input.metric && isSnapshotMetric(input.metric) ? input.metric : 'none';
  const subject = cleanSubject(input.subject);
  if (input.measurementStatus !== 'measured') {
    return { measurementStatus: 'not_measured', metric: 'none', subject: '', score: null, engines: [], notes };
  }
  const engines = input.engines
    .filter((row) => row.engine.trim().length > 0)
    .slice(0, 8)
    .map((row) => ({ engine: row.engine.trim().slice(0, 40), cited: row.cited }));
  return {
    measurementStatus: 'measured',
    metric,
    subject,
    score: finiteScore(input.score),
    engines,
    notes,
  };
}

export function parseSignals(raw: unknown): SnapshotSignals {
  const empty = freezeSignals({ measurementStatus: 'not_measured', score: null, engines: [], notes: [] });
  if (!raw || typeof raw !== 'object') return empty;
  const row = raw as Record<string, unknown>;
  const engines: EngineSignal[] = [];
  if (Array.isArray(row.engines)) {
    for (const item of row.engines) {
      if (!item || typeof item !== 'object') continue;
      const engine = item as Record<string, unknown>;
      if (typeof engine.engine !== 'string' || typeof engine.cited !== 'boolean') continue;
      engines.push({ engine: engine.engine, cited: engine.cited });
    }
  }
  const notes: string[] = [];
  if (Array.isArray(row.notes)) {
    for (const note of row.notes) {
      if (typeof note === 'string') notes.push(note);
    }
  }
  const metric = typeof row.metric === 'string' && isSnapshotMetric(row.metric) ? row.metric : 'none';
  return freezeSignals({
    measurementStatus: row.measurementStatus === 'measured' ? 'measured' : 'not_measured',
    metric,
    subject: typeof row.subject === 'string' ? row.subject : '',
    score: finiteScore(row.score),
    engines,
    notes,
  });
}

function citedSet(signals: SnapshotSignals): Map<string, boolean> {
  return new Map(signals.engines.map((row) => [row.engine, row.cited]));
}

function engineNames(signals: SnapshotSignals): string {
  return [...citedSet(signals).keys()].sort().join('\0');
}

export function compareSnapshots(earlier: SnapshotPoint, later: SnapshotPoint): SnapshotDelta {
  const sameMetric =
    earlier.kind === later.kind &&
    earlier.signals.metric === later.signals.metric &&
    earlier.signals.metric !== 'none' &&
    earlier.signals.subject === later.signals.subject;
  const sameEngineNames = engineNames(earlier.signals) === engineNames(later.signals);
  const comparableScore = sameMetric && (earlier.signals.metric !== 'visibility_rate' || sameEngineNames);
  const earlierScore = comparableScore ? earlier.signals.score : null;
  const laterScore = comparableScore ? later.signals.score : null;
  const scoreDelta =
    earlierScore !== null && laterScore !== null ? laterScore - earlierScore : null;
  const before = citedSet(earlier.signals);
  const after = citedSet(later.signals);
  const droppedEngines: string[] = [];
  const gainedEngines: string[] = [];
  if (sameMetric) {
    for (const [engine, cited] of before) {
      if (!after.has(engine)) continue;
      if (cited && after.get(engine) !== true) droppedEngines.push(engine);
    }
    for (const [engine, cited] of after) {
      if (!before.has(engine)) continue;
      if (cited && before.get(engine) !== true) gainedEngines.push(engine);
    }
  }
  return {
    kind: later.kind,
    earlierId: earlier.id,
    laterId: later.id,
    earlierScore,
    laterScore,
    scoreDelta,
    droppedEngines,
    gainedEngines,
    label: scoreDelta === null ? 'too_little_data' : 'measured',
  };
}

export function outcomeLift(before: number | null, after: number | null): {
  lift: number | null;
  label: CompareLabel;
} {
  if (before === null || after === null || !Number.isFinite(before) || !Number.isFinite(after)) {
    return { lift: null, label: 'too_little_data' };
  }
  return { lift: after - before, label: 'measured' };
}

export function trendsFromSnapshots(snapshots: SnapshotPoint[]): SnapshotTrend[] {
  const byKind = new Map<SnapshotKind, SnapshotPoint[]>();
  for (const point of snapshots) {
    const list = byKind.get(point.kind) ?? [];
    list.push(point);
    byKind.set(point.kind, list);
  }
  const trends: SnapshotTrend[] = [];
  for (const kind of SNAPSHOT_KINDS) {
    const list = (byKind.get(kind) ?? []).slice().sort((a, b) => a.measuredAt - b.measuredAt);
    if (!list.length) continue;
    const scored = list.filter((point) => point.signals.score !== null && point.signals.metric !== 'none');
    const metrics = SNAPSHOT_METRICS.filter((metric) => scored.some((point) => point.signals.metric === metric));
    if (!metrics.length) {
      trends.push({ kind, metric: 'none', subject: '', latestScore: null, latestDelta: null });
      continue;
    }
    for (const metric of metrics) {
      const subjects = [...new Set(scored.filter((point) => point.signals.metric === metric).map((point) => point.signals.subject))];
      for (const subject of subjects) {
        const series = scored.filter((point) => point.signals.metric === metric && point.signals.subject === subject);
        const later = series[series.length - 1];
        const earlier = series.length >= 2 ? series[series.length - 2] : undefined;
        if (!later) continue;
        trends.push({
          kind,
          metric,
          subject,
          latestScore: later.signals.score,
          latestDelta: earlier ? compareSnapshots(earlier, later) : null,
        });
      }
    }
  }
  return trends;
}
