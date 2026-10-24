/**
 * Browser Sentry. No-op when VITE_SENTRY_DSN is unset (the SDK is not loaded).
 */
import type { BrowserOptions } from '@sentry/browser';
import {
  scrubSentryEvent,
  SENTRY_RELEASE_FALLBACK,
  SENTRY_TRACES_SAMPLE_RATE,
} from './sentryScrub';

export type BrowserSentryEnv = {
  VITE_SENTRY_DSN?: string;
  VITE_SENTRY_RELEASE?: string;
  MODE?: string;
};

const sentryDataCollection: NonNullable<BrowserOptions['dataCollection']> = {
  userInfo: false,
  cookies: false,
  httpBodies: [],
  httpHeaders: { deny: ['authorization', 'cookie', 'x-firebase-appcheck'] },
};

function viteEnv(): BrowserSentryEnv {
  const env = (import.meta as ImportMeta & { env?: BrowserSentryEnv }).env;
  return env ?? {};
}

export function browserSentryOptions(env: BrowserSentryEnv): BrowserOptions | null {
  const dsn = env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return null;
  return {
    dsn,
    enabled: true,
    environment: env.MODE || 'production',
    release: env.VITE_SENTRY_RELEASE?.trim() || SENTRY_RELEASE_FALLBACK,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    dataCollection: sentryDataCollection,
    beforeSend(event) {
      return scrubSentryEvent(event);
    },
  };
}

function defaultInit(options: BrowserOptions): void {
  void import('@sentry/browser').then((Sentry) => {
    Sentry.init(options);
  });
}

/** Returns false and does not load the SDK when the DSN is missing. */
export function initBrowserSentry(
  env: BrowserSentryEnv = viteEnv(),
  init: (options: BrowserOptions) => void = defaultInit,
): boolean {
  const options = browserSentryOptions(env);
  if (!options) return false;
  init(options);
  return true;
}

export function reportBrowserError(message: string, tags?: Record<string, string>): void {
  if (!browserSentryOptions(viteEnv())) return;
  void import('@sentry/browser').then((Sentry) => {
    Sentry.captureMessage(message, { level: 'error', tags: { surface: 'web', ...tags } });
  });
}
