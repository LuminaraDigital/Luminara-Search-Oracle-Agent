import { describe, it, expect } from 'vitest';
import { criticReflectionEngine } from '../../services/agentCore/criticReflectionEngine';
import { AuditFinding, CodeRemediationPatch, ScrapedPageEvidence, SerpEvidenceItem } from '../../services/agentCore/types';

describe('CriticReflectionEngine (AutoGen-inspired Adversarial Gate)', () => {
  it('should suppress hallucinated schema missingness when schema actually exists in raw DOM', () => {
    const candidateFindings: AuditFinding[] = [
      {
        id: 'f-1',
        category: 'schema',
        severity: 'critical',
        title: 'Missing Organization Schema on Target Site',
        description: 'No organization schema detected.',
        evidenceSource: 'AI guess',
        howWeKnowItFailed: 'Not found',
        leadingIndicator: 'Add it',
        criticVerified: false,
        criticConfidence: 0.5,
      },
    ];

    const scrapedPages: ScrapedPageEvidence[] = [
      {
        url: 'https://example.com',
        title: 'Example Brand',
        h1s: ['Welcome'],
        schemasFound: [
          { type: 'Organization', rawJson: '{"@type":"Organization","name":"Example"}', isValid: true },
        ],
        wordCount: 500,
        rawTextSnippet: 'Example brand home',
      },
    ];

    const result = criticReflectionEngine.verify(candidateFindings, [], scrapedPages, []);

    // Finding must be rejected because Organization schema is actually present!
    expect(result.rejectedCount).toBe(1);
    expect(result.verifiedFindings.length).toBe(0);
    expect(result.reflectionFeedback[0]).toContain('Organization schema was actually present in raw DOM');
  });

  it('should pass through legitimately verified findings', () => {
    const candidateFindings: AuditFinding[] = [
      {
        id: 'f-2',
        category: 'schema',
        severity: 'critical',
        title: 'Missing Organization Schema',
        description: 'No schema found.',
        evidenceSource: 'DOM check',
        howWeKnowItFailed: 'None found',
        leadingIndicator: 'Add organization schema',
        criticVerified: false,
        criticConfidence: 0.8,
      },
    ];

    const scrapedPages: ScrapedPageEvidence[] = [
      {
        url: 'https://example.com',
        title: 'Example Brand',
        h1s: ['Welcome'],
        schemasFound: [], // Legitimately missing!
        wordCount: 500,
        rawTextSnippet: 'Example brand text',
      },
    ];

    const result = criticReflectionEngine.verify(candidateFindings, [], scrapedPages, []);

    expect(result.rejectedCount).toBe(0);
    expect(result.verifiedFindings.length).toBe(1);
    expect(result.verifiedFindings[0].criticVerified).toBe(true);
    expect(result.criticConfidence).toBeGreaterThanOrEqual(0.95);
  });

  it('should validate JSON-LD syntax for remediation patches', () => {
    const patches: CodeRemediationPatch[] = [
      {
        id: 'p-1',
        targetType: 'json_ld',
        filename: 'schema.jsonld',
        proposedSnippet: '{"@context": "https://schema.org", "@type": "Organization", "name": "Acme"}',
        explanation: 'Valid schema',
        criticSyntaxValid: false,
      },
      {
        id: 'p-2',
        targetType: 'json_ld',
        filename: 'broken.jsonld',
        proposedSnippet: '{ invalid json content',
        explanation: 'Broken schema',
        criticSyntaxValid: true,
      },
    ];

    const result = criticReflectionEngine.verify([], patches, [], []);

    expect(result.verifiedPatches[0].criticSyntaxValid).toBe(true);
    expect(result.verifiedPatches[1].criticSyntaxValid).toBe(false);
  });
});
