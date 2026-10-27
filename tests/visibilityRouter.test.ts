import { describe, expect, it } from 'vitest';
import { runVisibilityRouter } from '../services/visibility/engineVisibilityRouter';
import { offSiteMentionPackDraft } from '../services/audit/fixPackCopy';
import { readRecheck } from '../services/upgrade/recheckReading';
import { getVisibilitySnapshot } from '../services/tools/paidResearch';
import { recheckOneFix } from '../worker/recheckFix';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';
import { readFreeUsed } from '../worker/quotaMiddleware';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';

describe('W4 visibility router', () => {
  it('returns not_measured when no credentials', async () => {
    const out = await runVisibilityRouter({ domain: 'example.com', queries: ['best crm'] });
    expect(out.measurementStatus).toBe('not_measured');
    expect(out.aggregateCitationRatePercent).toBeNull();
    expect(out.engines.every((e) => e.measurementStatus === 'not_measured')).toBe(true);
    expect(out.missingSources).toEqual([]);
  });

  it('labels LLM OpenRouter probes as estimated, not product measured KPIs', async () => {
    const out = await runVisibilityRouter({
      domain: 'acme.com',
      brand: 'Acme',
      queries: ['acme crm'],
      dfsPost: async () => ({ ok: false, body: null, error: 'DFS down', code: 'DFS_FAIL' }),
      llmGenerate: async () => 'Acme (acme.com) is a strong option for CRM.',
    });
    expect(out.engines.some((e) => e.method === 'llm_answer_probe')).toBe(true);
    expect(out.engines.some((e) => e.measurementStatus === 'estimated')).toBe(true);
    expect(out.engines.every((e) => e.measurementStatus !== 'measured')).toBe(true);
    expect(out.measurementStatus).toBe('estimated');
    expect(out.aggregateCitationRatePercent).toBeNull();
  });

  it('extracts missing third-party sources where competitors are named and brand is absent', async () => {
    const out = await runVisibilityRouter({
      domain: 'autotrader.co.uk',
      brand: 'AutoTrader',
      competitors: ['Carwow', 'Cazoo'],
      queries: ['best used car sites uk'],
      dfsPost: async () => ({
        ok: true,
        body: {
          tasks: [
            {
              result: [
                {
                  keyword: 'best used car sites uk',
                  answer: 'Carwow and Cazoo are top choices according to recent buyer roundups.',
                  mentioned: false,
                  sources: [
                    'https://www.wired.com/story/best-used-car-sites',
                    'https://www.trustpilot.com/review/carwow.co.uk',
                  ],
                },
              ],
            },
          ],
        },
      }),
    });

    expect(out.measurementStatus).toBe('measured');
    expect(out.missingSources).toHaveLength(2);
    const wired = out.missingSources.find((s) => s.domain === 'wired.com');
    const trustpilot = out.missingSources.find((s) => s.domain === 'trustpilot.com');
    expect(wired?.channel).toBe('roundup_listicle');
    expect(wired?.competitorsMentioned).toEqual(['Carwow', 'Cazoo']);
    expect(trustpilot?.channel).toBe('review_platform');
  });

  it('generates Prepare-mode 4-channel mention packs without em dashes and verifies brand_mention rechecks', () => {
    const channels = [
      'editorial_pr',
      'roundup_listicle',
      'review_platform',
      'community_forum',
    ] as const;
    for (const channel of channels) {
      const pack = offSiteMentionPackDraft({
        host: 'autotrader.co.uk',
        siteNameOrEvidence: 'AutoTrader',
        channel,
        targetHubDomain: 'ukfuels.co.uk',
        rivalName: 'Carwow',
      });
      expect(pack).toContain('AutoTrader');
      expect(pack).not.toContain('\u2014');
    }

    const passReading = readRecheck(
      '<html><body><p>Our roundup recommends AutoTrader for fuel-efficient cars.</p></body></html>',
      'https://ukfuels.co.uk/study',
      200,
      'brand_mention',
      'AutoTrader',
    );
    expect(passReading).toEqual({
      measured: true,
      passed: true,
      detail: 'Measured. The page mentions "AutoTrader".',
    });

    const failReading = readRecheck(
      '<html><body><p>Only Carwow is listed in this article.</p></body></html>',
      'https://ukfuels.co.uk/study',
      200,
      'brand_mention',
      'AutoTrader',
    );
    expect(failReading).toEqual({
      measured: true,
      passed: false,
      detail: 'Measured. The page does not mention "AutoTrader".',
    });
  });

  it('falls back to stored project competitors in getVisibilitySnapshot and enforces targetUrl + SSRF on brand_mention rechecks', async () => {
    const snap = await getVisibilitySnapshot(
      { projectId: 'proj_1', queries: ['best electric cars'] },
      {
        accountId: 'acct_1',
        canUsePaid: true,
        dataForSeoCredential: 'user:pass',
        getProject: async () => ({
          id: 'proj_1',
          domain: 'autotrader.co.uk',
          default_location_code: '2840',
          default_language_code: 'en',
        }),
        getCompetitors: async () => ['Carwow'],
        getResearchLog: async () => [],
        appendResearchLog: async () => {},
        dfsPost: async () => ({
          ok: true,
          status: 200,
          body: {
            tasks: [
              {
                result: [
                  {
                    keyword: 'best electric cars',
                    answer: 'Carwow is featured in the latest buyer guide.',
                    mentioned: false,
                    sources: ['https://www.pcmag.com/picks/best-ev-sites'],
                  },
                ],
              },
            ],
          },
        }),
      },
    );

    const missing = (snap.structuredContent?.missingSources as Array<{ domain: string; competitorsMentioned: string[] }>) || [];
    expect(missing).toHaveLength(1);
    expect(missing[0].domain).toBe('pcmag.com');
    expect(missing[0].competitorsMentioned).toEqual(['Carwow']);

    const kvStore = new Map<string, string>();
    const env = {
      LUMINARA_KV: {
        get: async (k: string) => kvStore.get(k) ?? null,
        put: async (k: string, v: string) => {
          kvStore.set(k, v);
        },
        delete: async (k: string) => {
          kvStore.delete(k);
        },
      } as unknown as KVNamespace,
      DAILY_QUOTA: memoryDailyQuotaNamespace(),
      FREE_DAILY_LIMIT: '3',
    } as Env;
    const user: HostedIdentity = { id: 'u1', source: 'firebase', accountId: 'acct_1' };

    // Missing targetUrl on brand_mention must NOT fall back to the user's own homepage
    const noTargetRes = await recheckOneFix(
      env,
      user,
      { domain: 'autotrader.co.uk', checkId: 'brand_mention', expect: 'AutoTrader' },
      async () => new Response('<html><body>AutoTrader homepage</body></html>', { status: 200 }),
    );
    expect(await noTargetRes.json()).toMatchObject({ ok: true, measured: false, passed: null });
    expect(await readFreeUsed(env, 'acct_1', 3)).toBe(0);

    // SSRF loopback targetUrl is rejected and quota refunded
    const ssrfRes = await recheckOneFix(
      env,
      user,
      {
        domain: 'autotrader.co.uk',
        checkId: 'brand_mention',
        expect: 'AutoTrader',
        targetUrl: 'http://127.0.0.1/admin',
      },
      async () => new Response('<html><body>AutoTrader</body></html>', { status: 200 }),
    );
    expect(await ssrfRes.json()).toMatchObject({ ok: true, measured: false, passed: null });
    expect(await readFreeUsed(env, 'acct_1', 3)).toBe(0);

    // Valid third-party public URL with DNS resolving to public IP passes and keeps spent check
    const validRes = await recheckOneFix(
      env,
      user,
      {
        domain: 'autotrader.co.uk',
        checkId: 'brand_mention',
        expect: 'AutoTrader',
        targetUrl: 'https://ukfuels.co.uk/study',
      },
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('cloudflare-dns.com')) {
          const isAaaa = url.includes('type=AAAA');
          const answer = isAaaa ? [] : [{ type: 1, data: '93.184.216.34' }];
          return new Response(JSON.stringify({ Status: 0, Answer: answer }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          '<html><body><article>AutoTrader partnered with UK Fuels on this study.</article></body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      },
    );
    expect(await validRes.json()).toMatchObject({
      ok: true,
      measured: true,
      passed: true,
      detail: 'Measured. The page mentions "AutoTrader".',
    });
    expect(await readFreeUsed(env, 'acct_1', 3)).toBe(1);
  });
});
