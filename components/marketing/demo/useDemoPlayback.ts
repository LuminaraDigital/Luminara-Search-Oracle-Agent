import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ANALYZE_STAGES,
  DemoEngineRow,
  DemoFocus,
  DemoPhase,
  DemoFixture,
  SAMPLE_FIXTURE,
  idleEngines,
  normalizeDemoUrl,
  sampleEngineRowsForHost,
} from './demoFixtures';
import { fetchProbeCrawl } from '../../../services/marketing/probeCrawlClient';

export type ProbeResultKind = 'sample' | 'live_crawl' | 'mixed';

export interface DemoPlayback {
  phase: DemoPhase;
  url: string;
  focus: DemoFocus;
  error: string | null;
  stageLabel: string | null;
  engines: DemoEngineRow[];
  fixture: DemoFixture | null;
  resultKind: ProbeResultKind;
  setUrl: (v: string) => void;
  setFocus: (f: DemoFocus) => void;
  /** Runs the check on `host` when given (a shared link), else on the typed URL. */
  runSample: (host?: string) => void;
  reset: () => void;
}

export function useDemoPlayback(): DemoPlayback {
  const [phase, setPhase] = useState<DemoPhase>('empty');
  const [url, setUrlState] = useState('');
  const [focus, setFocus] = useState<DemoFocus>('AEO');
  const [error, setError] = useState<string | null>(null);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [engines, setEngines] = useState<DemoEngineRow[]>(() => idleEngines());
  const [fixture, setFixture] = useState<DemoFixture | null>(null);
  const [resultKind, setResultKind] = useState<ProbeResultKind>('sample');
  const timers = useRef<number[]>([]);
  const reducedRef = useRef(false);
  const runIdRef = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedRef.current = mq.matches;
    const onChange = () => {
      reducedRef.current = mq.matches;
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  useEffect(() => () => {
    runIdRef.current += 1;
    clearTimers();
  }, [clearTimers]);

  const setUrl = useCallback(
    (v: string) => {
      setUrlState(v);
      setError(null);
      if (phase === 'results_sample' || phase === 'error') {
        setPhase(v.trim() ? 'typing' : 'empty');
        setFixture(null);
        setEngines(idleEngines());
        setStageLabel(null);
        setResultKind('sample');
      } else {
        setPhase(v.trim() ? 'typing' : 'empty');
      }
    },
    [phase],
  );

  const reset = useCallback(() => {
    clearTimers();
    runIdRef.current += 1;
    setPhase('empty');
    setUrlState('');
    setError(null);
    setStageLabel(null);
    setEngines(idleEngines());
    setFixture(null);
    setResultKind('sample');
  }, [clearTimers]);

  const runSample = useCallback((host?: string) => {
    clearTimers();
    if (host !== undefined) setUrlState(host);
    // A shared link's host, or what the visitor typed. Never a sample domain.
    const parsed = host !== undefined ? normalizeDemoUrl(host) : normalizeDemoUrl(url);
    if (!parsed.ok) {
      setError(parsed.error);
      setPhase('error');
      return;
    }

    const runId = ++runIdRef.current;
    setError(null);
    setFixture(null);
    setResultKind('sample');
    setPhase('analyzing');
    // Only the crawl row is in flight; the engines are never asked here, so they read
    // Not measured from the first frame instead of pretending to be checked.
    const [crawlIdle] = idleEngines();
    setEngines([{ ...crawlIdle, status: 'pending', note: 'Checking…' }, ...sampleEngineRowsForHost(parsed.host)]);
    const startedAt = Date.now();

    const stepMs = reducedRef.current ? 80 : 480;
    ANALYZE_STAGES.forEach((label, i) => {
      const id = window.setTimeout(() => {
        if (runIdRef.current !== runId) return;
        setStageLabel(label);
      }, i * stepMs);
      timers.current.push(id);
    });

    void (async () => {
      const crawl = await fetchProbeCrawl(parsed.host);
      if (runIdRef.current !== runId) return;

      const engineRows = sampleEngineRowsForHost(parsed.host);
      let crawlRow: DemoEngineRow;
      let kind: ProbeResultKind = 'sample';
      let verdict = SAMPLE_FIXTURE.verdict;
      let shipAction = SAMPLE_FIXTURE.shipAction;

      if (crawl.ok) {
        kind = 'live_crawl';
        crawlRow = {
          id: 'crawl_readiness',
          label: 'Crawl readiness',
          status: crawl.crawl.status,
          note: crawl.crawl.note,
        };
        verdict = crawl.crawl.note;
        shipAction = `Create a free account and run Instant Audit on ${crawl.host} for Measured engine rows.`;
      } else {
        crawlRow = {
          id: 'crawl_readiness',
          label: 'Crawl readiness',
          status: 'not_measured',
          note:
            crawl.ok === false
              ? `Not measured · ${crawl.error} Sample-safe: engines stay not measured.`
              : 'Not measured · crawl unavailable. Sample-safe: engines stay not measured.',
        };
        kind = 'sample';
      }

      const resultBase: DemoFixture = {
        domain: parsed.host,
        focus,
        verdict,
        shipAction,
        engines: [crawlRow, ...engineRows],
        // `page` stays undefined when a Worker without the homepage read answers, which hides
        // the section instead of reporting a failed read.
        ...(crawl.ok
          ? {
            page: crawl.page,
            pageReason: crawl.pageReason ?? null,
            checkedAt: crawl.checkedAt,
          }
          : {}),
      };

      // Let each crawl stage show for a beat, but never wait longer than the request itself.
      const doneAt = Math.max(0, ANALYZE_STAGES.length * stepMs - (Date.now() - startedAt));
      const doneId = window.setTimeout(() => {
        if (runIdRef.current !== runId) return;
        setFixture(resultBase);
        setEngines(resultBase.engines);
        setResultKind(kind);
        setStageLabel(null);
        setPhase('results_sample');
      }, doneAt);
      timers.current.push(doneId);
    })();
  }, [clearTimers, focus, url]);

  return {
    phase,
    url,
    focus,
    error,
    stageLabel,
    engines,
    fixture,
    resultKind,
    setUrl,
    setFocus,
    runSample,
    reset,
  };
}
