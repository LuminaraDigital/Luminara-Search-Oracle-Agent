/**
 * Self-learning skill library.
 *
 * Usage counts, active/stale/archived state, and a curator that retires
 * unused skills follow the shape of Nous Research hermes-agent (MIT)
 * tools/skill_manager_tool.py and skill_usage.py. This file is original.
 * The propose-then-evaluate-then-retain loop follows Gen-Verse/RSI-Anything
 * (Apache-2.0) at the idea level only.
 *
 * A skill is proposed after the same fix succeeds at least twice. It goes
 * live only when the safety scan and evals pass, evidence is cited, the
 * record is not pinned, and the round still has change budget.
 */

import { RSI_ARCHIVE_STALE_AFTER_MS, RSI_MAX_CHANGES_PER_ROUND, RSI_MIN_SUCCESSES_TO_PROPOSE, RSI_STALE_AFTER_MS, gateLiveChange, requireEvidence } from './guardrails';
import { scanSkillBody } from './skillGuard';
import { failedEvalNames, runSkillEvals, type SkillEvalCase } from './skillEvals';

export type SkillState = 'active' | 'stale' | 'archived';
export type SkillChangeKind = 'create' | 'patch' | 'archive' | 'restore' | 'curate_stale' | 'pin' | 'unpin';
export type ProposalKind = 'create' | 'patch';
export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'blocked';

export interface RsiSkill {
  id: string;
  accountId: string;
  slug: string;
  title: string;
  bodyMd: string;
  version: number;
  state: SkillState;
  pinned: boolean;
  sourceRefs: string[];
  usageCount: number;
  successCount: number;
  failureCount: number;
  lastUsedAt: number | null;
  staleAt: number | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface SkillRevision {
  id: string;
  skillId: string;
  accountId: string;
  version: number;
  title: string;
  bodyMd: string;
  state: SkillState;
  pinned: boolean;
  changeKind: SkillChangeKind;
  evidenceRefs: string[];
  guardOk: boolean;
  evalsOk: boolean;
  createdAt: number;
}

export interface FixObservation {
  id: string;
  accountId: string;
  domain: string;
  signature: string;
  title: string;
  outcome: 'success' | 'failure';
  sourceRefs: string[];
  createdAt: number;
}

export interface SkillProposal {
  id: string;
  accountId: string;
  slug: string;
  title: string;
  bodyMd: string;
  kind: ProposalKind;
  targetSkillId: string | null;
  evidenceRefs: string[];
  successCount: number;
  status: ProposalStatus;
  blockReason: string | null;
  createdAt: number;
}

export function skillSuccessRate(skill: Pick<RsiSkill, 'successCount' | 'failureCount'>): number | null {
  const decided = skill.successCount + skill.failureCount;
  if (decided === 0) return null;
  return skill.successCount / decided;
}

export function slugForFix(signature: string): string {
  const slug = signature
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `fix-${slug || 'untitled'}`;
}

export function normalizeFixSignature(signature: string): string {
  return signature.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

export function renderFixSkillMarkdown(input: {
  title: string;
  signature: string;
  domains: string[];
  evidenceRefs: string[];
  successCount: number;
}): string {
  const domains = [...new Set(input.domains.map((d) => d.trim()).filter(Boolean))];
  const refs = input.evidenceRefs.map((ref) => `- ${ref}`).join('\n');
  return [
    `# ${input.title}`,
    '',
    '## When to use',
    `Prefer this fix after it has succeeded at least twice. Signature: \`${input.signature}\`.`,
    domains.length > 0 ? `Seen on: ${domains.join(', ')}.` : 'Seen on: unknown.',
    '',
    '## Steps',
    `1. Apply the fix named "${input.title}".`,
    '2. Measure the AI citation rate before and after. If it was not measured, record not_measured and do not count the run as a success.',
    '',
    '## Evidence',
    `Recorded successes: ${input.successCount}.`,
    refs || '- none',
    '',
  ].join('\n');
}

function withSuccessLine(body: string, successCount: number, refs: string[]): string {
  let next = body;
  if (/^Recorded successes: \d+\./m.test(next)) {
    next = next.replace(/^Recorded successes: \d+\./m, `Recorded successes: ${successCount}.`);
  } else {
    next = `${next.trimEnd()}\n\n## Evidence\nRecorded successes: ${successCount}.\n`;
  }
  const extra = refs.filter((ref) => ref && !next.includes(ref)).map((ref) => `- ${ref}`);
  if (extra.length > 0) next = `${next.trimEnd()}\n${extra.join('\n')}\n`;
  return next;
}

export function considerFixSuccess(input: {
  successes: FixObservation[];
  skills: readonly RsiSkill[];
  proposalId: string;
  now: number;
}): { proposal: SkillProposal | null; reason: string } {
  const latestSeed = input.successes.filter((item) => item.outcome === 'success').at(-1);
  const successes = latestSeed
    ? input.successes.filter(
        (item) => item.outcome === 'success' && item.signature === latestSeed.signature && item.accountId === latestSeed.accountId,
      )
    : [];
  if (successes.length < RSI_MIN_SUCCESSES_TO_PROPOSE) {
    return { proposal: null, reason: `Waiting for ${RSI_MIN_SUCCESSES_TO_PROPOSE} measured successes.` };
  }
  const latest = successes[successes.length - 1];
  const evidence = requireEvidence(successes.flatMap((item) => item.sourceRefs));
  if (!evidence.ok) return { proposal: null, reason: evidence.reason };
  const slug = slugForFix(latest.signature);
  const existing = input.skills.find((skill) => skill.accountId === latest.accountId && skill.slug === slug && skill.state !== 'archived');
  if (existing?.pinned) {
    return {
      proposal: {
        id: input.proposalId,
        accountId: latest.accountId,
        slug,
        title: existing.title,
        bodyMd: existing.bodyMd,
        kind: 'patch',
        targetSkillId: existing.id,
        evidenceRefs: evidence.refs,
        successCount: successes.length,
        status: 'blocked',
        blockReason: 'Pinned items stay fixed until a person unpins them.',
        createdAt: input.now,
      },
      reason: 'Pinned items stay fixed until a person unpins them.',
    };
  }
  const domains = successes.map((item) => item.domain);
  const body = existing
    ? withSuccessLine(existing.bodyMd, successes.length, evidence.refs)
    : renderFixSkillMarkdown({
        title: latest.title,
        signature: latest.signature,
        domains,
        evidenceRefs: evidence.refs,
        successCount: successes.length,
      });
  if (existing && body === existing.bodyMd) {
    return { proposal: null, reason: 'Skill already records these successes.' };
  }
  return {
    proposal: {
      id: input.proposalId,
      accountId: latest.accountId,
      slug,
      title: latest.title,
      bodyMd: body,
      kind: existing ? 'patch' : 'create',
      targetSkillId: existing?.id ?? null,
      evidenceRefs: evidence.refs,
      successCount: successes.length,
      status: 'pending',
      blockReason: null,
      createdAt: input.now,
    },
    reason: existing ? 'Patch proposed from repeated successes.' : 'New skill proposed from repeated successes.',
  };
}

export interface ApplyProposalResult {
  ok: boolean;
  deferred: boolean;
  reason: string;
  proposal: SkillProposal;
  skill?: RsiSkill;
  revision?: SkillRevision;
}

export function applySkillProposal(input: {
  proposal: SkillProposal;
  skills: readonly RsiSkill[];
  now: number;
  skillId: string;
  revisionId: string;
  changesAlreadyThisRound: number;
  extraCases?: readonly SkillEvalCase[];
}): ApplyProposalResult {
  const proposal = input.proposal;
  if (proposal.status === 'applied' || proposal.status === 'rejected') {
    return { ok: false, deferred: false, reason: `Proposal is already ${proposal.status}.`, proposal };
  }
  const existing = proposal.targetSkillId
    ? input.skills.find((skill) => skill.id === proposal.targetSkillId)
    : input.skills.find((skill) => skill.accountId === proposal.accountId && skill.slug === proposal.slug && skill.state !== 'archived');
  const pinned = existing?.pinned ?? false;
  const guard = scanSkillBody(proposal.bodyMd);
  const evals = runSkillEvals(proposal.bodyMd, input.extraCases);
  const gate = gateLiveChange({
    evidenceRefs: proposal.evidenceRefs,
    pinned,
    guardOk: guard.ok,
    guardFindings: guard.findings.map((finding) => finding.detail),
    evalsPassed: evals.passed,
    failedCases: failedEvalNames(evals),
    changesAlreadyThisRound: input.changesAlreadyThisRound,
  });
  if (!gate.allowed) {
    const deferred = gate.reasons.length === 1 && gate.reasons[0].startsWith('Change cap reached');
    return {
      ok: false,
      deferred,
      reason: gate.reasons.join(' '),
      proposal: {
        ...proposal,
        status: deferred ? 'pending' : 'blocked',
        blockReason: deferred ? null : gate.reasons.join(' '),
      },
    };
  }
  const evidence = requireEvidence(proposal.evidenceRefs);
  const refs = evidence.ok ? evidence.refs : proposal.evidenceRefs;
  const skill: RsiSkill = existing
    ? {
        ...existing,
        title: proposal.title || existing.title,
        bodyMd: proposal.bodyMd,
        version: existing.version + 1,
        state: 'active',
        staleAt: null,
        sourceRefs: refs,
        updatedAt: input.now,
      }
    : {
        id: input.skillId,
        accountId: proposal.accountId,
        slug: proposal.slug,
        title: proposal.title,
        bodyMd: proposal.bodyMd,
        version: 1,
        state: 'active',
        pinned: false,
        sourceRefs: refs,
        usageCount: 0,
        successCount: 0,
        failureCount: 0,
        lastUsedAt: null,
        staleAt: null,
        createdAt: input.now,
        updatedAt: input.now,
        archivedAt: null,
      };
  const revision: SkillRevision = {
    id: input.revisionId,
    skillId: skill.id,
    accountId: skill.accountId,
    version: skill.version,
    title: skill.title,
    bodyMd: skill.bodyMd,
    state: skill.state,
    pinned: skill.pinned,
    changeKind: existing ? 'patch' : 'create',
    evidenceRefs: refs,
    guardOk: true,
    evalsOk: true,
    createdAt: input.now,
  };
  return {
    ok: true,
    deferred: false,
    reason: existing ? 'Skill patched.' : 'Skill created.',
    proposal: { ...proposal, status: 'applied', blockReason: null, targetSkillId: skill.id },
    skill,
    revision,
  };
}

export function recordSkillUsage(skill: RsiSkill, success: boolean, at: number): RsiSkill {
  const archived = skill.state === 'archived';
  return {
    ...skill,
    usageCount: skill.usageCount + 1,
    successCount: skill.successCount + (success ? 1 : 0),
    failureCount: skill.failureCount + (success ? 0 : 1),
    lastUsedAt: at,
    updatedAt: at,
    state: archived ? 'archived' : 'active',
    staleAt: archived ? skill.staleAt : null,
  };
}

export function setSkillPinned(skill: RsiSkill, pinned: boolean, at: number, revisionId: string): { skill: RsiSkill; revision: SkillRevision } {
  const next: RsiSkill = { ...skill, pinned, updatedAt: at };
  return {
    skill: next,
    revision: {
      id: revisionId,
      skillId: skill.id,
      accountId: skill.accountId,
      version: skill.version,
      title: skill.title,
      bodyMd: skill.bodyMd,
      state: skill.state,
      pinned,
      changeKind: pinned ? 'pin' : 'unpin',
      evidenceRefs: ['human-pin'],
      guardOk: true,
      evalsOk: true,
      createdAt: at,
    },
  };
}

export function rollbackSkill(input: {
  skill: RsiSkill;
  revisions: readonly SkillRevision[];
  now: number;
  revisionId: string;
}): { ok: true; skill: RsiSkill; revision: SkillRevision } | { ok: false; reason: string } {
  if (input.skill.pinned) {
    return { ok: false, reason: 'Pinned items stay fixed until a person unpins them.' };
  }
  const prior = input.revisions
    .filter((revision) => revision.skillId === input.skill.id && revision.version < input.skill.version)
    .filter((revision) => revision.changeKind === 'create' || revision.changeKind === 'patch' || revision.changeKind === 'restore')
    .sort((a, b) => b.version - a.version)[0];
  if (!prior) return { ok: false, reason: 'No earlier version to restore.' };
  const guard = scanSkillBody(prior.bodyMd);
  const evals = runSkillEvals(prior.bodyMd);
  if (!guard.ok || !evals.passed) {
    return { ok: false, reason: 'Earlier version no longer passes the safety scan and evals.' };
  }
  const skill: RsiSkill = {
    ...input.skill,
    title: prior.title,
    bodyMd: prior.bodyMd,
    version: input.skill.version + 1,
    state: prior.state === 'archived' ? 'archived' : 'active',
    updatedAt: input.now,
    staleAt: null,
  };
  return {
    ok: true,
    skill,
    revision: {
      id: input.revisionId,
      skillId: skill.id,
      accountId: skill.accountId,
      version: skill.version,
      title: skill.title,
      bodyMd: skill.bodyMd,
      state: skill.state,
      pinned: false,
      changeKind: 'restore',
      evidenceRefs: [`rollback:${prior.id}`],
      guardOk: true,
      evalsOk: true,
      createdAt: input.now,
    },
  };
}

export interface CuratorUpdate {
  skill: RsiSkill;
  revision: SkillRevision;
  kind: 'curate_stale' | 'archive';
}

function idleSince(skill: RsiSkill): number {
  return skill.lastUsedAt ?? skill.createdAt;
}

export function planCuratorRound(input: {
  skills: readonly RsiSkill[];
  now: number;
  changesAlreadyThisRound: number;
  nextId: () => string;
}): { updates: CuratorUpdate[]; skippedPinned: string[]; deferred: string[] } {
  const skippedPinned: string[] = [];
  const candidates: Array<{ skill: RsiSkill; kind: 'curate_stale' | 'archive'; age: number }> = [];
  for (const skill of input.skills) {
    if (skill.state === 'archived') continue;
    const guard = scanSkillBody(skill.bodyMd);
    if (skill.pinned) {
      skippedPinned.push(skill.id);
      continue;
    }
    if (!guard.ok) {
      candidates.push({ skill, kind: 'archive', age: Number.MAX_SAFE_INTEGER });
      continue;
    }
    const idle = input.now - idleSince(skill);
    if (skill.state === 'stale') {
      const staleFor = input.now - (skill.staleAt ?? skill.updatedAt);
      if (staleFor >= RSI_ARCHIVE_STALE_AFTER_MS) {
        candidates.push({ skill, kind: 'archive', age: staleFor });
      }
      continue;
    }
    if (idle >= RSI_STALE_AFTER_MS) {
      candidates.push({ skill, kind: 'curate_stale', age: idle });
    }
  }
  candidates.sort((a, b) => {
    const rank = (kind: 'curate_stale' | 'archive') => (kind === 'archive' ? 1 : 0);
    return rank(b.kind) - rank(a.kind) || b.age - a.age;
  });
  const room = Math.max(0, RSI_MAX_CHANGES_PER_ROUND - input.changesAlreadyThisRound);
  const { accepted, deferred } = {
    accepted: candidates.slice(0, room),
    deferred: candidates.slice(room),
  };
  const updates: CuratorUpdate[] = accepted.map((candidate) => {
    const skill: RsiSkill =
      candidate.kind === 'archive'
        ? {
            ...candidate.skill,
            state: 'archived',
            archivedAt: input.now,
            updatedAt: input.now,
            version: candidate.skill.version + 1,
          }
        : {
            ...candidate.skill,
            state: 'stale',
            staleAt: input.now,
            updatedAt: input.now,
            version: candidate.skill.version + 1,
          };
    return {
      kind: candidate.kind,
      skill,
      revision: {
        id: input.nextId(),
        skillId: skill.id,
        accountId: skill.accountId,
        version: skill.version,
        title: skill.title,
        bodyMd: skill.bodyMd,
        state: skill.state,
        pinned: false,
        changeKind: candidate.kind,
        evidenceRefs: [`curator:${skill.id}`, `idle-since:${idleSince(candidate.skill)}`],
        guardOk: true,
        evalsOk: true,
        createdAt: input.now,
      },
    };
  });
  return { updates, skippedPinned, deferred: deferred.map((item) => item.skill.id) };
}
