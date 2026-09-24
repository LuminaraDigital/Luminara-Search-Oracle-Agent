import { useCallback, useRef, useState } from 'react';

/**
 * Submission lock: ignores re-entrant calls while an async action is in flight.
 * Use for mutation buttons (save, checkout, register) to stop double-clicks.
 */
export function useAsyncLock() {
  const lockedRef = useRef(false);
  const [pending, setPending] = useState(false);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (lockedRef.current) return undefined;
    lockedRef.current = true;
    setPending(true);
    try {
      return await action();
    } finally {
      lockedRef.current = false;
      setPending(false);
    }
  }, []);

  return { pending, run };
}
