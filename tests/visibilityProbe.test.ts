import { describe, expect, it } from 'vitest';
import {
  SAMPLE_FIXTURE,
  idleEngines,
  normalizeDemoUrl,
} from '../components/marketing/demo/demoFixtures';

describe('landing Visibility Probe fixtures', () => {
  it('normalizes domains without inventing hosts', () => {
    expect(normalizeDemoUrl('https://www.LuminaraSuite.com/path')).toEqual({
      ok: true,
      host: 'luminarasuite.com',
    });
    expect(normalizeDemoUrl('yourbrand.com').ok).toBe(true);
    expect(normalizeDemoUrl('').ok).toBe(false);
    expect(normalizeDemoUrl('not-a-domain').ok).toBe(false);
  });

  it('keeps sample engines honest (no numeric citation rates)', () => {
    for (const row of SAMPLE_FIXTURE.engines) {
      expect(['measured', 'estimated', 'not_measured']).toContain(row.status);
      expect(row.note.toLowerCase()).toMatch(/sample|not measured|illustrative/);
    }
    expect(SAMPLE_FIXTURE.verdict.toLowerCase()).toContain('sample');
    expect(idleEngines().every((e) => e.status === 'idle')).toBe(true);
  });
});
