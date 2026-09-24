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
} from './demoFixtures';

export interface DemoPlayback {
  phase: DemoPhase;
  url: string;
  focus: DemoFocus;
  error: string | null;
  stageLabel: string | null;
  engines: DemoEngineRow[];
  fixture: DemoFixture | null;
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
  const timers = useRef<number[]>([]);
  const reducedRef = useRef(false);

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
      } else {
        setPhase(v.trim() ? 'typing' : 'empty');
      }
    },
    [phase],
  );

  const reset = useCallback(() => {
    clearTimers();
    setPhase('empty');
    setUrlState('');
    setError(null);
    setStageLabel(null);
    setEngines(idleEngines());
    setFixture(null);
  }, [clearTimers]);

  const runSample = useCallback(() => {
    clearTimers();
    const parsed = normalizeDemoUrl(url || SAMPLE_FIXTURE.domain);
    if (!parsed.ok) {
      setError(parsed.error);
      setPhase('error');
      return;
    }

    setError(null);
    setFixture(null);
    setPhase('analyzing');
    setEngines(idleEngines().map((e) => ({ ...e, status: 'pending', note: 'Checking…' })));

    const stepMs = reducedRef.current ? 80 : 550;
    ANALYZE_STAGES.forEach((label, i) => {
      const id = window.setTimeout(() => setStageLabel(label), i * stepMs);
      timers.current.push(id);
    });

    const doneAt = ANALYZE_STAGES.length * stepMs + (reducedRef.current ? 40 : 200);
    const doneId = window.setTimeout(() => {
      const result: DemoFixture = {
        ...SAMPLE_FIXTURE,
        domain: parsed.host,
        focus,
      };
      setFixture(result);
      setEngines(result.engines);
      setStageLabel(null);
      setPhase('results_sample');
    }, doneAt);
    timers.current.push(doneId);
  }, [clearTimers, focus, url]);

  return {
    phase,
    url,
    focus,
    error,
    stageLabel,
    engines,
    fixture,
    setUrl,
    setFocus,
    runSample,
    reset,
  };
}
