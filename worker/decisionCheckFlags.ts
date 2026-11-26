/**
 * Flags for the Allora fix retest (docs/plans/allora-concepts-implementation-plan.md 2.1).
 * A feature is on only when its var is exactly "true" and the KV off-switch does not disable it.
 * The switch fails closed: an unknown value, a read that throws, or no KV binding disables both.
 * Read it once per request or job run; KV is eventually consistent, so allow about 60 seconds.
 */
import type { Env } from './env';

/** KV key that pauses the feature without a deploy. Values: `checks`, `retest` or `all`. */
export const DECISION_CHECKS_OFF_KEY = 'decision_checks:off';
/** KV key the retest job stamps with its run time. Separate from the switch, so a run never undoes a pause. */
export const DECISION_CHECKS_LAST_RUN_KEY = 'decision_checks:last_run';

export type DecisionCheckFlags = {
  checksVar: boolean;
  retestVar: boolean;
  checksOn: boolean;
  retestOn: boolean;
};

type FlagEnv = Pick<Env, 'DECISION_CHECKS_ENABLED' | 'DECISION_RETEST_ENABLED' | 'LUMINARA_KV'>;

/** What the switch disables. Missing key: nothing. Anything unexpected: both. */
export async function readDecisionChecksSwitch(env: FlagEnv): Promise<{ checksOff: boolean; retestOff: boolean }> {
  const both = { checksOff: true, retestOff: true };
  if (!env.LUMINARA_KV) return both;
  let value: string | null;
  try {
    value = await env.LUMINARA_KV.get(DECISION_CHECKS_OFF_KEY);
  } catch {
    return both;
  }
  if (value === null) return { checksOff: false, retestOff: false };
  if (value === 'checks') return { checksOff: true, retestOff: false };
  if (value === 'retest') return { checksOff: false, retestOff: true };
  return both;
}

export async function decisionCheckFlags(env: FlagEnv): Promise<DecisionCheckFlags> {
  const checksVar = env.DECISION_CHECKS_ENABLED === 'true';
  const retestVar = env.DECISION_RETEST_ENABLED === 'true';
  const off = await readDecisionChecksSwitch(env);
  return { checksVar, retestVar, checksOn: checksVar && !off.checksOff, retestOn: retestVar && !off.retestOff };
}

/** For /api/health: the flags plus the last run stamp, from KV only (no database query, no counts). */
export async function decisionChecksHealth(env: FlagEnv): Promise<DecisionCheckFlags & { lastRunAt: number | null }> {
  const [flags, lastRunAt] = await Promise.all([decisionCheckFlags(env), readLastRunAt(env)]);
  return { ...flags, lastRunAt };
}

async function readLastRunAt(env: FlagEnv): Promise<number | null> {
  try {
    const raw = await env.LUMINARA_KV?.get(DECISION_CHECKS_LAST_RUN_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
