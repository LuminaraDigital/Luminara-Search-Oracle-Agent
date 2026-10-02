import { describe, expect, it } from 'vitest';
import {
  SAMPLE_FIXTURE,
  idleEngines,
  normalizeDemoUrl,
  type DemoPhase,
} from '../components/marketing/demo/demoFixtures';
import { probeUiForPhase } from '../components/marketing/VisibilityProbe';
import { LIVE_SAMPLE_SNAPSHOT } from '../services/marketing/liveSampleSnapshot';
import { summarizeProbeCrawl } from '../worker/probeCrawlRoute';
import type { LlmCrawlerSnapshot } from '../services/audit/llmCrawlerReadiness';

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

  it('keeps sample engines honest (never Measured; Sample notes only)', () => {
    for (const row of SAMPLE_FIXTURE.engines) {
      expect(row.status).toBe('not_measured');
      expect(row.status).not.toBe('measured');
      expect(row.note.toLowerCase()).toMatch(/sample/);
      if (row.status === 'estimated') {
        expect(row.note.startsWith('Sample · illustrative')).toBe(true);
      }
    }
    expect(SAMPLE_FIXTURE.verdict.toLowerCase()).toContain('sample');
    expect(idleEngines().every((e) => e.status === 'idle')).toBe(true);
  });

  it('live sample snapshot measures crawl only', () => {
    const crawl = LIVE_SAMPLE_SNAPSHOT.rows.find((r) => r.id === 'crawl_readiness');
    expect(crawl?.status).toBe('measured');
    for (const row of LIVE_SAMPLE_SNAPSHOT.rows) {
      if (row.id === 'crawl_readiness') continue;
      expect(row.status).toBe('not_measured');
    }
    expect(LIVE_SAMPLE_SNAPSHOT.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('probeCrawl summarize', () => {
  it('marks crawl Measured from snapshot collection, not engines', () => {
    const snapshot: LlmCrawlerSnapshot = {
      llmsTxt: '# Hello',
      llmsHttpStatus: 200,
      robotsTxt: 'User-agent: *',
      robotsHttpStatus: 200,
      aiTxt: null,
      aiHttpStatus: 404,
    };
    const crawl = summarizeProbeCrawl('luminarasuite.com', snapshot);
    expect(crawl.status).toBe('measured');
    expect(crawl.robotsPresent).toBe(true);
    expect(crawl.llmsPresent).toBe(true);
    expect(crawl.note.toLowerCase()).toContain('live crawl');
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

  it('gates results primary to results_sample only', () => {
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

  it('hides focus tune on results so the live CTA stays the only primary control', () => {
    const ui = probeUiForPhase('results_sample');
    expect(ui.showFocusTune).toBe(false);
    expect(ui.showPresets).toBe(false);
    expect(ui.primaryAction).toBe('open_audit');
  });
});
