/**
 * ND0-2: a lasting drift is re-audited weekly, a change is audited the same day.
 * Driven through runSentinelScan (the function scheduled() calls) with a faked
 * clock, a fake KV, a stubbed search provider and a stubbed audit enqueue.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '../worker/env';

const enqueueAuditJob = vi.fn();
vi.mock('../worker/auditQueue', () => ({ enqueueAuditJob: (...args: unknown[]) => enqueueAuditJob(...args) }));
vi.mock('../worker/runProvenance', () => ({
  startRun: vi.fn(async () => ({ runId: 'run_sentinel' })),
  completeRun: vi.fn(async () => undefined),
}));

import { runSentinelScan, type SentinelTarget } from '../worker/sentinel';

const DAY = 24 * 3600 * 1000;
const START = Date.UTC(2026, 10, 1, 6, 0, 0);

type Search = 'cited' | 'not_cited' | 'fail';
let search: Search = 'not_cited';

function dnsOrProbe(url: string): Response {
  if (url.includes('cloudflare-dns.com')) {
    const body = { Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] };
    return { ok: true, status: 200, headers: { get: () => 'application/dns-json' }, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  }
  return { ok: true, url: url.replace(/^http:\/\//i, 'https://'), headers: { get: () => null }, text: async () => '', json: async () => ({}) } as unknown as Response;
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url || '');
      if (!url.includes('api.tavily.com')) return dnsOrProbe(url);
      if (search === 'fail') return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      const results =
        search === 'cited'
          ? [{ url: 'https://shop.example.com/page', content: 'rival is here' }]
          : [{ url: 'https://other.example.org/page', content: 'rival is here' }];
      return { ok: true, status: 200, json: async () => ({ results }) } as unknown as Response;
    }),
  );
}

function makeEnv() {
  const store = new Map<string, string>();
  const env = {
    TAVILY_API_KEY: 'test-key',
    LUMINARA_KV: {
      async get(key: string, type?: string) {
        const v = store.get(key);
        if (v === undefined) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      async put(key: string, value: string) {
        store.set(key, String(value));
      },
    },
  } as unknown as Env;
  const read = (): SentinelTarget => JSON.parse(store.get('sentinel:targets')!)[0];
  const write = (t: SentinelTarget) => store.set('sentinel:targets', JSON.stringify([t]));
  return { env, read, write };
}

function seedTarget(): SentinelTarget {
  return {
    id: 'sentinel-t1',
    ownerId: 'acct_owner',
    domain: 'shop.example.com',
    brandName: 'shop',
    keywords: ['what is shop'],
    competitorNames: ['Rival'],
    lastSecurityTrust: 40, // the stubbed probes score 40, so no regression unless a case raises it
  };
}

/** Runs one scan per entry on consecutive days and returns the days (1-based) that enqueued an audit. */
async function runDays(plan: Array<Search | { search: Search; trustWas?: number }>, ctx: ReturnType<typeof makeEnv>) {
  const audited: number[] = [];
  for (let i = 0; i < plan.length; i++) {
    const step = typeof plan[i] === 'string' ? { search: plan[i] as Search } : (plan[i] as { search: Search; trustWas?: number });
    vi.setSystemTime(START + i * DAY);
    search = step.search;
    if (step.trustWas !== undefined) ctx.write({ ...ctx.read(), lastSecurityTrust: step.trustWas });
    const before = enqueueAuditJob.mock.calls.length;
    await runSentinelScan(ctx.env);
    if (enqueueAuditJob.mock.calls.length > before) audited.push(i + 1);
  }
  return audited;
}

describe('sentinel re-audit cadence (ND0-2)', () => {
  let ctx: ReturnType<typeof makeEnv>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    stubFetch();
    enqueueAuditJob.mockReset();
    enqueueAuditJob.mockResolvedValue({ runId: 'aud_1', provenanceRunId: null });
    ctx = makeEnv();
    ctx.write(seedTarget());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('1. not cited for 8 daily scans audits on day 1 and day 8 only', async () => {
    expect(await runDays(Array(8).fill('not_cited'), ctx)).toEqual([1, 8]);
  });

  it('2. a trust regression on day 3 audits that day and day 4 stays quiet', async () => {
    const days = await runDays(['not_cited', 'not_cited', { search: 'not_cited', trustWas: 100 }, 'not_cited'], ctx);
    expect(days).toEqual([1, 3]);
  });

  it('3. cited on day 4 then not cited on day 5 audits on day 5', async () => {
    const days = await runDays(['not_cited', 'not_cited', 'not_cited', 'cited', 'not_cited'], ctx);
    expect(days).toEqual([1, 5]);
    expect(ctx.read().lastDriftKey).toBe('not_cited');
    expect(ctx.read().driftSince).toBe(START + 4 * DAY);
  });

  it('4. a failed provider on day 4 is no recovery and no competitor event', async () => {
    const days = await runDays(['not_cited', 'not_cited', 'not_cited', 'fail', 'not_cited'], ctx);
    expect(days).toEqual([1]);
    expect(ctx.read().lastDriftKey).toBe('not_cited');
    expect(ctx.read().driftSince).toBe(START);
    expect(ctx.read().lastCompetitorHits).toEqual({ Rival: true });
  });

  it('5. a healthy target never audits and carries no drift state', async () => {
    expect(await runDays(['cited', 'cited', 'cited'], ctx)).toEqual([]);
    expect(ctx.read().lastDriftKey).toBeUndefined();
    expect(ctx.read().lastAuditEnqueuedAt).toBeUndefined();
  });

  it('6. a missing queue leaves lastAuditEnqueuedAt unset and the next scan tries again', async () => {
    enqueueAuditJob.mockResolvedValue(null);
    expect(await runDays(['not_cited', 'not_cited'], ctx)).toEqual([1, 2]);
    expect(ctx.read().lastAuditEnqueuedAt).toBeUndefined();
  });
});
