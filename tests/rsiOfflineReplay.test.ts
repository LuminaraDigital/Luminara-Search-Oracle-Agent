import { describe, expect, it } from 'vitest';
import { scoreStrategyOnHistory, selectReplayStrategy } from '../services/rsi/offlineReplay';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { handleRsiRoute } from '../worker/rsiRoutes';

const user = { id: 'acct_replay', accountId: 'acct_replay' } as HostedIdentity;

function envFor(): Env {
  return { DB: createSqliteD1() } as unknown as Env;
}

async function post(env: Env, path: string, body: unknown) {
  return handleRsiRoute(
    new Request(`https://luminarasuite.com/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
    user,
    path,
  );
}

async function logMeasured(env: Env, strategyId: string, outcomeScore: number, ref: string) {
  const res = await post(env, '/rsi/replay/nodes', {
    domain: 'example.com',
    kind: 'audit',
    strategyId,
    measurementStatus: 'measured',
    outcomeScore,
    cost: 1,
    sourceRefs: [ref],
  });
  expect(res!.status).toBe(200);
}

describe('offline strategy replay', () => {
  it('ignores unmeasured nodes and will not enable a strategy that does not beat the current one', () => {
    const nodes = [
      { id: '1', domain: 'example.com', kind: 'audit' as const, strategyId: 'current', outcomeScore: 1, cost: 1, createdAt: 1 },
      { id: '2', domain: 'example.com', kind: 'audit' as const, strategyId: 'current', outcomeScore: 1, cost: 1, createdAt: 2 },
      { id: '3', domain: 'example.com', kind: 'audit' as const, strategyId: 'current', outcomeScore: 1, cost: 1, createdAt: 3 },
      { id: '4', domain: 'example.com', kind: 'audit' as const, strategyId: 'weaker', outcomeScore: 0, cost: 1, createdAt: 4 },
      { id: '5', domain: 'example.com', kind: 'audit' as const, strategyId: 'weaker', outcomeScore: 0, cost: 1, createdAt: 5 },
      { id: '6', domain: 'example.com', kind: 'audit' as const, strategyId: 'weaker', outcomeScore: 0, cost: 1, createdAt: 6 },
      { id: '7', domain: 'example.com', kind: 'probe' as const, strategyId: 'ghost', outcomeScore: null, cost: 1, createdAt: 7 },
    ];
    const score = scoreStrategyOnHistory('ghost', nodes);
    expect(score.mean).toBeNull();
    expect(score.notMeasured).toBe(1);
    const held = selectReplayStrategy({
      currentId: 'current',
      candidateIds: ['weaker', 'ghost'],
      nodes,
      pinned: false,
      promotionsThisWeek: 0,
    });
    expect(held.changed).toBe(false);
    expect(held.chosen).toBe('current');
  });

  it('enables a better strategy once, then holds for the week and while pinned', async () => {
    const env = envFor();
    for (let i = 0; i < 3; i++) await logMeasured(env, 'baseline', 1, `base-${i}`);
    for (let i = 0; i < 3; i++) await logMeasured(env, 'challenger', 4, `chal-${i}`);
    const unmeasured = await post(env, '/rsi/replay/nodes', {
      domain: 'example.com',
      kind: 'audit',
      strategyId: 'challenger',
      measurementStatus: 'not_measured',
      outcomeScore: 9,
      sourceRefs: ['nope'],
    });
    expect(unmeasured!.status).toBe(400);

    const first = await post(env, '/rsi/replay/select', {
      domain: 'example.com',
      kind: 'audit',
      currentStrategyId: 'baseline',
      candidateIds: ['challenger'],
    });
    const enabled = (await first!.json()) as { changed: boolean; chosen: string };
    expect(enabled.changed).toBe(true);
    expect(enabled.chosen).toBe('challenger');

    for (let i = 0; i < 3; i++) await logMeasured(env, 'later', 9, `later-${i}`);
    const second = await post(env, '/rsi/replay/select', {
      domain: 'example.com',
      kind: 'audit',
      currentStrategyId: 'baseline',
      candidateIds: ['later'],
    });
    const held = (await second!.json()) as { changed: boolean; chosen: string; reason: string };
    expect(held.changed).toBe(false);
    expect(held.chosen).toBe('challenger');
    expect(held.reason).toContain('cap');

    await post(env, '/rsi/replay/pin', {
      domain: 'example.com',
      kind: 'probe',
      strategyId: 'baseline',
      pinned: true,
    });
    for (let i = 0; i < 3; i++) {
      await post(env, '/rsi/replay/nodes', {
        domain: 'example.com',
        kind: 'probe',
        strategyId: 'baseline',
        measurementStatus: 'measured',
        outcomeScore: 1,
        sourceRefs: [`p-base-${i}`],
      });
      await post(env, '/rsi/replay/nodes', {
        domain: 'example.com',
        kind: 'probe',
        strategyId: 'better',
        measurementStatus: 'measured',
        outcomeScore: 5,
        sourceRefs: [`p-better-${i}`],
      });
    }
    const pinned = await post(env, '/rsi/replay/select', {
      domain: 'example.com',
      kind: 'probe',
      currentStrategyId: 'baseline',
      candidateIds: ['better'],
    });
    const stuck = (await pinned!.json()) as { changed: boolean; chosen: string; reason: string };
    expect(stuck.changed).toBe(false);
    expect(stuck.chosen).toBe('baseline');
    expect(stuck.reason).toContain('Pinned');
  });
});
