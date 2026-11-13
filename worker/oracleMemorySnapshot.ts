/**
 * Frozen session-level memory snapshot for `OracleSession` (`SUITE-REPORT.md` recommendation #7).
 *
 * When `ORACLE_LOOP_GUARDS_ENABLED === 'true'` and an `OracleSession` Durable Object stub is
 * bound, turn 1 captures `{ block, facts, frozenAt }` into Plane 3 state bucket `memory_snapshot`
 * and turns 2+ reuse that exact snapshot. Keeping both `block` and `facts` frozen preserves
 * prompt-cache prefix stability across turns AND ensures `withoutUnmeasuredClaims()` still
 * recognizes user-owned memory numbers on turns 2+.
 */

import type { Env } from './env';
import { oracleLoopGuardsEnabled } from '../services/oracle/toolLoopGuardrails';

export interface SessionStateStub {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export interface FrozenMemorySnapshot {
  block: string;
  facts: string[];
  frozenAt: number;
}

export const MEMORY_SNAPSHOT_STATE_KEY = 'memory_snapshot';
export const SNAPSHOT_TTL_MS = 30 * 60 * 1000;

function isValidFrozenSnapshot(doc: unknown): doc is FrozenMemorySnapshot {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  const candidate = doc as Record<string, unknown>;
  return (
    typeof candidate.block === 'string' &&
    Array.isArray(candidate.facts) &&
    candidate.facts.every((f) => typeof f === 'string') &&
    typeof candidate.frozenAt === 'number' &&
    Number.isFinite(candidate.frozenAt)
  );
}

export async function readFrozenMemorySnapshot(
  sessionStub: SessionStateStub,
): Promise<FrozenMemorySnapshot | null> {
  try {
    const res = await sessionStub.fetch(
      `https://oracle-session/state?key=${MEMORY_SNAPSHOT_STATE_KEY}`,
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      version?: number;
      doc?: unknown;
    } | null;
    if (!data?.ok || !data.version || !isValidFrozenSnapshot(data.doc)) return null;
    return {
      block: data.doc.block,
      facts: [...data.doc.facts],
      frozenAt: data.doc.frozenAt,
    };
  } catch {
    return null;
  }
}

export async function writeFrozenMemorySnapshot(
  sessionStub: SessionStateStub,
  snapshot: FrozenMemorySnapshot,
): Promise<boolean> {
  try {
    const res = await sessionStub.fetch('https://oracle-session/state/patch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: MEMORY_SNAPSHOT_STATE_KEY,
        snapshot,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resolveSessionMemorySnapshot(params: {
  env: Env;
  sessionStub: SessionStateStub | null;
  accountId: string;
  message: string;
  now?: number;
  loadLiveMemory?: (
    env: Env,
    accountId: string,
    message: string,
  ) => Promise<{ block: string; facts: string[] }>;
}): Promise<{ block: string; facts: string[]; fromSnapshot: boolean }> {
  const now = params.now ?? Date.now();
  const freezeEnabled = oracleLoopGuardsEnabled(params.env) && params.sessionStub !== null;
  if (freezeEnabled && params.sessionStub) {
    const existing = await readFrozenMemorySnapshot(params.sessionStub);
    if (
      existing &&
      existing.block.trim().length > 0 &&
      now - existing.frozenAt < SNAPSHOT_TTL_MS
    ) {
      return {
        block: existing.block,
        facts: existing.facts,
        fromSnapshot: true,
      };
    }
  }

  let live: { block: string; facts: string[] } = { block: '', facts: [] };
  try {
    if (params.loadLiveMemory) {
      live = await params.loadLiveMemory(params.env, params.accountId, params.message);
    } else {
      const { ragContextForOracle } = await import('./memoryRag');
      live = await ragContextForOracle(params.env, params.accountId, params.message);
    }
  } catch {
    /* memory RAG is best-effort */
  }

  if (freezeEnabled && params.sessionStub && live.block.trim().length > 0) {
    await writeFrozenMemorySnapshot(params.sessionStub, {
      block: live.block,
      facts: live.facts,
      frozenAt: now,
    });
  }

  return {
    block: live.block,
    facts: live.facts,
    fromSnapshot: false,
  };
}
