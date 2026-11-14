/**
 * Per-plan limits for the Oracle tool loop. Values are first guesses, tuned on staging
 * (docs/rea/agentic-oracle/Blueprint.md sections 4, 6 and 13). ORACLE_AGENT_LIMITS may
 * override any field per plan as JSON, for example {"free":{"turnsPerDay":8}}.
 */
import type { PlanId } from '../../services/plans/planEntitlements';
import { normalizePlanId } from '../../services/plans/planEntitlements';

export type AgentLimits = {
  /** Model calls that may return tool calls. One grace call follows. */
  rounds: number;
  /** Tool calls per turn, across rounds. */
  toolCalls: number;
  /** Agent turns per UTC day. */
  turnsPerDay: number;
  /** live_search calls per UTC day. */
  searchesPerDay: number;
};

export const DEFAULT_AGENT_LIMITS: Readonly<Record<PlanId, AgentLimits>> = Object.freeze({
  free: { rounds: 3, toolCalls: 4, turnsPerDay: 5, searchesPerDay: 3 },
  starter: { rounds: 4, toolCalls: 6, turnsPerDay: 50, searchesPerDay: 30 },
  growth: { rounds: 6, toolCalls: 10, turnsPerDay: 200, searchesPerDay: 120 },
  agency: { rounds: 8, toolCalls: 14, turnsPerDay: 1000, searchesPerDay: 500 },
});

/** Agent turns per UTC day across every account: the kill switch for a free-account farm. */
export const DEFAULT_GLOBAL_TURNS_PER_DAY = 5000;
/** Agent turns per UTC day per client IP. */
export const DEFAULT_IP_TURNS_PER_DAY = 40;

/** Prompt-side cap per tool result. The full text is kept for the honesty checks. */
export const TOOL_RESULT_PROMPT_CHARS = 3000;
/** Total tool text per turn that enters the prompt. */
export const TURN_TOOL_PROMPT_CHARS = 12000;

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Limits for a plan, with the env override applied. Never returns 0 (0 would mean unlimited on the meter). */
export function agentLimitsFor(plan: string | null | undefined, overrideJson?: string): AgentLimits {
  const id = normalizePlanId(plan);
  const base = DEFAULT_AGENT_LIMITS[id];
  if (!overrideJson) return { ...base };
  try {
    const parsed = JSON.parse(overrideJson) as Record<string, Partial<AgentLimits>>;
    const o = parsed && typeof parsed === 'object' ? parsed[id] : undefined;
    if (!o || typeof o !== 'object') return { ...base };
    return {
      rounds: positive(o.rounds) ?? base.rounds,
      toolCalls: positive(o.toolCalls) ?? base.toolCalls,
      turnsPerDay: positive(o.turnsPerDay) ?? base.turnsPerDay,
      searchesPerDay: positive(o.searchesPerDay) ?? base.searchesPerDay,
    };
  } catch {
    return { ...base };
  }
}

export function globalTurnsPerDay(raw?: string): number {
  return positive(raw) ?? DEFAULT_GLOBAL_TURNS_PER_DAY;
}

export function ipTurnsPerDay(raw?: string): number {
  return positive(raw) ?? DEFAULT_IP_TURNS_PER_DAY;
}
