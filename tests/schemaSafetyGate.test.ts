import { describe, expect, it } from 'vitest';
import { validateSchemaJsonLd, schemaSafetyScore, schemaSafetyGate } from '../services/deployment/schemaSafetyGate';

describe('schemaSafetyGate', () => {
  it('blocks empty schema as critical', () => {
    const result = validateSchemaJsonLd('');
    expect(result.okToDeploy).toBe(false);
    expect(result.severity).toBe('critical');
    expect(result.issues.some((i) => i.code === 'EMPTY_SCHEMA')).toBe(true);
  });

  it('blocks invalid JSON as critical', () => {
    const result = validateSchemaJsonLd('{ not json');
    expect(result.okToDeploy).toBe(false);
    expect(result.severity).toBe('critical');
    expect(result.issues.some((i) => i.code === 'INVALID_JSON')).toBe(true);
  });

  it('blocks missing @type as critical', () => {
    const result = validateSchemaJsonLd(JSON.stringify({
      '@context': 'https://schema.org',
      name: 'Brand',
    }));
    expect(result.okToDeploy).toBe(false);
    expect(result.issues.some((i) => i.code === 'MISSING_TYPE')).toBe(true);
  });

  it('warns on deprecated FAQPage but still allows deploy', () => {
    const result = validateSchemaJsonLd(JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [],
    }));
    expect(result.okToDeploy).toBe(true);
    expect(result.severity).toBe('warn');
    expect(result.issues.some((i) => i.code === 'DEPRECATED_RICH_RESULT')).toBe(true);
  });

  it('accepts clean Organization graph', () => {
    const result = schemaSafetyGate.validate(JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Luminara',
    }));
    expect(result.okToDeploy).toBe(true);
    expect(result.severity).toBe('ok');
    expect(schemaSafetyScore(result)).toBe(100);
  });

  it('scores critical schemas in the low band', () => {
    const result = validateSchemaJsonLd('');
    expect(schemaSafetyScore(result)).toBeLessThanOrEqual(35);
  });
});
