import type { AnswerType, PlannerIntent, PointerRequest } from './types.ts';
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  LUMINARA_SURFACE_PROMPT,
  POINTER_SYSTEM_PROMPT,
  buildPointerUserPrompt,
} from './protocol.ts';

const ACTION_VERBS: Record<PlannerIntent['action'], string> = {
  click: 'Click',
  box: 'Draw a tight box around',
  type_into: 'Click into the field for',
  inspect: 'Locate',
};

/**
 * Planner / pointer split:
 * - Planner: language only (what to do). Never emits coordinates.
 * - Pointer: screenshot + grounded instruction -> absolute geometry only.
 */
export function composePointerInstruction(intent: PlannerIntent): string {
  const verb = ACTION_VERBS[intent.action];
  const base = `${verb} ${intent.target}`.replace(/\s+/g, ' ').trim();
  if (intent.constraints?.trim()) {
    return `${base}. Constraint: ${intent.constraints.trim()}`;
  }
  return base;
}

export function intentToPointerRequest(
  intent: PlannerIntent,
  opts?: { agentic?: boolean; answerType?: AnswerType },
): PointerRequest {
  const answerType =
    opts?.answerType ?? (intent.action === 'box' ? 'bbox' : 'point');
  return {
    instruction: composePointerInstruction(intent),
    answerType,
    imageWidth: FRAME_WIDTH,
    imageHeight: FRAME_HEIGHT,
    agentic: opts?.agentic ?? false,
  };
}

/** Full pointer message pair for a vision model call. */
export function buildPointerMessages(
  intent: PlannerIntent,
  opts?: { agentic?: boolean; answerType?: AnswerType; luminaraSurface?: boolean },
): { system: string; user: string; request: PointerRequest } {
  const request = intentToPointerRequest(intent, opts);
  const system = opts?.luminaraSurface
    ? `${POINTER_SYSTEM_PROMPT} ${LUMINARA_SURFACE_PROMPT}`
    : POINTER_SYSTEM_PROMPT;
  return {
    system,
    user: buildPointerUserPrompt(request),
    request,
  };
}

/** Reject planner outputs that smuggle coordinates (protocol invariant). */
export function plannerEmittedCoordinates(text: string): boolean {
  const lower = text.toLowerCase();
  if (/"point"\s*:/.test(lower) || /"bbox"\s*:/.test(lower)) return true;
  if (/\bcoords?\b/.test(lower) && /\d+\s*,\s*\d+/.test(text)) return true;
  return false;
}
