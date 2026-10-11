/**
 * Luminara Share of Voice from the audit's search sample.
 *
 * Counts only. Each evidence row is one sampled search query. A row counts for the
 * brand when the brand or domain name was found in that query's results, and for a
 * competitor when the competitor was named there. The summary carries no percentage,
 * no share and no slice for rows where nobody was named.
 *
 * Invariant: a summary is measured only when buildShareOfVoice made it from evidence
 * rows. isMeasuredShareOfVoice tells such a summary from an object of the same shape
 * that something else wrote, for example a chat model.
 */

import type { EmpiricalCitationSummary } from '../audit/empiricalCitationService';

export type VoiceActorKind = 'brand' | 'competitor';

export interface ShareOfVoiceSlice {
  label: string;
  kind: VoiceActorKind;
  /** Sampled queries whose results named this actor. */
  mentionCount: number;
}

export interface ShareOfVoiceSummary {
  targetDomain: string;
  brandName: string;
  measuredAt: number;
  /** Sampled queries: the evidence rows every count is taken from. */
  totalPrompts: number;
  /** The brand first, then competitors by count. */
  slices: ShareOfVoiceSlice[];
}

const measuredSummaries = new WeakSet<object>();

/** True only for the object buildShareOfVoice returned in this session. */
export function isMeasuredShareOfVoice(value: unknown): value is ShareOfVoiceSummary {
  return typeof value === 'object' && value !== null && measuredSummaries.has(value);
}

function domainLabel(raw: string): string {
  return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
}

/**
 * Counts the brand and each named competitor over one audit's evidence rows.
 */
export function buildShareOfVoice(summary: EmpiricalCitationSummary): ShareOfVoiceSummary {
  const rows = summary.evidenceList;
  const competitorRows = new Map<string, number>();
  for (const row of rows) {
    const named = new Set(row.competitorsCited.map((name) => name.trim()).filter(Boolean));
    for (const name of named) competitorRows.set(name, (competitorRows.get(name) || 0) + 1);
  }

  const slices: ShareOfVoiceSlice[] = [
    {
      label: summary.brandName || summary.targetDomain,
      kind: 'brand',
      mentionCount: rows.filter((row) => row.brandCited).length,
    },
    ...[...competitorRows.entries()]
      .map(([label, mentionCount]) => ({ label, kind: 'competitor' as const, mentionCount }))
      .sort((a, b) => b.mentionCount - a.mentionCount || a.label.localeCompare(b.label)),
  ];

  const built: ShareOfVoiceSummary = {
    targetDomain: domainLabel(summary.targetDomain),
    brandName: summary.brandName,
    measuredAt: summary.lastAudited || Date.now(),
    totalPrompts: rows.length,
    slices,
  };
  measuredSummaries.add(built);
  return built;
}

export const shareOfVoiceService = {
  build: buildShareOfVoice,
  isMeasured: isMeasuredShareOfVoice,
};
