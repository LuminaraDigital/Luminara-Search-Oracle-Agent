/**
 * User corrections become eval cases that gate the next skill or prompt change.
 * Reward weights move only from measured outcome signals, and only when the
 * profile is not pinned and the week still has a nudge left.
 */
import { requireEvidence } from './guardrails';
import type { SkillEvalCase } from './skillEvals';

export interface UserCorrection {
  id: string;
  accountId: string;
  domain: string;
  prompt: string;
  badExcerpt: string;
  goodExcerpt: string;
  sourceRefs: string[];
  createdAt: number;
}

export interface CorrectionDraft {
  domain: string;
  prompt: string;
  badExcerpt: string;
  goodExcerpt: string;
  sourceRefs: string[];
}

export function normalizeExcerpt(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

export function validateCorrection(draft: CorrectionDraft): { ok: true; draft: CorrectionDraft } | { ok: false; reason: string } {
  const domain = draft.domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
  const prompt = draft.prompt.replace(/[\r\n]+/g, ' ').trim().slice(0, 2000);
  const badExcerpt = normalizeExcerpt(draft.badExcerpt);
  const goodExcerpt = normalizeExcerpt(draft.goodExcerpt);
  if (!domain) return { ok: false, reason: 'Domain required.' };
  if (prompt.length < 8) return { ok: false, reason: 'Prompt required so the case can be traced.' };
  if (badExcerpt.length < 12) return { ok: false, reason: 'Rejected text must be at least 12 characters.' };
  if (goodExcerpt.length < 12) return { ok: false, reason: 'Corrected text must be at least 12 characters.' };
  if (goodExcerpt.includes(badExcerpt)) {
    return { ok: false, reason: 'Corrected text still contains the rejected text.' };
  }
  const evidence = requireEvidence(draft.sourceRefs);
  if (!evidence.ok) return { ok: false, reason: evidence.reason };
  return { ok: true, draft: { domain, prompt, badExcerpt, goodExcerpt, sourceRefs: evidence.refs } };
}

export function correctionToSkillCase(correction: Pick<UserCorrection, 'id' | 'badExcerpt'>): SkillEvalCase {
  return {
    name: `correction-${correction.id}`,
    mustNotContain: [correction.badExcerpt],
  };
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** YAML subset the self-hosted eval runner can parse. Positive case only. */
export function renderCorrectionEvalYaml(correction: Pick<UserCorrection, 'id' | 'badExcerpt' | 'goodExcerpt'>): string {
  return [
    `- name: correction-${correction.id}`,
    '  provider:',
    '    model: recorded-fixture',
    '  evidenceNumbers: []',
    '  response: |',
    `    ${correction.goodExcerpt}`,
    '  expect:',
    '    mustContain:',
    `      - ${yamlQuote(correction.goodExcerpt)}`,
    '    mustNotContain:',
    `      - ${yamlQuote(correction.badExcerpt)}`,
    '',
  ].join('\n');
}
