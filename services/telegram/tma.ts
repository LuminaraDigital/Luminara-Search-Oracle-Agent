/**
 * Telegram Mini App bridge (thin wrapper over @telegram-apps/sdk-react).
 *
 * The app runs in two environments: a normal browser at luminarasuite.com and inside Telegram.
 * Everything here is feature-gated so the web build keeps working when Telegram is absent.
 */
import {
  init as sdkInit,
  isTMA,
  initData,
  miniApp,
  themeParams,
  viewport,
  backButton,
  mainButton,
  hapticFeedback,
  openInvoice,
  retrieveLaunchParams,
  swipeBehavior,
  closingBehavior,
} from '@telegram-apps/sdk-react';

function detectTelegramSync(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (isTMA()) return true;
  } catch { /* ignore */ }
  try {
    const w = window as any;
    if (w.TelegramWebviewProxy) return true;
    const wa = w.Telegram?.WebApp;
    if (!wa) return false;
    // Real Mini App sessions always carry signed initData; the script alone is not enough
    // (telegram-web-app.js is also loaded on the public website).
    if (typeof wa.initData === 'string' && wa.initData.length > 0) return true;
    const platform = typeof wa.platform === 'string' ? wa.platform : '';
    if (platform && platform !== 'unknown') return true;
  } catch { /* ignore */ }
  return false;
}

let insideTelegram = detectTelegramSync();
let initStarted = false;
let readySettled = false;
let resolveReady: ((value: boolean) => void) | null = null;
const readyPromise = new Promise<boolean>((resolve) => {
  resolveReady = resolve;
});
const readyListeners = new Set<(inside: boolean) => void>();

function finishReady(inside: boolean): boolean {
  insideTelegram = inside;
  readySettled = true;
  resolveReady?.(inside);
  resolveReady = null;
  readyListeners.forEach((cb) => {
    try { cb(inside); } catch { /* ignore listener errors */ }
  });
  return inside;
}

export function isInTelegram(): boolean {
  return insideTelegram;
}

/** Resolves once initTelegram has finished (or immediately if already done). */
export function whenTelegramReady(): Promise<boolean> {
  if (readySettled) return Promise.resolve(insideTelegram);
  // Hooks can race the boot call; ensure init is in flight.
  void initTelegram();
  return readyPromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for signed initData after Telegram is ready.
 * Some clients inject WebApp.initData a few frames after the bridge mounts.
 */
export async function waitForInitDataRaw(opts?: {
  attempts?: number;
  intervalMs?: number;
}): Promise<string> {
  const attempts = opts?.attempts ?? 6;
  const intervalMs = opts?.intervalMs ?? 50;
  const inside = await whenTelegramReady();
  if (!inside) return '';
  for (let i = 0; i < attempts; i++) {
    const raw = getInitDataRaw();
    if (raw) return raw;
    if (i < attempts - 1) await sleep(intervalMs);
  }
  return getInitDataRaw();
}

/** Subscribe to Telegram environment readiness (for React re-renders). */
export function subscribeTelegramReady(cb: (inside: boolean) => void): () => void {
  readyListeners.add(cb);
  if (readySettled) {
    try { cb(insideTelegram); } catch { /* ignore */ }
  }
  return () => { readyListeners.delete(cb); };
}

/** Native bridge fallback before / alongside @telegram-apps/sdk restore. */
function nativeInitData(): string {
  try {
    const raw = (window as any)?.Telegram?.WebApp?.initData;
    return typeof raw === 'string' ? raw : '';
  } catch {
    return '';
  }
}

/** Call once before rendering. Resolves instantly (0ms) outside Telegram. */
export async function initTelegram(timeoutMs = 1200): Promise<boolean> {
  if (readySettled) return insideTelegram;
  if (initStarted) return readyPromise;
  initStarted = true;

  const syncHit = detectTelegramSync();
  if (!syncHit) {
    return finishReady(false);
  }

  // Never demote a sync-detected Mini App to "web" on a slow isTMA() race.
  // That bug routed real Telegram users onto the marketing landing + Firebase wall.
  try {
    const confirmed = await Promise.race([
      isTMA('complete'),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs)),
    ]);
    insideTelegram = Boolean(confirmed) || syncHit;
  } catch {
    insideTelegram = syncHit;
  }
  if (!insideTelegram) return finishReady(false);

  try {
    sdkInit();
    initData.restore();
    backButton.mount.ifAvailable();
    if (miniApp.mount.isAvailable()) {
      themeParams.mount();
      miniApp.mount();
      themeParams.bindCssVars();
      // The product is dark obsidian; keep Telegram's chrome consistent with it.
      if (miniApp.setHeaderColor.isAvailable()) miniApp.setHeaderColor('#000000');
      if (miniApp.setBackgroundColor.isAvailable()) miniApp.setBackgroundColor('#000000');
      if (miniApp.setBottomBarColor.isAvailable()) miniApp.setBottomBarColor('#000000');
    }
    if (viewport.mount.isAvailable()) {
      await viewport.mount();
      viewport.bindCssVars();
      if (viewport.expand.isAvailable()) viewport.expand();
      try {
        if ((viewport as any).requestFullscreen?.isAvailable?.()) {
          (viewport as any).requestFullscreen();
        }
      } catch { /* ignore older TMA versions */ }
    }
    // Chat-style scrolling inside the app should not swipe the Mini App closed.
    if (swipeBehavior.mount.isAvailable()) {
      swipeBehavior.mount();
      if (swipeBehavior.disableVertical.isAvailable()) swipeBehavior.disableVertical();
    }
    if (closingBehavior.mount.isAvailable()) {
      closingBehavior.mount();
      if (closingBehavior.enableConfirmation.isAvailable()) closingBehavior.enableConfirmation();
    }
    if (miniApp.ready.isAvailable()) miniApp.ready();
  } catch (e) {
    console.warn('[TMA] init failed; keeping Telegram mode if native initData exists', e);
    if (nativeInitData() || syncHit) {
      return finishReady(true);
    }
    return finishReady(false);
  }
  return finishReady(true);
}

/** Raw signed launch context; send this to the server, never trust its fields on the client. */
export function getInitDataRaw(): string {
  if (!insideTelegram && !detectTelegramSync()) return '';
  try {
    const fromSdk = initData.raw() || '';
    if (fromSdk) return fromSdk;
  } catch { /* SDK not restored yet */ }
  return nativeInitData();
}

export function getStartParam(): string | undefined {
  if (typeof window !== 'undefined' && window.location) {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const param = urlParams.get('tgWebAppStartParam') || urlParams.get('startapp');
      if (param) return param;
    } catch { /* ignore */ }
  }
  if (!insideTelegram) return undefined;
  try {
    return retrieveLaunchParams().tgWebAppStartParam;
  } catch {
    return undefined;
  }
}

/** True when the URL carries Mini App launch hints (used for first-paint routing only). */
export function hasTelegramLaunchHints(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    return Boolean(q.get('tgWebAppStartParam') || q.get('startapp') || q.get('tgWebAppData'));
  } catch {
    return false;
  }
}

export function getTelegramUserUnsafe() {
  if (!insideTelegram) return null;
  try {
    return initData.user() ?? null;
  } catch {
    return null;
  }
}

export function haptic(kind: 'light' | 'medium' | 'success' | 'error' = 'light') {
  if (!insideTelegram) return;
  try {
    if (kind === 'success' || kind === 'error') {
      if (hapticFeedback.notificationOccurred.isAvailable()) hapticFeedback.notificationOccurred(kind);
    } else if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred(kind);
    }
  } catch { /* unsupported client */ }
}

/** Shows Telegram's native back button; returns a disposer. */
export function useTelegramBackButton(onBack: (() => void) | null): () => void {
  if (!insideTelegram || !backButton.isMounted()) return () => {};
  if (!onBack) {
    if (backButton.hide.isAvailable()) backButton.hide();
    return () => {};
  }
  if (backButton.show.isAvailable()) backButton.show();
  const off = backButton.onClick(onBack);
  return () => {
    off();
    if (backButton.hide.isAvailable()) backButton.hide();
  };
}

/** Telegram's bottom main button, used for the primary action of a screen. */
export function setTelegramMainButton(opts: { text: string; onClick: () => void; loading?: boolean; enabled?: boolean } | null): () => void {
  if (!insideTelegram) return () => {};
  try {
    if (!mainButton.isMounted()) mainButton.mount();
    if (!opts) {
      mainButton.setParams({ isVisible: false });
      return () => {};
    }
    mainButton.setParams({
      text: opts.text,
      isVisible: true,
      isEnabled: opts.enabled ?? true,
      isLoaderVisible: Boolean(opts.loading),
      backgroundColor: '#BF953F',
      textColor: '#000000',
    });
    const off = mainButton.onClick(opts.onClick);
    return () => {
      off();
      mainButton.setParams({ isVisible: false });
    };
  } catch {
    return () => {};
  }
}

export async function payWithStars(invoiceUrl: string): Promise<'paid' | 'cancelled' | 'failed' | 'pending'> {
  if (!insideTelegram) {
    if (typeof window !== 'undefined') {
      window.open(invoiceUrl, '_blank', 'noopener');
    }
    return 'pending';
  }

  // 1. Primary: @telegram-apps/sdk openInvoice
  try {
    if (openInvoice.isAvailable()) {
      const status = await openInvoice(invoiceUrl, 'url');
      return (status as 'paid' | 'cancelled' | 'failed' | 'pending') || 'pending';
    }
  } catch (err) {
    console.warn('[TMA] SDK openInvoice encountered an error, trying native bridge fallback', err);
  }

  // 2. Secondary: native Telegram.WebApp.openInvoice callback bridge
  if (typeof window !== 'undefined') {
    const tgWebApp = (window as any).Telegram?.WebApp;
    if (tgWebApp && typeof tgWebApp.openInvoice === 'function') {
      return new Promise<'paid' | 'cancelled' | 'failed' | 'pending'>((resolve) => {
        try {
          tgWebApp.openInvoice(invoiceUrl, (status: string) => {
            if (status === 'paid' || status === 'cancelled' || status === 'failed' || status === 'pending') {
              resolve(status);
            } else {
              resolve('pending');
            }
          });
        } catch {
          resolve('failed');
        }
      });
    }
  }

  // 3. Last resort fallback
  if (typeof window !== 'undefined') {
    window.open(invoiceUrl, '_blank', 'noopener');
  }
  return 'pending';
}
