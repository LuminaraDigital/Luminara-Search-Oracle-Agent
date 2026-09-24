import { safeJsonParse } from '../llm/safeJsonParse.ts';
import type { AnswerType, BBox, ParsedGeometry, Point } from './types.ts';
import { normalizeBBox } from './geometry.ts';

function asNumbers(value: unknown): number[] {
  if (typeof value === 'string') {
    const matches = value.match(/-?\d+(?:\.\d+)?/g);
    return matches ? matches.map(Number) : [];
  }
  if (Array.isArray(value)) {
    return value.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  }
  return [];
}

function readPoint(rec: Record<string, unknown>): Point | null {
  for (const key of ['point', 'pred', 'coordinate', 'prediction'] as const) {
    const nums = asNumbers(rec[key]);
    if (nums.length >= 2) return [nums[0], nums[1]];
  }
  if (typeof rec.x === 'number' && typeof rec.y === 'number') {
    return [rec.x, rec.y];
  }
  return null;
}

function readBBox(rec: Record<string, unknown>): BBox | null {
  for (const key of ['bbox', 'box', 'pred', 'prediction'] as const) {
    const nums = asNumbers(rec[key]);
    if (nums.length >= 4) return normalizeBBox([nums[0], nums[1], nums[2], nums[3]]);
  }
  if (
    typeof rec.x0 === 'number' &&
    typeof rec.y0 === 'number' &&
    typeof rec.x1 === 'number' &&
    typeof rec.y1 === 'number'
  ) {
    return normalizeBBox([rec.x0, rec.y0, rec.x1, rec.y1]);
  }
  return null;
}

/**
 * Parse model output into absolute-pixel geometry.
 * Rejects normalized [0,1] coordinates when the frame is known (optional check).
 */
export function parseGeometry(
  text: string,
  prefer: AnswerType = 'point',
  opts?: { rejectNormalized?: boolean; frameWidth?: number; frameHeight?: number },
): ParsedGeometry | null {
  const obj = safeJsonParse<Record<string, unknown> | null>(text, null);
  if (!obj || typeof obj !== 'object') return null;

  const point = readPoint(obj);
  const bbox = readBBox(obj);

  if (opts?.rejectNormalized && opts.frameWidth && opts.frameHeight) {
    const check = (vals: number[]) =>
      vals.every((v) => v >= 0 && v <= 1.0001) &&
      vals.some((v) => v <= 1) &&
      Math.max(...vals) <= 1.0001;
    if (point && check([...point])) return null;
    if (bbox && check([...bbox])) return null;
  }

  if (prefer === 'bbox') {
    if (bbox) return { kind: 'bbox', bbox, raw: obj };
    if (point) return { kind: 'point', point, raw: obj };
    return null;
  }

  if (point) return { kind: 'point', point, raw: obj };
  if (bbox) return { kind: 'bbox', bbox, raw: obj };
  return null;
}

export function parsePredictionLine(
  line: string,
): { id: string; point?: Point; bbox?: BBox } | null {
  const obj = safeJsonParse<Record<string, unknown> | null>(line, null);
  if (!obj || typeof obj.id !== 'string') return null;
  const point = readPoint(obj);
  const bbox = readBBox(obj);
  if (!point && !bbox) return { id: obj.id };
  return {
    id: obj.id,
    ...(point ? { point } : {}),
    ...(bbox ? { bbox } : {}),
  };
}
