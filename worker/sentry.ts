/**
 * Worker exception reporter (optional SENTRY_DSN).
 */
import { sendSentryEvent } from '../services/observability/sentryEnvelope';

export { sendSentryEvent };

export function reportWorkerException(
  env: { SENTRY_DSN?: string; ENVIRONMENT?: string },
  err: unknown,
  tags?: Record<string, string>,
): void {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return;
  const message = err instanceof Error ? err.stack || err.message : String(err);
  void sendSentryEvent({
    dsn,
    message,
    level: 'error',
    environment: env.ENVIRONMENT || 'production',
    platform: 'javascript',
    tags: { surface: 'worker', ...tags },
  });
}
