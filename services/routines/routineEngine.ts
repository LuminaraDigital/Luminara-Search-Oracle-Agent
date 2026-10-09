/**
 * Autonomous Weekly Decision Routine Engine
 * Adapted from OpenMausBot (server/routines.ts, Apache 2.0).
 *
 * Powers recurring background audits, SERP re-probes, and Weekly Decision Sentinel loops:
 * - continuity: true -> injects the previous run's report or findings into the next prompt,
 *   enabling the agent to track delta changes rather than starting cold.
 * - overlap: 'skip' -> prevents unbounded job pileup if a live crawl or audit is still running.
 * - failureStreak tracking: safely surfaces consecutive failures without crashing.
 * No em dashes in copy.
 */

export type RoutineSchedule =
  | { type: 'interval'; everyMinutes: number; anchorAt: number }
  | { type: 'daily'; timeUtc: string; weekdays?: number[] }
  | { type: 'cron'; expression: string };

export type RoutineRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped';

export interface RoutineRunReceipt {
  runId: string;
  routineId: string;
  status: RoutineRunStatus;
  startedAt: number;
  completedAt?: number;
  reportSummary?: string;
  error?: string;
}

export interface RoutineConfig {
  id: string;
  name: string;
  targetDomain: string;
  prompt: string;
  agentId: string;
  enabled: boolean;
  schedule: RoutineSchedule;
  /** Carry previous run's report into the next prompt so recurring work tracks delta changes. */
  continuity: boolean;
  /** Skip execution if the previous run is still active. */
  overlap: 'skip' | 'queue';
  timeoutMinutes?: number;
}

export interface RoutineState {
  config: RoutineConfig;
  lastRunAt?: number;
  lastSkippedAt?: number;
  skippedRuns: number;
  failureStreak: number;
  lastReceipt?: RoutineRunReceipt;
  isRunning: boolean;
}

export interface RoutineExecutor {
  executeRun(
    config: RoutineConfig,
    promptWithContext: string,
    signal: AbortSignal
  ): Promise<{ ok: boolean; reportSummary?: string; error?: string }>;
}

export class RoutineEngine {
  private readonly routines = new Map<string, RoutineState>();
  private readonly executor: RoutineExecutor;
  private readonly now: () => number;

  constructor(executor: RoutineExecutor, now: () => number = Date.now) {
    this.executor = executor;
    this.now = now;
  }

  registerRoutine(config: RoutineConfig): void {
    const existing = this.routines.get(config.id);
    this.routines.set(config.id, {
      config,
      lastRunAt: existing?.lastRunAt,
      lastSkippedAt: existing?.lastSkippedAt,
      skippedRuns: existing?.skippedRuns ?? 0,
      failureStreak: existing?.failureStreak ?? 0,
      lastReceipt: existing?.lastReceipt,
      isRunning: existing?.isRunning ?? false,
    });
  }

  getRoutineState(id: string): RoutineState | undefined {
    return this.routines.get(id);
  }

  listRoutines(): RoutineState[] {
    return [...this.routines.values()];
  }

  /**
   * Compose the prompt for a routine run.
   * If continuity is enabled and a previous report summary exists, inject it as baseline context.
   */
  composePrompt(state: RoutineState): string {
    const { config, lastReceipt } = state;
    if (!config.continuity || !lastReceipt?.reportSummary) {
      return config.prompt;
    }

    return (
      `[Previous Run Report - Baseline Delta Context]\n` +
      `${lastReceipt.reportSummary}\n\n` +
      `[Current Task Instructions]\n` +
      `${config.prompt}`
    );
  }

  /**
   * Trigger a scheduled or manual tick for a routine.
   * Enforces overlap prevention and handles status transitions.
   */
  async trigger(
    id: string,
    abortSignal?: AbortSignal
  ): Promise<RoutineRunReceipt> {
    const state = this.routines.get(id);
    if (!state) {
      throw new Error(`Routine with id ${id} not found`);
    }

    const currentTime = this.now();
    const runId = `run_${id}_${currentTime}`;

    if (state.isRunning) {
      if (state.config.overlap === 'skip') {
        state.skippedRuns++;
        state.lastSkippedAt = currentTime;
        return {
          runId,
          routineId: id,
          status: 'skipped',
          startedAt: currentTime,
          completedAt: currentTime,
          reportSummary: 'Skipped: previous run still active.',
        };
      }
    }

    state.isRunning = true;
    state.lastRunAt = currentTime;

    const promptWithContext = this.composePrompt(state);
    const controller = new AbortController();
    const activeSignal = abortSignal ?? controller.signal;

    try {
      const result = await this.executor.executeRun(
        state.config,
        promptWithContext,
        activeSignal
      );

      const completedAt = this.now();
      const receipt: RoutineRunReceipt = {
        runId,
        routineId: id,
        status: result.ok ? 'completed' : 'failed',
        startedAt: currentTime,
        completedAt,
        reportSummary: result.reportSummary,
        error: result.error,
      };

      state.lastReceipt = receipt;
      state.isRunning = false;

      if (result.ok) {
        state.failureStreak = 0;
      } else {
        state.failureStreak++;
      }

      return receipt;
    } catch (err: unknown) {
      const completedAt = this.now();
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown execution failure';

      const receipt: RoutineRunReceipt = {
        runId,
        routineId: id,
        status: 'failed',
        startedAt: currentTime,
        completedAt,
        error: errorMessage,
      };

      state.lastReceipt = receipt;
      state.failureStreak++;
      state.isRunning = false;

      return receipt;
    }
  }
}
