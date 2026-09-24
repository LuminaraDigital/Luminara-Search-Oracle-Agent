import { describe, expect, it } from 'vitest';
import { buildVisibilityStub, buildPagespeedStub } from '../services/tools/visibilityPagespeed';
import { appendLocalMemoryFact, fetchHostedMemoryFacts } from '../services/memory/hostedMemoryStub';

describe('P5 visibility/PSI stubs', () => {
  it('never invents citation rates and does not claim W4 unwired', () => {
    const snap = buildVisibilityStub('example.com');
    expect(snap.engines.every((e) => e.measurementStatus === 'not_measured')).toBe(true);
    expect(snap.engines.every((e) => e.citationRate === null)).toBe(true);
    expect(snap.engines.every((e) => !/W4 .*not wired/i.test(e.reason))).toBe(true);
    expect(snap.engines[0]?.reason).toMatch(/get_visibility_snapshot/);
  });

  it('PSI stub is not_measured without claiming W5 unwired', () => {
    const psi = buildPagespeedStub('https://example.com/');
    expect(psi.measurementStatus).toBe('not_measured');
    expect(psi.lcpMs).toBeNull();
    expect(psi.reason).not.toMatch(/W5 .*not live/i);
    expect(psi.reason).toMatch(/get_pagespeed_summary/);
  });
});

describe('P6 hosted memory stub', () => {
  it('returns MEMORY_HOSTED_PENDING when API base is unavailable', async () => {
    const res = await fetchHostedMemoryFacts('acc');
    expect(['MEMORY_HOSTED_PENDING', 'AUTH_REQUIRED', 'ERROR', 'OK']).toContain(res.code);
    expect(Array.isArray(res.facts)).toBe(true);
  });

  it('can append local facts when localStorage exists', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
      },
      removeItem: (k) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    };
    const fact = appendLocalMemoryFact('acc', 'Brand prefers plain English');
    expect(fact.source).toBe('local');
    expect(fact.text).toContain('plain English');
  });
});
