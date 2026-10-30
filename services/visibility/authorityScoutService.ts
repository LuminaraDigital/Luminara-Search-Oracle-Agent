/**
 * Authority Source Scout Service (Track KP-4).
 * Identifies high-leverage third-party citation hubs repeatedly cited by Answer Engines.
 * Inspired by Kaito Studio creator and authority graph matching.
 */

import type { EmpiricalEvidence } from '../audit/empiricalCitationService';
import { isNamesakeHost } from '../audit/entityMatch';
import {
  classifyOffSiteChannel,
  extractSourceHost,
  type OffSiteMentionChannel,
} from './engineVisibilityTypes';

export type AuthorityCategory = 'community' | 'directory' | 'documentation' | 'reviews' | 'publication' | 'other';

export interface AuthoritySource {
  domain: string;
  category: AuthorityCategory;
  offSiteChannel: OffSiteMentionChannel;
  citationFrequencyPercent: number; // % of queries where this hub was cited
  queryCount: number;
  brandPresent: boolean;
  presenceUrl?: string;
  competitorsMentioned: string[];
  competitorMentionCount: number;
  prompts: string[];
  leverageScore: 'high' | 'medium' | 'low';
  actionRecommendation: string;
}

export interface AuthorityScoutSummary {
  targetDomain: string;
  totalQueriesAnalyzed: number;
  totalExternalSourcesFound: number;
  sources: AuthoritySource[];
  missingCompetitorSources: AuthoritySource[];
  topUntappedHub?: AuthoritySource;
  method: 'observed';
}

function categorizeDomain(domain: string): AuthorityCategory {
  const d = domain.toLowerCase();
  if (d.includes('reddit.com') || d.includes('discord') || d.includes('community') || d.includes('forum')) {
    return 'community';
  }
  if (d.includes('g2.com') || d.includes('capterra.com') || d.includes('trustpilot.com')) {
    return 'reviews';
  }
  if (d.includes('github.com') || d.includes('docs.') || d.includes('gitbook.io') || d.includes('readme.io')) {
    return 'documentation';
  }
  if (d.includes('producthunt.com') || d.includes('crunchbase.com') || d.includes('directory')) {
    return 'directory';
  }
  if (d.includes('techcrunch.com') || d.includes('medium.com') || d.includes('substack.com') || d.includes('forbes.com')) {
    return 'publication';
  }
  return 'other';
}

/**
 * Scouts external authority hubs from empirical evidence and sources.
 */
export function scoutAuthoritySources(opts: {
  targetDomain: string;
  evidence: EmpiricalEvidence[];
  rawSources?: Array<{ uri: string; title: string }>;
}): AuthorityScoutSummary {
  const targetHost = extractSourceHost(opts.targetDomain);
  const totalQueries = Math.max(1, opts.evidence.length);
  const hubQueryCounts = new Map<string, Set<string>>();
  const hubBrandPresence = new Map<string, { present: boolean; url?: string }>();
  const hubCompetitors = new Map<string, Set<string>>();
  const hubSampleContext = new Map<string, string>();

  // Extract from raw sources if provided
  for (const src of opts.rawSources || []) {
    if (!src.uri) continue;
    const host = extractSourceHost(src.uri);
    if (!host || host === targetHost || isNamesakeHost(host, targetHost)) continue;

    if (!hubQueryCounts.has(host)) {
      hubQueryCounts.set(host, new Set());
    }
    hubQueryCounts.get(host)!.add(src.uri);
    if (!hubSampleContext.has(host)) {
      hubSampleContext.set(host, `${src.uri} ${src.title || ''}`);
    }
  }

  // Extract from evidence snippets and URLs
  for (const ev of opts.evidence) {
    if (ev.citedUrl) {
      const host = extractSourceHost(ev.citedUrl);
      if (host && host !== targetHost && !isNamesakeHost(host, targetHost)) {
        if (!hubQueryCounts.has(host)) {
          hubQueryCounts.set(host, new Set());
        }
        hubQueryCounts.get(host)!.add(ev.query);
        if (!hubSampleContext.has(host)) {
          hubSampleContext.set(host, `${ev.citedUrl} ${ev.snippet || ''}`);
        }

        // Check if brand was mentioned in this citation
        if (ev.brandCited) {
          hubBrandPresence.set(host, { present: true, url: ev.citedUrl });
        } else if (!hubBrandPresence.has(host)) {
          hubBrandPresence.set(host, { present: false, url: ev.citedUrl });
        }

        if (Array.isArray(ev.competitorsCited) && ev.competitorsCited.length > 0) {
          if (!hubCompetitors.has(host)) {
            hubCompetitors.set(host, new Set());
          }
          for (const comp of ev.competitorsCited) {
            if (comp && comp.trim()) hubCompetitors.get(host)!.add(comp.trim());
          }
        }
      }
    }
  }

  const sources: AuthoritySource[] = [];

  for (const [hub, querySet] of hubQueryCounts.entries()) {
    if (isNamesakeHost(hub, targetHost)) continue;
    const qCount = querySet.size;
    const frequency = Math.round((qCount / totalQueries) * 100);
    const category = categorizeDomain(hub);
    const sampleCtx = hubSampleContext.get(hub) || '';
    const offSiteChannel = classifyOffSiteChannel(hub, sampleCtx);
    const presenceInfo = hubBrandPresence.get(hub) || { present: false };
    const competitorsMentioned = [...(hubCompetitors.get(hub) || [])];
    const competitorMentionCount = competitorsMentioned.length;

    let leverageScore: 'high' | 'medium' | 'low' = 'low';
    if ((frequency >= 50 || competitorMentionCount > 0) && !presenceInfo.present) {
      leverageScore = 'high';
    } else if (frequency >= 25 || !presenceInfo.present) {
      leverageScore = 'medium';
    }

    let actionRecommendation = `Maintain monitoring on ${hub}.`;
    if (!presenceInfo.present) {
      if (category === 'community' || offSiteChannel === 'community_forum') {
        actionRecommendation = `Establish verified community presence or documentation thread on ${hub}.`;
      } else if (category === 'reviews' || offSiteChannel === 'review_platform') {
        actionRecommendation = `Claim company profile and collect authentic user reviews on ${hub}.`;
      } else if (category === 'documentation') {
        actionRecommendation = `Publish open-source code example or integration guide on ${hub}.`;
      } else if (offSiteChannel === 'roundup_listicle') {
        actionRecommendation = `Pitch editorial inclusion with a drop-in product spec block on ${hub}.`;
      } else {
        actionRecommendation = `Seek reference citation or editorial mention on ${hub}.`;
      }
    }

    sources.push({
      domain: hub,
      category,
      offSiteChannel,
      citationFrequencyPercent: frequency,
      queryCount: qCount,
      brandPresent: presenceInfo.present,
      presenceUrl: presenceInfo.url,
      competitorsMentioned,
      competitorMentionCount,
      prompts: [...querySet],
      leverageScore,
      actionRecommendation,
    });
  }

  sources.sort((a, b) => {
    if (b.citationFrequencyPercent !== a.citationFrequencyPercent) {
      return b.citationFrequencyPercent - a.citationFrequencyPercent;
    }
    return b.competitorMentionCount - a.competitorMentionCount;
  });

  const missingCompetitorSources = sources
    .filter((s) => !s.brandPresent && s.competitorMentionCount > 0)
    .sort((a, b) => b.competitorMentionCount - a.competitorMentionCount || b.citationFrequencyPercent - a.citationFrequencyPercent);

  const topUntappedHub =
    sources.find((s) => !s.brandPresent && s.leverageScore === 'high') ||
    sources.find((s) => !s.brandPresent);

  return {
    targetDomain: targetHost,
    totalQueriesAnalyzed: totalQueries,
    totalExternalSourcesFound: sources.length,
    sources,
    missingCompetitorSources,
    topUntappedHub,
    method: 'observed',
  };
}
