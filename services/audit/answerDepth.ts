/** Header Quick / Thorough, read by the guest scout summary. Defaults to quick. */
export type AnswerDepth = 'quick' | 'thorough';

const STORAGE_KEY = 'luminara_answer_depth';

function storedDepth(): AnswerDepth {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'thorough' ? 'thorough' : 'quick';
  } catch {
    return 'quick';
  }
}

let depth: AnswerDepth | undefined;

export function setAnswerDepth(next: AnswerDepth): void {
  depth = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode or a blocked store: the choice lasts for this page only */
  }
}

export function getAnswerDepth(): AnswerDepth {
  if (!depth) depth = storedDepth();
  return depth;
}
