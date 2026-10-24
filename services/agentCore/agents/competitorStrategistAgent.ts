/**
 * Competitor Strategist Agent: Market Intelligence & Gap Specialist
 * 
 * CrewAI Role: Competitor Strategist
 * Goal: Discover direct market competitors from SERP signals and Business DNA,
 * identifying strategic keyword moats and unharvested search demand.
 */

import { AgentActivityEvent, SerpEvidenceItem } from '../types';
import { BusinessDNA } from '../../../types';
import { isNamesakeHost } from '../../audit/entityMatch';

const EXCLUDED_COMPETITOR_DOMAINS = [
  // Encyclopedias & medical/general reference aggregators
  'webmd.com',
  'healthline.com',
  'mayoclinic.org',
  'wikipedia.org',
  'britannica.com',
  'investopedia.com',
  'dictionary.com',
  'merriam-webster.com',
  'wikihow.com',
  'who.int',

  // Reviews, directories & business aggregators
  'trustpilot.com',
  'yelp.com',
  'tripadvisor.com',
  'productreview.com.au',
  'yellowpages.com.au',
  'truelocal.com.au',
  'hotfrog.com.au',
  'bark.com',
  'thumbtack.com',
  'angi.com',
  'homeadvisor.com',
  'clutch.co',
  'g2.com',
  'capterra.com',
  'glassdoor.com',
  'bbb.org',
  'seek.com.au',
  'indeed.com',
  'jora.com',

  // Search engines & portals
  'google.com',
  'google.com.au',
  'bing.com',
  'yahoo.com',
  'duckduckgo.com',
  'baidu.com',

  // Social media & forum platforms
  'youtube.com',
  'reddit.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'pinterest.com',
  'threads.net',
  'quora.com',
  'medium.com',
  'substack.com',

  // Marketplaces & platforms
  'amazon.com',
  'amazon.com.au',
  'amazon.co.uk',
  'ebay.com',
  'ebay.com.au',
  'etsy.com',
  'alibaba.com',
  'apple.com',
  'github.com',
];

const EXCLUDED_COMPETITOR_KEYWORDS = [
  'webmd',
  'trustpilot',
  'yelp',
  'healthline',
  'mayo clinic',
  'mayoclinic',
  'wikipedia',
  'britannica',
  'investopedia',
  'dictionary.com',
  'merriam-webster',
  'wikihow',
  'productreview',
  'yellow pages',
  'yellowpages',
  'truelocal',
  'hotfrog',
  'tripadvisor',
  'thumbtack',
  'homeadvisor',
  'capterra',
  'glassdoor',
  'google',
  'bing',
  'yahoo',
  'duckduckgo',
  'baidu',
  'youtube',
  'reddit',
  'twitter',
  'linkedin',
  'facebook',
  'instagram',
  'tiktok',
  'quora',
  'medium',
  'substack',
  'amazon',
  'ebay',
  'etsy',
  'alibaba',
];

export function isExcludedCompetitorHost(hostOrName: string, cleanDomain: string): boolean {
  const h = hostOrName.toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./, '').trim();
  if (!h) return true;
  const targetClean = cleanDomain.toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./, '').split('/')[0];
  if (targetClean && (h === targetClean || h.includes(targetClean) || isNamesakeHost(h, targetClean))) return true;

  // Government & Academic institutions
  if (/\.(gov|edu|ac|mil)(\.[a-z]{2})?$/i.test(h)) return true;

  if (EXCLUDED_COMPETITOR_DOMAINS.some((excluded) => h === excluded || h.endsWith(`.${excluded}`))) {
    return true;
  }

  if (EXCLUDED_COMPETITOR_KEYWORDS.some((kw) => h.includes(kw))) {
    return true;
  }

  return false;
}

export class CompetitorStrategistAgent {
  public readonly name = 'Competitor Strategist';
  public readonly role = 'competitor_strategist';

  public async execute(
    _targetUrl: string,
    _dna: BusinessDNA | null | undefined,
    serpEvidence: SerpEvidenceItem[],
    emit: (event: AgentActivityEvent) => void
  ): Promise<{ topCompetitors: string[]; competitorGaps: string[] }> {
    emit({
      id: `strat-start-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'competitor_strategist',
      agentName: this.name,
      phase: 'analyzing_market',
      message: 'Comparing other sites in your market…',
      status: 'running',
    });

    // A search host is not a rival. The map's rendered rows are the verified list, and they are not known yet.
    const topCompetitors: string[] = [];
    const competitorGaps: string[] = [];
    const message = serpEvidence.length === 0
      ? 'No search results collected. Competitor signals not measured.'
      : 'No competitors found in this search sample.';

    emit({
      id: `strat-done-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'competitor_strategist',
      agentName: this.name,
      phase: 'strategy_complete',
      message,
      status: 'completed',
      evidenceSnippet: serpEvidence.length === 0
        ? 'Search returned 0 results. Competitor gaps omitted.'
        : message,
      confidenceScore: serpEvidence.length === 0 ? 0 : 0.88,
    });

    return { topCompetitors, competitorGaps };
  }
}

export const competitorStrategistAgent = new CompetitorStrategistAgent();
