/**
 * Session-scoped cinematic intro gate for app opens (web product entry + Telegram).
 */
export const INTRO_SESSION_KEY = 'luminara_intro_v1';

export const INTRO_ASSETS = {
  webm: '/intro/luminara-intro.webm',
  mp4: '/intro/luminara-intro.mp4',
  poster: '/intro/poster.jpg',
} as const;

export function hasSeenIntroThisSession(): boolean {
  try {
    return sessionStorage.getItem(INTRO_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    sessionStorage.setItem(INTRO_SESSION_KEY, '1');
  } catch {
    /* private mode / blocked storage */
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
