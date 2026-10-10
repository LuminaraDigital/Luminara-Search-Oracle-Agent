import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { AUDIT_QUEUE, AUDIT_QUEUE_STAGING, dispatchQueueBatch, isQueueMapped, type QueueBatchHandler } from '../worker/queueDispatch';
import { DAILY_CRON, jobsForCron } from '../worker/scheduledJobs';
import { parseJsonc } from '../scripts/lib/jsonc.mjs';
import type { Env } from '../worker/env';

/**
 * The Worker's scheduled() and queue() handlers, called the way the runtime calls them.
 * An unmapped cron runs no job and an unknown queue processes no message; both are reported
 * with console.error, which is what scheduled() has always used to report.
 */

type FakeMessage = { id: string; timestamp: Date; attempts: number; body: unknown; ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };

function makeBatch(queue: string, bodies: unknown[]) {
  const messages: FakeMessage[] = bodies.map((body, i) => ({
    id: `m${i}`,
    timestamp: new Date(0),
    attempts: 1,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  }));
  const batch = { queue, messages, ackAll: vi.fn(), retryAll: vi.fn() };
  return { batch: batch as unknown as MessageBatch<unknown>, messages, ackAll: batch.ackAll, retryAll: batch.retryAll };
}

/** A D1 stand-in that records each statement the audit job runs, or throws on every one. */
function makeDb(options: { fail?: boolean } = {}) {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (options.fail) throw new Error('d1 unavailable');
              statements.push({ sql, args });
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { DB: DB as unknown as D1Database, statements };
}

/** A job the audit handler finishes without leaving the process: its target is a local host, so it is marked failed. */
const LOCAL_TARGET_JOB = { runId: 'aud_test_1', accountId: 'acct_test', targetUrl: 'http://localhost/' };

function makeCtx() {
  const waited: Promise<unknown>[] = [];
  // Like the runtime, waitUntil takes ownership of the promise: a job that rejects is not an unhandled rejection here.
  const ctx = { waitUntil: vi.fn((p: Promise<unknown>) => void waited.push(Promise.resolve(p).catch(() => undefined))), passThroughOnException: vi.fn() };
  return { ctx: ctx as unknown as ExecutionContext, waitUntil: ctx.waitUntil, waited };
}

function controller(cron: string): ScheduledController {
  return { cron, scheduledTime: 0, noRetry: () => {} } as unknown as ScheduledController;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

function reported(): string[] {
  return errorSpy.mock.calls.map((call: unknown[]) => String(call[0]));
}

describe('scheduled(): an unmapped cron runs no job and is reported', () => {
  it.each([
    ['a cron added by a newer version', '*/5 * * * *'],
    ['another daily time', '0 9 * * *'],
    ['an empty expression', ''],
  ])('%s starts nothing and logs one error', async (_label, cron) => {
    const { ctx, waitUntil } = makeCtx();
    await worker.scheduled(controller(cron), {} as Env, ctx);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(reported()).toHaveLength(1);
    expect(reported()[0]).toContain(`[Cron] Cron "${cron}" is not mapped`);
    expect(reported()[0]).toContain('no job was run');
  });

  it('the daily cron still starts every job it owns and reports no cron error', async () => {
    const { ctx, waitUntil, waited } = makeCtx();
    // With no bindings each job returns at once, so nothing leaves the process.
    await worker.scheduled(controller(DAILY_CRON), {} as Env, ctx);
    await Promise.allSettled(waited);
    const owned = jobsForCron(DAILY_CRON);
    expect(owned.length).toBeGreaterThanOrEqual(3);
    expect(waitUntil).toHaveBeenCalledTimes(owned.length);
    expect(reported().filter((line) => line.startsWith('[Cron]'))).toEqual([]);
  });
});

describe('queue(): a batch goes only to the handler that owns its queue', () => {
  it.each([AUDIT_QUEUE, AUDIT_QUEUE_STAGING])('a batch from %s is processed by the audit handler, which acknowledges its message', async (queue) => {
    const { DB, statements } = makeDb();
    const { batch, messages, ackAll, retryAll } = makeBatch(queue, [LOCAL_TARGET_JOB]);
    await worker.queue(batch, { DB } as Env);
    // The job ran: the audit run was marked running, then failed on the local target.
    expect(statements.map((s) => s.args[0])).toEqual(['running', 'failed']);
    expect(statements.every((s) => s.args.at(-1) === 'aud_test_1')).toBe(true);
    expect(messages[0].ack).toHaveBeenCalledTimes(1);
    expect(messages[0].retry).not.toHaveBeenCalled();
    expect(ackAll).not.toHaveBeenCalled();
    expect(retryAll).not.toHaveBeenCalled();
    expect(reported()).toEqual([]);
  });

  it.each([
    ['a queue this Worker has no handler for', 'luminara-other-jobs'],
    ['the dead letter queue', 'luminara-audit-jobs-dlq'],
    ['an empty queue name', ''],
    ['an object prototype key', 'constructor'],
  ])('a batch from %s is acknowledged and reported, and no message is processed', async (_label, queue) => {
    const { DB, statements } = makeDb();
    const { batch, messages, ackAll, retryAll } = makeBatch(queue, [LOCAL_TARGET_JOB, LOCAL_TARGET_JOB]);
    await worker.queue(batch, { DB } as Env);
    expect(statements).toEqual([]);
    expect(ackAll).toHaveBeenCalledTimes(1);
    expect(retryAll).not.toHaveBeenCalled();
    for (const message of messages) {
      expect(message.ack).not.toHaveBeenCalled();
      expect(message.retry).not.toHaveBeenCalled();
    }
    expect(reported()).toHaveLength(1);
    expect(reported()[0]).toContain(`[Queue] Queue "${queue}" is not mapped`);
    expect(reported()[0]).toContain('2 message(s) acknowledged, none processed');
  });

  it('a job that fails inside the audit handler is retried by that handler, as before', async () => {
    const { DB } = makeDb({ fail: true });
    const { batch, messages, ackAll, retryAll } = makeBatch(AUDIT_QUEUE, [LOCAL_TARGET_JOB]);
    await worker.queue(batch, { DB } as Env);
    expect(messages[0].retry).toHaveBeenCalledTimes(1);
    expect(messages[0].ack).not.toHaveBeenCalled();
    expect(ackAll).not.toHaveBeenCalled();
    expect(retryAll).not.toHaveBeenCalled();
    expect(reported()).toEqual(['[auditQueue] job failed']);
  });

  it('an error thrown by the handler itself is reported and the batch goes back for retry, not lost', async () => {
    const { batch, ackAll, retryAll } = makeBatch(AUDIT_QUEUE, []);
    // The audit handler reads batch.messages first; make that read throw, outside its per-message handling.
    Object.defineProperty(batch, 'messages', {
      get() {
        throw new Error('batch unreadable');
      },
    });
    await expect(worker.queue(batch, {} as Env)).resolves.toBeUndefined();
    expect(retryAll).toHaveBeenCalledTimes(1);
    expect(ackAll).not.toHaveBeenCalled();
    expect(reported()).toHaveLength(1);
    expect(reported()[0]).toContain(`[Queue] Handler for queue "${AUDIT_QUEUE}" failed`);
    expect(String(errorSpy.mock.calls[0][1])).toContain('batch unreadable');
  });
});

describe('dispatchQueueBatch', () => {
  it('calls only the handler mapped to the batch queue, and leaves settling the messages to it', async () => {
    const owner = vi.fn(async () => {});
    const other = vi.fn(async () => {});
    const handlers: Record<string, QueueBatchHandler> = { 'queue-a': owner, 'queue-b': other };
    const { batch, ackAll, retryAll } = makeBatch('queue-a', [{ n: 1 }]);
    const env = {} as Env;
    await dispatchQueueBatch(batch, env, handlers);
    expect(owner).toHaveBeenCalledTimes(1);
    expect(owner).toHaveBeenCalledWith(batch, env);
    expect(other).not.toHaveBeenCalled();
    expect(ackAll).not.toHaveBeenCalled();
    expect(retryAll).not.toHaveBeenCalled();
    expect(reported()).toEqual([]);
  });

  it('reports a rejected handler with the queue name and the error, and retries the batch', async () => {
    const boom = new Error('handler exploded');
    const handlers: Record<string, QueueBatchHandler> = { 'queue-a': async () => Promise.reject(boom) };
    const { batch, ackAll, retryAll } = makeBatch('queue-a', [{ n: 1 }]);
    await expect(dispatchQueueBatch(batch, {} as Env, handlers)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('[Queue] Handler for queue "queue-a" failed');
    expect(errorSpy.mock.calls[0][1]).toBe(boom);
    expect(retryAll).toHaveBeenCalledTimes(1);
    expect(ackAll).not.toHaveBeenCalled();
  });

  it('maps every queue wrangler.jsonc makes this Worker consume, and no dead letter queue', () => {
    type QueuesBlock = { queues?: { consumers?: Array<{ queue: string; dead_letter_queue?: string }> } };
    const cfg = parseJsonc(readFileSync(resolve(__dirname, '..', 'wrangler.jsonc'), 'utf8')) as QueuesBlock & { env: Record<string, QueuesBlock> };
    const blocks: QueuesBlock[] = [cfg, ...Object.values(cfg.env)];
    const consumers = blocks.flatMap((block) => block.queues?.consumers ?? []);
    const consumed = [...new Set(consumers.map((c) => c.queue))].sort();
    expect(consumed).toEqual([AUDIT_QUEUE, AUDIT_QUEUE_STAGING].sort());
    for (const queue of consumed) expect(isQueueMapped(queue), `queue "${queue}" has no handler`).toBe(true);
    for (const c of consumers) {
      if (c.dead_letter_queue) expect(isQueueMapped(c.dead_letter_queue), `dead letter queue "${c.dead_letter_queue}"`).toBe(false);
    }
  });
});
