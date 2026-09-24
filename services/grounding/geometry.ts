import type { BBox, Point } from './types.ts';

export function normalizeBBox(bbox: BBox): BBox {
  const [x0, y0, x1, y1] = bbox;
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

export function pointInBBox(point: Point, bbox: BBox): boolean {
  const [x0, y0, x1, y1] = normalizeBBox(bbox);
  const [x, y] = point;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

export function boxArea(bbox: BBox): number {
  const [x0, y0, x1, y1] = normalizeBBox(bbox);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

export function intersectionArea(a: BBox, b: BBox): number {
  const [ax0, ay0, ax1, ay1] = normalizeBBox(a);
  const [bx0, by0, bx1, by1] = normalizeBBox(b);
  const ix0 = Math.max(ax0, bx0);
  const iy0 = Math.max(ay0, by0);
  const ix1 = Math.min(ax1, bx1);
  const iy1 = Math.min(ay1, by1);
  return Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
}

export function iou(a: BBox, b: BBox): number {
  const inter = intersectionArea(a, b);
  const denom = boxArea(a) + boxArea(b) - inter;
  return denom > 0 ? inter / denom : 0;
}

/**
 * Asymmetric overlap from the PointerBench public methodology:
 * coverage = intersection / area(gt) must be high (do not cut off the target),
 * precision = intersection / area(pred) must stay reasonably tight.
 */
export function asymmetricOverlap(
  pred: BBox,
  gt: BBox,
  coverageMin = 0.9,
  precisionMin = 0.7,
): { ok: boolean; coverage: number; precision: number } {
  const inter = intersectionArea(pred, gt);
  const gtArea = boxArea(gt);
  const predArea = boxArea(pred);
  const coverage = gtArea > 0 ? inter / gtArea : 0;
  const precision = predArea > 0 ? inter / predArea : 0;
  return {
    ok: coverage >= coverageMin && precision >= precisionMin,
    coverage,
    precision,
  };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Map a point from a crop (resized to frame) back into the full image. */
export function mapPointFromCrop(
  pointInCropFrame: Point,
  crop: BBox,
  frameWidth: number,
  frameHeight: number,
): Point {
  const [x0, y0, x1, y1] = normalizeBBox(crop);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const [px, py] = pointInCropFrame;
  const x = x0 + (px / frameWidth) * w;
  const y = y0 + (py / frameHeight) * h;
  return [x, y];
}

/** Map a bbox from a crop (resized to frame) back into the full image. */
export function mapBBoxFromCrop(
  boxInCropFrame: BBox,
  crop: BBox,
  frameWidth: number,
  frameHeight: number,
): BBox {
  const [a, b] = [
    mapPointFromCrop([boxInCropFrame[0], boxInCropFrame[1]], crop, frameWidth, frameHeight),
    mapPointFromCrop([boxInCropFrame[2], boxInCropFrame[3]], crop, frameWidth, frameHeight),
  ];
  return normalizeBBox([a[0], a[1], b[0], b[1]]);
}

export function cropAroundPoint(
  center: Point,
  frameWidth: number,
  frameHeight: number,
  cropFraction: number,
): BBox {
  const halfW = (frameWidth * cropFraction) / 2;
  const halfH = (frameHeight * cropFraction) / 2;
  const [cx, cy] = center;
  return normalizeBBox([
    clamp(cx - halfW, 0, frameWidth),
    clamp(cy - halfH, 0, frameHeight),
    clamp(cx + halfW, 0, frameWidth),
    clamp(cy + halfH, 0, frameHeight),
  ]);
}
