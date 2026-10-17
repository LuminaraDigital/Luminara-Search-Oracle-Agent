import { describe, expect, it } from 'vitest';
import { actionMemoryFromFix, classifyFixEffect, rankFixes } from '../services/rsi/fixOutcomes';
import { normalizeFixSignature } from '../services/rsi/skillLibrary';
import { deterministicDreamConsolidator } from '../worker/dreamAgent';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { handleRsiRoute } from '../worker/rsiRoutes';
import type { DreamEvent } from '../types';

const user = { id: 'acct_fix', accountId: 'acct_fix' } as HostedIdentity;

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

describe('fix citation outcomes', () => {
  it('classifies only measured before and after rates, and refuses a number on not_measured', () => {
    expect(classifyFixEffect({ measurementStatus: 'measured', beforeCitationRate: 10, afterCitationRate: 14 }).ok).toBe(true);
    expect(classifyFixEffect({ measurementStatus: 'not_measured', beforeCitationRate: null, afterCitationRate: null })).toEqual({
      ok: true,
      effect: 'not_measured',
    });
    expect(classifyFixEffect({ measurementStatus: 'not_measured', beforeCitationRate: 10, afterCitationRate: null }).ok).toBe(false);
    const memory = actionMemoryFromFix({
      domain: 'example.com',
      title: 'Add FAQ schema',
      signature: 'add faq schema',
      effect: 'not_measured',
      beforeCitationRate: null,
      afterCitationRate: null,
      sourceRefs: ['audit-1'],
    });
    expect(memory.content).toContain('not_measured');
    expect(memory.content).not.toMatch(/\d/);
  });

  it('logs a measured gain into action_memory, proposes a skill on the second gain, and re-ranks', async () => {
    const env = envFor();
    const first = await post(env, '/rsi/fixes', {
      domain: 'example.com',
      signature: 'Add FAQ schema',
      title: 'Add FAQ schema',
      sourceRefs: ['audit-1'],
      measurementStatus: 'measured',
      beforeCitationRate: 10,
      afterCitationRate: 18,
    });
    const logged = (await first!.json()) as { effect: string; memoryId: string; proposal: null; content: string };
    expect(logged.effect).toBe('success');
    expect(logged.proposal).toBeNull();
    expect(logged.content).toContain('before: 10');
    const row = await env.DB!.prepare(`SELECT memory_type, content FROM business_memories WHERE id = ?`).bind(logged.memoryId).first<{
      memory_type: string;
      content: string;
    }>();
    expect(row?.memory_type).toBe('action_memory');

    const second = await post(env, '/rsi/fixes', {
      domain: 'example.com',
      signature: 'add faq schema',
      title: 'Add FAQ schema',
      sourceRefs: ['audit-2'],
      measurementStatus: 'measured',
      beforeCitationRate: 18,
      afterCitationRate: 22,
    });
    const proposed = (await second!.json()) as { proposal: { kind: string } | null };
    expect(proposed.proposal?.kind).toBe('create');

    await post(env, '/rsi/fixes', {
      domain: 'example.com',
      signature: 'thin footer',
      title: 'Trim the footer',
      sourceRefs: ['audit-3'],
      measurementStatus: 'not_measured',
      beforeCitationRate: null,
      afterCitationRate: null,
    });
    const ranked = await post(env, '/rsi/fixes/rank', {
      domain: 'example.com',
      fixes: [
        { signature: 'thin footer', title: 'Trim the footer' },
        { signature: 'Add FAQ schema', title: 'Add FAQ schema' },
      ],
    });
    const order = (await ranked!.json()) as { fixes: Array<{ signature: string; rankScore: number; evidence: string }> };
    expect(order.fixes[0].signature).toBe('Add FAQ schema');
    expect(order.fixes[0].rankScore).toBeGreaterThan(0);
    expect(order.fixes[1].evidence).toBe('not_measured');
  });

  it('does not ask Dreaming to create a second action memory when the citation row is already logged', () => {
    const event: DreamEvent = {
      id: 'devt_1',
      accountId: 'acct_fix',
      domain: 'example.com',
      eventType: 'recommendation_updated',
      payload: { title: 'Add FAQ schema', status: 'success', citationLogged: true },
      contentHash: 'h',
      signalWeight: 2,
      createdAt: 1,
    };
    const skipped = deterministicDreamConsolidator({ domain: 'example.com', pendingEvents: [event], activeMemories: [] });
    expect(skipped.proposals).toHaveLength(0);
    const plain = deterministicDreamConsolidator({
      domain: 'example.com',
      pendingEvents: [{ ...event, id: 'devt_2', payload: { title: 'Add FAQ schema', status: 'completed' } }],
      activeMemories: [],
    });
    expect(plain.proposals[0]?.memoryType).toBe('action_memory');
  });

  it('keeps an unmeasured fix behind a measured gain when scores tie on order', () => {
    const ranked = rankFixes(
      [
        { signature: 'beta', title: 'Beta' },
        { signature: 'alpha', title: 'Alpha' },
      ],
      [{ signature: 'alpha', successes: 1, regressions: 0, measured: 1 }],
      normalizeFixSignature,
    );
    expect(ranked.map((item) => item.signature)).toEqual(['alpha', 'beta']);
    expect(ranked[1].evidence).toBe('not_measured');
  });
});
