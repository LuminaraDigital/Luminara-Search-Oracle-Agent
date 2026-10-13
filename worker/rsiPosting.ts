/**
 * Record the selected post, ingest 24h and 72h metrics, and reflect into a playbook skill.
 * Selecting a post records it. This module does not call an external social network.
 */
import type { Env } from './env';
import { RSI_MAX_PLAYBOOK_EDITS_PER_WEEK, requireEvidence, utcIsoWeekKey } from '../services/rsi/guardrails';
import {
  generatePostCandidates,
  predictWinner,
  reflectPostingPlaybook,
  type MeasuredPost,
  type PostPatternKey,
} from '../services/rsi/postingAgent';
import { RsiUserError } from './rsiErrors';
import { applyRsiProposal, getRsiSkill } from './rsiSkillStore';

function requireDb(env: Env): D1Database {
  if (!env.DB) throw new RsiUserError('Database unavailable.', 503);
  return env.DB;
}

function brandSlug(brandId: string): string {
  const slug = brandId.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `posting-${slug || 'brand'}`;
}

export async function draftAndSelectPost(
  env: Env,
  accountId: string,
  input: { brandId: string; brandName: string; offer: string; audience: string; count?: number; sourceRefs: string[] },
) {
  const evidence = requireEvidence(input.sourceRefs);
  if (!evidence.ok) throw new RsiUserError(evidence.reason);
  const brandId = input.brandId.trim().slice(0, 80);
  if (!brandId) throw new RsiUserError('brandId required.');
  const candidates = generatePostCandidates(input);
  const history = await loadMeasured(env, accountId, brandId);
  const prediction = predictWinner(candidates, history);
  const winner = candidates.find((candidate) => candidate.id === prediction.winnerId) || candidates[0];
  const db = requireDb(env);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO rsi_posts (
        id, account_id, brand_id, pattern_key, hook, body, prediction, prediction_evidence, status, source_refs_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'selected', ?, ?)`,
    )
    .bind(
      id,
      accountId,
      brandId,
      winner.patternKey,
      winner.hook,
      winner.body,
      prediction.prediction,
      prediction.evidence,
      JSON.stringify(evidence.refs),
      now,
    )
    .run();
  return { postId: id, winner, candidates, prediction: prediction.prediction, evidence: prediction.evidence };
}

async function loadMeasured(env: Env, accountId: string, brandId: string): Promise<MeasuredPost[]> {
  const db = requireDb(env);
  const rows = await db
    .prepare(
      `SELECT p.pattern_key, m.engagements, m.measurement_status
       FROM rsi_posts p
       JOIN rsi_post_metrics m ON m.post_id = p.id AND m.horizon = '72h'
       WHERE p.account_id = ? AND p.brand_id = ?`,
    )
    .bind(accountId, brandId)
    .all<{ pattern_key: PostPatternKey; engagements: number | null; measurement_status: string }>();
  return (rows.results || []).map((row) => ({
    patternKey: row.pattern_key,
    engagements72: row.measurement_status === 'measured' ? row.engagements : null,
  }));
}

export async function ingestPostMetric(
  env: Env,
  accountId: string,
  input: {
    postId: string;
    horizon: '24h' | '72h';
    measurementStatus: 'measured' | 'not_measured';
    impressions: number | null;
    engagements: number | null;
  },
) {
  const db = requireDb(env);
  if (input.horizon !== '24h' && input.horizon !== '72h') throw new RsiUserError('horizon must be 24h or 72h.');
  const post = await db
    .prepare(`SELECT id FROM rsi_posts WHERE id = ? AND account_id = ?`)
    .bind(input.postId, accountId)
    .first<{ id: string }>();
  if (!post) throw new RsiUserError('Post not found.', 404);
  if (input.measurementStatus === 'not_measured') {
    if (input.impressions != null || input.engagements != null) {
      throw new RsiUserError('Do not send engagement numbers when the status is not_measured.');
    }
  } else if (input.measurementStatus !== 'measured' || input.engagements == null || !Number.isFinite(input.engagements)) {
    throw new RsiUserError('A measured snapshot needs a finite engagements number.');
  }
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO rsi_post_metrics (id, post_id, account_id, horizon, impressions, engagements, measurement_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(post_id, horizon) DO UPDATE SET
         impressions = excluded.impressions,
         engagements = excluded.engagements,
         measurement_status = excluded.measurement_status,
         created_at = excluded.created_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.postId,
      accountId,
      input.horizon,
      input.measurementStatus === 'measured' ? input.impressions : null,
      input.measurementStatus === 'measured' ? input.engagements : null,
      input.measurementStatus,
      now,
    )
    .run();
  return { ok: true as const };
}

export async function reflectBrandPlaybook(env: Env, accountId: string, brandId: string, brandName: string, now = Date.now()) {
  const db = requireDb(env);
  const week = utcIsoWeekKey(now);
  const spentRow = await db
    .prepare(`SELECT COALESCE(SUM(patterns_added), 0) AS n FROM rsi_post_reflections WHERE account_id = ? AND brand_id = ? AND week_key = ?`)
    .bind(accountId, brandId, week)
    .first<{ n: number }>();
  const editsThisWeek = Number(spentRow?.n || 0);
  const slug = brandSlug(brandId);
  const existing = await getRsiSkill(env, accountId, slug);
  const history = await loadMeasured(env, accountId, brandId);
  const reflection = reflectPostingPlaybook({
    brandName: brandName || brandId,
    history,
    currentBody: existing?.bodyMd || null,
    pinned: existing?.pinned || false,
    editsThisWeek,
    maxEdits: RSI_MAX_PLAYBOOK_EDITS_PER_WEEK,
    evidenceRef: `reflection:${week}`,
  });
  if (reflection.added.length === 0) return { ...reflection, applied: false };
  const proposalId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO rsi_skill_proposals (
        id, account_id, slug, title, body_md, kind, target_skill_id, evidence_refs_json,
        success_count, status, block_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`,
    )
    .bind(
      proposalId,
      accountId,
      slug,
      `Posting playbook: ${brandName || brandId}`,
      reflection.body,
      existing ? 'patch' : 'create',
      existing?.id || null,
      JSON.stringify([`reflection:${week}`]),
      reflection.added.length,
      now,
    )
    .run();
  const applied = await applyRsiProposal(env, accountId, proposalId, now);
  if (applied.ok) {
    await db
      .prepare(
        `INSERT INTO rsi_post_reflections (id, account_id, brand_id, week_key, patterns_added, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), accountId, brandId, week, reflection.added.length, now)
      .run();
  }
  return { ...reflection, applied: applied.ok, applyReason: applied.reason };
}

export async function runPostingReflection(env: Env): Promise<{ brands: number; applied: number }> {
  if (!env.DB) return { brands: 0, applied: 0 };
  let rows: { account_id: string; brand_id: string }[] = [];
  try {
    const listed = await env.DB
      .prepare(`SELECT account_id, brand_id FROM rsi_posts GROUP BY account_id, brand_id ORDER BY MAX(created_at) DESC LIMIT 50`)
      .all<{ account_id: string; brand_id: string }>();
    rows = listed.results || [];
  } catch (err) {
    if (/no such table: rsi_posts/i.test(String((err as Error)?.message || err))) return { brands: 0, applied: 0 };
    throw err;
  }
  let applied = 0;
  for (const row of rows) {
    try {
      const result = await reflectBrandPlaybook(env, row.account_id, row.brand_id, row.brand_id);
      if (result.applied) applied += 1;
    } catch (err) {
      console.error('[RSI] posting reflection failed for a brand', err instanceof Error ? err.message : 'error');
    }
  }
  return { brands: rows.length, applied };
}
