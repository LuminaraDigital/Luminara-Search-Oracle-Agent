import React, { useEffect, useState } from 'react';
import { Skeleton } from '../ui/Skeleton';
import { formatAuDate } from '../../utils/formatAuDate';
import { getCurrentQuotaSync, subscribeQuota } from '../../services/apiClient';
import { entitlementsFor } from '../../services/plans/planEntitlements';
import { WATCH_NOTE_LABEL } from '../../services/citationWatch/agentNote';
import {
  CitationWatchApiError,
  fetchCitationWatchRuns,
  listCitationWatches,
  type CitationWatchRun,
  type CitationWatchSummary,
} from '../../services/citationWatch/citationWatchClient';

/**
 * The signed-in user's citation watches, each with its recent runs and the latest Oracle note.
 * Every figure shown comes from the API as returned. Nothing here is estimated.
 */

export type WatchWithRuns = {
  watch: CitationWatchSummary;
  /** null while loading or when the runs could not be read. */
  runs: CitationWatchRun[] | null;
  runsError?: string;
};

export type CitationWatchListState = 'loading' | 'ready' | 'signed_out' | 'unavailable' | 'error';

const ENGINE_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT',
  google_aio: 'Google AI Overviews',
  perplexity: 'Perplexity',
};

const CADENCE_LABELS: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

const VERDICT_LABELS: Record<string, string> = {
  consistent: 'Consistent',
  drift: 'Drift',
  insufficient: 'Not enough data',
  not_measured: 'Not measured',
};

const RECENT_RUNS = 5;

export const label = (map: Record<string, string>, value: string): string => map[value] ?? value;

/** "40% (4 of 10 prompts)" from the stored share and counts, or "not measured" when the run has no share. */
export function shareText(run: Pick<CitationWatchRun, 'share' | 'citedCount' | 'promptCount'>): string {
  if (run.share == null) return 'not measured';
  const pct = `${Math.round(run.share * 100)}%`;
  return run.citedCount != null && run.promptCount != null ? `${pct} (${run.citedCount} of ${run.promptCount} prompts)` : pct;
}

const LatestNote: React.FC<{ runs: CitationWatchRun[] }> = ({ runs }) => {
  const note = runs.find((r) => r.agentNote)?.agentNote;
  if (!note) return null;
  return (
    <div className="rounded-xl border border-gold/30 bg-gold/5 px-4 py-3 space-y-1" aria-label="Latest Oracle note">
      <p className="text-[10px] font-semibold tracking-wide text-gold">
        {WATCH_NOTE_LABEL}
        {formatAuDate(note.at) ? <span className="ml-2 font-normal text-gray-400">{formatAuDate(note.at)}</span> : null}
      </p>
      <p className="text-sm text-gray-200">{note.sentence}</p>
      <p className="text-xs text-gray-400">{note.action}</p>
    </div>
  );
};

const WatchCard: React.FC<{ item: WatchWithRuns }> = ({ item }) => {
  const { watch, runs } = item;
  const latest = runs?.[0];
  return (
    <li className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white">{watch.domain}</span>
        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-gray-400">
          {label(ENGINE_LABELS, watch.engine)}
        </span>
        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-gray-400">
          {label(CADENCE_LABELS, watch.cadence)}
        </span>
        {!watch.active && (
          <span className="rounded-full border border-danger-500/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-danger-300">
            Stopped
          </span>
        )}
      </div>

      {runs === null && !item.runsError && <Skeleton className="h-10 w-full rounded-xl" />}
      {item.runsError && <p className="text-xs text-danger-400">{item.runsError}</p>}
      {runs && !latest && <p className="text-xs text-gray-400">No checks have run yet.</p>}
      {latest && (
        <p className="text-xs text-gray-300">
          Last check {formatAuDate(latest.ranAt)}: <span className="text-gold-light">{label(VERDICT_LABELS, latest.verdict)}</span>, share{' '}
          {shareText(latest)}.
        </p>
      )}
      {watch.active && watch.nextRunAt != null && formatAuDate(watch.nextRunAt) && (
        <p className="text-xs text-gray-500">Next check due {formatAuDate(watch.nextRunAt)}.</p>
      )}

      {runs && runs.length > 0 && <LatestNote runs={runs} />}

      {runs && runs.length > 1 && (
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer text-gray-300 hover:text-white">Recent checks</summary>
          <ul className="mt-2 space-y-1" aria-label={`Recent checks for ${watch.domain}`}>
            {runs.slice(0, RECENT_RUNS).map((run) => (
              <li key={run.id} className="flex flex-wrap gap-x-2">
                <span className="text-gray-500">{formatAuDate(run.ranAt)}</span>
                <span className="text-gray-300">{label(VERDICT_LABELS, run.verdict)}</span>
                <span>{shareText(run)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
};

/** Pure view, so tests can render it without the network. */
export const CitationWatchList: React.FC<{
  state: CitationWatchListState;
  watches: WatchWithRuns[];
  planIncludesWatches: boolean;
  error?: string;
}> = ({ state, watches, planIncludesWatches, error }) => (
  <section className="space-y-5" aria-labelledby="citation-watches-title">
    <div>
      <h2 id="citation-watches-title" className="text-lg font-semibold text-white">
        Citation watches
      </h2>
      <p className="text-sm text-gray-400">How often AI answer engines cite your domain, checked on a schedule.</p>
    </div>

    {state === 'loading' && (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    )}
    {state === 'signed_out' && <p className="text-sm text-gray-400">Sign in to see your citation watches.</p>}
    {state === 'unavailable' && <p className="text-sm text-gray-400">Citation watches are not available on this site yet.</p>}
    {state === 'error' && (
      <p role="alert" className="text-sm text-danger-400">
        {error || 'Your citation watches could not be loaded.'}
      </p>
    )}
    {state === 'ready' && watches.length === 0 && (
      <p className="text-sm text-gray-400">
        {planIncludesWatches
          ? 'No citation watches yet.'
          : 'Your plan does not include scheduled re-audits, so there are no citation watches to show.'}
      </p>
    )}
    {state === 'ready' && watches.length > 0 && (
      <ul className="divide-y divide-white/5 rounded-2xl border border-white/10" aria-label="Your citation watches">
        {watches.map((item) => (
          <WatchCard key={item.watch.id} item={item} />
        ))}
      </ul>
    )}
  </section>
);

function planIncludesWatches(): boolean {
  return entitlementsFor(getCurrentQuotaSync()?.plan).scheduledReaudit !== 'none';
}

export const CitationWatchesPanel: React.FC = () => {
  const [state, setState] = useState<CitationWatchListState>('loading');
  const [error, setError] = useState<string>();
  const [watches, setWatches] = useState<WatchWithRuns[]>([]);
  const [planAllows, setPlanAllows] = useState(planIncludesWatches);

  useEffect(() => subscribeQuota(() => setPlanAllows(planIncludesWatches())), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listCitationWatches();
        if (cancelled) return;
        setWatches(list.map((watch) => ({ watch, runs: null })));
        setState('ready');
        await Promise.all(
          list.map(async (watch) => {
            let next: WatchWithRuns;
            try {
              next = { watch, runs: await fetchCitationWatchRuns(watch.id) };
            } catch {
              next = { watch, runs: null, runsError: 'The checks for this watch could not be loaded.' };
            }
            if (!cancelled) setWatches((prev) => prev.map((w) => (w.watch.id === watch.id ? next : w)));
          }),
        );
      } catch (err) {
        if (cancelled) return;
        if (err instanceof CitationWatchApiError && err.status === 401) setState('signed_out');
        else if (err instanceof CitationWatchApiError && err.status === 503) setState('unavailable');
        else {
          setError(err instanceof Error ? err.message : undefined);
          setState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <CitationWatchList state={state} watches={watches} planIncludesWatches={planAllows} error={error} />;
};
