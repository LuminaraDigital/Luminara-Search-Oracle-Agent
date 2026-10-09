import { describe, it, expect } from 'vitest';
import {
  extractGoalEvidence,
  runCitationScout,
} from '../services/visibility/citationScoutService';

describe('CitationScoutService', () => {
  it('extracts goal evidence and identifies pricing transparency', () => {
    const rawText = `
      Our enterprise platform provides AI visibility monitoring.

      The Pro tier costs $49/mo and includes unlimited search tracking, 5000 API calls, and automated Schema validation.
      Starter tier is free forever.

      Join 10,000 developers optimizing their sites.
    `;

    const extraction = extractGoalEvidence(rawText, 'best AI visibility tools pricing');
    expect(extraction.gapCategory).toBe('pricing_transparency');
    expect(extraction.evidence).toContain('$49/mo');
    expect(extraction.rational).toContain('best AI visibility tools pricing');
  });

  it('extracts documentation freshness signals', () => {
    const rawText = `
      Updated September 2026. Complete API reference and quickstart guide for developer integration.
      Use our SDK for automated Schema.org JSON-LD generation.
    `;

    const extraction = extractGoalEvidence(rawText, 'API documentation reference');
    expect(extraction.gapCategory).toBe('documentation_freshness');
    expect(extraction.evidence).toContain('API reference');
  });

  it('runs multi-round scout and synthesizes actionable citation gap recipe', async () => {
    const report = await runCitationScout({
      targetDomain: 'luminara-oracle.dev',
      query: 'AI search optimization software pricing',
      engine: 'perplexity',
    });

    expect(report.targetDomain).toBe('luminara-oracle.dev');
    expect(report.rounds.length).toBeGreaterThanOrEqual(1);
    expect(report.competitorWinners.length).toBeGreaterThan(0);
    expect(report.synthesizedGapAction.title).toBeDefined();
    expect(report.synthesizedGapAction.priority).toBe('p0');
    expect(report.synthesizedGapAction.recipe).toContain('pricing table');
  });
});
