import { describe, expect, it } from 'vitest';
import { empiricalCitationService } from '../services/audit/empiricalCitationService';

describe('EmpiricalCitationService', () => {
  it('generates test queries across informational, commercial, and comparative vectors', () => {
    const queries = empiricalCitationService.generateTestQueries('acmebrand.com', 'Acme Corp', 'SEO automation software');
    expect(queries.length).toBeGreaterThanOrEqual(3);

    const intents = queries.map(q => q.intent);
    expect(intents).toContain('informational');
    expect(intents).toContain('commercial');
    expect(intents).toContain('comparative');

    // Brand and domain should be included in generated queries
    expect(queries.some(q => q.query.includes('Acme Corp'))).toBe(true);
  });

  it('normalizes target domain properly', () => {
    const queries = empiricalCitationService.generateTestQueries('https://www.myshop.co.uk/store/page', 'MyShop');
    expect(queries.length).toBeGreaterThanOrEqual(3);
    expect(queries[0].query).not.toContain('https://');
    expect(queries[0].query).not.toContain('www.');
  });
});
