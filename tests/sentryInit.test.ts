import { describe, expect, it, vi } from 'vitest';
import { scrubSentryEvent, SENTRY_TRACES_SAMPLE_RATE } from '../services/observability/sentryScrub';
import { browserSentryOptions, initBrowserSentry } from '../services/observability/sentryBrowser';
import { workerSentryOptions } from '../worker/sentry';

describe('sentry init', () => {
  it('is a no-op without a DSN', () => {
    expect(initBrowserSentry({}, () => {
      throw new Error('browser init');
    })).toBe(false);
    expect(browserSentryOptions({})).toBeNull();
    const worker = workerSentryOptions({});
    expect(worker.enabled).toBe(false);
    expect(worker.dsn).toBeUndefined();
  });

  it('sets a low traces sample rate, release, and environment when a DSN is present', () => {
    const init = vi.fn();
    const dsn = 'https://public@example.ingest.sentry.io/1';
    expect(initBrowserSentry({ VITE_SENTRY_DSN: dsn, MODE: 'staging', VITE_SENTRY_RELEASE: 'luminara-suite@test' }, init)).toBe(true);
    expect(init).toHaveBeenCalledOnce();
    expect(init.mock.calls[0]?.[0]).toMatchObject({
      dsn,
      environment: 'staging',
      release: 'luminara-suite@test',
      tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
      dataCollection: { userInfo: false, cookies: false },
    });
    expect(SENTRY_TRACES_SAMPLE_RATE).toBeLessThanOrEqual(0.1);

    const worker = workerSentryOptions({
      SENTRY_DSN: dsn,
      ENVIRONMENT: 'staging',
      SENTRY_RELEASE: 'luminara-suite@test',
    });
    expect(worker).toMatchObject({
      enabled: true,
      dsn,
      environment: 'staging',
      release: 'luminara-suite@test',
      tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
      dataCollection: { userInfo: false, cookies: false },
    });
  });

  it('scrubs auth headers, cookies, and PII in beforeSend', () => {
    const event = {
      message: 'Bearer secret.token and eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.signature',
      request: {
        headers: {
          Authorization: 'Bearer id-token',
          'X-Firebase-AppCheck': 'app-check-token',
          cookie: 'session=secret',
          accept: 'application/json',
        },
        cookies: { session: 'secret' },
      },
      user: {
        email: 'ada@example.com',
        username: 'ada',
        ip_address: '203.0.113.5',
        geo: { city: 'Lagos' },
        id: 'account-1',
      },
    };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.request?.headers).toEqual({
      Authorization: '[redacted]',
      'X-Firebase-AppCheck': '[redacted]',
      cookie: '[redacted]',
      accept: 'application/json',
    });
    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.user).toMatchObject({
      email: '[redacted]',
      username: '[redacted]',
      ip_address: '[redacted]',
      id: 'account-1',
    });
    expect(scrubbed.user?.geo).toBeUndefined();
    expect(scrubbed.message).not.toContain('secret.token');
    expect(scrubbed.message).not.toContain('eyJhbGci');

    const options = browserSentryOptions({ VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1' });
    const viaHook = options?.beforeSend?.({
      request: { headers: { Authorization: 'Bearer secret' } },
    }, {});
    expect(viaHook && 'request' in viaHook ? viaHook.request?.headers?.Authorization : '').toBe('[redacted]');
  });
});