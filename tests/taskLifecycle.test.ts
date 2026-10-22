import { describe, expect, it, vi } from 'vitest';
import {
  createTaskContext,
  executeWithLifecycle,
  refundHostedQuota,
} from '../worker/taskLifecycle';
import { readFreeUsed, spendDailyQuota } from '../worker/quotaMiddleware';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';
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
    expect(result.refunded).toBe(false);
    expect(ctx.diagnostics.length).toBeGreaterThan(2);
  });

  it('triggers onRevert and refunds quota when an unhandled error occurs', async () => {
    const mockEnv = {
      LUMINARA_KV: { get: vi.fn(), put: vi.fn() } as unknown as KVNamespace,
      DAILY_QUOTA: memoryDailyQuotaNamespace(),
      FREE_DAILY_LIMIT: '5',
    } as Env;
    for (let i = 0; i < 5; i++) expect((await spendDailyQuota(mockEnv, 'acc_revert', 5)).ok).toBe(true);

    const ctx = createTaskContext({
      accountId: 'acc_revert',
      surface: 'mcp',
      targetDomain: 'broken-site.com',
      quotaCharged: true,
    });

    const result = await executeWithLifecycle(mockEnv, ctx, async (updateState) => {
      updateState('observing', 'Starting scrape');
      throw new Error('Upstream provider timeout (504 Gateway Timeout)');
    });

    expect(result.ok).toBe(false);
    expect(result.state).toBe('reverted');
    expect(result.error).toContain('Upstream provider timeout');
    expect(result.code).toBe('TASK_REVERTED');
    expect(result.refunded).toBe(true);
    expect(await readFreeUsed(mockEnv, 'acc_revert', 5)).toBe(4);
  });

  it('does not refund quota if quotaCharged is false', async () => {
    const mockKv = {
      get: vi.fn(),
      put: vi.fn(),
    };
    const mockEnv = { LUMINARA_KV: mockKv as unknown as KVNamespace } as Env;

    const ctx = createTaskContext({
      accountId: 'acc_no_charge',
      surface: 'tma',
      targetDomain: 'site.com',
      quotaCharged: false,
    });

    const result = await executeWithLifecycle(mockEnv, ctx, async () => {
      throw new Error('Model rate limited (429)');
    });

    expect(result.ok).toBe(false);
    expect(result.state).toBe('reverted');
    expect(result.refunded).toBe(false);
    expect(mockKv.put).not.toHaveBeenCalled();
  });

  it('handles safe no-op in refundHostedQuota when KV is unbound or empty', async () => {
    const emptyEnv = {} as Env;
    const res1 = await refundHostedQuota(emptyEnv, 'acc_1');
    expect(res1).toBe(false);

    const zeroEnv = {
      DAILY_QUOTA: memoryDailyQuotaNamespace(),
      FREE_DAILY_LIMIT: '3',
    } as Env;
    const res2 = await refundHostedQuota(zeroEnv, 'acc_zero');
    expect(res2).toBe(false);
    expect(await readFreeUsed(zeroEnv, 'acc_zero', 3)).toBe(0);
  });
});
