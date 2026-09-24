import { useCallback, useEffect, useRef } from 'react';

/**
 * Debounce a callback (default 400ms). Cancels pending work on unmount.
 * Use for search typeahead and other rapid input-to-network paths.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs = 400,
): (...args: Args) => void {
  const cbRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    cbRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback(
    (...args: Args) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        cbRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}
