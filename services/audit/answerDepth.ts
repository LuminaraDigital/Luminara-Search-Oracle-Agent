/** Header Quick / Thorough, read by the guest scout summary. Defaults to quick. */
export type AnswerDepth = 'quick' | 'thorough';

let depth: AnswerDepth = 'quick';

export function setAnswerDepth(next: AnswerDepth): void {
  depth = next;
}

export function getAnswerDepth(): AnswerDepth {
  return depth;
}
