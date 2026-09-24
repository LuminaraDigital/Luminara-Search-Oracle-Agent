import type {
  GroundingSubset,
  ModelGateResult,
  ModelGateThresholds,
  SubsetScore,
} from './types.ts';

/** Default pass bars. Text is lower because it is the hard slice, but still required. */
export const DEFAULT_GATE_THRESHOLDS: ModelGateThresholds = {
  sheets: 0.7,
  text: 0.4,
  pro: 0.65,
  luminara: 0.7,
  textFloor: 0.35,
};

export interface GateInput {
  scores: Partial<Record<GroundingSubset, number>>;
  /** e.g. ScreenSpot-Pro 0.81 with no PointerBench Text. */
  vanityBenchOnly?: boolean;
  /** Subsets that must be present for a production click model. */
  required?: GroundingSubset[];
  thresholds?: Partial<ModelGateThresholds>;
}

/**
 * Model gate: refuse vanity-only GUI claims; require separate Sheets/Text/Pro
 * reporting; enforce a Text floor so sheet-only heroes cannot ship as click models.
 */
export function evaluateModelGate(input: GateInput): ModelGateResult {
  const thresholds: ModelGateThresholds = {
    ...DEFAULT_GATE_THRESHOLDS,
    ...input.thresholds,
  };
  const required = input.required ?? ['sheets', 'text', 'pro'];
  const reasons: string[] = [];
  let vanityOnlyRejected = false;

  if (input.vanityBenchOnly) {
    vanityOnlyRejected = true;
    reasons.push(
      'Rejected: candidate cited a vanity GUI bench (e.g. ScreenSpot-Pro only) without PointerBench Text. Run PointerBench Sheets/Text/Pro separately.',
    );
  }

  for (const subset of required) {
    const score = input.scores[subset];
    if (score === undefined || Number.isNaN(score)) {
      reasons.push(`Missing required subset score: ${subset}`);
      continue;
    }
    const bar =
      subset === 'sheets'
        ? thresholds.sheets
        : subset === 'text'
          ? thresholds.text
          : subset === 'pro'
            ? thresholds.pro
            : thresholds.luminara ?? thresholds.pro;
    if (score < bar) {
      reasons.push(
        `${subset} accuracy ${(score * 100).toFixed(1)}% is below gate ${(bar * 100).toFixed(0)}%`,
      );
    }
  }

  const textScore = input.scores.text;
  if (typeof textScore === 'number' && textScore < thresholds.textFloor) {
    const msg = `Text floor fail: ${(textScore * 100).toFixed(1)}% < ${(thresholds.textFloor * 100).toFixed(0)}% (hard-slice gate)`;
    if (!reasons.includes(msg)) reasons.push(msg);
  }

  return {
    pass: reasons.length === 0,
    reasons,
    scores: { ...input.scores },
    vanityOnlyRejected,
  };
}

export function gateFromSubsetScores(
  subsetScores: SubsetScore[],
  opts?: Omit<GateInput, 'scores'>,
): ModelGateResult {
  const scores: Partial<Record<GroundingSubset, number>> = {};
  for (const s of subsetScores) {
    if (s.n > 0) scores[s.subset] = s.accuracy;
  }
  return evaluateModelGate({ ...opts, scores });
}
