import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EMPTY_SITE_INPUT_MESSAGE } from '../services/audit/auditTargetUrl';
import {
  ANALYZE_STAGES,
  SAMPLE_FIXTURE,
  idleEngines,
  normalizeDemoUrl,
  sampleEngineRowsForHost,
  visibleProbeHost,
} from '../components/marketing/demo/demoFixtures';
import { ENGINE_STATUS_LABEL } from '../components/marketing/EvidenceGlyph';
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
    const empty = normalizeDemoUrl('');
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.error).toBe(EMPTY_SITE_INPUT_MESSAGE);
    expect(visibleProbeHost('https:// https://example.com/path')).toBe('example.com/path');
    expect(normalizeDemoUrl('https://https://Example.com')).toEqual({ ok: true, host: 'example.com' });
      expect(empty.error).not.toContain('luminarasuite.com');
    }
    expect(normalizeDemoUrl('not-a-domain').ok).toBe(false);
    expect(ENGINE_STATUS_LABEL.idle).toBe('Not run yet');
    const playback = readFileSync(new URL('../components/marketing/demo/useDemoPlayback.ts', import.meta.url), 'utf8');
    expect(playback).toContain('normalizeDemoUrl(url)');
    expect(playback).not.toContain('SAMPLE_FIXTURE.domain');
  });

  it('only shows crawl work in progress: the engines are never presented as being checked', () => {
    expect(ANALYZE_STAGES.join(' ')).not.toMatch(/engine|rank|fix/i);
    expect(ANALYZE_STAGES.join(' ')).toMatch(/robots\.txt/);
    const playback = readFileSync(new URL('../components/marketing/demo/useDemoPlayback.ts', import.meta.url), 'utf8');
    expect(playback).not.toMatch(/idleEngines\(\)\.map\(\(e\) => \(\{ \.\.\.e, status: 'pending'/);
    expect(playback).toContain('sampleEngineRowsForHost(parsed.host)]');
    for (const row of sampleEngineRowsForHost('example.com')) {
      expect(row.status).toBe('not_measured');
    }
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

  it('says a 403 crawl file could not be checked', () => {
    const snapshot: LlmCrawlerSnapshot = {
      llmsTxt: null,
      llmsHttpStatus: 403,
      robotsTxt: null,
      robotsHttpStatus: 403,
      aiTxt: null,
      aiHttpStatus: 403,
    };
    const crawl = summarizeProbeCrawl('movida.com.au', snapshot);
    expect(crawl.status).toBe('not_measured');
    expect(crawl.note).toContain('robots.txt: Not measured (site blocked our check)');
    expect(crawl.note).toContain('llms.txt: Not measured (site blocked our check)');
    expect(crawl.note).toContain('ai.txt: Not measured (site blocked our check)');
    expect(crawl.note).not.toContain('missing');
    expect(crawl.note).not.toContain('Measured');
    expect(crawl.robotsPresent).toBe(false);
  });
});
