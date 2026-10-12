/**
 * Queue dispatch for the Worker's queue() handler.
 * Each queue this Worker consumes (wrangler.jsonc `queues.consumers`, top level and per env)
 * maps to the one handler that owns it. Keep QUEUE_HANDLERS in step with wrangler.jsonc: a new
 * consumer and its entry here ship in the same pull request.
 *
 * A batch from a queue with no entry is acknowledged and reported, and none of its messages is
 * processed. Its messages have a shape no handler here knows, so running them as audit jobs
 * would be wrong, and retrying them would only deliver them here again.
 *
 * The audit handler settles its own messages one by one (ack on success, retry on failure).
 * If a handler throws instead of settling, the error is reported and the batch is sent back for
 * retry: Cloudflare acknowledges every unsettled message once queue() returns normally, so
 * swallowing the error without a retry would lose them. Messages the handler had already
 * acknowledged stay acknowledged; the consumer's max_retries and dead letter queue still apply.
 */
import type { Env } from './env';
import { processAuditQueueBatch } from './auditQueue';

export type QueueBatchHandler = (batch: MessageBatch<unknown>, env: Env) => Promise<void>;

/** Agency queued audit runs: the production queue and the staging queue. */
export const AUDIT_QUEUE = 'luminara-audit-jobs';
export const AUDIT_QUEUE_STAGING = 'luminara-audit-jobs-staging';

const runAuditBatch: QueueBatchHandler = (batch, env) =>
  processAuditQueueBatch(batch as Parameters<typeof processAuditQueueBatch>[0], env);

const QUEUE_HANDLERS: Record<string, QueueBatchHandler> = {
  [AUDIT_QUEUE]: runAuditBatch,
  [AUDIT_QUEUE_STAGING]: runAuditBatch,
};

/** True when the queue name has an explicit entry in QUEUE_HANDLERS. */
export function isQueueMapped(queue: string): boolean {
  return Object.hasOwn(QUEUE_HANDLERS, String(queue || ''));
}

/** Route one batch to the handler that owns its queue. Never throws. */
export async function dispatchQueueBatch(
  batch: MessageBatch<unknown>,
  env: Env,
  handlers: Record<string, QueueBatchHandler> = QUEUE_HANDLERS,
): Promise<void> {
  const queue = String(batch.queue || '');
  if (!Object.hasOwn(handlers, queue)) {
    console.error(
      `[Queue] Queue "${queue}" is not mapped in worker/queueDispatch.ts; ${batch.messages.length} message(s) acknowledged, none processed.`,
    );
    batch.ackAll();
    return;
  }
  try {
    await handlers[queue](batch, env);
  } catch (err) {
    console.error(`[Queue] Handler for queue "${queue}" failed; unsettled messages go back for retry.`, err);
    batch.retryAll();
  }
}
