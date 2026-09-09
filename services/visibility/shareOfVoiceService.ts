/**
 * Luminara Share of Voice (SoV) from empirical citation probes.
 * Clean-room metrics inspired by common GEO panel math (mention vs citation coverage).
 */

import type { EmpiricalCitationSummary, EmpiricalEvidence } from '../audit/empiricalCitationService';

export type VoiceActorKind = 'brand' | 'competitor' | 'other';

export interface ShareOfVoiceSlice {
  label: string;
  kind: VoiceActorKind;
  mentionCount: number;
  citationCount: number;
  /** Share of total citation slots (0-100). */
  citationSharePercent: number;
  /** Share of total mention slots including brand absences as competitor wins (0-100). */
  mentionSharePercent: number;
}

export interface ShareOfVoiceSummary {
  targetDomain: string;
  brandName: string;
  measuredAt: number;
  totalPrompts: number;
  mentionCoveragePercent: number;
  citationCoveragePercent: number;
  brandCitationSharePercent: number;
  slices: ShareOfVoiceSlice[];
  formula: string;
  method: 'observed';
}

const FORMULA =
  'mentionCoverage = brandMentions/prompts; citationCoverage = brandCitations/prompts; ' +
  'citationShare = actorCitations / sum(actorCitations); denominators never invent unseen engines';

function domainLabel(raw: string): string {
  return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
}

function countCompetitorMentions(evidence: EmpiricalEvidence[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of evidence) {
    for (const c of e.competitorsCited) {
      const key = c.trim();
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return map;
}

/**
 * Builds SoV from a single empirical citation summary (one audit panel).
 */
export function buildShareOfVoice(summary: EmpiricalCitationSummary): ShareOfVoiceSummary {
  const prompts = Math.max(1, summary.totalQueriesTested || summary.evidenceList.length);
  const brandMentions = summary.evidenceList.filter((e) => e.brandCited).length;
  const brandCitations = summary.evidenceList.filter((e) => e.brandCited && e.citedUrl).length;

  const competitorMentions = countCompetitorMentions(summary.evidenceList);
  const slices: ShareOfVoiceSlice[] = [];

  const citationDenomParts: Array<{ label: string; kind: VoiceActorKind; citations: number; mentions: number }> = [
    {
      label: summary.brandName || summary.targetDomain,
      kind: 'brand',
      citations: brandCitations,
      mentions: brandMentions,
    },
  ];

  for (const [label, mentions] of competitorMentions.entries()) {
    citationDenomParts.push({
      label,
      kind: 'competitor',
      citations: mentions,
      mentions,
    });
  }

  // Residual "other" for prompts where brand was absent and no named competitor was logged.
  const uncovered = Math.max(
    0,
    prompts - brandMentions - [...competitorMentions.values()].reduce((a, b) => a + b, 0)
  );
  if (uncovered > 0) {
    citationDenomParts.push({
      label: 'Other / unattributed',
      kind: 'other',
      citations: uncovered,
      mentions: uncovered,
    });
  }

  const totalCitations = Math.max(
    1,
    citationDenomParts.reduce((a, p) => a + p.citations, 0)
  );
  const totalMentions = Math.max(
    1,
    citationDenomParts.reduce((a, p) => a + p.mentions, 0)
  );

  for (const part of citationDenomParts) {
    slices.push({
      label: part.label,
      kind: part.kind,
      mentionCount: part.mentions,
      citationCount: part.citations,
      citationSharePercent: Math.round((part.citations / totalCitations) * 100),
      mentionSharePercent: Math.round((part.mentions / totalMentions) * 100),
    });
  }

  slices.sort((a, b) => b.citationSharePercent - a.citationSharePercent);

  const brandSlice = slices.find((s) => s.kind === 'brand');

  return {
    targetDomain: domainLabel(summary.targetDomain),
    brandName: summary.brandName,
    measuredAt: summary.lastAudited || Date.now(),
    totalPrompts: prompts,
    mentionCoveragePercent: Math.round((brandMentions / prompts) * 100),
    citationCoveragePercent: Math.round((brandCitations / prompts) * 100),
    brandCitationSharePercent: brandSlice?.citationSharePercent ?? 0,
    slices,
    formula: FORMULA,
    method: 'observed',
  };
}

export const shareOfVoiceService = {
  build: buildShareOfVoice,
};
