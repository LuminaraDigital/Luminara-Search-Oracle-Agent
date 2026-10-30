/**
 * Detect the Electron desktop shell (Hermes-style native window).
 * Prefer the preload bridge; accept ?desktop=1 as a fallback for first paint.
 */

export type DesktopUpdateStatus = {
  status: string;
  detail?: unknown;
  at?: number;
};

export type DesktopUpdatePrefs = {
  autoUpdateEnabled: boolean;
  packaged: boolean;
  shellVersion: string;
};

export type LuminaraDesktopBridge = {
  getInfo: () => Promise<{
    shellVersion: string;
    webappUrl: string;
    platform: string;
    packaged: boolean;
    autoUpdateEnabled?: boolean;
  }>;
  openExternal: (url: string) => Promise<void>;
  getUpdatePrefs: () => Promise<DesktopUpdatePrefs>;
  setAutoUpdate: (enabled: boolean) => Promise<{ autoUpdateEnabled: boolean }>;
  checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>;
  installUpdate: () => Promise<{ ok: boolean; reason?: string }>;
  retryConnection?: () => Promise<void>;
  onUpdateStatus: (callback: (payload: DesktopUpdateStatus) => void) => () => void;
  getCoordinatorStatus?: () => Promise<Record<string, unknown>>;
  checkCrawlerHealth?: () => Promise<{
    healthy: boolean;
    port: number;
    pid: number | null;
    lastCheckedAt: string | null;
  }>;
  superviseCrawler?: (opts?: { spawnIfDown?: boolean }) => Promise<{ healthy: boolean; port: number; pid: number | null }>;
  resolveProfile?: (profileId: string) => Promise<{ profileId: string; profilePath: string }>;
  resolveBrowserProfile?: (profileId: string) => Promise<{ profileId: string; profilePath: string }>;
  listRoutines?: () => Promise<Array<Record<string, unknown>>>;
  upsertRoutine?: (routine: Record<string, unknown>) => Promise<Record<string, unknown>>;
  runRoutineOnce?: (routineId: string, simulatedResponse?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  validateMcpCall?: (payload: Record<string, unknown>) => Promise<{ allowed: boolean; reason: string | null }>;
  validateMcpInvocation?: (payload: Record<string, unknown>) => Promise<{ allowed: boolean; reason: string | null }>;
  storeSecret?: (
    key: string,
    plaintext: string,
  ) => Promise<{ key?: string; stored: boolean; encrypted: boolean; encryptedWithOsKeychain?: boolean }>;
  hasSecret?: (key: string) => Promise<boolean>;
};

declare global {
  interface Window {
    luminaraDesktop?: LuminaraDesktopBridge;
  }
}

/** Default product view when the desktop shell opens (no marketing landing). */
export const DESKTOP_DEFAULT_VIEW = 'INSTANT_AUDIT' as const;

export function isDesktopShell(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.luminaraDesktop) return true;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('desktop') === '1' || q.get('client') === 'desktop') return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Native product surfaces skip marketing acquisition pages. */
export function isNativeClientShell(): boolean {
  return isDesktopShell();
}

export function getDesktopBridge(): LuminaraDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return window.luminaraDesktop || null;
}
