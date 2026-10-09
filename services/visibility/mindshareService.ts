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
  brandMindsharePercent: number;
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
  overallMindsharePercent: number;
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

const DEFAULT_NARRATIVE_TEMPLATES = [
  {
    id: 'privacy_security',
    name: 'Privacy, Security & Local-First',
    keywords: ['privacy', 'security', 'soc2', 'local', 'self-host', 'compliance', 'encrypt', 'open source'],
  },
  {
    id: 'pricing_value',
    name: 'Cost, Pricing & Open Access',
    keywords: ['price', 'pricing', 'cost', 'free', 'budget', 'cheap', 'roi', 'tier'],
  },
  {
    id: 'developer_api',
    name: 'Developer Experience & APIs',
    keywords: ['api', 'sdk', 'developer', 'docs', 'integration', 'latency', 'webhook', 'code'],
  },
  {
    id: 'speed_performance',
    name: 'Performance & Fast Onboarding',
    keywords: ['fast', 'speed', 'instant', 'quick', 'easy', 'simple', 'performance', 'real-time'],
  },
];

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

  // Never flash 100% brand mindshare when no competitor signals were measured in the sample.
  let overallMindsharePercent = 0;
  if (hasCompetitorEvidence) {
    overallMindsharePercent = totalSlots > 0 ? Math.round((brandCitations / totalSlots) * 100) : 0;
  } else if (list.length > 1) {
    overallMindsharePercent = Math.round((brandCitations / list.length) * 100);
  } else {
    overallMindsharePercent = brandCitations > 0 ? 50 : 0;
  }

  // Compute velocity from previous historical point if available (7 days back)
  let velocityPercentWoW = 0;
  if (opts.history && opts.history.length > 0) {
    const prior = opts.history[opts.history.length - 1];
    if (prior && prior.mindsharePercent > 0) {
      velocityPercentWoW = Math.round(
        ((overallMindsharePercent - prior.mindsharePercent) / prior.mindsharePercent) * 100
      );
    }
  }

  // Group evidence into narrative clusters
  const narratives: NarrativeCluster[] = DEFAULT_NARRATIVE_TEMPLATES.map((tmpl) => {
    let clusterTotal = 0;
    let clusterBrand = 0;
    const clusterCompetitors = new Map<string, number>();

    for (const ev of list) {
      const queryLower = (ev.query + ' ' + (ev.snippet || '')).toLowerCase();
      const matches = tmpl.keywords.some((kw) => queryLower.includes(kw));
      if (matches) {
        clusterTotal += 1;
        if (ev.brandCited) clusterBrand += 1;
        for (const comp of ev.competitorsCited || []) {
          clusterCompetitors.set(comp, (clusterCompetitors.get(comp) || 0) + 1);
        }
      }
    }

    const clusterCompTotal = [...clusterCompetitors.values()].reduce((a, b) => a + b, 0);
    const clusterSlots = clusterBrand + clusterCompTotal;
    const clusterMindshare = clusterSlots > 0 ? Math.round((clusterBrand / clusterSlots) * 100) : 0;

    let topComp: { name: string; citations: number } | undefined;
    let maxCitations = 0;
    for (const [cName, cCount] of clusterCompetitors.entries()) {
      if (cCount > maxCitations) {
        maxCitations = cCount;
        topComp = { name: cName, citations: cCount };
      }
    }

    return {
      id: tmpl.id,
      name: tmpl.name,
      keywords: tmpl.keywords,
      totalQueries: clusterTotal,
      brandCitations: clusterBrand,
      competitorCitations: clusterCompTotal,
      brandMindsharePercent: clusterMindshare,
      topCompetitor: topComp,
      velocityStatus: clusterBrand > (topComp?.citations ?? 0) ? 'surging' : clusterBrand === 0 ? 'decaying' : 'stable',
    };
  });

  const activeNarratives = narratives.filter((n) => n.totalQueries > 0);
  const topSurgingNarrative = [...activeNarratives].sort(
    (a, b) => b.brandMindsharePercent - a.brandMindsharePercent
  )[0];
  const underperformingNarrative = [...activeNarratives].sort(
    (a, b) => a.brandMindsharePercent - b.brandMindsharePercent
  )[0];

  return {
    domain: opts.domain,
    measuredAt,
    overallMindsharePercent,
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
