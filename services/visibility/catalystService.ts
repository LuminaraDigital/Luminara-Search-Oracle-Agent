/**
 * AEO Catalyst Service (Track KP-3).
 * Correlates industry platform search updates and brand engineering actions with visibility changes.
 * Inspired by Kaito Catalyst Calendar.
 */

export type CatalystOrigin = 'platform' | 'brand';

export interface AEOCatalyst {
  id: string;
  date: string; // ISO string or YYYY-MM-DD
  timestamp: number;
  origin: CatalystOrigin;
  title: string;
  description: string;
  engineAffinity?: 'all' | 'chatgpt' | 'perplexity' | 'google_aio' | 'claude';
  impact?: {
    metric: 'mindshare' | 'citation_rate' | 'health_score';
    deltaPercent: number;
    description: string;
  };
}

/**
 * Historical and upcoming platform search updates affecting Answer Engines.
 */
export const KNOWN_PLATFORM_CATALYSTS: AEOCatalyst[] = [
  {
    id: 'plat-2026-10-01',
    date: '2026-10-01',
    timestamp: new Date('2026-10-01T00:00:00Z').getTime(),
    origin: 'platform',
    title: 'Perplexity Sonar Freshness Recalibration',
    description: 'Perplexity increased weighting for recent documentation and verified Schema.org entity metadata.',
    engineAffinity: 'perplexity',
  },
  {
    id: 'plat-2026-09-15',
    date: '2026-09-15',
    timestamp: new Date('2026-09-15T00:00:00Z').getTime(),
    origin: 'platform',
    title: 'OpenAI Search Direct Citation Rollout',
    description: 'ChatGPT Search prioritizes explicit domain citations over synthetic paragraph summaries.',
    engineAffinity: 'chatgpt',
  },
  {
    id: 'plat-2026-08-20',
    date: '2026-08-20',
    timestamp: new Date('2026-08-20T00:00:00Z').getTime(),
    origin: 'platform',
    title: 'Google AI Overviews Entity Disambiguation Update',
    description: 'Expanded knowledge graph entity matching for B2B tech and developer tooling.',
    engineAffinity: 'google_aio',
  },
];

export interface BrandActionInput {
  actionId: string;
  title: string;
  timestamp: number;
  description?: string;
}

/**
 * Merges platform catalysts with brand actions to create an integrated impact timeline.
 */
export function buildCatalystTimeline(opts: {
  brandActions: BrandActionInput[];
  mindshareDelta?: number;
  citationRateDelta?: number;
}): AEOCatalyst[] {
  const brandCatalysts: AEOCatalyst[] = opts.brandActions.map((act) => {
    const d = new Date(act.timestamp);
    const dateStr = d.toISOString().split('T')[0];
    return {
      id: `brand-${act.actionId}-${act.timestamp}`,
      date: dateStr,
      timestamp: act.timestamp,
      origin: 'brand',
      title: act.title,
      description: act.description || `Executed action: ${act.title}`,
      impact: opts.mindshareDelta !== undefined
        ? {
            metric: 'mindshare',
            deltaPercent: opts.mindshareDelta,
            description: `${opts.mindshareDelta >= 0 ? '+' : ''}${opts.mindshareDelta}% change following deployment`,
          }
        : undefined,
    };
  });

  const merged = [...KNOWN_PLATFORM_CATALYSTS, ...brandCatalysts];
  merged.sort((a, b) => b.timestamp - a.timestamp);
  return merged;
}
