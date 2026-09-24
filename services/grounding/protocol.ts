import type { AnswerType, PointerRequest } from './types.ts';

/** Official PointerBench frame. Do not silently resize without remapping coords. */
export const FRAME_WIDTH = 1024;
export const FRAME_HEIGHT = 768;

/**
 * Recommended inference system prompt from PointerBench.
 * @see https://github.com/warmwindOS/pointerbench
 */
export const POINTER_SYSTEM_PROMPT =
  'You are evaluating Pointerbench, a GUI grounding benchmark. ' +
  'You will receive one 1024x768 screenshot and one task instruction. ' +
  'Use absolute pixel coordinates with origin at the top-left of the image. ' +
  'Do not return normalized coordinates. Do not crop or resize the coordinate frame. ' +
  'For point tasks, return JSON like {"point": [x, y]}. ' +
  'For bounding-box tasks, return JSON like {"bbox": [x0, y0, x1, y1]}.';

/** Extra constraint for Luminara private-surface runs. */
export const LUMINARA_SURFACE_PROMPT =
  'This screenshot is a Luminara Suite product surface. ' +
  'Return only absolute pixel geometry in the 1024x768 frame. ' +
  'Prefer interactive chrome (inputs, buttons, tabs) over decorative copy.';

export const DEFAULT_BBOX_COVERAGE_MIN = 0.9;
export const DEFAULT_BBOX_PRECISION_MIN = 0.7;
export const DEFAULT_IOU_THRESHOLD = 0.7;

export function assertFixedFrame(width: number, height: number): void {
  if (width !== FRAME_WIDTH || height !== FRAME_HEIGHT) {
    throw new Error(
      `Grounding protocol requires ${FRAME_WIDTH}x${FRAME_HEIGHT}. ` +
        `Got ${width}x${height}. Resize the image OR remap predictions back to the fixed frame before scoring.`,
    );
  }
}

export function buildPointerUserPrompt(req: PointerRequest): string {
  const shape =
    req.answerType === 'bbox'
      ? 'Return JSON only: {"bbox": [x0, y0, x1, y1]}'
      : 'Return JSON only: {"point": [x, y]}';
  return [
    `Frame: ${req.imageWidth}x${req.imageHeight} absolute pixels, origin top-left.`,
    `Task: ${req.instruction}`,
    shape,
    req.agentic
      ? 'You may reason about a coarse region first, but the final answer must still be absolute pixels in the full frame.'
      : 'Single-shot: do not ask for a crop; answer in the full frame.',
  ].join('\n');
}

export function answerTypeLabel(t: AnswerType): string {
  return t === 'bbox' ? 'bounding box' : 'click point';
}
