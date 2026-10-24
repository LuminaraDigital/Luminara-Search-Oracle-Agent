/**
 * Shared Sentry event scrubber. No SDK import, so Worker and browser init can
 * both use it and stay a no-op when the DSN is unset.
 */
export const SENTRY_TRACES_SAMPLE_RATE = 0.05;
export const SENTRY_RELEASE_FALLBACK = 'luminara-suite';
const REDACTED = '[redacted]';

const AUTH_HEADERS = new Set(['authorization', 'cookie', 'x-firebase-appcheck']);

export type SentryScrubEvent = {
  message?: unknown;
  request?: {
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
  };
  user?: {
    email?: string;
    username?: string;
    ip_address?: string | null;
    geo?: unknown;
  };
  exception?: {
    values?: Array<{ value?: string }>;
  };
};

function scrubText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]');
}

/** Drops auth headers, cookies, and common PII before an event leaves the process. */
export function scrubSentryEvent<T extends SentryScrubEvent>(event: T): T {
  const headers = event.request?.headers;
  if (headers) {
    for (const name of Object.keys(headers)) {
      if (AUTH_HEADERS.has(name.toLowerCase())) headers[name] = REDACTED;
    }
  }
  if (event.request && 'cookies' in event.request) delete event.request.cookies;
  const user = event.user;
  if (user) {
    if (user.email) user.email = REDACTED;
    if (user.username) user.username = REDACTED;
    if (user.ip_address) user.ip_address = REDACTED;
    if (user.geo) delete user.geo;
  }
  if (typeof event.message === 'string') event.message = scrubText(event.message);
  const values = event.exception?.values;
  if (values) {
    for (const item of values) {
      if (typeof item.value === 'string') item.value = scrubText(item.value);
    }
  }
  return event;
}
