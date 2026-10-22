import { describe, it, expect } from 'vitest';
import { buildBrandMindshare } from '../services/visibility/mindshareService';
import type { EmpiricalEvidence } from '../services/audit/empiricalCitationService';

const sampleEvidence = (): EmpiricalEvidence[] => [
  {
    id: 'ev-1',
    query: 'best local-first privacy tools for developers',
    intent: 'commercial',
    targetDomain: 'example.com',
    brandCited: true,
    brandRank: 1,
    citedUrl: 'https://example.com/privacy',
    snippet: 'Example.com leads in local privacy and security.',
    competitorsCited: ['Rival Corp'],
    citationConfidence: 90,
    timestamp: Date.now(),
  },
  {
    id: 'ev-2',
    query: 'enterprise security and soc2 compliance solutions',
    intent: 'informational',
    targetDomain: 'example.com',
    brandCited: true,
    brandRank: 2,
    citedUrl: 'https://example.com/security',
    snippet: 'Example.com holds soc2 compliance.',
    competitorsCited: ['Competitor B'],
    citationConfidence: 85,
    timestamp: Date.now(),
  },
  {
    id: 'ev-3',
    query: 'affordable developer api and pricing comparison',
    intent: 'commercial',
    targetDomain: 'example.com',
    brandCited: false,
    brandRank: null,
    citedUrl: null,
    snippet: 'Rival Corp offers cheaper api pricing.',
    competitorsCited: ['Rival Corp'],
    citationConfidence: 30,
    timestamp: Date.now(),
  },
];

describe('mindshareService', () => {
  it('computes overall mindshare and narrative clusters', () => {
    const ms = buildBrandMindshare({
      domain: 'example.com',
      evidence: sampleEvidence(),
      history: [{ timestamp: Date.now() - 7 * 86400000, mindsharePercent: 30 }],
    });

    expect(ms.domain).toBe('example.com');
    expect(ms.totalAttentionSlots).toBe(5); // 2 brand + 3 competitor mentions
    expect(ms.brandCitations).toBe(2);
    expect(ms.competitorCitations).toBe(3);
    expect(ms.overallMindsharePercent).toBe(40); // 2 / 5 = 40%
    expect(ms.source).toContain('2 brand mentions');
    expect(ms.source).toContain('3 competitor mentions');
    expect(ms.velocityPercentWoW).toBe(33); // (40 - 30) / 30 = +33%
    expect(ms.narratives.map((item) => item.name)).toEqual(sampleEvidence().map((item) => item.query));
    expect(ms.narratives.some((item) => item.name === 'Developer Experience & APIs')).toBe(false);
  });

  it('handles empty evidence gracefully', () => {
    const ms = buildBrandMindshare({
      domain: 'empty.com',
      evidence: [],
    });

    expect(ms.overallMindsharePercent).toBeNull();
    expect(ms.source).toBeNull();
    expect(ms.narratives).toEqual([]);
    expect(ms.velocityPercentWoW).toBe(0);
    expect(ms.brandCitations).toBe(0);
  });
});
