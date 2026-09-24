/** Absolute pixel geometry on a fixed PointerBench-style frame. */
export type Point = readonly [number, number];

/** Axis-aligned box as [x0, y0, x1, y1] in absolute pixels. */
export type BBox = readonly [number, number, number, number];

export type AnswerType = 'point' | 'bbox';

export type GroundingSubset = 'sheets' | 'text' | 'pro' | 'luminara';

export interface GroundingExample {
  id: string;
  instruction: string;
  /** Ground-truth target box used for point-in-bbox and overlap scoring. */
  bbox: BBox;
  answer_type: AnswerType;
  subset: GroundingSubset;
  /** Optional image path relative to the dataset root. */
  file_name?: string;
  surface?: string;
  tags?: string[];
  eval?: {
    type: 'point_in_bbox' | 'asymmetric_overlap' | 'iou';
    /** IoU threshold when type is iou (legacy Pointerbench-Text shipped scorer). */
    threshold?: number;
    coverage_min?: number;
    precision_min?: number;
  };
}

export interface PointPrediction {
  id: string;
  point: Point;
}

export interface BBoxPrediction {
  id: string;
  bbox: BBox;
}

export type GroundingPrediction = PointPrediction | BBoxPrediction;

export interface ParsedGeometry {
  kind: AnswerType;
  point?: Point;
  bbox?: BBox;
  raw?: unknown;
}

/** Planner emits intent only. It never returns click coordinates. */
export interface PlannerIntent {
  action: 'click' | 'box' | 'type_into' | 'inspect';
  target: string;
  constraints?: string;
  /** Optional surface hint for Luminara private mirror tasks. */
  surface?: string;
}

export interface PointerRequest {
  instruction: string;
  answerType: AnswerType;
  imageWidth: number;
  imageHeight: number;
  /** When true, pointer may run multi-step zoom before finalizing. */
  agentic?: boolean;
}

export interface SubsetScore {
  subset: GroundingSubset;
  n: number;
  hits: number;
  missing: number;
  accuracy: number;
}

export interface GroundingReport {
  subsets: SubsetScore[];
  /** Arithmetic mean of subset accuracies that have n > 0. Not a blended micro-average. */
  macroAverage: number | null;
  /** Missing when any required subset was not reported. */
  gate: ModelGateResult;
}

export interface ModelGateThresholds {
  sheets: number;
  text: number;
  pro: number;
  luminara?: number;
  /** Hard floor: models that crush Sheets/Pro but fail Text are rejected. */
  textFloor: number;
}

export interface ModelGateResult {
  pass: boolean;
  reasons: string[];
  scores: Partial<Record<GroundingSubset, number>>;
  /** True when the candidate only cited a vanity GUI bench without PointerBench Text. */
  vanityOnlyRejected: boolean;
}

export interface AgenticZoomConfig {
  /** Crop half-width / half-height as a fraction of the frame on the first refine. */
  cropFraction: number;
  /** Output crop is always resized back to this frame before the second call. */
  frameWidth: number;
  frameHeight: number;
  maxSteps: number;
}
