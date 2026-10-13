/**
 * Log a recommended fix and its before/after AI citation outcome into Dreaming action_memory.
 */
import type { Env } from './env';
import { actionMemoryFromFix, classifyFixEffect, rankFixes, type FixStat } from '../services/rsi/fixOutcomes';
import { normalizeFixSignature } from '../services/rsi/skillLibrary';
import { enqueueDreamEvent } from './dreamingQueue';
import { recordFixObservation, type RecordObservationInput } from './rsiSkillStore';
import { RsiUserError } from './rsiErrors';

export interface CitedFixRequest extends RecordObservationInput {
  beforeCitationRate: number | null;
  afterCitationRate: number | null;
  measurementStatus: 'measured' | 'not_measured';
}

export async function recordCitedFix(env: Env, accountId: string, input: CitedFixRequest) {
  const classified = classifyFixEffect({
    measurementStatus: input.measurementStatus,
    beforeCitationRate: input.beforeCitationRate,
    afterCitationRate: input.afterCitationRate,
  });
  if (!classified.ok) throw new RsiUserError(classified.reason);
  const outcome = classified.effect === 'success' ? 'success' : 'failure';
  const recorded = await recordFixObservation(env, accountId, {
    domain: input.domain,
    signature: input.signature,
    title: input.title,
    outcome,
    sourceRefs: input.sourceRefs,
  });
  if (!env.DB) throw new RsiUserError('Database unavailable.', 503);
  await env.DB
    .prepare(
      `UPDATE rsi_fix_observations
       SET before_citation_rate = ?, after_citation_rate = ?, measurement_status = ?, effect = ?
       WHERE id = ? AND account_id = ?`,
    )
    .bind(
      classified.effect === 'not_measured' ? null : input.beforeCitationRate,
      classified.effect === 'not_measured' ? null : input.afterCitationRate,
      classified.effect === 'not_measured' ? 'not_measured' : 'measured',
      classified.effect,
      recorded.observation.id,
      accountId,
    )
    .run();

  const memory = actionMemoryFromFix({
    domain: recorded.observation.domain,
    title: recorded.observation.title,
    signature: recorded.observation.signature,
    effect: classified.effect,
    beforeCitationRate: input.beforeCitationRate,
    afterCitationRate: input.afterCitationRate,
    sourceRefs: recorded.observation.sourceRefs,
  });
  const now = Date.now();
  const existing = await env.DB
    .prepare(
      `SELECT id FROM business_memories
       WHERE account_id = ? AND domain = ? AND memory_type = 'action_memory'
         AND json_extract(structured_data_json, '$.signature') = ?
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(accountId, recorded.observation.domain, recorded.observation.signature)
    .first<{ id: string }>();
  let memoryId = existing?.id;
  if (memoryId) {
    await env.DB
      .prepare(
        `UPDATE business_memories SET
          title = ?, content = ?, structured_data_json = ?, confidence = ?, source_refs_json = ?,
          updated_at = ?, last_verified_at = ?, status = 'active'
         WHERE id = ? AND account_id = ?`,
      )
      .bind(
        memory.title,
        memory.content,
        JSON.stringify(memory.structuredData),
        memory.confidence,
        JSON.stringify(recorded.observation.sourceRefs),
        now,
        now,
        memoryId,
        accountId,
      )
      .run();
  } else {
    memoryId = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO business_memories (
          id, account_id, project_id, domain, memory_type, title, content,
          structured_data_json, confidence, status, source_refs_json,
          created_at, updated_at, last_verified_at, expires_at
        ) VALUES (?, ?, NULL, ?, 'action_memory', ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL)`,
      )
      .bind(
        memoryId,
        accountId,
        recorded.observation.domain,
        memory.title,
        memory.content,
        JSON.stringify(memory.structuredData),
        memory.confidence,
        JSON.stringify(recorded.observation.sourceRefs),
        now,
        now,
        now,
      )
      .run();
  }
  try {
    await enqueueDreamEvent(env, {
      accountId,
      domain: recorded.observation.domain,
      eventType: 'recommendation_updated',
      sourceId: recorded.observation.id,
      payload: {
        title: recorded.observation.title,
        status: classified.effect,
        citationLogged: true,
        signature: recorded.observation.signature,
        measurementStatus: classified.effect === 'not_measured' ? 'not_measured' : 'measured',
      },
    });
  } catch {
    /* the action_memory row is the record; the queue is the audit trail */
  }
  return { ...recorded, effect: classified.effect, memoryId, memory };
}

export async function rankCitedFixes<T extends { signature: string }>(
  env: Env,
  accountId: string,
  domain: string,
  items: readonly T[],
): Promise<Array<T & { rankScore: number; evidence: string }>> {
  if (!env.DB) throw new RsiUserError('Database unavailable.', 503);
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
  if (!clean) throw new RsiUserError('Domain required.');
  const rows = await env.DB
    .prepare(
      `SELECT signature,
              SUM(CASE WHEN effect = 'success' THEN 1 ELSE 0 END) AS successes,
              SUM(CASE WHEN effect = 'regression' THEN 1 ELSE 0 END) AS regressions,
              SUM(CASE WHEN effect IN ('success', 'regression', 'no_gain') THEN 1 ELSE 0 END) AS measured
       FROM rsi_fix_observations
       WHERE account_id = ? AND domain = ?
       GROUP BY signature`,
    )
    .bind(accountId, clean)
    .all<{ signature: string; successes: number; regressions: number; measured: number }>();
  const stats: FixStat[] = (rows.results || []).map((row) => ({
    signature: row.signature,
    successes: Number(row.successes || 0),
    regressions: Number(row.regressions || 0),
    measured: Number(row.measured || 0),
  }));
  return rankFixes(items, stats, normalizeFixSignature);
}
