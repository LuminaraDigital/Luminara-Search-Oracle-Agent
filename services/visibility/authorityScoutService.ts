/**
 * Authority Source Scout Service (Track KP-4).
 * Identifies high-leverage third-party citation hubs repeatedly cited by Answer Engines.
 * Inspired by Kaito Studio creator and authority graph matching.
 */

import type { EmpiricalEvidence } from '../audit/empiricalCitationService';

export type AuthorityCategory = 'community' | 'directory' | 'documentation' | 'reviews' | 'publication' | 'other';

export interface AuthoritySource {
  domain: string;
  category: AuthorityCategory;
  citationFrequencyPercent: number; // % of queries where this hub was cited
  queryCount: number;
  brandPresent: boolean;
  presenceUrl?: string;
  leverageScore: 'high' | 'medium' | 'low';
  actionRecommendation: string;
}

export interface AuthorityScoutSummary {
  targetDomain: string;
  totalQueriesAnalyzed: number;
  totalExternalSourcesFound: number;
  sources: AuthoritySource[];
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

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  }
}

/**
 * Scouts external authority hubs from empirical evidence and sources.
 */
export function scoutAuthoritySources(opts: {
  targetDomain: string;
  evidence: EmpiricalEvidence[];
  rawSources?: Array<{ uri: string; title: string }>;
}): AuthorityScoutSummary {
  const targetHost = extractHostname(opts.targetDomain);
  const totalQueries = Math.max(1, opts.evidence.length);
  const hubQueryCounts = new Map<string, Set<string>>();
  const hubBrandPresence = new Map<string, { present: boolean; url?: string }>();

  // Extract from raw sources if provided
  for (const src of opts.rawSources || []) {
    if (!src.uri) continue;
    const host = extractHostname(src.uri);
    if (!host || host === targetHost) continue;

    if (!hubQueryCounts.has(host)) {
      hubQueryCounts.set(host, new Set());
    }
    hubQueryCounts.get(host)!.add(src.uri);
  }

  // Extract from evidence snippets and URLs
  for (const ev of opts.evidence) {
    if (ev.citedUrl) {
      const host = extractHostname(ev.citedUrl);
      if (host && host !== targetHost) {
        if (!hubQueryCounts.has(host)) {
          hubQueryCounts.set(host, new Set());
        }
        hubQueryCounts.get(host)!.add(ev.query);

        // Check if brand was mentioned in this citation
        if (ev.brandCited) {
          hubBrandPresence.set(host, { present: true, url: ev.citedUrl });
        }
      }
    }
  }

  const sources: AuthoritySource[] = [];

  for (const [hub, querySet] of hubQueryCounts.entries()) {
    const qCount = querySet.size;
    const frequency = Math.round((qCount / totalQueries) * 100);
    const category = categorizeDomain(hub);
    const presenceInfo = hubBrandPresence.get(hub) || { present: false };

    let leverageScore: 'high' | 'medium' | 'low' = 'low';
    if (frequency >= 50 && !presenceInfo.present) {
      leverageScore = 'high';
    } else if (frequency >= 25 || !presenceInfo.present) {
      leverageScore = 'medium';
    }

    let actionRecommendation = `Maintain monitoring on ${hub}.`;
    if (!presenceInfo.present) {
      if (category === 'community') {
        actionRecommendation = `Establish verified community presence or documentation thread on ${hub}.`;
      } else if (category === 'reviews') {
        actionRecommendation = `Claim company profile and collect authentic user reviews on ${hub}.`;
      } else if (category === 'documentation') {
        actionRecommendation = `Publish open-source code example or integration guide on ${hub}.`;
      } else {
        actionRecommendation = `Seek reference citation or editorial mention on ${hub}.`;
      }
    }

    sources.push({
      domain: hub,
      category,
      citationFrequencyPercent: frequency,
      queryCount: qCount,
      brandPresent: presenceInfo.present,
      presenceUrl: presenceInfo.url,
      leverageScore,
      actionRecommendation,
    });
  }

  sources.sort((a, b) => b.citationFrequencyPercent - a.citationFrequencyPercent);

  const topUntappedHub = sources.find((s) => !s.brandPresent && s.leverageScore === 'high') ||
    sources.find((s) => !s.brandPresent);

  return {
    targetDomain: targetHost,
    totalQueriesAnalyzed: totalQueries,
    totalExternalSourcesFound: sources.length,
    sources,
    topUntappedHub,
    method: 'observed',
  };
}
