/**
 * Browser Sentry envelope reporter (optional VITE_SENTRY_DSN).
 */
import { sendSentryEvent } from './sentryEnvelope';

let installed = false;

export function initBrowserSentry(): void {
  if (installed || typeof window === 'undefined') return;
  const dsn = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SENTRY_DSN;
  if (!dsn) return;
  installed = true;
  const envName =
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.MODE || 'production';

  window.addEventListener('error', (ev) => {
    void sendSentryEvent({
      dsn,
      message: ev.error?.stack || ev.message || 'window.error',
      level: 'error',
      environment: envName,
      platform: 'javascript',
      tags: { surface: 'web' },
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const message =
      reason instanceof Error ? reason.stack || reason.message : String(reason || 'unhandledrejection');
    void sendSentryEvent({
      dsn,
      message,
      level: 'error',
      environment: envName,
      platform: 'javascript',
      tags: { surface: 'web', kind: 'unhandledrejection' },
    });
  });
}

export function reportBrowserError(message: string, tags?: Record<string, string>): void {
  const dsn = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SENTRY_DSN;
  if (!dsn) return;
  void sendSentryEvent({
    dsn,
    message,
    level: 'error',
    platform: 'javascript',
    tags: { surface: 'web', ...tags },
  });
}
