/**
 * Persist corrections, nudge reward weights, and publish prompts only after the eval gate.
 */
import type { Env } from './env';
import { utcIsoWeekKey, gateLiveChange, requireEvidence, RSI_MAX_CHANGES_PER_ROUND } from '../services/rsi/guardrails';
import { correctionToSkillCase, renderCorrectionEvalYaml, validateCorrection, type UserCorrection } from '../services/rsi/corrections';
import { failedEvalNames, runPromptEvals, type SkillEvalCase } from '../services/rsi/skillEvals';
import { scanSkillBody } from '../services/rsi/skillGuard';
import {
  DEFAULT_LUMINARA_REWARD_WEIGHTS,
  nudgeRewardWeights,
  type OutcomeSignal,
  type RewardWeights,
} from '../services/rl/luminaraRewardFunctions';
import { setAgentSkillEnabled, upsertAgentSkillVersion } from './agentSkills';
import { RsiUserError } from './rsiErrors';

const ROUND_MS = 24 * 60 * 60 * 1000;
const MISSING_TABLE = /no such table: rsi_/i;

type CaseRow = {
  id: string;
  account_id: string;
  domain: string;
  prompt: string;
  bad_excerpt: string;
  good_excerpt: string;
  source_refs_json: string;
  yaml_text: string;
  active: number;
  created_at: number;
};

function parseRefs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function rethrow(err: unknown): never {
  if (err instanceof RsiUserError) throw err;
  if (MISSING_TABLE.test(String((err as Error)?.message || err))) {
    throw new RsiUserError('RSI correction tables are missing. Apply migration 0028_rsi_corrections.sql.', 503);
  }
  throw err;
}

function requireDb(env: Env): D1Database {
  if (!env.DB) throw new RsiUserError('Database unavailable.', 503);
  return env.DB;
}

export async function listCorrectionCases(env: Env, accountId: string): Promise<UserCorrection[]> {
  const db = requireDb(env);
  try {
    const rows = await db
      .prepare(`SELECT * FROM rsi_eval_cases WHERE account_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 100`)
      .bind(accountId)
      .all<CaseRow>();
    return (rows.results || []).map((row) => ({
      id: row.id,
      accountId: row.account_id,
      domain: row.domain,
      prompt: row.prompt,
      badExcerpt: row.bad_excerpt,
      goodExcerpt: row.good_excerpt,
      sourceRefs: parseRefs(row.source_refs_json),
      createdAt: row.created_at,
    }));
  } catch (err) {
    rethrow(err);
  }
}

export async function listCorrectionEvalCases(env: Env, accountId: string): Promise<SkillEvalCase[]> {
  try {
    const corrections = await listCorrectionCases(env, accountId);
    return corrections.map(correctionToSkillCase);
  } catch (err) {
    if (MISSING_TABLE.test(String((err as Error)?.message || err))) return [];
    throw err;
  }
}

export async function recordCorrection(
  env: Env,
  accountId: string,
  input: { domain: string; prompt: string; badExcerpt: string; goodExcerpt: string; sourceRefs: string[] },
  now = Date.now(),
): Promise<UserCorrection & { yaml: string }> {
  const db = requireDb(env);
  const validated = validateCorrection(input);
  if (!validated.ok) throw new RsiUserError(validated.reason);
  const id = crypto.randomUUID();
  const correction: UserCorrection = { id, accountId, ...validated.draft, createdAt: now };
  const yaml = renderCorrectionEvalYaml(correction);
  try {
    await db
      .prepare(
        `INSERT INTO rsi_eval_cases (
          id, account_id, domain, prompt, bad_excerpt, good_excerpt, source_refs_json, yaml_text, active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .bind(
        id,
        accountId,
        correction.domain,
        correction.prompt,
        correction.badExcerpt,
        correction.goodExcerpt,
        JSON.stringify(correction.sourceRefs),
        yaml,
        now,
      )
      .run();
    return { ...correction, yaml };
  } catch (err) {
    rethrow(err);
  }
}

function parseWeights(raw: string | null): RewardWeights {
  if (!raw) return { ...DEFAULT_LUMINARA_REWARD_WEIGHTS };
  try {
    const parsed = JSON.parse(raw) as Partial<RewardWeights>;
    const base = { ...DEFAULT_LUMINARA_REWARD_WEIGHTS };
    for (const key of Object.keys(base) as Array<keyof RewardWeights>) {
      if (typeof parsed[key] === 'number' && Number.isFinite(parsed[key])) base[key] = parsed[key] as number;
    }
    return base;
  } catch {
    return { ...DEFAULT_LUMINARA_REWARD_WEIGHTS };
  }
}

export async function getRewardProfile(
  env: Env,
  accountId: string,
): Promise<{ weights: RewardWeights; pinned: boolean; lastNudgeWeek: string }> {
  const db = requireDb(env);
  try {
    const row = await db
      .prepare(`SELECT weights_json, pinned, last_nudge_week FROM rsi_reward_profiles WHERE account_id = ?`)
      .bind(accountId)
      .first<{ weights_json: string; pinned: number; last_nudge_week: string }>();
    if (!row) return { weights: { ...DEFAULT_LUMINARA_REWARD_WEIGHTS }, pinned: false, lastNudgeWeek: '' };
    return { weights: parseWeights(row.weights_json), pinned: row.pinned === 1, lastNudgeWeek: row.last_nudge_week || '' };
  } catch (err) {
    rethrow(err);
  }
}

async function writeProfile(
  env: Env,
  accountId: string,
  weights: RewardWeights,
  pinned: boolean,
  lastNudgeWeek: string,
  now: number,
): Promise<void> {
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO rsi_reward_profiles (account_id, weights_json, pinned, last_nudge_week, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         weights_json = excluded.weights_json,
         pinned = excluded.pinned,
         last_nudge_week = excluded.last_nudge_week,
         updated_at = excluded.updated_at`,
    )
    .bind(accountId, JSON.stringify(weights), pinned ? 1 : 0, lastNudgeWeek, now)
    .run();
}

export async function nudgeRewardProfile(
  env: Env,
  accountId: string,
  input: { signals: OutcomeSignal[]; sourceRefs: string[] },
  now = Date.now(),
): Promise<{ weights: RewardWeights; changed: boolean; notes: string[]; pinned: boolean }> {
  const evidence = requireEvidence(input.sourceRefs);
  if (!evidence.ok) throw new RsiUserError(evidence.reason);
  if (!Array.isArray(input.signals) || input.signals.length === 0) {
    throw new RsiUserError('At least one outcome signal is required.');
  }
  try {
    const profile = await getRewardProfile(env, accountId);
    if (profile.pinned) {
      throw new RsiUserError('Pinned reward weights stay fixed until a person unpins them.', 409);
    }
    const week = utcIsoWeekKey(now);
    if (profile.lastNudgeWeek === week) {
      return {
        weights: profile.weights,
        changed: false,
        pinned: false,
        notes: [`Reward weights already moved in ${week}. One nudge per week.`],
      };
    }
    const nudged = nudgeRewardWeights(profile.weights, input.signals);
    if (!nudged.changed) return { weights: profile.weights, changed: false, pinned: false, notes: nudged.notes };
    await writeProfile(env, accountId, nudged.weights, false, week, now);
    const db = requireDb(env);
    await db
      .prepare(`INSERT INTO rsi_reward_revisions (id, account_id, weights_json, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), accountId, JSON.stringify(profile.weights), nudged.notes.join(' '), now)
      .run();
    return { weights: nudged.weights, changed: true, pinned: false, notes: nudged.notes };
  } catch (err) {
    rethrow(err);
  }
}

export async function setRewardPinned(env: Env, accountId: string, pinned: boolean, now = Date.now()): Promise<{ pinned: boolean; weights: RewardWeights }> {
  try {
    const profile = await getRewardProfile(env, accountId);
    await writeProfile(env, accountId, profile.weights, pinned, profile.lastNudgeWeek, now);
    return { pinned, weights: profile.weights };
  } catch (err) {
    rethrow(err);
  }
}

export async function rollbackRewardProfile(env: Env, accountId: string, now = Date.now()): Promise<RewardWeights> {
  const db = requireDb(env);
  try {
    const profile = await getRewardProfile(env, accountId);
    if (profile.pinned) throw new RsiUserError('Pinned reward weights stay fixed until a person unpins them.', 409);
    const prior = await db
      .prepare(`SELECT id, weights_json FROM rsi_reward_revisions WHERE account_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(accountId)
      .first<{ id: string; weights_json: string }>();
    if (!prior) throw new RsiUserError('No earlier reward weights to restore.', 409);
    const weights = parseWeights(prior.weights_json);
    await writeProfile(env, accountId, weights, false, profile.lastNudgeWeek, now);
    await db.prepare(`DELETE FROM rsi_reward_revisions WHERE id = ? AND account_id = ?`).bind(prior.id, accountId).run();
    return weights;
  } catch (err) {
    rethrow(err);
  }
}

export async function countPromptChangesThisRound(env: Env, accountId: string, now: number): Promise<number> {
  if (!env.DB) return 0;
  try {
    const row = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM rsi_prompt_changes WHERE account_id = ? AND created_at >= ? AND counts_toward_cap = 1`,
      )
      .bind(accountId, now - ROUND_MS)
      .first<{ n: number }>();
    return Number(row?.n || 0);
  } catch (err) {
    if (MISSING_TABLE.test(String((err as Error)?.message || err))) return 0;
    throw err;
  }
}

export async function publishGatedPrompt(
  env: Env,
  accountId: string,
  input: { slug: string; promptBody: string; evidenceRefs: string[]; changesAlreadyThisRound: number },
  now = Date.now(),
): Promise<{ version: number; reasons: string[] }> {
  const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!slug) throw new RsiUserError('Prompt slug required.');
  const evidence = requireEvidence(input.evidenceRefs);
  if (!evidence.ok) throw new RsiUserError(evidence.reason);
  const extra = await listCorrectionEvalCases(env, accountId);
  const guard = scanSkillBody(input.promptBody);
  const evals = runPromptEvals(input.promptBody, extra);
  const gate = gateLiveChange({
    evidenceRefs: evidence.refs,
    pinned: false,
    guardOk: guard.ok,
    guardFindings: guard.findings.map((finding) => finding.detail),
    evalsPassed: evals.passed,
    failedCases: failedEvalNames(evals),
    changesAlreadyThisRound: input.changesAlreadyThisRound,
    cap: RSI_MAX_CHANGES_PER_ROUND,
  });
  if (!gate.allowed) throw new RsiUserError(gate.reasons.join(' '), 409);
  try {
    const db = requireDb(env);
    const previous = await db
      .prepare(`SELECT MAX(version) AS v FROM agent_skills WHERE skill_slug = ?`)
      .bind(slug)
      .first<{ v: number | null }>();
    const { version } = await upsertAgentSkillVersion(env, {
      slug,
      promptBody: input.promptBody,
      createdBy: accountId,
      notes: 'rsi-eval-gate',
    });
    await db
      .prepare(
        `INSERT INTO rsi_prompt_changes (
          id, account_id, slug, version, previous_version, prompt_body, evidence_refs_json, counts_toward_cap, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        accountId,
        slug,
        version,
        previous?.v ?? null,
        input.promptBody,
        JSON.stringify(evidence.refs),
        now,
      )
      .run();
    return { version, reasons: [] };
  } catch (err) {
    rethrow(err);
  }
}

export async function rollbackGatedPrompt(env: Env, accountId: string, slug: string): Promise<{ disabledVersion: number; restoredVersion: number | null }> {
  const db = requireDb(env);
  const clean = slug.trim().toLowerCase();
  try {
    const row = await db
      .prepare(
        `SELECT version, previous_version FROM rsi_prompt_changes
         WHERE account_id = ? AND slug = ? AND counts_toward_cap = 1
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(accountId, clean)
      .first<{ version: number; previous_version: number | null }>();
    if (!row) throw new RsiUserError('No gated prompt publish to roll back.', 404);
    await setAgentSkillEnabled(env, clean, row.version, false);
    if (row.previous_version != null) await setAgentSkillEnabled(env, clean, row.previous_version, true);
    await db
      .prepare(`UPDATE rsi_prompt_changes SET counts_toward_cap = 0 WHERE account_id = ? AND slug = ? AND version = ?`)
      .bind(accountId, clean, row.version)
      .run();
    await db
      .prepare(
        `INSERT INTO rsi_prompt_changes (
          id, account_id, slug, version, previous_version, prompt_body, evidence_refs_json, counts_toward_cap, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, '[]', 0, ?)`,
      )
      .bind(crypto.randomUUID(), accountId, clean, row.version, row.previous_version, 'rollback', Date.now())
      .run();
    return { disabledVersion: row.version, restoredVersion: row.previous_version };
  } catch (err) {
    rethrow(err);
  }
}
