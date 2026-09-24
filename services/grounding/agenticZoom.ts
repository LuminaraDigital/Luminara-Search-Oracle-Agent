import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  buildPointerUserPrompt,
} from './protocol.ts';
import {
  cropAroundPoint,
  mapBBoxFromCrop,
  mapPointFromCrop,
  normalizeBBox,
} from './geometry.ts';
import { parseGeometry } from './parse.ts';
import type {
  AgenticZoomConfig,
  AnswerType,
  BBox,
  ParsedGeometry,
  Point,
  PointerRequest,
} from './types.ts';

export const DEFAULT_AGENTIC_ZOOM: AgenticZoomConfig = {
  cropFraction: 0.45,
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  maxSteps: 2,
};

export interface ZoomStep {
  step: number;
  crop: BBox | null;
  promptUser: string;
  /** Geometry in the frame shown to the model (full or crop-as-frame). */
  local: ParsedGeometry;
  /** Geometry mapped into the original 1024x768 frame. */
  absolute: ParsedGeometry;
}

export type PointerCall = (args: {
  system: string;
  user: string;
  /** When set, the caller should crop the original image to this box, resize to frame, and send that. */
  crop: BBox | null;
  step: number;
}) => Promise<string>;

/**
 * Agentic zoom-crop-verify loop.
 * Step 0: full frame. Later steps: crop around prior point, resize crop to 1024x768,
 * re-ask, map coords back to the original frame.
 */
export async function runAgenticPointer(opts: {
  system: string;
  request: PointerRequest;
  call: PointerCall;
  config?: Partial<AgenticZoomConfig>;
}): Promise<{ final: ParsedGeometry; steps: ZoomStep[] }> {
  const config: AgenticZoomConfig = { ...DEFAULT_AGENTIC_ZOOM, ...opts.config };
  const steps: ZoomStep[] = [];
  let crop: BBox | null = null;
  let lastAbsolute: ParsedGeometry | null = null;

  for (let step = 0; step < config.maxSteps; step++) {
    const user = buildPointerUserPrompt({
      ...opts.request,
      agentic: true,
      instruction:
        step === 0
          ? opts.request.instruction
          : `${opts.request.instruction} (refine inside the zoomed crop; still return absolute pixels of THIS crop frame, ${config.frameWidth}x${config.frameHeight})`,
    });

    const raw = await opts.call({
      system: opts.system,
      user,
      crop,
      step,
    });

    const local = parseGeometry(raw, opts.request.answerType, {
      rejectNormalized: true,
      frameWidth: config.frameWidth,
      frameHeight: config.frameHeight,
    });
    if (!local) {
      throw new Error(`Agentic pointer step ${step}: could not parse geometry from model output`);
    }

    const absolute = mapLocalToAbsolute(local, crop, config);
    steps.push({ step, crop, promptUser: user, local, absolute });
    lastAbsolute = absolute;

    if (step + 1 >= config.maxSteps) break;

    const center = centerOf(absolute, opts.request.answerType);
    if (!center) break;
    crop = cropAroundPoint(
      center,
      config.frameWidth,
      config.frameHeight,
      config.cropFraction,
    );
  }

  if (!lastAbsolute) {
    throw new Error('Agentic pointer produced no geometry');
  }
  return { final: lastAbsolute, steps };
}

function centerOf(geo: ParsedGeometry, prefer: AnswerType): Point | null {
  if (prefer === 'point' && geo.point) return geo.point;
  if (geo.bbox) {
    const [x0, y0, x1, y1] = normalizeBBox(geo.bbox);
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  }
  if (geo.point) return geo.point;
  return null;
}

function mapLocalToAbsolute(
  local: ParsedGeometry,
  crop: BBox | null,
  config: AgenticZoomConfig,
): ParsedGeometry {
  if (!crop) return local;
  if (local.kind === 'point' && local.point) {
    return {
      kind: 'point',
      point: mapPointFromCrop(
        local.point,
        crop,
        config.frameWidth,
        config.frameHeight,
      ),
      raw: local.raw,
    };
  }
  if (local.kind === 'bbox' && local.bbox) {
    return {
      kind: 'bbox',
      bbox: mapBBoxFromCrop(
        local.bbox,
        crop,
        config.frameWidth,
        config.frameHeight,
      ),
      raw: local.raw,
    };
  }
  return local;
}
