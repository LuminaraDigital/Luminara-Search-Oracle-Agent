/**
 * One-time first-run tour for signed-in web users.
 * The account copy lives in the workspace storage bag (MEMORY_KEYS).
 * shortcut: the account push is best-effort. localStorage already holds the flag if that push fails.
 */

export const FIRST_RUN_TOUR_KEY = 'luminara_first_run_tour';

export const TOUR_STEP_COUNT = 4;

export type TourStep = 1 | 2 | 3 | 4;

/** null: show step 1 when the website field is on screen. */
export type TourFlag = null | '2' | '3' | '4' | 'done';

export type TourAnchor = {
  step: TourStep;
  title: string;
  body: string;
  anchorId: string;
};

export const TOUR_COPY: readonly TourAnchor[] = [
  {
    step: 1,
    title: 'Your website',
    body: "Enter your agency's website.",
    anchorId: 'audit-target-url',
  },
  {
    step: 2,
    title: 'Your result',
    body: 'This is your result. The score is how many checks passed.',
    anchorId: 'tour-audit-result',
  },
  {
    step: 3,
    title: 'Your first fix',
    body: 'This is the first fix.',
    anchorId: 'tour-top-fix',
  },
  {
    step: 4,
    title: 'Mark it done',
    body: 'Mark it done. We will recheck it.',
    anchorId: 'tour-mark-done',
  },
];

export type TourAnchors = {
  hasUrl: boolean;
  hasResult: boolean;
  hasFix: boolean;
  hasRecheck: boolean;
};

type Kv = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type TourPersistDeps = {
  store?: Kv;
  push?: () => void;
};

function isTourFlag(value: string | null): value is Exclude<TourFlag, null> {
  return value === '2' || value === '3' || value === '4' || value === 'done';
}

function storeOf(deps?: TourPersistDeps): Kv | null {
  if (deps?.store) return deps.store;
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readTourFlag(deps?: TourPersistDeps): TourFlag {
  try {
    const raw = storeOf(deps)?.getItem(FIRST_RUN_TOUR_KEY) ?? null;
    return isTourFlag(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function tourCopy(step: TourStep): TourAnchor {
  switch (step) {
    case 1: return TOUR_COPY[0];
    case 2: return TOUR_COPY[1];
    case 3: return TOUR_COPY[2];
    case 4: return TOUR_COPY[3];
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

/** Step 2 was requested and the result is not on screen yet. The tour stays visible. */
export function tourIsWaiting(input: {
  signedInWeb: boolean;
  flag: TourFlag;
  anchors: TourAnchors;
}): boolean {
  return input.signedInWeb && input.flag === '2' && !input.anchors.hasResult;
}

/** Which step to show. Null means wait, or the tour is finished. */
export function tourStepToShow(input: {
  signedInWeb: boolean;
  flag: TourFlag;
  anchors: TourAnchors;
}): TourStep | null {
  if (!input.signedInWeb || input.flag === 'done') return null;
  const { hasUrl, hasResult, hasFix, hasRecheck } = input.anchors;
  if (input.flag == null) {
    if (hasUrl) return 1;
    if (hasResult) return 2;
    return null;
  }
  if (input.flag === '2') return hasResult ? 2 : null;
  if (input.flag === '3') return hasFix ? 3 : null;
  if (input.flag === '4') return hasRecheck ? 4 : null;
  const _exhaustive: never = input.flag;
  return _exhaustive;
}

/** Next flag. 'stay' keeps the current step when the next anchor is not on screen. */
export function flagAfterNext(input: {
  step: TourStep;
  anchors: TourAnchors;
}): TourFlag | 'stay' {
  if (input.step === 1) return '2';
  if (input.step === 2) return input.anchors.hasFix ? '3' : 'stay';
  if (input.step === 3) return input.anchors.hasRecheck ? '4' : 'stay';
  if (input.step === 4) return 'done';
  const _exhaustive: never = input.step;
  return _exhaustive;
}

export function flagAfterBack(step: TourStep): TourFlag {
  if (step === 4) return '3';
  if (step === 3) return '2';
  return null;
}

export function persistTourFlag(flag: TourFlag, deps?: TourPersistDeps): void {
  const store = storeOf(deps);
  if (!store) return;
  try {
    if (flag == null) store.removeItem(FIRST_RUN_TOUR_KEY);
    else store.setItem(FIRST_RUN_TOUR_KEY, flag);
  } catch {
    return;
  }
  try {
    deps?.push?.();
  } catch {
    /* localStorage already holds the flag */
  }
}

export function replayTour(deps?: TourPersistDeps): void {
  persistTourFlag(null, deps);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('luminara-replay-tour'));
}

export function progressLabel(step: TourStep): string {
  return `${step} of ${TOUR_STEP_COUNT}`;
}
