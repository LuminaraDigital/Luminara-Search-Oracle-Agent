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

let insideTelegram = false;
let initialised = false;

export function isInTelegram(): boolean {
  return insideTelegram;
}

/** Call once before rendering. Resolves quickly outside Telegram. */
export async function initTelegram(): Promise<boolean> {
  if (initialised) return insideTelegram;
  initialised = true;
  try {
    insideTelegram = await isTMA('complete');
  } catch {
    insideTelegram = false;
  }
  if (!insideTelegram) return false;

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
    console.warn('[TMA] init failed, running as plain web', e);
    insideTelegram = false;
  }
  return insideTelegram;
}

/** Raw signed launch context; send this to the server, never trust its fields on the client. */
export function getInitDataRaw(): string {
  if (!insideTelegram) return '';
  try {
    return initData.raw() || '';
  } catch {
    return '';
  }
}

export function getStartParam(): string | undefined {
  if (!insideTelegram) return undefined;
  try {
    return retrieveLaunchParams().tgWebAppStartParam;
  } catch {
    return undefined;
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
  if (!insideTelegram || !openInvoice.isAvailable()) {
    window.open(invoiceUrl, '_blank', 'noopener');
    return 'pending';
  }
  const status = await openInvoice(invoiceUrl, 'url');
  return status as 'paid' | 'cancelled' | 'failed' | 'pending';
}
