import { configService } from '../configService';
import { tavilyService } from '../search/tavilyService';
import { localSerpService } from '../search/localSerpService';
import { extractDomain } from '../search/searchPlanner';

export type QueryIntent = 'informational' | 'commercial' | 'comparative';

export interface EmpiricalEvidence {
  id: string;
  query: string;
  intent: QueryIntent;
  targetDomain: string;
  brandCited: boolean;
  brandRank: number | null;
  citedUrl: string | null;
  snippet: string;
  competitorsCited: string[];
  citationConfidence: number; // 0-100
  timestamp: number;
}

export interface EmpiricalCitationSummary {
  targetDomain: string;
  brandName: string;
  totalQueriesTested: number;
  queriesCitedCount: number;
  citationRatePercent: number;
  topCitedCompetitor: string | null;
  evidenceList: EmpiricalEvidence[];
  entityClarityScore: number; // 0-100
  lastAudited: number;
}

export class EmpiricalCitationService {
  private static instance: EmpiricalCitationService;

  private constructor() {}

  public static getInstance(): EmpiricalCitationService {
    if (!EmpiricalCitationService.instance) {
      EmpiricalCitationService.instance = new EmpiricalCitationService();
    }
    return EmpiricalCitationService.instance;
  }

  /**
   * Generates high-impact test queries across 3 key intent categories
   */
  public generateTestQueries(domain: string, brandName?: string, primaryTopic?: string): Array<{ query: string; intent: QueryIntent }> {
    const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./, '');
    const cleanBrand = (brandName && brandName.trim()) || cleanDomain.split('.')[0];
    const topic = (primaryTopic && primaryTopic.trim()) || 'best solutions in this market';

    return [
      {
        query: `what is ${cleanBrand} ${cleanDomain} overview and offerings`,
        intent: 'informational',
      },
      {
        query: `best ${topic} top alternatives for ${cleanDomain}`,
        intent: 'commercial',
      },
      {
        query: `${cleanBrand} vs top competitors comparison reviews`,
        intent: 'comparative',
      },
    ];
  }

  /**
   * Probes live search results to verify whether target brand is cited
   */
  public async probeDomainCitations(
    targetUrl: string,
    brandName?: string,
    knownCompetitors: string[] = [],
    customQueries?: Array<{ query: string; intent: QueryIntent }>
  ): Promise<EmpiricalCitationSummary> {
    const targetDomain = extractDomain(targetUrl) || targetUrl.replace(/^https?:\/\//i, '').split('/')[0];
    const brand = (brandName && brandName.trim()) || targetDomain.split('.')[0];
    const queriesToTest = customQueries && customQueries.length > 0 
      ? customQueries 
      : this.generateTestQueries(targetDomain, brand);

    const evidenceList: EmpiricalEvidence[] = [];
    const competitorCounts: Record<string, number> = {};

    for (const item of queriesToTest) {
      try {
        const tavilyKey = configService.getTavilyKey();
        let results: Array<{ url: string; title: string; content: string }> = [];

        if (tavilyKey) {
          const searchRes = await tavilyService.search(item.query, { maxResults: 6 });
          results = searchRes.results || [];
        }

        // Additive zero-key / quota fallback: Local SERP scraper
        if (results.length === 0 && configService.isLocalSerpEnabled()) {
          try {
            const serpRes = await localSerpService.search(item.query, { num: 6 });
            if (serpRes.results?.length) {
              results = serpRes.results.map(r => ({ url: r.url, title: r.title, content: r.snippet }));
            }
          } catch {
            // Non-blocking fallback
          }
        }

        let brandCited = false;
        let brandRank: number | null = null;
        let citedUrl: string | null = null;
        let snippet = '';
        const competitorsFound: string[] = [];

        if (results.length > 0) {
          results.forEach((res, idx) => {
            const resDomain = extractDomain(res.url);
            const contentLower = (res.content + ' ' + res.title).toLowerCase();
            const brandLower = brand.toLowerCase();
            const targetDomainLower = targetDomain.toLowerCase();

            // Check if brand is cited or ranks
            const isMatch = (resDomain && resDomain.includes(targetDomainLower)) ||
                            contentLower.includes(targetDomainLower) ||
                            contentLower.includes(brandLower);

            if (isMatch && !brandCited) {
              brandCited = true;
              brandRank = idx + 1;
              citedUrl = res.url;
              snippet = res.content ? res.content.slice(0, 240) + '...' : res.title;
            }

            // Check known competitors
            knownCompetitors.forEach(comp => {
              if (comp && contentLower.includes(comp.toLowerCase())) {
                if (!competitorsFound.includes(comp)) {
                  competitorsFound.push(comp);
                  competitorCounts[comp] = (competitorCounts[comp] || 0) + 1;
                }
              }
            });
          });
        }

        // If not cited in live results, capture the leading snippet to show what was cited instead
        if (!brandCited && results.length > 0) {
          snippet = `Not cited in top ${results.length} search results. Leading citation: "${results[0].title}" (${results[0].url})`;
        } else if (!results.length) {
          snippet = `Search query evaluated: "${item.query}". Empirical probe pending live SERP payload.`;
        }

        evidenceList.push({
          id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          query: item.query,
          intent: item.intent,
          targetDomain,
          brandCited,
          brandRank,
          citedUrl,
          snippet,
          competitorsCited: competitorsFound,
          citationConfidence: brandCited ? (brandRank === 1 ? 95 : Math.max(60, 90 - (brandRank || 5) * 5)) : 20,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.warn(`[EmpiricalCitationService] Failed probe for query: ${item.query}`, err);
        evidenceList.push({
          id: `ev-${Date.now()}-err`,
          query: item.query,
          intent: item.intent,
          targetDomain,
          brandCited: false,
          brandRank: null,
          citedUrl: null,
          snippet: 'Query probe timed out or service unreachable.',
          competitorsCited: [],
          citationConfidence: 0,
          timestamp: Date.now(),
        });
      }
    }

    const queriesCitedCount = evidenceList.filter(e => e.brandCited).length;
    const citationRatePercent = Math.round((queriesCitedCount / Math.max(1, evidenceList.length)) * 100);

    let topCitedCompetitor: string | null = null;
    let maxCompCount = 0;
    Object.entries(competitorCounts).forEach(([comp, count]) => {
      if (count > maxCompCount) {
        maxCompCount = count;
        topCitedCompetitor = comp;
      }
    });

    const entityClarityScore = Math.min(100, Math.max(25, citationRatePercent + (queriesCitedCount > 0 ? 20 : 5)));

    return {
      targetDomain,
      brandName: brand,
      totalQueriesTested: evidenceList.length,
      queriesCitedCount,
      citationRatePercent,
      topCitedCompetitor,
      evidenceList,
      entityClarityScore,
      lastAudited: Date.now(),
    };
  }
}

export const empiricalCitationService = EmpiricalCitationService.getInstance();
