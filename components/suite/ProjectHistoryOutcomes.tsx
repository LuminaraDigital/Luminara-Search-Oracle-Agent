import React, { useEffect, useState } from 'react';
import {
  fetchProjectHistory,
  fetchProjectOutcomes,
  listSeoProjects,
  markProjectActionDone,
  type ProjectHistoryPayload,
  type ProjectOutcomePayload,
} from '../../services/projects/projectClient';
import type { SnapshotSignals } from '../../services/history/snapshotCompare';
import type { SeoProject } from '../../services/projects/types';

const KIND_LABEL: Record<string, string> = {
  audit: 'Audit',
  keyword: 'Keywords',
  ai_visibility: 'AI visibility',
  instant_audit: 'Instant Audit',
};

const METRIC_LABEL: Record<string, string> = {
  citation_rate: 'citation rate %',
  watch_share: 'citation share %',
  visibility_rate: 'visibility rate %',
  organic_count: 'organic pages',
  keyword_volume: 'keyword volume',
  crawler_status: 'crawler files',
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] || kind;
}

function dayLabel(measuredAt: number): string {
  return new Date(measuredAt).toISOString().slice(0, 10);
}

function trendTitle(kind: string, metric: string | undefined): string {
  const metricLabel = metric ? METRIC_LABEL[metric] : '';
  return metricLabel ? `${kindLabel(kind)}, ${metricLabel}` : kindLabel(kind);
}

function recordedText(signals: SnapshotSignals): string {
  if (typeof signals.score === 'number') return String(signals.score);
  if (signals.notes.length > 0) return signals.notes.join('; ');
  return 'Not measured';
}

function liftText(lift: number): string {
  const rounded = Math.round(lift * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return rounded > 0 ? `+${text}` : text;
}

export function ProjectHistoryOutcomes({ signedIn }: { signedIn: boolean }) {
  const [projects, setProjects] = useState<SeoProject[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [history, setHistory] = useState<ProjectHistoryPayload | null>(null);
  const [outcomes, setOutcomes] = useState<ProjectOutcomePayload[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    listSeoProjects()
      .then((rows) => {
        if (cancelled) return;
        setProjects(rows);
        setProjectsLoaded(true);
        setProjectId((current) => current || rows[0]?.id || '');
      })
      .catch(() => {
        if (!cancelled) {
          setProjectsLoaded(true);
          setError('Could not load project history.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn || !projectId) return;
    let cancelled = false;
    setError('');
    setHistory(null);
    setOutcomes(null);
    Promise.all([fetchProjectHistory(projectId), fetchProjectOutcomes(projectId)])
      .then(([nextHistory, nextOutcomes]) => {
        if (cancelled) return;
        setHistory(nextHistory);
        setOutcomes(nextOutcomes);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load project history.');
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, projectId]);

  if (!signedIn) return null;

  async function onDone(actionId: string) {
    setBusyId(actionId);
    setError('');
    try {
      const saved = await markProjectActionDone(projectId, actionId);
      setOutcomes((current) => (current || []).map((row) => (row.id === saved.id ? saved : row)));
    } catch {
      setError('Could not mark that action done.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="mb-10 mkt-chassis p-6" aria-labelledby="project-history-heading">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <h2 id="project-history-heading" className="text-xs font-mono uppercase tracking-[0.14em] text-[var(--color-accent)]">
            Project history
          </h2>
          <p className="text-sm text-[var(--color-ink-2)] mt-1">Checks saved for this project, and whether a fix moved a measured score.</p>
        </div>
        {projects.length > 1 && (
          <label className="text-xs text-[var(--color-ink-2)] flex flex-col gap-1">
            Project
            <select
              className="bg-black/60 border border-[var(--color-rule)] text-[var(--color-ink)] text-sm px-2 py-2 min-h-11"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.domain})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <p className="text-sm text-warning-300" role="alert">
          {error}
        </p>
      )}
      {!error && !projectsLoaded && (
        <p className="text-sm text-[var(--color-ink-2)]" aria-busy="true">
          Loading project history.
        </p>
      )}
      {!error && projectsLoaded && projects.length === 0 && (
        <p className="text-sm text-[var(--color-ink)]">No project yet. Save an audit to a project to start a history.</p>
      )}
      {!error && projectId && history === null && projectsLoaded && (
        <p className="text-sm text-[var(--color-ink-2)]" aria-busy="true">
          Loading project history.
        </p>
      )}

      {history && history.snapshots.length === 0 && (
        <p className="text-sm text-[var(--color-ink)]">No measurements yet.</p>
      )}
      {history && history.snapshots.length > 0 && (
        <div className="space-y-4">
          <p className="text-xs text-[var(--color-ink-2)]">{history.retentionNote}</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {history.trends.map((trend) => {
              const delta = trend.latestDelta;
              const score = trend.latestScore;
              return (
                <li key={`${trend.kind}:${trend.metric || 'none'}`} className="border border-[var(--color-rule)] bg-black/40 p-4">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--gold-light)]">{trendTitle(trend.kind, trend.metric)}</div>
                  <p className="text-lg text-[var(--color-ink)] mt-1">
                    {score === null || score === undefined ? 'Not measured' : score}
                  </p>
                  {delta && delta.label === 'measured' && delta.scoreDelta !== null ? (
                    <p className="text-sm text-[var(--color-ink-2)]">Change vs previous: {liftText(delta.scoreDelta)}</p>
                  ) : (
                    <p className="text-sm text-[var(--color-ink-2)]">Too little data to measure lift.</p>
                  )}
                  {delta && delta.droppedEngines.length > 0 && (
                    <p className="text-sm text-[var(--color-ink)]">Dropped out of AI answers: {delta.droppedEngines.join(', ')}.</p>
                  )}
                </li>
              );
            })}
          </ul>
          <ul className="space-y-2">
            {history.snapshots.slice(0, 8).map((row) => (
              <li key={row.id} className="text-sm text-[var(--color-ink-2)] flex flex-wrap gap-x-3">
                <span className="font-mono text-[var(--color-ink)]">{dayLabel(row.measuredAt)}</span>
                <span>{kindLabel(row.kind)}</span>
                <span>{recordedText(row.signals)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="mt-6 text-xs font-mono uppercase tracking-[0.14em] text-[var(--color-accent)]">Outcomes</h3>
      {outcomes && outcomes.length === 0 && <p className="text-sm text-[var(--color-ink)] mt-2">No recommended actions yet.</p>}
      {outcomes && outcomes.length > 0 && (
        <ul className="mt-3 space-y-3">
          {outcomes.map((outcome) => (
            <li key={outcome.id} className="border border-[var(--color-rule)] p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <p className="text-sm text-[var(--color-ink)]">{outcome.title}</p>
                <p className="text-xs text-[var(--color-ink-2)] mt-1">
                  {kindLabel(outcome.kind)}. {outcome.status}.{' '}
                  {outcome.dataLabel === 'measured' && outcome.lift !== null
                    ? `Measured lift ${liftText(outcome.lift)} (${outcome.beforeValue} to ${outcome.afterValue}).`
                    : 'Too little data to measure lift.'}
                </p>
              </div>
              {outcome.status === 'recommended' && (
                <button
                  type="button"
                  className="mkt-cta-secondary !min-h-11 !py-2 !px-4 !text-xs"
                  disabled={busyId === outcome.id}
                  onClick={() => onDone(outcome.id)}
                >
                  {busyId === outcome.id ? 'Saving' : 'Mark done'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
