/**
 * D1 + KV persistence for the learned skill library.
 * D1 is the record. KV holds a short-lived copy of the latest live body.
 */
import type { Env } from './env';
import {
  applySkillProposal,
  considerFixSuccess,
  normalizeFixSignature,
  planCuratorRound,
  recordSkillUsage,
  rollbackSkill,
  setSkillPinned,
  slugForFix,
  type FixObservation,
  type RsiSkill,
  type SkillProposal,
  type SkillRevision,
} from '../services/rsi/skillLibrary';
import { requireEvidence } from '../services/rsi/guardrails';
import { RsiUserError } from './rsiErrors';
import { countPromptChangesThisRound, listCorrectionEvalCases } from './rsiCorrections';

const ROUND_MS = 24 * 60 * 60 * 1000;
const KV_TTL_SECONDS = 300;
const MISSING_TABLE = /no such table: rsi_/i;

type SkillRow = {
  id: string;
  account_id: string;
  slug: string;
  title: string;
  body_md: string;
  version: number;
  state: RsiSkill['state'];
  pinned: number;
  source_refs_json: string;
  usage_count: number;
  success_count: number;
  failure_count: number;
  last_used_at: number | null;
  stale_at: number | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
};

type RevisionRow = {
  id: string;
  skill_id: string;
  account_id: string;
  version: number;
  title: string;
  body_md: string;
  state: RsiSkill['state'];
  pinned: number;
  change_kind: SkillRevision['changeKind'];
  evidence_refs_json: string;
  guard_ok: number;
  evals_ok: number;
  created_at: number;
};

type ProposalRow = {
  id: string;
  account_id: string;
  slug: string;
  title: string;
  body_md: string;
  kind: SkillProposal['kind'];
  target_skill_id: string | null;
  evidence_refs_json: string;
  success_count: number;
  status: SkillProposal['status'];
  block_reason: string | null;
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

function skillFromRow(row: SkillRow): RsiSkill {
  return {
    id: row.id,
    accountId: row.account_id,
    slug: row.slug,
    title: row.title,
    bodyMd: row.body_md,
    version: row.version,
    state: row.state,
    pinned: row.pinned === 1,
    sourceRefs: parseRefs(row.source_refs_json),
    usageCount: row.usage_count,
    successCount: row.success_count,
    failureCount: row.failure_count,
    lastUsedAt: row.last_used_at,
    staleAt: row.stale_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function revisionFromRow(row: RevisionRow): SkillRevision {
  return {
    id: row.id,
    skillId: row.skill_id,
    accountId: row.account_id,
    version: row.version,
    title: row.title,
    bodyMd: row.body_md,
    state: row.state,
    pinned: row.pinned === 1,
    changeKind: row.change_kind,
    evidenceRefs: parseRefs(row.evidence_refs_json),
    guardOk: row.guard_ok === 1,
    evalsOk: row.evals_ok === 1,
    createdAt: row.created_at,
  };
}

function proposalFromRow(row: ProposalRow): SkillProposal {
  return {
    id: row.id,
    accountId: row.account_id,
    slug: row.slug,
    title: row.title,
    bodyMd: row.body_md,
    kind: row.kind,
    targetSkillId: row.target_skill_id,
    evidenceRefs: parseRefs(row.evidence_refs_json),
    successCount: row.success_count,
    status: row.status,
    blockReason: row.block_reason,
    createdAt: row.created_at,
  };
}

function rethrowStore(err: unknown): never {
  if (err instanceof RsiUserError) throw err;
  if (MISSING_TABLE.test(String((err as Error)?.message || err))) {
    throw new RsiUserError('RSI skill tables are missing. Apply migration 0027_rsi_skill_library.sql.', 503);
  }
  throw err;
}

function requireDb(env: Env): D1Database {
  if (!env.DB) throw new RsiUserError('Database unavailable.', 503);
  return env.DB;
}

function cleanDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
}

const listKey = (accountId: string) => `rsi:skills:${accountId}`;
const bodyKey = (accountId: string, slug: string) => `rsi:skill:${accountId}:${slug}`;

async function invalidateSkillCache(env: Env, accountId: string, slug?: string): Promise<void> {
  if (!env.LUMINARA_KV) return;
  try {
    await env.LUMINARA_KV.delete(listKey(accountId));
    if (slug) await env.LUMINARA_KV.delete(bodyKey(accountId, slug));
  } catch {
    /* cache expires on its own */
  }
}

async function cacheLiveSkill(env: Env, skill: RsiSkill): Promise<void> {
  if (!env.LUMINARA_KV || skill.state === 'archived') return;
  try {
    await env.LUMINARA_KV.put(bodyKey(skill.accountId, skill.slug), JSON.stringify(skill), { expirationTtl: KV_TTL_SECONDS });
  } catch {
    /* ignore */
  }
}

export async function listRsiSkills(env: Env, accountId: string, state?: RsiSkill['state']): Promise<RsiSkill[]> {
  const db = requireDb(env);
  try {
    const rows = state
      ? await db
          .prepare(
            `SELECT * FROM rsi_skills WHERE account_id = ? AND state = ? ORDER BY updated_at DESC LIMIT 200`,
          )
          .bind(accountId, state)
          .all<SkillRow>()
      : await db
          .prepare(`SELECT * FROM rsi_skills WHERE account_id = ? ORDER BY updated_at DESC LIMIT 200`)
          .bind(accountId)
          .all<SkillRow>();
    return (rows.results || []).map(skillFromRow);
  } catch (err) {
    rethrowStore(err);
  }
}

async function loadSkillForMutation(env: Env, accountId: string, idOrSlug: string): Promise<RsiSkill> {
  const db = requireDb(env);
  const row = await db
    .prepare(`SELECT * FROM rsi_skills WHERE account_id = ? AND (id = ? OR slug = ?) ORDER BY updated_at DESC LIMIT 1`)
    .bind(accountId, idOrSlug, idOrSlug)
    .first<SkillRow>();
  if (!row) throw new RsiUserError('Skill not found.', 404);
  return skillFromRow(row);
}

export async function getRsiSkill(env: Env, accountId: string, idOrSlug: string): Promise<RsiSkill | null> {
  if (env.LUMINARA_KV) {
    try {
      const cached = (await env.LUMINARA_KV.get(bodyKey(accountId, idOrSlug), 'json')) as RsiSkill | null;
      if (cached && cached.accountId === accountId && cached.slug === idOrSlug) return cached;
    } catch {
      /* miss */
    }
  }
  const db = requireDb(env);
  try {
    const row = await db
      .prepare(`SELECT * FROM rsi_skills WHERE account_id = ? AND (id = ? OR slug = ?) ORDER BY updated_at DESC LIMIT 1`)
      .bind(accountId, idOrSlug, idOrSlug)
      .first<SkillRow>();
    if (!row) return null;
    const skill = skillFromRow(row);
    await cacheLiveSkill(env, skill);
    return skill;
  } catch (err) {
    rethrowStore(err);
  }
}

async function loadLiveSkills(env: Env, accountId: string): Promise<RsiSkill[]> {
  const db = requireDb(env);
  const rows = await db
    .prepare(`SELECT * FROM rsi_skills WHERE account_id = ? AND state != 'archived'`)
    .bind(accountId)
    .all<SkillRow>();
  return (rows.results || []).map(skillFromRow);
}

async function loadSuccesses(env: Env, accountId: string, signature: string): Promise<FixObservation[]> {
  const db = requireDb(env);
  const rows = await db
    .prepare(
      `SELECT id, account_id, domain, signature, title, outcome, source_refs_json, created_at
       FROM rsi_fix_observations
       WHERE account_id = ? AND signature = ? AND outcome = 'success'
       ORDER BY created_at ASC LIMIT 50`,
    )
    .bind(accountId, signature)
    .all<{
      id: string;
      account_id: string;
      domain: string;
      signature: string;
      title: string;
      outcome: 'success';
      source_refs_json: string;
      created_at: number;
    }>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    domain: row.domain,
    signature: row.signature,
    title: row.title,
    outcome: 'success' as const,
    sourceRefs: parseRefs(row.source_refs_json),
    createdAt: row.created_at,
  }));
}

export async function countAutomaticRsiChanges(env: Env, accountId: string, now = Date.now()): Promise<number> {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM rsi_skill_revisions
       WHERE account_id = ? AND created_at >= ? AND change_kind IN ('create', 'patch', 'archive', 'curate_stale')`,
    )
    .bind(accountId, now - ROUND_MS)
    .first<{ n: number }>();
  const prompts = await countPromptChangesThisRound(env, accountId, now);
  return Number(row?.n || 0) + prompts;
}

async function saveProposal(env: Env, proposal: SkillProposal, existingId: string | null): Promise<void> {
  const db = requireDb(env);
  if (existingId) {
    await db
      .prepare(
        `UPDATE rsi_skill_proposals SET
          slug = ?, title = ?, body_md = ?, kind = ?, target_skill_id = ?, evidence_refs_json = ?,
          success_count = ?, status = ?, block_reason = ?
         WHERE id = ? AND account_id = ?`,
      )
      .bind(
        proposal.slug,
        proposal.title,
        proposal.bodyMd,
        proposal.kind,
        proposal.targetSkillId,
        JSON.stringify(proposal.evidenceRefs),
        proposal.successCount,
        proposal.status,
        proposal.blockReason,
        existingId,
        proposal.accountId,
      )
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO rsi_skill_proposals (
        id, account_id, slug, title, body_md, kind, target_skill_id, evidence_refs_json,
        success_count, status, block_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      proposal.id,
      proposal.accountId,
      proposal.slug,
      proposal.title,
      proposal.bodyMd,
      proposal.kind,
      proposal.targetSkillId,
      JSON.stringify(proposal.evidenceRefs),
      proposal.successCount,
      proposal.status,
      proposal.blockReason,
      proposal.createdAt,
    )
    .run();
}

export interface RecordObservationInput {
  domain: string;
  signature: string;
  title: string;
  outcome: 'success' | 'failure';
  sourceRefs: string[];
}

export async function recordFixObservation(
  env: Env,
  accountId: string,
  input: RecordObservationInput,
  now = Date.now(),
): Promise<{ observation: FixObservation; proposal: SkillProposal | null; reason: string }> {
  const db = requireDb(env);
  const domain = cleanDomain(input.domain || '');
  const signature = normalizeFixSignature(input.signature || '');
  const title = String(input.title || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (!domain) throw new RsiUserError('Domain required.');
  if (!signature) throw new RsiUserError('Fix signature required.');
  if (!title) throw new RsiUserError('Fix title required.');
  if (input.outcome !== 'success' && input.outcome !== 'failure') {
    throw new RsiUserError('Outcome must be success or failure.');
  }
  const evidence = requireEvidence(input.sourceRefs || []);
  if (!evidence.ok) throw new RsiUserError(evidence.reason);
  const observation: FixObservation = {
    id: crypto.randomUUID(),
    accountId,
    domain,
    signature,
    title,
    outcome: input.outcome,
    sourceRefs: evidence.refs,
    createdAt: now,
  };
  try {
    await db
      .prepare(
        `INSERT INTO rsi_fix_observations (id, account_id, domain, signature, title, outcome, source_refs_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(observation.id, accountId, domain, signature, title, observation.outcome, JSON.stringify(evidence.refs), now)
      .run();
    if (observation.outcome !== 'success') {
      return { observation, proposal: null, reason: 'Failure recorded. A skill is proposed only after repeated successes.' };
    }
    const successes = await loadSuccesses(env, accountId, signature);
    const skills = await loadLiveSkills(env, accountId);
    const pending = await db
      .prepare(
        `SELECT * FROM rsi_skill_proposals WHERE account_id = ? AND slug = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(accountId, slugForFix(signature))
      .first<ProposalRow>();
    const decision = considerFixSuccess({
      successes,
      skills,
      proposalId: pending?.id || crypto.randomUUID(),
      now,
    });
    if (!decision.proposal) {
      return { observation, proposal: pending ? proposalFromRow(pending) : null, reason: decision.reason };
    }
    await saveProposal(env, decision.proposal, pending ? pending.id : null);
    return { observation, proposal: decision.proposal, reason: decision.reason };
  } catch (err) {
    rethrowStore(err);
  }
}

async function insertRevision(env: Env, revision: SkillRevision): Promise<void> {
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO rsi_skill_revisions (
        id, skill_id, account_id, version, title, body_md, state, pinned, change_kind,
        evidence_refs_json, guard_ok, evals_ok, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      revision.id,
      revision.skillId,
      revision.accountId,
      revision.version,
      revision.title,
      revision.bodyMd,
      revision.state,
      revision.pinned ? 1 : 0,
      revision.changeKind,
      JSON.stringify(revision.evidenceRefs),
      revision.guardOk ? 1 : 0,
      revision.evalsOk ? 1 : 0,
      revision.createdAt,
    )
    .run();
}

async function upsertSkill(env: Env, skill: RsiSkill, isNew: boolean): Promise<void> {
  const db = requireDb(env);
  if (isNew) {
    await db
      .prepare(
        `INSERT INTO rsi_skills (
          id, account_id, slug, title, body_md, version, state, pinned, source_refs_json,
          usage_count, success_count, failure_count, last_used_at, stale_at, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        skill.id,
        skill.accountId,
        skill.slug,
        skill.title,
        skill.bodyMd,
        skill.version,
        skill.state,
        skill.pinned ? 1 : 0,
        JSON.stringify(skill.sourceRefs),
        skill.usageCount,
        skill.successCount,
        skill.failureCount,
        skill.lastUsedAt,
        skill.staleAt,
        skill.createdAt,
        skill.updatedAt,
        skill.archivedAt,
      )
      .run();
    return;
  }
  const result = await db
    .prepare(
      `UPDATE rsi_skills SET
        title = ?, body_md = ?, version = ?, state = ?, pinned = ?, source_refs_json = ?,
        usage_count = ?, success_count = ?, failure_count = ?, last_used_at = ?, stale_at = ?,
        updated_at = ?, archived_at = ?
       WHERE id = ? AND account_id = ? AND pinned = 0`,
    )
    .bind(
      skill.title,
      skill.bodyMd,
      skill.version,
      skill.state,
      skill.pinned ? 1 : 0,
      JSON.stringify(skill.sourceRefs),
      skill.usageCount,
      skill.successCount,
      skill.failureCount,
      skill.lastUsedAt,
      skill.staleAt,
      skill.updatedAt,
      skill.archivedAt,
      skill.id,
      skill.accountId,
    )
    .run();
  if (Number(result.meta?.changes ?? 0) === 0) {
    throw new RsiUserError('Pinned items stay fixed until a person unpins them.', 409);
  }
}

export async function applyRsiProposal(env: Env, accountId: string, proposalId: string, now = Date.now()): Promise<ApplyOutcome> {
  const db = requireDb(env);
  try {
    const row = await db
      .prepare(`SELECT * FROM rsi_skill_proposals WHERE id = ? AND account_id = ?`)
      .bind(proposalId, accountId)
      .first<ProposalRow>();
    if (!row) throw new RsiUserError('Proposal not found.', 404);
    const proposal = proposalFromRow(row);
    const skills = await loadLiveSkills(env, accountId);
    const spent = await countAutomaticRsiChanges(env, accountId, now);
    const extraCases = await listCorrectionEvalCases(env, accountId);
    const applied = applySkillProposal({
      proposal,
      skills,
      now,
      skillId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      changesAlreadyThisRound: spent,
      extraCases,
    });
    if (!applied.ok || !applied.skill || !applied.revision) {
      await saveProposal(env, applied.proposal, proposal.id);
      return { ok: false, deferred: applied.deferred, reason: applied.reason, proposal: applied.proposal };
    }
    const isNew = !skills.some((skill) => skill.id === applied.skill!.id);
    await upsertSkill(env, applied.skill, isNew);
    await insertRevision(env, applied.revision);
    await saveProposal(env, applied.proposal, proposal.id);
    await invalidateSkillCache(env, accountId, applied.skill.slug);
    await cacheLiveSkill(env, applied.skill);
    return { ok: true, deferred: false, reason: applied.reason, proposal: applied.proposal, skill: applied.skill };
  } catch (err) {
    rethrowStore(err);
  }
}

export interface ApplyOutcome {
  ok: boolean;
  deferred: boolean;
  reason: string;
  proposal: SkillProposal;
  skill?: RsiSkill;
}

export async function listRsiProposals(env: Env, accountId: string, status?: SkillProposal['status']): Promise<SkillProposal[]> {
  const db = requireDb(env);
  try {
    const rows = status
      ? await db
          .prepare(
            `SELECT * FROM rsi_skill_proposals WHERE account_id = ? AND status = ? ORDER BY created_at DESC LIMIT 100`,
          )
          .bind(accountId, status)
          .all<ProposalRow>()
      : await db
          .prepare(`SELECT * FROM rsi_skill_proposals WHERE account_id = ? ORDER BY created_at DESC LIMIT 100`)
          .bind(accountId)
          .all<ProposalRow>();
    return (rows.results || []).map(proposalFromRow);
  } catch (err) {
    rethrowStore(err);
  }
}

export async function setRsiSkillPinned(env: Env, accountId: string, skillId: string, pinned: boolean, now = Date.now()): Promise<RsiSkill> {
  const db = requireDb(env);
  try {
    const current = await loadSkillForMutation(env, accountId, skillId);
    const { skill, revision } = setSkillPinned(current, pinned, now, crypto.randomUUID());
    await db
      .prepare(`UPDATE rsi_skills SET pinned = ?, updated_at = ? WHERE id = ? AND account_id = ?`)
      .bind(pinned ? 1 : 0, now, skill.id, accountId)
      .run();
    await insertRevision(env, revision);
    await invalidateSkillCache(env, accountId, skill.slug);
    await cacheLiveSkill(env, skill);
    return skill;
  } catch (err) {
    rethrowStore(err);
  }
}

export async function rollbackRsiSkill(env: Env, accountId: string, skillId: string, now = Date.now()): Promise<RsiSkill> {
  const db = requireDb(env);
  try {
    const current = await loadSkillForMutation(env, accountId, skillId);
    const rows = await db
      .prepare(`SELECT * FROM rsi_skill_revisions WHERE skill_id = ? AND account_id = ? ORDER BY version DESC`)
      .bind(current.id, accountId)
      .all<RevisionRow>();
    const result = rollbackSkill({
      skill: current,
      revisions: (rows.results || []).map(revisionFromRow),
      now,
      revisionId: crypto.randomUUID(),
    });
    if (!result.ok) throw new RsiUserError(result.reason, 409);
    await upsertSkill(env, result.skill, false);
    await insertRevision(env, result.revision);
    await invalidateSkillCache(env, accountId, result.skill.slug);
    await cacheLiveSkill(env, result.skill);
    return result.skill;
  } catch (err) {
    rethrowStore(err);
  }
}

export async function recordRsiSkillUsage(
  env: Env,
  accountId: string,
  skillId: string,
  success: boolean,
  now = Date.now(),
): Promise<RsiSkill> {
  const db = requireDb(env);
  try {
    const current = await loadSkillForMutation(env, accountId, skillId);
    const skill = recordSkillUsage(current, success, now);
    await db
      .prepare(
        `UPDATE rsi_skills SET
          usage_count = ?, success_count = ?, failure_count = ?, last_used_at = ?, updated_at = ?, state = ?, stale_at = ?
         WHERE id = ? AND account_id = ?`,
      )
      .bind(
        skill.usageCount,
        skill.successCount,
        skill.failureCount,
        skill.lastUsedAt,
        skill.updatedAt,
        skill.state,
        skill.staleAt,
        skill.id,
        accountId,
      )
      .run();
    await invalidateSkillCache(env, accountId, skill.slug);
    return skill;
  } catch (err) {
    rethrowStore(err);
  }
}

export async function curateRsiAccount(
  env: Env,
  accountId: string,
  now = Date.now(),
): Promise<{ staled: number; archived: number; skippedPinned: string[]; deferred: string[] }> {
  try {
    const skills = await loadLiveSkills(env, accountId);
    const spent = await countAutomaticRsiChanges(env, accountId, now);
    const plan = planCuratorRound({
      skills,
      now,
      changesAlreadyThisRound: spent,
      nextId: () => crypto.randomUUID(),
    });
    for (const update of plan.updates) {
      await upsertSkill(env, update.skill, false);
      await insertRevision(env, update.revision);
      await invalidateSkillCache(env, accountId, update.skill.slug);
    }
    return {
      staled: plan.updates.filter((update) => update.kind === 'curate_stale').length,
      archived: plan.updates.filter((update) => update.kind === 'archive').length,
      skippedPinned: plan.skippedPinned,
      deferred: plan.deferred,
    };
  } catch (err) {
    rethrowStore(err);
  }
}

export async function listCuratorAccountIds(env: Env): Promise<string[]> {
  const db = requireDb(env);
  try {
    const rows = await db
      .prepare(
        `SELECT account_id FROM rsi_skills WHERE state != 'archived' GROUP BY account_id ORDER BY MIN(updated_at) ASC LIMIT 200`,
      )
      .all<{ account_id: string }>();
    return (rows.results || []).map((row) => row.account_id);
  } catch (err) {
    if (MISSING_TABLE.test(String((err as Error)?.message || err))) return [];
    throw err;
  }
}
