import { describe, expect, it } from 'vitest';
import {
  findResearchLogHit,
  RESEARCH_LOG_REUSE_MS,
  researchLogHitResult,
} from '../services/tools/researchLogGate';
import { researchKeywords } from '../services/tools/paidResearch';
import type { PaidToolRuntime } from '../services/tools/types';
import { isDataForSeoPathAllowed } from '../worker/dataForSeoClient';
import { isPathAllowed, PROVIDERS } from '../worker/providerRelay';

describe('research log gate', () => {
  it('hits recent matching summary within 30 days', () => {
    const now = Date.now();
    const hit = findResearchLogHit(
      [
        {
          id: '1',
          entry_date: '2026-09-01',
          summary: 'Keyword research: seeds=shoes. Top ideas: running shoes.',
          created_at: now - 2 * 24 * 60 * 60 * 1000,
        },
      ],
      ['keyword', 'shoes'],
      now,
    );
    expect(hit?.id).toBe('1');
  });

  it('misses entries older than 30 days', () => {
    const now = Date.now();
    const hit = findResearchLogHit(
      [
        {
          id: '1',
          entry_date: '2026-01-01',
          summary: 'Keyword research: seeds=shoes.',
          created_at: now - RESEARCH_LOG_REUSE_MS - 1000,
        },
      ],
      ['keyword', 'shoes'],
      now,
    );
    expect(hit).toBeNull();
  });

  it('skips not_measured poison summaries so retries are not blocked', () => {
    const now = Date.now();
    const hit = findResearchLogHit(
      [
        {
          id: 'poison',
          entry_date: '2026-09-17',
          summary: 'Keyword research: seeds=shoes. Verdict: not_measured (DFS_ERROR).',
          created_at: now - 1000,
        },
      ],
      ['keyword', 'shoes'],
      now,
    );
    expect(hit).toBeNull();
  });

  it('researchLogHitResult does not claim measured for not_measured summaries', () => {
    const result = researchLogHitResult(
      {
        id: 'legacy',
        entry_date: '2026-09-17',
        summary: 'SERP: shoes. Verdict: not_measured (DFS_EMPTY).',
        created_at: Date.now(),
      },
      'get_serp_results',
    );
    expect(result.structuredContent.measurementStatus).toBe('not_measured');
    expect(result.structuredContent.code).toBe('RESEARCH_LOG_HIT');
  });
});

describe('DataForSEO allowlist', () => {
  it('allows labs, backlinks, serp prefixes', () => {
    expect(isDataForSeoPathAllowed('/v3/dataforseo_labs/google/keyword_suggestions/live')).toBe(true);
    expect(isDataForSeoPathAllowed('/v3/backlinks/summary/live')).toBe(true);
    expect(isPathAllowed(PROVIDERS.dataforseo, '/v3/backlinks/summary/live')).toBe(true);
    expect(isPathAllowed(PROVIDERS.dataforseo, '/v3/admin/evil')).toBe(false);
  });
});

describe('researchKeywords live mapping', () => {
  it('returns measured keywords from mock DFS', async () => {
    const logs: string[] = [];
    const rt: PaidToolRuntime = {
      accountId: 'acc',
      canUsePaid: true,
      dataForSeoCredential: 'user:pass',
      getProject: async () => ({
        id: 'proj_1',
        domain: 'example.com',
        default_location_code: '2840',
        default_language_code: 'en',
      }),
      getResearchLog: async () => [],
      appendResearchLog: async (_id, summary) => {
        logs.push(summary);
      },
      dfsPost: async () => ({
        ok: true,
        status: 200,
        body: {
          tasks: [
            {
              result: [
                {
                  keyword_data: {
                    keyword: 'running shoes',
                    keyword_info: { search_volume: 1200, competition: 0.4 },
                  },
                },
              ],
            },
          ],
        },
      }),
    };

    const result = await researchKeywords({ projectId: 'proj_1', seeds: ['shoes'] }, rt);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.measurementStatus).toBe('measured');
    expect((result.structuredContent?.keywords as unknown[])?.length).toBe(1);
    expect(logs.length).toBe(1);
  });

  it('returns RESEARCH_LOG_HIT without calling DFS', async () => {
    let dfsCalls = 0;
    const now = Date.now();
    const rt: PaidToolRuntime = {
      accountId: 'acc',
      canUsePaid: true,
      dataForSeoCredential: 'user:pass',
      getProject: async () => ({ id: 'proj_1', domain: 'example.com' }),
      getResearchLog: async () => [
        {
          id: 'log1',
          entry_date: '2026-09-17',
          summary: 'Keyword research: seeds=shoes. Top ideas: running shoes.',
          created_at: now - 1000,
        },
      ],
      appendResearchLog: async () => {},
      dfsPost: async () => {
        dfsCalls += 1;
        return { ok: false, status: 500, body: null };
      },
    };
    const result = await researchKeywords({ projectId: 'proj_1', seeds: ['shoes'] }, rt);
    expect(result.structuredContent?.code).toBe('RESEARCH_LOG_HIT');
    expect(result.structuredContent?.measurementStatus).toBe('measured');
    expect(dfsCalls).toBe(0);
  });

  it('does not append research log on DFS failure', async () => {
    const logs: string[] = [];
    const rt: PaidToolRuntime = {
      accountId: 'acc',
      canUsePaid: true,
      dataForSeoCredential: 'user:pass',
      getProject: async () => ({ id: 'proj_1', domain: 'example.com' }),
      getResearchLog: async () => [],
      appendResearchLog: async (_id, summary) => {
        logs.push(summary);
      },
      dfsPost: async () => ({ ok: false, status: 500, body: null, code: 'DFS_ERROR', error: 'down' }),
    };
    const result = await researchKeywords({ projectId: 'proj_1', seeds: ['shoes'] }, rt);
    expect(result.structuredContent?.measurementStatus).toBe('not_measured');
    expect(logs.length).toBe(0);
  });
});
