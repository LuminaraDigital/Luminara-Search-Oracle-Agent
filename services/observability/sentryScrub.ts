/**
 * Shared Sentry event scrubber. No SDK import, so Worker and browser init can
 * both use it and stay a no-op when the DSN is unset.
 */
export const SENTRY_TRACES_SAMPLE_RATE = 0.05;
export const SENTRY_RELEASE_FALLBACK = 'luminara-suite';
const REDACTED = '[redacted]';

/** Request headers that carry a credential. None may reach Sentry. */
export const SENTRY_DENIED_HEADERS = [
  'authorization',
  'cookie',
  'x-firebase-appcheck',
  'x-telegram-init-data',
  'x-provider-key',
  'x-admin-secret',
  'x-share-password',
  'x-pagespeed-key',
  'x-goog-api-key',
  'x-api-key',
];
const AUTH_HEADERS = new Set(SENTRY_DENIED_HEADERS);

export type SentryScrubEvent = {
  message?: unknown;
  transaction?: string;
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  request?: {
    url?: string;
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

/** Share, teaser and verify links are capability URLs: whoever holds the token can open the report. */
const CAPABILITY_PATH_RE = /\/(share\/teaser|share\/reports|share|verify)\/[A-Za-z0-9_-]{16,}/g;

function scrubText(value: string): string {
  return value
    .replace(CAPABILITY_PATH_RE, '/$1/[redacted]')
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
  if (typeof event.request?.url === 'string') event.request.url = scrubText(event.request.url);
  if (typeof event.transaction === 'string') event.transaction = scrubText(event.transaction);
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.message === 'string') crumb.message = scrubText(crumb.message);
    for (const field of ['url', 'from', 'to']) {
      const value = crumb.data?.[field];
      if (crumb.data && typeof value === 'string') crumb.data[field] = scrubText(value);
    }
  }
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
