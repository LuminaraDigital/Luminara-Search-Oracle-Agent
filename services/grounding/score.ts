import {
  DEFAULT_BBOX_COVERAGE_MIN,
  DEFAULT_BBOX_PRECISION_MIN,
  DEFAULT_IOU_THRESHOLD,
} from './protocol.ts';
import { asymmetricOverlap, iou, pointInBBox } from './geometry.ts';
import type {
  GroundingExample,
  GroundingPrediction,
  GroundingSubset,
  SubsetScore,
} from './types.ts';

export interface ScoreDetail {
  id: string;
  ok: boolean;
  missing: boolean;
  reason?: string;
}

export function scoreExample(
  example: GroundingExample,
  prediction: GroundingPrediction | undefined,
): ScoreDetail {
  if (!prediction) {
    return { id: example.id, ok: false, missing: true, reason: 'missing_prediction' };
  }

  const rule = example.eval;
  const answerType =
    example.answer_type ||
    (rule?.type === 'iou' || rule?.type === 'asymmetric_overlap' ? 'bbox' : 'point');

  if (answerType === 'point') {
    if (!('point' in prediction) || !prediction.point) {
      return { id: example.id, ok: false, missing: true, reason: 'missing_point' };
    }
    const ok = pointInBBox(prediction.point, example.bbox);
    return { id: example.id, ok, missing: false, reason: ok ? undefined : 'point_outside_bbox' };
  }

  if (!('bbox' in prediction) || !prediction.bbox) {
    return { id: example.id, ok: false, missing: true, reason: 'missing_bbox' };
  }

  if (rule?.type === 'iou') {
    const threshold = rule.threshold ?? DEFAULT_IOU_THRESHOLD;
    const ok = iou(prediction.bbox, example.bbox) >= threshold;
    return { id: example.id, ok, missing: false, reason: ok ? undefined : 'iou_below_threshold' };
  }

  const coverageMin = rule?.coverage_min ?? DEFAULT_BBOX_COVERAGE_MIN;
  const precisionMin = rule?.precision_min ?? DEFAULT_BBOX_PRECISION_MIN;
  const { ok } = asymmetricOverlap(prediction.bbox, example.bbox, coverageMin, precisionMin);
  return {
    id: example.id,
    ok,
    missing: false,
    reason: ok ? undefined : 'asymmetric_overlap_fail',
  };
}

export function scoreSubset(
  subset: GroundingSubset,
  examples: GroundingExample[],
  predictions: Map<string, GroundingPrediction>,
): SubsetScore {
  let hits = 0;
  let missing = 0;
  for (const ex of examples) {
    const detail = scoreExample(ex, predictions.get(ex.id));
    if (detail.missing) missing += 1;
    if (detail.ok) hits += 1;
  }
  const n = examples.length;
  return {
    subset,
    n,
    hits,
    missing,
    accuracy: n > 0 ? hits / n : 0,
  };
}

export function macroAverage(scores: SubsetScore[]): number | null {
  const nonempty = scores.filter((s) => s.n > 0);
  if (nonempty.length === 0) return null;
  const sum = nonempty.reduce((acc, s) => acc + s.accuracy, 0);
  return sum / nonempty.length;
}

export function predictionsFromJsonl(
  rows: Array<{ id: string; point?: [number, number]; bbox?: [number, number, number, number] }>,
): Map<string, GroundingPrediction> {
  const map = new Map<string, GroundingPrediction>();
  for (const row of rows) {
    if (row.point) map.set(row.id, { id: row.id, point: row.point });
    else if (row.bbox) map.set(row.id, { id: row.id, bbox: row.bbox });
  }
  return map;
}
