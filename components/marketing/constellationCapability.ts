/**
 * Gate for the lazy Canvas/WebGL Visibility constellation.
 * SVG remains the default when any check fails.
 */

const MIN_WIDTH = 768;

export function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true }) ||
      canvas.getContext('experimental-webgl', { failIfMajorPerformanceCaveat: true });
    return !!gl;
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isSaveDataEnabled(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !!conn?.saveData;
}

export function isLowMemoryDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof mem === 'number' && mem > 0 && mem < 4;
}

/** True only when enhanced Canvas constellation may load. */
export function shouldUseEnhancedConstellation(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth < MIN_WIDTH) return false;
  if (prefersReducedMotion()) return false;
  if (isSaveDataEnabled()) return false;
  if (isLowMemoryDevice()) return false;
  return hasWebGL();
}
