/**
 * Brand & Narrative Mindshare Service (Track KP-2).
 * Quantifies percentage share of conversational attention and thematic narrative velocity.
 * Inspired by Kaito Pro Token Mindshare & Narrative Mindshare analytics.
 */

import type { EmpiricalEvidence } from '../audit/empiricalCitationService';

export interface NarrativeCluster {
  id: string;
  name: string;
  keywords: string[];
  totalQueries: number;
  brandCitations: number;
  competitorCitations: number;
  brandMindsharePercent: number | null;
  topCompetitor?: {
    name: string;
    citations: number;
  };
  velocityStatus: 'surging' | 'stable' | 'decaying';
}

export interface MindshareHistoryPoint {
  timestamp: number;
  mindsharePercent: number;
}

export interface BrandMindshareSummary {
  domain: string;
  measuredAt: number;
  overallMindsharePercent: number | null;
  /** Where the percent came from. Null when the percent was not measured. */
  source: string | null;
  velocityPercentWoW: number;
  totalAttentionSlots: number;
  brandCitations: number;
  competitorCitations: number;
  hasCompetitorEvidence: boolean;
  narratives: NarrativeCluster[];
  topSurgingNarrative?: NarrativeCluster;
  underperformingNarrative?: NarrativeCluster;
  method: 'observed' | 'uncontested';
}

function topicName(query: string): string {
  const name = query.replace(/\s+/g, ' ').trim();
  if (!name) return '';
  return name.length > 80 ? `${name.slice(0, 77)}...` : name;
}

export function buildBrandMindshare(opts: {
  domain: string;
  evidence: EmpiricalEvidence[];
  history?: MindshareHistoryPoint[];
  measuredAt?: number;
}): BrandMindshareSummary {
  const measuredAt = opts.measuredAt ?? Date.now();
  const list = opts.evidence || [];

  let brandCitations = 0;
  const competitorMap = new Map<string, number>();

  for (const ev of list) {
    if (ev.brandCited) {
      brandCitations += 1;
    }
    for (const comp of ev.competitorsCited || []) {
      const trimmed = comp.trim();
      if (trimmed) {
        competitorMap.set(trimmed, (competitorMap.get(trimmed) || 0) + 1);
      }
    }
  }

  const totalCompetitorCitations = [...competitorMap.values()].reduce((a, b) => a + b, 0);
  const totalSlots = brandCitations + totalCompetitorCitations;
  const hasCompetitorEvidence = totalCompetitorCitations > 0;
  const overallMindsharePercent = hasCompetitorEvidence && totalSlots > 0
    ? Math.round((brandCitations / totalSlots) * 100)
    : null;
  const mentionPhrase = (count: number, singular: string, plural: string) =>
    `${count} ${count === 1 ? singular : plural}`;
  const source = overallMindsharePercent == null
    ? null
    : `${mentionPhrase(brandCitations, 'brand mention', 'brand mentions')} and ${mentionPhrase(totalCompetitorCitations, 'competitor mention', 'competitor mentions')} in this search sample.`;

  let velocityPercentWoW = 0;
  if (overallMindsharePercent != null && opts.history && opts.history.length > 0) {
    const prior = opts.history[opts.history.length - 1];
    if (prior && prior.mindsharePercent > 0) {
      velocityPercentWoW = Math.round(
        ((overallMindsharePercent - prior.mindsharePercent) / prior.mindsharePercent) * 100
      );
    }
  }

  const byQuery = new Map<string, EmpiricalEvidence[]>();
  for (const ev of list) {
    const name = topicName(ev.query || '');
    if (!name) continue;
    const rows = byQuery.get(name) || [];
    rows.push(ev);
    byQuery.set(name, rows);
  }

  const narratives: NarrativeCluster[] = [...byQuery.entries()].map(([name, rows]) => {
    let clusterBrand = 0;
    const clusterCompetitors = new Map<string, number>();
    for (const ev of rows) {
      if (ev.brandCited) clusterBrand += 1;
      for (const comp of ev.competitorsCited || []) {
        const trimmed = comp.trim();
        if (trimmed) clusterCompetitors.set(trimmed, (clusterCompetitors.get(trimmed) || 0) + 1);
      }
    }
    const clusterCompTotal = [...clusterCompetitors.values()].reduce((a, b) => a + b, 0);
    const clusterSlots = clusterBrand + clusterCompTotal;
    let topComp: { name: string; citations: number } | undefined;
    for (const [cName, cCount] of clusterCompetitors) {
      if (!topComp || cCount > topComp.citations) topComp = { name: cName, citations: cCount };
    }
    return {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'query',
      name,
      keywords: [name],
      totalQueries: rows.length,
      brandCitations: clusterBrand,
      competitorCitations: clusterCompTotal,
      brandMindsharePercent: clusterCompTotal > 0 && clusterSlots > 0
        ? Math.round((clusterBrand / clusterSlots) * 100)
        : null,
      topCompetitor: topComp,
      velocityStatus: 'stable' as const,
    };
  });

  const measured = narratives.filter((item) => item.brandMindsharePercent != null);
  const topSurgingNarrative = [...measured].sort(
    (a, b) => (b.brandMindsharePercent ?? 0) - (a.brandMindsharePercent ?? 0)
  )[0];
  const underperformingNarrative = measured.length > 1
    ? [...measured].sort((a, b) => (a.brandMindsharePercent ?? 0) - (b.brandMindsharePercent ?? 0))[0]
    : undefined;

  return {
    domain: opts.domain,
    measuredAt,
    overallMindsharePercent,
    source,
    velocityPercentWoW,
    totalAttentionSlots: totalSlots,
    brandCitations,
    competitorCitations: totalCompetitorCitations,
    hasCompetitorEvidence,
    narratives,
    topSurgingNarrative,
    underperformingNarrative,
    method: hasCompetitorEvidence ? 'observed' : 'uncontested',
  };
}
