import { describe, expect, it } from 'vitest';
import {
  SAMPLE_FIXTURE,
  idleEngines,
  normalizeDemoUrl,
  type DemoPhase,
} from '../components/marketing/demo/demoFixtures';
import { probeUiForPhase } from '../components/marketing/VisibilityProbe';

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

describe('probeUiForPhase progressive disclosure', () => {
  const phases: DemoPhase[] = ['empty', 'typing', 'analyzing', 'results_sample', 'error'];

  it('keeps idle minimal: run CTA, engine rows idle, no reveal', () => {
    const ui = probeUiForPhase('empty');
    expect(ui.primaryAction).toBe('run');
    expect(ui.showEngineRows).toBe(true);
    expect(ui.showReveal).toBe(false);
    expect(ui.showPresets).toBe(false);
    expect(ui.showFocusTune).toBe(false);
  });

  it('gates Open Instant Audit to results_sample only', () => {
    for (const phase of phases) {
      const ui = probeUiForPhase(phase);
      if (phase === 'results_sample') {
        expect(ui.primaryAction).toBe('open_audit');
        expect(ui.showReveal).toBe(true);
        expect(ui.showEngineRows).toBe(true);
      } else {
        expect(ui.primaryAction).not.toBe('open_audit');
        expect(ui.showReveal).toBe(false);
      }
    }
  });

  it('shows analyzing engine rows without a competing primary CTA', () => {
    const ui = probeUiForPhase('analyzing');
    expect(ui.showEngineRows).toBe(true);
    expect(ui.primaryAction).toBe('none');
  });

  it('offers examples while typing', () => {
    const ui = probeUiForPhase('typing');
    expect(ui.showPresets).toBe(true);
    expect(ui.showFocusTune).toBe(true);
    expect(ui.primaryAction).toBe('run');
  });

  it('hides focus tune on results so Open Instant Audit stays the only primary control', () => {
    const ui = probeUiForPhase('results_sample');
    expect(ui.showFocusTune).toBe(false);
    expect(ui.showPresets).toBe(false);
    expect(ui.primaryAction).toBe('open_audit');
  });
});
