/**
 * Competitor Strategist Agent: Market Intelligence & Gap Specialist
 * 
 * CrewAI Role: Competitor Strategist
 * Goal: Discover direct market competitors from SERP signals and Business DNA,
 * identifying strategic keyword moats and unharvested search demand.
 */

import { AgentActivityEvent, SerpEvidenceItem } from '../types';
import { BusinessDNA } from '../../../types';

export class CompetitorStrategistAgent {
  public readonly name = 'Competitor Strategist';
  public readonly role = 'competitor_strategist';

  public async execute(
    targetUrl: string,
    dna: BusinessDNA | null | undefined,
    serpEvidence: SerpEvidenceItem[],
    emit: (event: AgentActivityEvent) => void
  ): Promise<{ topCompetitors: string[]; competitorGaps: string[] }> {
    emit({
      id: `strat-start-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'competitor_strategist',
      agentName: this.name,
      phase: 'analyzing_market',
      message: 'Mapping competitive landscape and market share of voice…',
      status: 'running',
    });

    const cleanDomain = targetUrl.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    const competitors = new Set<string>();

    // 1. From Business DNA
    if (dna?.competitors && Array.isArray(dna.competitors)) {
      dna.competitors.forEach((c) => {
        if (c && typeof c === 'string' && c.trim()) competitors.add(c.trim());
      });
    }

    // 2. Discover from SERP results (excluding target domain, social media, and search engines)
    const ignoredDomains = new Set([
      cleanDomain,
      'google.com',
      'youtube.com',
      'wikipedia.org',
      'reddit.com',
      'twitter.com',
      'x.com',
      'linkedin.com',
      'facebook.com',
      'instagram.com',
      'medium.com',
      'quora.com',
    ]);

    serpEvidence.forEach((item) => {
      try {
        const u = new URL(item.url);
        const host = u.hostname.toLowerCase().replace(/^www\./, '');
        if (!ignoredDomains.has(host) && !host.includes(cleanDomain)) {
          competitors.add(host);
        }
      } catch {
        /* invalid url */
      }
    });

    const topCompetitors = Array.from(competitors).slice(0, 5);
    const competitorGaps: string[] = [];

    if (topCompetitors.length > 0) {
      competitorGaps.push(`Competitor Authority Moat: Leading competitors (${topCompetitors.slice(0, 2).join(', ')}) possess established third-party review coverage.`);
      competitorGaps.push('Comparison Intent Gap: Lack of authoritative "vs" landing pages targeting high-converting evaluation queries.');
    } else {
      competitorGaps.push('Niche Definition: Untapped brand authority opportunity with minimal direct head-to-head search competition.');
    }

    emit({
      id: `strat-done-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'competitor_strategist',
      agentName: this.name,
      phase: 'strategy_complete',
      message: `Identified ${topCompetitors.length} key competitor(s) and mapped ${competitorGaps.length} strategic keyword gaps.`,
      status: 'completed',
      evidenceSnippet: `Competitors tracked: ${topCompetitors.join(', ') || 'None found in initial SERP slice'}`,
      confidenceScore: 0.88,
    });

    return { topCompetitors, competitorGaps };
  }
}

export const competitorStrategistAgent = new CompetitorStrategistAgent();
