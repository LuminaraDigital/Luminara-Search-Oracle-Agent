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

describe('schemaSafetyGate script breakout', () => {
  const org = (name: string) => JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name });
  const expectBreakout = (raw: string) => {
    const result = validateSchemaJsonLd(raw);
    expect(result.okToDeploy).toBe(false);
    expect(result.severity).toBe('critical');
    expect(result.issues.map((i) => i.code)).toEqual(['SCRIPT_BREAKOUT']);
    expect(result.canonicalJson).toBeUndefined();
  };

  it.each([
    ['lowercase </script>', org('</script><script>alert(1)</script>')],
    ['uppercase </SCRIPT>', org('</SCRIPT><img src=x onerror=alert(1)>')],
    ['whitespace </ script>', org('</ script >')],
    ['double slash <//script>', org('<//script>')],
    ['HTML comment <!--', org('<!--<script>')],
  ])('rejects %s in a string value', (_label, raw) => expectBreakout(raw));

  it.each([
    ['JSON-escaped slash <\\/script', '{"@type":"Organization","name":"<\\/script>"}'],
    ['unicode \\u003c/script', '{"@type":"Organization","name":"\\u003c/script>"}'],
    ['unicode \\u003C\\/script', '{"@type":"Organization","name":"\\u003C\\/script>"}'],
    ['unicode \\u003c\\u002fscript', '{"@type":"Organization","name":"\\u003c\\u002fscript>"}'],
    ['unicode \\u003c!--', '{"@type":"Organization","name":"\\u003c!--"}'],
  ])('rejects %s in the raw string', (_label, raw) => expectBreakout(raw));

  it('rejects breakouts that only appear after JSON decoding', () => {
    expectBreakout('{"@type":"Organization","name":"<\\u002fscript>"}');
    expectBreakout('{"@type":"Organization","name":"\\u003c\\u002F\\u0073cript>"}');
    expectBreakout('{"@type":"Organization","</script>":"x"}');
  });

  it('rejects text outside a fenced JSON block', () => {
    const result = validateSchemaJsonLd('alert(1)\n```json\n{"@type":"Organization","name":"x"}\n```');
    expect(result.okToDeploy).toBe(false);
    expect(result.issues.some((i) => i.code === 'CONTENT_OUTSIDE_FENCE')).toBe(true);
  });

  it('passes normal JSON-LD and emits HTML-safe canonical JSON', () => {
    const graph = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'Scripts & Co <Bold>', url: 'https://example.com/script' },
        { '@type': 'WebPage', description: 'We write scripts. a < b > c -- done', sameAs: ['https://x.com/a'] },
      ],
    };
    for (const raw of [JSON.stringify(graph, null, 2), '```json\n' + JSON.stringify(graph) + '\n```']) {
      const result = validateSchemaJsonLd(raw);
      expect(result.okToDeploy).toBe(true);
      expect(result.severity).toBe('ok');
      expect(result.canonicalJson).not.toMatch(/[<>&]/);
      expect(JSON.parse(result.canonicalJson!)).toEqual(graph);
    }
  });
});
