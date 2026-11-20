import React, { useEffect, useMemo, useState } from 'react';
import { score, summarize } from '../../services/visibilityTests/scorer';
import {
  askOwnModels,
  factsFromDna,
  fetchLatestRun,
  fetchScorecard,
  ownKeyQuestions,
  ownKeyTargets,
  regradeVisibilityRun,
  saveVisibilityRun,
  type SavedVisibilityRun,
  type VisibilityRunResult,
} from '../../services/visibilityTests/client';
import { FAMILIES, FAMILY_LABELS, type RawVisibilityRun, type ScorecardRow, type VisibilityVerdict } from '../../services/visibilityTests/types';
import type { BusinessDNA } from '../../types';

/** Own-model scores on fewer answers than this are a hint, and the card says so. */
const FEW_ANSWERS = 10;
const MAX_REASONS_SHOWN = 6;

function costLine(row: ScorecardRow): string {
  if (row.costUsd === null) return 'cost not reported';
  const cost = `about $${row.costUsd < 0.01 ? row.costUsd.toFixed(4) : row.costUsd.toFixed(2)}`;
  return row.costUnknown ? `${cost}, plus ${row.costUnknown} with no cost reported` : cost;
}

function reasonsToShow(verdicts: readonly VisibilityVerdict[]): VisibilityVerdict[] {
  const seen = new Set<string>();
  return verdicts
    .filter((v) => v.result === 'fail')
    .filter((v) => {
      if (seen.has(v.label)) return false;
      seen.add(v.label);
      return true;
    })
    .slice(0, MAX_REASONS_SHOWN);
}

/** One save per audit, however often the card mounts. A failed save is forgotten, so the next mount retries. */
const saves = new WeakMap<RawVisibilityRun, Promise<VisibilityRunResult | null>>();

function saveOnce(raw: RawVisibilityRun): Promise<VisibilityRunResult | null> {
  const known = saves.get(raw);
  if (known) return known;
  const save = saveVisibilityRun(raw).then((result) => {
    if (!result) saves.delete(raw);
    return result;
  });
  saves.set(raw, save);
  return save;
}

export const VisibilityTestsCard: React.FC<{
  /** This audit's raw record. Null on a past report, which shows the newest saved checks for the website. */
  raw: RawVisibilityRun | null;
  domain: string;
  dna: BusinessDNA | null | undefined;
  isGuest: boolean;
  onRunSaved?: (runId: string | undefined) => void;
}> = ({ raw, domain, dna, isGuest, onRunSaved }) => {
  const [verdicts, setVerdicts] = useState<VisibilityVerdict[]>(() => (raw ? score(raw) : []));
  const [current, setCurrent] = useState<RawVisibilityRun | null>(raw);
  /** The audit's run, then one run per press of Ask my AI accounts. */
  const [saved, setSaved] = useState<SavedVisibilityRun[]>([]);
  const [scorecard, setScorecard] = useState<ScorecardRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const targets = useMemo(() => (isGuest || !raw ? [] : ownKeyTargets()), [isGuest, raw]);

  useEffect(() => {
    setCurrent(raw);
    setVerdicts(raw ? score(raw) : []);
    setSaved([]);
    setNote(null);
    if (isGuest) return;
    let live = true;
    void (raw ? saveOnce(raw) : fetchLatestRun(domain)).then((result) => {
      if (!live) return;
      if (result) {
        setSaved([result.run]);
        setVerdicts(result.verdicts);
      } else if (raw) {
        setNote('We could not save these results, so they will not be here next time.');
      }
    });
    void fetchScorecard(domain).then((rows) => {
      if (live) setScorecard(rows);
    });
    return () => {
      live = false;
    };
  }, [raw, domain, isGuest]);

  const firstRunId = saved[0]?.id;
  useEffect(() => {
    // A past report may be older than the newest run, so its share link carries no list.
    onRunSaved?.(raw ? firstRunId : undefined);
  }, [raw, firstRunId, onRunSaved]);

  const summary = summarize(verdicts);
  const passed = verdicts.filter((v) => v.result === 'pass').length;
  const graded = summary.graded;
  const reasons = reasonsToShow(verdicts);
  const regradable = saved.filter((run) => run.canRegrade);

  const askMyModels = async () => {
    if (!current) return;
    setBusy(true);
    setNote(null);
    try {
      // Read again now: the key may have gone since the card drew, and a hosted key must never be spent here.
      const answers = await askOwnModels(current, ownKeyTargets());
      if (!answers.length) {
        setNote('We could not find your OpenRouter key. Add it in Settings and try again.');
        return;
      }
      const next = { ...current, answers: [...current.answers, ...answers] };
      setCurrent(next);
      setVerdicts(score(next));
      // Only the new answers: the audit's own run is already saved, and a repeat would count twice.
      const result = await saveVisibilityRun({ ...current, answers, snapshot: null });
      if (result) {
        setSaved((runs) => [...runs, result.run]);
        setScorecard(await fetchScorecard(next.facts.domain));
      } else {
        setNote('We could not save these answers, so they will be gone when you leave this page.');
      }
    } finally {
      setBusy(false);
    }
  };

  const checkAgain = async () => {
    setBusy(true);
    setNote(null);
    try {
      const facts = factsFromDna(domain, dna);
      const results = await Promise.all(regradable.map((run) => regradeVisibilityRun(run.id, facts)));
      if (results.every(Boolean)) {
        const done = results.flatMap((result) => (result ? [result] : []));
        setSaved(done.map((result) => result.run));
        setVerdicts(done.flatMap((result) => result.verdicts));
        setCurrent((run) => run && { ...run, facts });
        setNote('Checked again using your saved answers. This was free.');
      } else {
        setNote('We could not check this again. Your saved results have not changed.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!raw && !verdicts.length) return null;

  const presence = summary.families.presence;
  return (
    <section className="glass-morphism rounded-2xl border border-white/10 p-5 mb-4" aria-labelledby="visibility-tests-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="visibility-tests-title" className="text-sm font-bold text-white">Can people and AI find your business?</h3>
          <p className="text-xs text-gray-300 mt-1">
            {graded ? `${passed} of ${graded} checks passed.` : 'We could not run these checks. Run the audit again to retry.'}
            {summary.notMeasured > 0 && ` ${summary.notMeasured} could not be checked.`}
          </p>
        </div>
        {summary.estimated && (
          <span className="shrink-0 px-2 py-1 rounded-lg border border-warning-400/40 text-[11px] text-warning-400">Estimated</span>
        )}
      </div>

      {summary.estimated && (
        <p className="text-xs text-gray-400 mt-2">
          These checks use details we found, not details you confirmed. {isGuest
            ? 'Sign in, then open Business profile to confirm your facts.'
            : regradable.length > 0
              ? 'Open Business profile and confirm your facts. Then open this report from your past reports and press Check again for free.'
              : 'Open Business profile and confirm your facts. Your next audit checks against them.'}
        </p>
      )}

      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {FAMILIES.map((family) => {
          const row = summary.families[family];
          if (!row) return null;
          return (
            <li key={family} className="rounded-xl bg-black/30 border border-white/5 p-3">
              <p className="text-xs text-white">{FAMILY_LABELS[family]}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {row.tests ? `${row.passed} of ${row.tests} passed` : 'Could not be checked'}
              </p>
            </li>
          );
        })}
      </ul>

      {!presence?.tests && (
        <p className="text-xs text-gray-400 mt-2">
          To test whether you get found, add what you do and your suburb to your Business profile, then run the audit again.
        </p>
      )}
      {isGuest && <p className="text-xs text-gray-400 mt-2">Sign in to save these checks and compare them over time.</p>}

      {reasons.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gold-light">What to look at</p>
          <ul className="mt-1 space-y-1">
            {reasons.map((v) => (
              <li key={v.label} className="text-xs text-gray-300">{v.why}</li>
            ))}
          </ul>
        </div>
      )}

      {scorecard.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gold-light">Your AI accounts compared</p>
          <ul className="mt-1 space-y-1">
            {scorecard.map((row) => (
              <li key={`${row.provider}/${row.model}`} className="text-xs text-gray-300 break-words">
                {row.model}: {row.tests ? `${row.passed} of ${row.tests} checks` : 'nothing checked'}, {row.refusals} refused, {costLine(row)}
                {row.answers < FEW_ANSWERS ? ' (only a few answers, so treat this as a hint)' : ''}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-400 mt-1">Some AI accounts cannot browse the web, so they rarely link to anyone. Compare them on the same question, not on links alone.</p>
        </div>
      )}

      {!isGuest && (targets.length > 0 || regradable.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {targets.length > 0 && (
            <button
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void askMyModels()}
              className="px-3 py-1.5 rounded-lg bg-gold/10 border border-gold/40 text-xs text-gold-light disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              {busy ? 'Working...' : 'Ask my AI accounts'}
            </button>
          )}
          {regradable.length > 0 && (
            <button
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void checkAgain()}
              className="px-3 py-1.5 rounded-lg border border-white/15 text-xs text-gray-200 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              Check again for free
            </button>
          )}
        </div>
      )}
      {current && targets.length > 0 && (
        <p className="text-[11px] text-gray-400 mt-2">
          Ask my AI accounts sends {ownKeyQuestions(current).length * targets.length} questions using your OpenRouter key, and OpenRouter may charge you a small amount. Their answers are estimates, not what people see in ChatGPT or Google.
        </p>
      )}
      <p className="text-xs text-gray-300 mt-2 empty:hidden" role="status">{note}</p>
    </section>
  );
};
