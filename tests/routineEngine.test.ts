import { describe, it, expect, vi } from 'vitest';
import {
  RoutineEngine,
  type RoutineConfig,
  type RoutineExecutor,
} from '../services/routines/routineEngine';

describe('RoutineEngine', () => {
  it('registers and executes a routine successfully with zero initial streak', async () => {
    const mockExecutor: RoutineExecutor = {
      executeRun: vi.fn().mockResolvedValue({
        ok: true,
        reportSummary: 'AEO citation radar scored 78/100. FAQPage schema missing.',
      }),
    };

    const currentTime = 1000;
    const engine = new RoutineEngine(mockExecutor, () => currentTime);

    const config: RoutineConfig = {
      id: 'routine-weekly-aeo',
      name: 'Weekly AEO Visibility Audit',
      targetDomain: 'luminarasuite.com',
      prompt: 'Check Google AI Overviews and Perplexity citations for target buyer queries.',
      agentId: 'aeo-prober',
      enabled: true,
      schedule: { type: 'interval', everyMinutes: 10080, anchorAt: 1000 },
      continuity: true,
      overlap: 'skip',
    };

    engine.registerRoutine(config);

    const receipt = await engine.trigger('routine-weekly-aeo');
    expect(receipt.status).toBe('completed');
    expect(receipt.reportSummary).toContain('scored 78/100');

    const state = engine.getRoutineState('routine-weekly-aeo');
    expect(state?.failureStreak).toBe(0);
    expect(state?.skippedRuns).toBe(0);
    expect(state?.isRunning).toBe(false);
  });

  it('injects previous run report into subsequent prompts when continuity is true', async () => {
    let capturedPrompt = '';
    const mockExecutor: RoutineExecutor = {
      executeRun: vi.fn().mockImplementation(async (_cfg, prompt) => {
        capturedPrompt = prompt;
        return {
          ok: true,
          reportSummary: 'Delta: FAQPage deployed, citations rose to 86/100.',
        };
      }),
    };

    const engine = new RoutineEngine(mockExecutor);
    const config: RoutineConfig = {
      id: 'routine-continuity-test',
      name: 'Continuous Monitor',
      targetDomain: 'example.com',
      prompt: 'Analyze brand share of voice.',
      agentId: 'aeo-prober',
      enabled: true,
      schedule: { type: 'interval', everyMinutes: 60, anchorAt: 0 },
      continuity: true,
      overlap: 'skip',
    };

    engine.registerRoutine(config);

    // Initial run - no prior report
    await engine.trigger('routine-continuity-test');
    expect(capturedPrompt).toBe('Analyze brand share of voice.');

    // Second run - continuity context injected
    await engine.trigger('routine-continuity-test');
    expect(capturedPrompt).toContain('[Previous Run Report - Baseline Delta Context]');
    expect(capturedPrompt).toContain('Delta: FAQPage deployed, citations rose to 86/100.');
    expect(capturedPrompt).toContain('[Current Task Instructions]\nAnalyze brand share of voice.');
  });

  it('skips overlapping runs when previous execution is still running', async () => {
    let finishFirstRun: (val: any) => void = () => {};
    const firstRunPromise = new Promise((resolve) => {
      finishFirstRun = resolve;
    });

    const mockExecutor: RoutineExecutor = {
      executeRun: vi.fn().mockImplementation(() => firstRunPromise),
    };

    const engine = new RoutineEngine(mockExecutor);
    const config: RoutineConfig = {
      id: 'routine-overlap-test',
      name: 'Long Running Crawl',
      targetDomain: 'slowsite.com',
      prompt: 'Deep crawl 500 pages.',
      agentId: 'crawler-bot',
      enabled: true,
      schedule: { type: 'interval', everyMinutes: 10, anchorAt: 0 },
      continuity: false,
      overlap: 'skip',
    };

    engine.registerRoutine(config);

    // Launch first run (doesn't finish yet)
    const run1 = engine.trigger('routine-overlap-test');

    // Trigger second run while first is active
    const run2Receipt = await engine.trigger('routine-overlap-test');
    expect(run2Receipt.status).toBe('skipped');

    const state = engine.getRoutineState('routine-overlap-test');
    expect(state?.skippedRuns).toBe(1);

    // Finish first run
    finishFirstRun({ ok: true, reportSummary: 'Finished crawl.' });
    const run1Receipt = await run1;
    expect(run1Receipt.status).toBe('completed');
  });

  it('tracks failureStreak upon execution error and resets on success', async () => {
    let shouldFail = true;
    const mockExecutor: RoutineExecutor = {
      executeRun: vi.fn().mockImplementation(async () => {
        if (shouldFail) {
          return { ok: false, error: 'SERP API connection timed out' };
        }
        return { ok: true, reportSummary: 'Recovered.' };
      }),
    };

    const engine = new RoutineEngine(mockExecutor);
    const config: RoutineConfig = {
      id: 'routine-fail-test',
      name: 'Failure Test',
      targetDomain: 'test.com',
      prompt: 'Check rankings.',
      agentId: 'rank-scout',
      enabled: true,
      schedule: { type: 'daily', timeUtc: '09:00' },
      continuity: false,
      overlap: 'skip',
    };

    engine.registerRoutine(config);

    const r1 = await engine.trigger('routine-fail-test');
    expect(r1.status).toBe('failed');
    expect(engine.getRoutineState('routine-fail-test')?.failureStreak).toBe(1);

    const r2 = await engine.trigger('routine-fail-test');
    expect(r2.status).toBe('failed');
    expect(engine.getRoutineState('routine-fail-test')?.failureStreak).toBe(2);

    shouldFail = false;
    const r3 = await engine.trigger('routine-fail-test');
    expect(r3.status).toBe('completed');
    expect(engine.getRoutineState('routine-fail-test')?.failureStreak).toBe(0);
  });
});
