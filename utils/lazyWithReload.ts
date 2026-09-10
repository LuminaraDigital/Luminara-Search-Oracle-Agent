import React from 'react';

const RELOAD_FLAG = 'luminara_chunk_reload';

/** True when a dynamic import failed because a hashed chunk is missing or not JS. */
export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Loading chunk [\w-]+ failed/i.test(msg)
  );
}

/**
 * Like React.lazy, but one hard reload when a deploy invalidated a hashed chunk.
 * Avoids an infinite loop via sessionStorage.
 */
export function lazyWithReload<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      const mod = await factory();
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch {
        /* private mode */
      }
      return mod;
    } catch (error) {
      if (isChunkLoadError(error) && typeof window !== 'undefined') {
        let alreadyReloaded = false;
        try {
          alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
          if (!alreadyReloaded) sessionStorage.setItem(RELOAD_FLAG, '1');
        } catch {
          /* private mode: still attempt one reload */
        }
        if (!alreadyReloaded) {
          window.location.reload();
          return new Promise(() => {
            /* pending until unload */
          });
        }
      }
      throw error;
    }
  });
}

/** Session-guarded full reload for chunk errors surfaced via ErrorBoundary. */
export function reloadOnceForChunkError(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === '1') return false;
    sessionStorage.setItem(RELOAD_FLAG, '1');
  } catch {
    /* still reload once */
  }
  window.location.reload();
  return true;
}
