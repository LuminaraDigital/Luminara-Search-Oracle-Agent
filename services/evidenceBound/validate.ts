/**
 * Strict Choice / Score / Noul validation (browserAction validateChoice lineage).
 * Invalid distributions never unlock an action.
 */

import type { ChoiceAnswer, NoulAnswer, ScoreAnswer } from './types';

export class EvidenceBoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceBoundError';
  }
}

function idSet(ids: string[] | Record<string, unknown>): Set<string> {
  return new Set(Array.isArray(ids) ? ids : Object.keys(ids));
}

/**
 * Reject mismatched keys, non-finite probs, sum drift, or non-max chosen id.
 */
export function validateChoice(
  answer: Partial<ChoiceAnswer> | Record<string, unknown> | null | undefined,
  ids: string[] | Record<string, unknown>,
): ChoiceAnswer {
  const allowed = idSet(ids);
  let valid = false;
  let choice = '';
  let probabilities: Record<string, number> = {};
  let confidence = 0;

  try {
    if (!answer || typeof answer !== 'object') throw new Error('missing');
    const rawChoice = (answer as ChoiceAnswer).choice;
    const rawProbs = (answer as ChoiceAnswer).probabilities;
    const rawConf = (answer as ChoiceAnswer).confidence;
    if (typeof rawChoice !== 'string' || !rawProbs || typeof rawProbs !== 'object') {
      throw new Error('shape');
    }
    choice = rawChoice;
    probabilities = rawProbs as Record<string, number>;
    confidence = Number(rawConf);

    const numbers = [...Object.values(probabilities), confidence];
    const keys = new Set(Object.keys(probabilities));
    const sum = Object.values(probabilities).reduce((a, b) => a + Number(b), 0);
    const maxProb = Math.max(...Object.values(probabilities).map(Number));
    valid =
      allowed.has(choice) &&
      keys.size === allowed.size &&
      [...allowed].every((id) => keys.has(id)) &&
      numbers.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) &&
      Math.abs(sum - 1) < 0.02 &&
      Number(probabilities[choice]) >= maxProb - 1e-6;
  } catch {
    valid = false;
  }

  if (!valid) {
    throw new EvidenceBoundError('Invalid choice response; no action executed.');
  }
  return { choice, probabilities, confidence };
}

/**
 * Score levels are ordered string keys (e.g. "0","1","2","3","4"). Peak must match score.
 */
export function validateScore(
  answer: Partial<ScoreAnswer> | Record<string, unknown> | null | undefined,
  levels: string[],
): ScoreAnswer {
  if (!answer || typeof answer !== 'object') {
    throw new EvidenceBoundError('Invalid score response; no action executed.');
  }
  const raw = answer as ScoreAnswer;
  const probabilities = raw.probabilities;
  const confidence = Number(raw.confidence);
  const score = Number(raw.score);

  if (!probabilities || typeof probabilities !== 'object' || !levels.length) {
    throw new EvidenceBoundError('Invalid score response; no action executed.');
  }

  const keys = Object.keys(probabilities);
  const numbers = [...Object.values(probabilities).map(Number), confidence];
  const sum = Object.values(probabilities).reduce((a, b) => a + Number(b), 0);
  const maxProb = Math.max(...Object.values(probabilities).map(Number));
  const peakKey = keys.find((k) => Number(probabilities[k]) >= maxProb - 1e-6) ?? '';

  const valid =
    Number.isFinite(score) &&
    levels.includes(String(Math.round(score))) &&
    keys.length === levels.length &&
    levels.every((l) => keys.includes(l)) &&
    numbers.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
    Math.abs(sum - 1) < 0.02 &&
    peakKey === String(Math.round(score));

  if (!valid) {
    throw new EvidenceBoundError('Invalid score response; no action executed.');
  }
  return { score: Math.round(score), probabilities, confidence };
}

/** Noul is P(yes) in [0,1]. No separate confidence field. */
export function validateNoul(
  answer: Partial<NoulAnswer> | Record<string, unknown> | null | undefined,
): NoulAnswer {
  const noul = Number((answer as NoulAnswer | undefined)?.noul);
  if (!Number.isFinite(noul) || noul < 0 || noul > 1) {
    throw new EvidenceBoundError('Invalid noul response; no action executed.');
  }
  return { noul };
}

/** Distance from 0.5; advisory only. */
export function noulConfidence(noul: number): number {
  return Math.abs(2 * noul - 1);
}

/**
 * Choice confidence from probabilities (TypeSafe formula). Advisory only.
 * confidence = (pMax - 1/n) / (1 - 1/n)
 */
export function choiceConfidenceFromProbs(probabilities: Record<string, number>): number {
  const values = Object.values(probabilities).map(Number);
  const n = values.length;
  if (n < 2) return values[0] === 1 ? 1 : 0;
  const pMax = Math.max(...values);
  return Math.max(0, Math.min(1, (pMax - 1 / n) / (1 - 1 / n)));
}

/** Shuffle option order for self-consistency (order-bias guard). */
export function shuffleKeys(keys: string[], seed = 1): string[] {
  const out = [...keys];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
