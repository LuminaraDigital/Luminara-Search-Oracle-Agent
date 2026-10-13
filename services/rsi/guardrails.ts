/**
 * Shared limits for Luminara recursive self-improvement.
 * Automatic rounds may change only a few records, every change cites evidence,
 * and a person who pinned a record keeps it fixed.
 */

export const RSI_MAX_CHANGES_PER_ROUND = 3;
export const RSI_MIN_SUCCESSES_TO_PROPOSE = 2;
export const RSI_STALE_AFTER_MS = 45 * 24 * 60 * 60 * 1000;
export const RSI_ARCHIVE_STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
export const RSI_MAX_PLAYBOOK_EDITS_PER_WEEK = 2;

export function requireEvidence(refs: readonly string[]): { ok: true; refs: string[] } | { ok: false; reason: string } {
  const clean = [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))].slice(0, 20);
  if (clean.length === 0) {
    return { ok: false, reason: 'Evidence required: cite at least one source event.' };
  }
  return { ok: true, refs: clean };
}

export function refusePinnedMutation(pinned: boolean): { ok: true } | { ok: false; reason: string } {
  if (pinned) {
    return { ok: false, reason: 'Pinned items stay fixed until a person unpins them.' };
  }
  return { ok: true };
}

export function takeChangeBudget<T>(items: readonly T[], cap = RSI_MAX_CHANGES_PER_ROUND): { accepted: T[]; deferred: T[] } {
  const limit = Math.max(0, cap);
  return { accepted: items.slice(0, limit), deferred: items.slice(limit) };
}

export interface RollbackRecord<T> {
  id: string;
  subjectId: string;
  at: number;
  reason: string;
  before: T;
  after: T;
}

export function pushRollback<T>(history: readonly RollbackRecord<T>[], entry: RollbackRecord<T>, max = 50): RollbackRecord<T>[] {
  return [...history, entry].slice(-max);
}

/** ISO week key, UTC, matching the weekly decision card week. */
export function utcIsoWeekKey(at: number): string {
  const date = new Date(at);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface LiveChangeGateInput {
  evidenceRefs: readonly string[];
  pinned: boolean;
  guardOk: boolean;
  guardFindings: readonly string[];
  evalsPassed: boolean;
  failedCases: readonly string[];
  changesAlreadyThisRound: number;
  cap?: number;
}

export function gateLiveChange(input: LiveChangeGateInput): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const evidence = requireEvidence(input.evidenceRefs);
  if (!evidence.ok) reasons.push(evidence.reason);
  const pin = refusePinnedMutation(input.pinned);
  if (!pin.ok) reasons.push(pin.reason);
  if (!input.guardOk) {
    for (const finding of input.guardFindings) reasons.push(`Safety guard: ${finding}`);
    if (input.guardFindings.length === 0) reasons.push('Safety guard rejected this change.');
  }
  if (!input.evalsPassed) {
    const names = input.failedCases.filter(Boolean);
    reasons.push(names.length > 0 ? `Evals failed: ${names.join(', ')}.` : 'Evals failed.');
  }
  const cap = input.cap ?? RSI_MAX_CHANGES_PER_ROUND;
  if (input.changesAlreadyThisRound >= cap) {
    reasons.push(`Change cap reached (${cap} per round).`);
  }
  return { allowed: reasons.length === 0, reasons };
}
