/**
 * Telegram Apps Center analytics. Off unless both public build vars are set.
 * No token is shipped in the tree. A missing or rejected script stays silent.
 */
const ANALYTICS_SRC = 'https://tganalytics.xyz/index.js';

type AnalyticsWindow = Window & {
  telegramAnalytics?: { init: (opts: { token: string; appName: string }) => void };
};

export function readTelegramAnalyticsConfig(
  env: Record<string, string | undefined> | undefined,
): { token: string; appName: string } | null {
  const token = (env?.VITE_TG_ANALYTICS_TOKEN || '').trim();
  const appName = (env?.VITE_TG_ANALYTICS_APP_NAME || '').trim();
  if (!token || !appName) return null;
  return { token, appName };
}

function viteEnv(): Record<string, string | undefined> {
  return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
}

export function initTelegramAnalytics(env?: Record<string, string | undefined>): void {
  const config = readTelegramAnalyticsConfig(env ?? viteEnv());
  if (!config || typeof document === 'undefined') return;

  const start = () => {
    try {
      (window as AnalyticsWindow).telegramAnalytics?.init(config);
    } catch {
      /* catalog analytics is optional */
    }
  };

  const existing = document.querySelector(`script[src="${ANALYTICS_SRC}"]`);
  if (existing) {
    if ((window as AnalyticsWindow).telegramAnalytics) start();
    else existing.addEventListener('load', start, { once: true });
    return;
  }

  const script = document.createElement('script');
  script.src = ANALYTICS_SRC;
  script.async = true;
  script.onload = () => start();
  script.onerror = () => {};
  document.head.appendChild(script);
}
