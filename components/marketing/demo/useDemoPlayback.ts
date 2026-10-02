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
  runSample: () => void;
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

  useEffect(() => () => clearTimers(), [clearTimers]);

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

  const runSample = useCallback(() => {
    clearTimers();
    const parsed = normalizeDemoUrl(url || SAMPLE_FIXTURE.domain);
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
    setEngines(idleEngines().map((e) => ({ ...e, status: 'pending', note: 'Checking…' })));

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

      if (crawl.ok && crawl.crawl.status === 'measured') {
        kind = 'live_crawl';
        crawlRow = {
          id: 'crawl_readiness',
          label: 'Crawl readiness',
          status: 'measured',
          note: crawl.crawl.note,
        };
        verdict = `Live crawl for ${crawl.host}: ${crawl.crawl.note} Answer engines were not measured here.`;
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
      };

      resultBase.engines.forEach((row, i) => {
        const at = ANALYZE_STAGES.length * stepMs + (i + 1) * (reducedRef.current ? 40 : 280);
        const id = window.setTimeout(() => {
          if (runIdRef.current !== runId) return;
          setEngines(() =>
            idleEngines().map((base) => {
              const idx = resultBase.engines.findIndex((r) => r.id === base.id);
              const revealed = resultBase.engines[idx];
              if (idx >= 0 && idx <= i && revealed) return { ...revealed };
              if (idx > i) return { ...base, status: 'pending' as const, note: 'Checking…' };
              return base;
            }),
          );
        }, at);
        timers.current.push(id);
      });

      const doneAt =
        ANALYZE_STAGES.length * stepMs +
        resultBase.engines.length * (reducedRef.current ? 40 : 280) +
        (reducedRef.current ? 40 : 180);
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
