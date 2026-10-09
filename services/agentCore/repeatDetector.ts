/**
 * Agent Repeat Detector
 * Adapted from OpenMausBot (server/repeat-detector.ts, Apache 2.0).
 *
 * Detects agent tool-call loops: identical tool calls with identical arguments
 * repeated within a single turn or audit run.
 * Protects user API credits and prevents runaway scrapers or SERP lookups.
 * No em dashes in copy.
 */

/** Tool name plus whitespace-normalized arguments signature. */
export function buildCallKey(tool: string, args?: string): string | null {
  const normalizedArgs = (args ?? '').replace(/\s+/g, ' ').trim();
  if (!normalizedArgs || normalizedArgs === tool) return null;
  return `${tool}:${normalizedArgs}`;
}

export interface RepeatDetectorOptions {
  thresholds: readonly number[];
  maxKeysPerThread?: number;
}

export interface RepeatRecordResult {
  count: number;
  threshold?: number;
  isLoop: boolean;
}

export class RepeatDetector {
  private readonly counts = new Map<string, Map<string, number>>();
  private readonly thresholds: readonly number[];
  private readonly maxKeysPerThread: number;

  constructor(opts: RepeatDetectorOptions) {
    this.thresholds = [...opts.thresholds].sort((a, b) => a - b);
    this.maxKeysPerThread = opts.maxKeysPerThread ?? 256;
    if (!Number.isInteger(this.maxKeysPerThread) || this.maxKeysPerThread < 1) {
      throw new Error('maxKeysPerThread must be a positive integer');
    }
  }

  /**
   * Record one tool call signature on a given thread or audit run.
   * Returns the updated count and indicates if a threshold was crossed.
   */
  record(threadId: string, key: string): RepeatRecordResult {
    let threadMap = this.counts.get(threadId);
    if (!threadMap) {
      threadMap = new Map();
      this.counts.set(threadId, threadMap);
    }

    const previous = threadMap.get(key);
    // Maintain a bounded recency-ordered set.
    if (previous !== undefined) {
      threadMap.delete(key);
    } else if (threadMap.size >= this.maxKeysPerThread) {
      const oldestKey = threadMap.keys().next().value;
      if (oldestKey) threadMap.delete(oldestKey);
    }

    const count = (previous ?? 0) + 1;
    threadMap.set(key, count);

    const hitThreshold = this.thresholds.includes(count);
    const maxThreshold = this.thresholds[this.thresholds.length - 1] ?? 3;
    const isLoop = count >= maxThreshold;

    return {
      count,
      threshold: hitThreshold ? count : undefined,
      isLoop,
    };
  }

  /**
   * Settle and clear memory for a thread when an audit turn finishes.
   */
  settle(threadId: string): void {
    this.counts.delete(threadId);
  }

  /**
   * Reset all tracked threads.
   */
  reset(): void {
    this.counts.clear();
  }
}
