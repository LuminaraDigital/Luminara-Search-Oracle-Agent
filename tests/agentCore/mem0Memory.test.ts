import { describe, it, expect, beforeEach } from 'vitest';
import { mem0MemoryEngine } from '../../services/agentCore/mem0MemoryEngine';
import { AuditStateGraphContext } from '../../services/agentCore/types';

describe('Mem0MemoryEngine (4-Tier Memory & Delta Extractor)', () => {
  beforeEach(() => {
    mem0MemoryEngine.clear();
  });

  it('should apply ADD, UPDATE, and DELETE deltas across tiers', () => {
    // 1. ADD
    const added = mem0MemoryEngine.applyDelta({
      action: 'ADD',
      tier: 'domain_entity',
      entityId: 'stripe.com',
      key: 'competitor',
      value: 'Adyen',
      rationale: 'Discovered in competitive analysis',
      confidence: 0.9,
    });

    expect(added).not.toBeNull();
    expect(added?.value).toBe('Adyen');

    // Verify retrieval
    const facts = mem0MemoryEngine.getFacts({ entityId: 'stripe.com' });
    expect(facts.length).toBe(1);
    expect(facts[0].key).toBe('competitor');

    // 2. UPDATE
    mem0MemoryEngine.applyDelta({
      action: 'UPDATE',
      tier: 'domain_entity',
      entityId: 'stripe.com',
      key: 'competitor',
      value: 'Adyen & PayPal',
      rationale: 'Updated competitor list',
      confidence: 0.95,
    });

    const updated = mem0MemoryEngine.getFacts({ entityId: 'stripe.com' });
    expect(updated.length).toBe(1);
    expect(updated[0].value).toBe('Adyen & PayPal');

    // 3. DELETE
    mem0MemoryEngine.applyDelta({
      action: 'DELETE',
      tier: 'domain_entity',
      entityId: 'stripe.com',
      key: 'competitor',
      value: '',
      rationale: 'User pruned',
      confidence: 1,
    });

    const afterDelete = mem0MemoryEngine.getFacts({ entityId: 'stripe.com' });
    expect(afterDelete.length).toBe(0);
  });

  it('should autonomously extract facts from audit context and resolve conflicts', () => {
    const mockContext: AuditStateGraphContext = {
      targetUrl: 'https://acme.org',
      focus: 'AEO',
      scrapedPages: [],
      serpEvidence: [],
      citationRatePercent: 78,
      shareOfVoiceScore: 82,
      healthScore: 88,
      findings: [
        {
          id: 'f-1',
          category: 'schema',
          severity: 'critical',
          title: 'Missing Organization Schema',
          description: '',
          evidenceSource: '',
          howWeKnowItFailed: '',
          leadingIndicator: '',
          criticVerified: true,
          criticConfidence: 0.9,
        },
      ],
      topCompetitors: ['beta.com', 'gamma.com'],
      competitorGaps: ['Comparison moat'],
      patches: [],
      plainEnglishBrief: 'All good.',
      criticRejections: 0,
      criticPass: true,
      errors: [],
    };

    const deltas = mem0MemoryEngine.extractAndSyncAuditContext(mockContext);

    expect(deltas.length).toBeGreaterThanOrEqual(3);

    const facts = mem0MemoryEngine.getFacts({ entityId: 'acme.org' });
    const scoreFact = facts.find((f) => f.key === 'latest_health_score');
    const compFact = facts.find((f) => f.key === 'competitors_list');
    const citationFact = facts.find((f) => f.key === 'ai_citation_rate');

    expect(scoreFact?.value).toBe('88');
    expect(compFact?.value).toBe('beta.com, gamma.com');
    expect(citationFact?.value).toBe('78%');
  });
});
