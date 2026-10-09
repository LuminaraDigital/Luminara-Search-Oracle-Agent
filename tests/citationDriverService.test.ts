import { describe, it, expect } from 'vitest';
import { extractCitationDrivers } from '../services/visibility/citationDriverService';

describe('citationDriverService', () => {
  it('extracts positive pricing driver when brand is cited with pricing context', () => {
    const analysis = extractCitationDrivers({
      domain: 'example.com',
      brandCited: true,
      snippet: 'Example.com is favored for its transparent pricing and affordable free tier plans.',
    });

    expect(analysis.brandCited).toBe(true);
    expect(analysis.domain).toBe('example.com');
    expect(analysis.drivers.length).toBeGreaterThan(0);
    expect(analysis.primaryDriver.type).toBe('pricing_transparency');
    expect(analysis.primaryDriver.impact).toBe('positive');
    expect(analysis.primaryDriver.label).toContain('Transparent pricing');
  });

  it('extracts negative schema driver when brand is omitted and schema keywords match', () => {
    const analysis = extractCitationDrivers({
      domain: 'example.com',
      brandCited: false,
      snippet: 'Rivals provide structured data and schema markup, whereas alternatives lack clear entity metadata.',
    });

    expect(analysis.brandCited).toBe(false);
    expect(analysis.primaryDriver.type).toBe('schema_clarity');
    expect(analysis.primaryDriver.impact).toBe('negative');
    expect(analysis.primaryDriver.recommendedActionId).toBe('deploy-schema');
  });

  it('falls back to unknown driver gracefully when no rule keywords match', () => {
    const analysis = extractCitationDrivers({
      domain: 'example.com',
      brandCited: false,
      snippet: 'No other details were provided.',
    });

    expect(analysis.primaryDriver.type).toBe('unknown');
    expect(analysis.primaryDriver.impact).toBe('neutral');
  });
});
