import { describe, expect, it } from 'vitest';
import { createTaskContext, executeWithLifecycle } from '../worker/taskLifecycle';
import type { Env } from '../worker/env';

describe('worker/taskLifecycle', () => {
  it('executes task through initiated, observing, executing, and settled states on success', async () => {
    const mockEnv = {} as Env;
    const ctx = createTaskContext({
      accountId: 'acc_123',
      surface: 'web',
      targetDomain: 'example.com',
    });

    expect(ctx.state).toBe('initiated');
    expect(ctx.taskId).toMatch(/^task_/);

    const result = await executeWithLifecycle(mockEnv, ctx, async (updateState) => {
      updateState('observing', 'Scanning SERP results');
      expect(ctx.state).toBe('observing');

      updateState('executing', 'Running model synthesis');
      expect(ctx.state).toBe('executing');

      return { summary: 'Audit completed' };
    });

    expect(result.ok).toBe(true);
    expect(result.state).toBe('settled');
    expect(result.data).toEqual({ summary: 'Audit completed' });
    expect(ctx.diagnostics.length).toBeGreaterThan(2);
  });

  it('reverts with TASK_REVERTED when the task throws', async () => {
    const ctx = createTaskContext({
      accountId: 'acc_revert',
      surface: 'mcp',
      targetDomain: 'broken-site.com',
    });

    const result = await executeWithLifecycle({} as Env, ctx, async (updateState) => {
      updateState('observing', 'Starting scrape');
      throw new Error('Upstream provider timeout (504 Gateway Timeout)');
    });

    expect(result.ok).toBe(false);
    expect(result.state).toBe('reverted');
    expect(result.error).toContain('Upstream provider timeout');
    expect(result.code).toBe('TASK_REVERTED');
  });
});
