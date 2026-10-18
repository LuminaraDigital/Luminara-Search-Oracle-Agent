/**
 * Persist replay nodes and enable a strategy only when logged history says it is better.
 */
import type { Env } from './env';
import { requireEvidence, utcIsoWeekKey } from '../services/rsi/guardrails';
import { selectReplayStrategy, type ReplayKind, type ReplayNode } from '../services/rsi/offlineReplay';
import { RsiUserError } from './rsiErrors';

const KINDS = new Set<ReplayKind>(['audit', 'probe', 'ranking']);

function requireDb(env: Env): D1Database {
  if (!env.DB) throw new RsiUserError('Database unavailable.', 503);
  return env.DB;
}

function cleanDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
}

function asKind(value: string): ReplayKind {
  if (!KINDS.has(value as ReplayKind)) throw new RsiUserError('kind must be audit, probe, or ranking.');
  return value as ReplayKind;
}

export async function recordReplayNode(
  env: Env,
  accountId: string,
  input: {
    domain: string;
    kind: string;
    strategyId: string;
    outcomeScore: number | null;
    measurementStatus: 'measured' | 'not_measured';
    cost?: number;
    sourceRefs: string[];
  },
  now = Date.now(),
): Promise<ReplayNode> {
  const db = requireDb(env);
  const domain = cleanDomain(input.domain || '');
  const kind = asKind(input.kind);
  const strategyId = input.strategyId.trim().slice(0, 80);
  if (!domain) throw new RsiUserError('Domain required.');
  if (!strategyId) throw new RsiUserError('strategyId required.');
  const evidence = requireEvidence(input.sourceRefs);
  if (!evidence.ok) throw new RsiUserError(evidence.reason);
  let outcomeScore: number | null = null;
  if (input.measurementStatus === 'not_measured') {
    if (input.outcomeScore != null) throw new RsiUserError('Do not send an outcome score when the status is not_measured.');
  } else if (input.measurementStatus === 'measured') {
    if (input.outcomeScore == null || !Number.isFinite(input.outcomeScore)) {
      throw new RsiUserError('A measured replay node needs a finite outcome score.');
    }
    outcomeScore = input.outcomeScore;
  } else {
    throw new RsiUserError('measurementStatus must be measured or not_measured.');
  }
  const cost = input.cost == null ? 1 : input.cost;
  if (!Number.isFinite(cost) || cost < 0) throw new RsiUserError('cost must be a finite number of 0 or more.');
  const node: ReplayNode = { id: crypto.randomUUID(), domain, kind, strategyId, outcomeScore, cost, createdAt: now };
  await db
    .prepare(
      `INSERT INTO rsi_replay_nodes (
        id, account_id, domain, kind, strategy_id, outcome_score, cost, source_refs_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(node.id, accountId, domain, kind, strategyId, outcomeScore, cost, JSON.stringify(evidence.refs), now)
    .run();
  return node;
}

async function loadNodes(env: Env, accountId: string, domain: string, kind: ReplayKind): Promise<ReplayNode[]> {
  const db = requireDb(env);
  const rows = await db
    .prepare(
      `SELECT id, domain, kind, strategy_id, outcome_score, cost, created_at
       FROM rsi_replay_nodes
       WHERE account_id = ? AND domain = ? AND kind = ?
       ORDER BY created_at ASC LIMIT 500`,
    )
    .bind(accountId, domain, kind)
    .all<{ id: string; domain: string; kind: ReplayKind; strategy_id: string; outcome_score: number | null; cost: number; created_at: number }>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    domain: row.domain,
    kind: row.kind,
    strategyId: row.strategy_id,
    outcomeScore: row.outcome_score,
    cost: row.cost,
    createdAt: row.created_at,
  }));
}

export async function selectAndMaybeEnableStrategy(
  env: Env,
  accountId: string,
  input: { domain: string; kind: string; currentStrategyId: string; candidateIds: string[] },
  now = Date.now(),
): Promise<ReturnType<typeof selectReplayStrategy> & { pinned: boolean }> {
  const db = requireDb(env);
  const domain = cleanDomain(input.domain || '');
  const kind = asKind(input.kind);
  const currentStrategyId = input.currentStrategyId.trim();
  if (!domain || !currentStrategyId) throw new RsiUserError('Domain and currentStrategyId required.');
  const slot = await db
    .prepare(`SELECT strategy_id, pinned, last_promotion_week FROM rsi_strategy_slots WHERE account_id = ? AND domain = ? AND kind = ?`)
    .bind(accountId, domain, kind)
    .first<{ strategy_id: string; pinned: number; last_promotion_week: string }>();
  const pinned = slot?.pinned === 1;
  const week = utcIsoWeekKey(now);
  const promotionsThisWeek = slot?.last_promotion_week === week ? 1 : 0;
  const currentId = slot?.strategy_id || currentStrategyId;
  const nodes = await loadNodes(env, accountId, domain, kind);
  const decision = selectReplayStrategy({
    currentId,
    candidateIds: input.candidateIds || [],
    nodes,
    pinned,
    promotionsThisWeek,
  });
  if (decision.changed) {
    await db
      .prepare(
        `INSERT INTO rsi_strategy_slots (account_id, domain, kind, strategy_id, pinned, last_promotion_week, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(account_id, domain, kind) DO UPDATE SET
           strategy_id = excluded.strategy_id,
           last_promotion_week = excluded.last_promotion_week,
           updated_at = excluded.updated_at`,
      )
      .bind(accountId, domain, kind, decision.chosen, week, now)
      .run();
  }
  return { ...decision, pinned };
}

export async function setReplayPinned(
  env: Env,
  accountId: string,
  input: { domain: string; kind: string; strategyId: string; pinned: boolean },
  now = Date.now(),
): Promise<{ pinned: boolean; strategyId: string }> {
  const db = requireDb(env);
  const domain = cleanDomain(input.domain || '');
  const kind = asKind(input.kind);
  const strategyId = input.strategyId.trim();
  if (!domain || !strategyId) throw new RsiUserError('Domain and strategyId required.');
  const existing = await db
    .prepare(`SELECT last_promotion_week FROM rsi_strategy_slots WHERE account_id = ? AND domain = ? AND kind = ?`)
    .bind(accountId, domain, kind)
    .first<{ last_promotion_week: string }>();
  await db
    .prepare(
      `INSERT INTO rsi_strategy_slots (account_id, domain, kind, strategy_id, pinned, last_promotion_week, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, domain, kind) DO UPDATE SET
         strategy_id = excluded.strategy_id,
         pinned = excluded.pinned,
         updated_at = excluded.updated_at`,
    )
    .bind(accountId, domain, kind, strategyId, input.pinned ? 1 : 0, existing?.last_promotion_week || '', now)
    .run();
  return { pinned: input.pinned, strategyId };
}
