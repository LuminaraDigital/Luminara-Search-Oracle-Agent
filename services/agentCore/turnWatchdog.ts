/**
 * Turn Activity Watchdog
 * Adapted from OpenMausBot (server/turn-watchdog.ts, Apache 2.0).
 *
 * Watches agent turns for activity stalls rather than imposing arbitrary raw duration caps.
 * A turn streaming live search evidence or parsing pages can run legitimately,
 * but a thread silent for `stallMs` without progress events is stalled and interrupted.
 * Turns paused waiting on human approval (e.g., Paid Tool Gate) are explicitly exempt.
 * No em dashes in copy.
 */

export interface WatchedTurn {
  threadId: string;
  agentId: string;
  startedAt: number;
  lastEventAt: number;
  waitingOnHuman: boolean;
  waitingOnNetwork?: boolean;
}

export interface TurnWatchdogOptions {
  stallMs: number;
  checkMs: number;
  onStall: (turn: WatchedTurn) => void;
  now?: () => number;
}

export class TurnWatchdog {
  private readonly turns = new Map<string, WatchedTurn>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: TurnWatchdogOptions;

  constructor(opts: TurnWatchdogOptions) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), this.opts.checkMs);
    // Never hold node process open just for watchdog checks.
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.turns.clear();
  }

  /**
   * Register a new admitted turn under observation.
   */
  watch(threadId: string, agentId: string): void {
    const at = this.now();
    this.turns.set(threadId, {
      threadId,
      agentId,
      startedAt: at,
      lastEventAt: at,
      waitingOnHuman: false,
    });
  }

  /**
   * Any stream event, delta token, or tool step proves the agent is actively working.
   */
  touch(threadId: string): void {
    const turn = this.turns.get(threadId);
    if (turn) {
      turn.lastEventAt = this.now();
    }
  }

  /**
   * Set waiting state for human approval. Deliberation time is never penalized as a stall.
   */
  setWaitingOnHuman(threadId: string, waiting: boolean): void {
    const turn = this.turns.get(threadId);
    if (!turn) return;
    turn.waitingOnHuman = waiting;
    turn.lastEventAt = this.now();
  }

  /**
   * Normal termination of a turn. Stop observation.
   */
  settle(threadId: string): void {
    this.turns.delete(threadId);
  }

  isWatching(threadId: string): boolean {
    return this.turns.has(threadId);
  }

  getTurn(threadId: string): WatchedTurn | undefined {
    return this.turns.get(threadId);
  }

  /**
   * Sweep active turns. If a turn has been silent beyond stallMs and is not awaiting approval, trigger onStall.
   */
  sweep(): void {
    const at = this.now();
    for (const turn of this.turns.values()) {
      if (turn.waitingOnHuman) continue;
      const elapsedSinceActivity = at - turn.lastEventAt;
      if (elapsedSinceActivity >= this.opts.stallMs) {
        this.turns.delete(turn.threadId);
        this.opts.onStall(turn);
      }
    }
  }
}
