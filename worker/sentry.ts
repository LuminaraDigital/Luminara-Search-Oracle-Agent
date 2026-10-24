/**
 * Worker Sentry (@sentry/cloudflare). No-op when SENTRY_DSN is unset:
 * the handler is not wrapped and captureException is not called.
 */
import * as Sentry from '@sentry/cloudflare';
import type { Env } from './env';
import {
  scrubSentryEvent,
  SENTRY_RELEASE_FALLBACK,
  SENTRY_TRACES_SAMPLE_RATE,
} from '../services/observability/sentryScrub';

export { SENTRY_TRACES_SAMPLE_RATE };

type SentryEnv = {
  SENTRY_DSN?: string;
  SENTRY_RELEASE?: string;
  ENVIRONMENT?: string;
};

export function workerSentryOptions(env: SentryEnv): Sentry.CloudflareOptions {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return { enabled: false };
  return {
    dsn,
    enabled: true,
    environment: env.ENVIRONMENT?.trim() || 'production',
    release: env.SENTRY_RELEASE?.trim() || SENTRY_RELEASE_FALLBACK,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      httpHeaders: { deny: ['authorization', 'cookie', 'x-firebase-appcheck'] },
    },
    beforeSend(event) {
      return scrubSentryEvent(event);
    },
  };
}

/**
 * Wraps fetch, scheduled, and queue only after a DSN is present.
 * withSentry proxies D1 and other bindings, so an unset DSN must stay on the original handler.
 */
export function bindWorkerSentry(base: ExportedHandler<Env>): ExportedHandler<Env> {
  let wrapped: ExportedHandler<Env> | null = null;
  const resolve = (env: Env): ExportedHandler<Env> => {
    if (!env.SENTRY_DSN?.trim()) return base;
    if (!wrapped) {
      const fetchHandler = base.fetch;
      const scheduled = base.scheduled;
      const queue = base.queue;
      const clone: ExportedHandler<Env> = {
        fetch: fetchHandler
          ? (request, nextEnv, ctx) => fetchHandler(request, nextEnv, ctx)
          : undefined,
        scheduled: scheduled
          ? (controller, nextEnv, ctx) => scheduled(controller, nextEnv, ctx)
          : undefined,
        queue: queue ? (batch, nextEnv, ctx) => queue(batch, nextEnv, ctx) : undefined,
      };
      wrapped = Sentry.withSentry((nextEnv: Env) => workerSentryOptions(nextEnv), clone);
    }
    return wrapped;
  };
  return {
    fetch(request, env, ctx) {
      const fetchHandler = resolve(env).fetch;
      if (!fetchHandler) return new Response('Not found', { status: 404 });
      return fetchHandler(request, env, ctx);
    },
    scheduled(controller, env, ctx) {
      const scheduled = resolve(env).scheduled;
      if (scheduled) return scheduled(controller, env, ctx);
    },
    queue(batch, env, ctx) {
      const queue = resolve(env).queue;
      if (queue) return queue(batch, env, ctx);
    },
  };
}

export function reportWorkerException(
  env: SentryEnv,
  err: unknown,
  tags?: Record<string, string>,
): void {
  if (!env.SENTRY_DSN?.trim()) return;
  Sentry.captureException(err, { tags: { surface: 'worker', ...tags } });
}
