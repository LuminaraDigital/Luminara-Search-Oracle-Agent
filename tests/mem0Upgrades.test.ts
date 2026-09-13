import { describe, it, expect, beforeEach } from 'vitest';
import {
  mem0MemoryEngine,
  computeDecayScore,
  MEM0_EXTRACTION_PROMPT_SCHEMA,
} from '../services/agentCore/mem0MemoryEngine';
import { AuditStateGraphContext } from '../services/agentCore/types';

describe('Mem0 Memory Engine Upgrades (Graph Triplets & Recency Decay)', () => {
  beforeEach(() => {
    mem0MemoryEngine.clear();
  });

  describe('Temporal Recency Decay Curve', () => {
    it('calculates exponential half-life decay accurately', () => {
      const now = Date.now();
      const baseConfidence = 1.0;

      // Brand new fact (0 elapsed) -> 1.0
      const newScore = computeDecayScore(baseConfidence, now, 'domain_entity');
      expect(newScore).toBe(1.0);

      // 30 days old with 30-day half-life -> ~0.5
      const thirtyDaysAgo = now - 30 * 86_400_000;
      const score30 = computeDecayScore(baseConfidence, thirtyDaysAgo, 'domain_entity', 30);
      expect(score30).toBeCloseTo(0.5, 2);

      // 60 days old with 30-day half-life -> ~0.25
      const sixtyDaysAgo = now - 60 * 86_400_000;
      const score60 = computeDecayScore(baseConfidence, sixtyDaysAgo, 'domain_entity', 30);
      expect(score60).toBeCloseTo(0.25, 2);
    });

    it('filters facts using minDecayedScore in getFacts', () => {
      const now = Date.now();
      const freshFact = mem0MemoryEngine.applyDelta({
        action: 'ADD',
        tier: 'domain_entity',
        entityId: 'example.com',
        key: 'fresh_signal',
        value: 'Fresh SERP 1',
        rationale: 'Observed today',
        confidence: 0.9,
      });

      const facts = mem0MemoryEngine.getFacts({ entityId: 'example.com', applyDecay: true });
      expect(facts.length).toBe(1);
      expect(facts[0].decayedScore).toBeCloseTo(0.9, 1);
    });
  });

  describe('Entity-Relation Graph Triplet Layer', () => {
    it('supports adding, querying, and deleting relational triplets', () => {
      const rel = mem0MemoryEngine.addRelation({
        source: 'nike.com',
        predicate: 'competes_with',
        target: 'adidas.com',
        confidence: 0.95,
      });

      expect(rel.source).toBe('nike.com');
      expect(rel.predicate).toBe('competes_with');
      expect(rel.target).toBe('adidas.com');

      const found = mem0MemoryEngine.getRelations({ source: 'nike.com' });
      expect(found.length).toBe(1);
      expect(found[0].target).toBe('adidas.com');

      // Update same relation
      mem0MemoryEngine.addRelation({
        source: 'nike.com',
        predicate: 'competes_with',
        target: 'adidas.com',
        confidence: 0.99,
      });
      const updated = mem0MemoryEngine.getRelations({ source: 'nike.com' });
      expect(updated.length).toBe(1);
      expect(updated[0].confidence).toBe(0.99);

      // Delete relation
      const deleted = mem0MemoryEngine.deleteRelation({
        source: 'nike.com',
        predicate: 'competes_with',
        target: 'adidas.com',
      });
      expect(deleted).toBe(true);
      expect(mem0MemoryEngine.getRelations({ source: 'nike.com' }).length).toBe(0);
    });

    it('applies relation deltas via applyRelationDelta', () => {
      mem0MemoryEngine.applyRelationDelta({
        action: 'ADD',
        source: 'shopify.com',
        predicate: 'targets_audience',
        target: 'direct_to_consumer_merchants',
        confidence: 0.92,
      });

      const list = mem0MemoryEngine.getRelations({ predicate: 'targets_audience' });
      expect(list.length).toBe(1);
      expect(list[0].source).toBe('shopify.com');

      mem0MemoryEngine.applyRelationDelta({
        action: 'DELETE',
        source: 'shopify.com',
        predicate: 'targets_audience',
        target: 'direct_to_consumer_merchants',
        confidence: 1.0,
      });
      expect(mem0MemoryEngine.getRelations({ predicate: 'targets_audience' }).length).toBe(0);
    });
  });

  describe('Autonomous Context Extraction with Relations', () => {
    it('autonomously extracts entity-relationship triplets during audit sync', () => {
      const mockContext: AuditStateGraphContext = {
        targetUrl: 'https://loom.com',
        focus: 'AEO',
        dna: {
          name: 'Loom',
          url: 'https://loom.com',
          targetAudience: 'Remote Product Teams',
        } as any,
        scrapedPages: [],
        serpEvidence: [],
        citationRatePercent: 82,
        shareOfVoiceScore: 75,
        healthScore: 88,
        findings: [
          {
            id: 'f-1',
            category: 'schema',
            severity: 'critical',
            title: 'Missing SoftwareApplication Schema',
            description: 'Missing Schema.org software markup',
            evidenceSource: 'DOM crawl',
            howWeKnowItFailed: 'No SoftwareApplication found',
            leadingIndicator: 'Rich snippet loss',
            criticVerified: true,
            criticConfidence: 0.95,
          },
        ],
        topCompetitors: ['Vidyard', 'Vimeo'],
        competitorGaps: [],
        patches: [],
        plainEnglishBrief: 'Audit complete',
        criticRejections: 0,
        criticPass: true,
        errors: [],
      };

      const deltas = mem0MemoryEngine.extractAndSyncAuditContext(mockContext);
      expect(deltas.length).toBeGreaterThan(0);

      // Verify competitor relations
      const compRels = mem0MemoryEngine.getRelations({ source: 'loom.com', predicate: 'competes_with' });
      expect(compRels.length).toBe(2);
      expect(compRels.some((r) => r.target === 'vidyard')).toBe(true);

      // Verify schema gap relation
      const gapRels = mem0MemoryEngine.getRelations({ source: 'loom.com', predicate: 'lacks_schema' });
      expect(gapRels.length).toBe(1);

      // Verify prompt context includes both facts and relations
      const formatted = mem0MemoryEngine.formatContextForAgent('loom.com');
      expect(formatted).toContain('AUTONOMOUS BRAND MEMORY GRAPH');
      expect(formatted).toContain('Graph Relationships:');
      expect(formatted).toContain('loom.com --[competes_with]--> vidyard');
    });

    it('exposes canonical Mem0 extraction prompt schema', () => {
      expect(MEM0_EXTRACTION_PROMPT_SCHEMA).toContain('Mem0 architecture');
      expect(MEM0_EXTRACTION_PROMPT_SCHEMA).toContain('"relations"');
    });
  });
});
