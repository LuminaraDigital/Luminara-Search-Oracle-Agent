import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Throttle an async action: at most one in-flight execution, and at most one
 * start per `intervalMs` window. Aborts the previous AbortController when a
 * new run is allowed (caller should pass signal into fetch).
 */
export function useThrottledAction(intervalMs = 400) {
  const lastStartRef = useRef(0);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const run = useCallback(
    async <T,>(action: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
      const now = Date.now();
      if (inFlightRef.current) return undefined;
      if (now - lastStartRef.current < intervalMs) return undefined;

      abortRef.current?.abort();
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      abortRef.current = controller;
      inFlightRef.current = true;
      lastStartRef.current = now;
      setPending(true);
      try {
        const signal = controller?.signal ?? (new AbortController().signal);
        return await action(signal);
      } finally {
        inFlightRef.current = false;
        setPending(false);
      }
    },
    [intervalMs],
  );

  return { pending, run };
}
