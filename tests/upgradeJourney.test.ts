import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAuditScoutRun } from '../worker/auditScoutRun';
import { readFreeUsed } from '../worker/quotaMiddleware';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';
import type { Env } from '../worker/env';
import type { BoardFinding } from '../services/audit/findingBoardService';
import { setFindingStatusLocal } from '../services/audit/findingBoardService';
import { UpgradePrompt, UpgradeSurfaces } from '../components/upgrade/UpgradeSurfaces';
import { audPrice, competitorRankLine, dismissPrompt, easyFix, fixProgress, isPromptDismissed, lockedFeatures, lockedSample, recheckCelebration, recheckTarget, upgradePrompt, UPGRADE_DISMISS_KEY } from '../services/upgrade/upgradeJourney';
import { readRecheck } from '../services/upgrade/recheckReading';
import { approximateAudLabel, PAID_PLAN_PRICES } from '../components/paywall/planPrices';
import { NO_TAX_LINE, NOTHING_TO_CANCEL, WAITLIST_LINE } from '../components/paywall/planCopy';

const BOT_TOKEN = '123456:MOCK_TOKEN';

function signInitData(fields: Record<string, string>, token = BOT_TOKEN): string {
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function envFor(limit = '3') {
  const store = new Map<string, string>();
  const env = {
    LUMINARA_KV: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
    },
    DAILY_QUOTA: memoryDailyQuotaNamespace(),
    BOT_TOKEN,
    REQUIRE_TG_AUTH: 'true',
    FREE_DAILY_LIMIT: limit,
    WEBAPP_URL: 'https://luminarasuite.com',
  } as Env;
  return env;
}

function finding(partial: Partial<BoardFinding> & Pick<BoardFinding, 'id' | 'title' | 'severity'>): BoardFinding {
  return {
    domain: 'raywhite.com.au',
    stableKey: partial.id,
    category: 'content_quality',
    description: 'The homepage title does not name the agency.',
    status: 'open',
    ...partial,
  };
}

const TITLE_HTML = '<html><head><title>Ray White | Richmond</title></head><body><a href="/richmond">Richmond</a></body></html>';

describe('upgrade journey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prices the prompts in AUD with no tax and no urgency', () => {
    expect(audPrice('starter')).toBe(approximateAudLabel(PAID_PLAN_PRICES.starter.usdLabel));
    expect(audPrice('starter')).toBe('A$76');
    const kinds = ['quota', 'competitor', 'white_label', 'tracking'] as const;
    for (const kind of kinds) {
      const copy = `${upgradePrompt(kind).title} ${upgradePrompt(kind).body}`;
      expect(copy).toContain('A$');
      expect(copy).not.toMatch(/GST|countdown|hurry|last chance|are you sure|don't miss/i);
      expect(copy).toContain('30 days');
    }
    expect(upgradePrompt('quota').body).toContain(audPrice('starter'));
    expect(upgradePrompt('white_label').body).toContain(audPrice('agency'));
    expect(NO_TAX_LINE).not.toMatch(/GST/i);
    expect(NOTHING_TO_CANCEL).toContain('nothing to cancel');
    expect(WAITLIST_LINE).toContain('support@luminarasuite.com');
    expect(WAITLIST_LINE).not.toMatch(/card checkout/i);
  });

  it('picks the easy fix, celebrates only a measured pass, and dates a real streak', () => {
    const rows = [
      finding({ id: 'hard', title: 'Add schema', severity: 'critical' }),
      finding({ id: 'easy', title: 'Add the agency name to the homepage title', severity: 'low' }),
    ];
    expect(easyFix(rows)?.id).toBe('easy');
    expect(recheckTarget(rows[1], 'Ray White')).toEqual({ checkId: 'title', expect: 'Ray White' });
    expect(recheckTarget(rows[1], null)).toBeNull();
    expect(recheckCelebration({ measured: false, passed: null })).toContain('Not measured');
    expect(recheckCelebration({ measured: true, passed: false })).toContain('still fails');
    expect(recheckCelebration({ measured: true, passed: true })).toBe('This check passed on the page we just fetched.');
    expect(fixProgress([{ status: 'done', doneOn: '2026-10-21' }, { status: 'done', doneOn: '2026-10-22' }, { status: 'open' }], '2026-10-22')).toEqual({
      done: 2,
      streak: 2,
      label: '2 fixes done. 2 day streak.',
    });
    expect(fixProgress([{ status: 'done' }], '2026-10-22').streak).toBe(0);
    expect(competitorRankLine()).toBe('Competitor rank: Not measured.');
    expect(lockedFeatures('free')).toContain('suburb');
    expect(lockedSample('competitor').rows[0]).toContain('SAMPLE');
    expect(lockedSample('competitor').rows.join(' ')).not.toContain('Ray White');
  });

  it('reads one homepage check and does not invent a pass', () => {
    expect(readRecheck(TITLE_HTML, 'https://raywhite.com.au/', 200, 'title', 'Ray White').passed).toBe(true);
    expect(readRecheck(TITLE_HTML, 'https://raywhite.com.au/', 200, 'title', 'Other Agency').passed).toBe(false);
    expect(readRecheck('', 'https://raywhite.com.au/', 200, 'title', 'Ray White').measured).toBe(false);
    expect(readRecheck(TITLE_HTML, 'https://raywhite.com.au/', 403, 'schema').measured).toBe(false);
  });

  it('renders the prompt and the sample card without presenting the sample as the user', () => {
    const html = renderToStaticMarkup(createElement(UpgradeSurfaces, {
      domain: 'raywhite.com.au',
      findings: [finding({ id: 'easy', title: 'Add the agency name to the homepage title', severity: 'low' })],
    }));
    expect(html).toContain('One easy fix');
    expect(html).toContain('Recheck this fix');
    expect(html).toContain('SAMPLE');
    expect(html).toContain('This is not your data.');
    expect(html).toContain('Competitor rank: Not measured.');
    expect(html).not.toContain('**');
    const quota = renderToStaticMarkup(createElement(UpgradePrompt, { kind: 'quota' }));
    expect(quota).toContain('A$76');
    expect(quota).toContain('Not now');
    expect(quota).toContain('See plans');
  });

  it('dismisses a prompt into the workspace bag and keeps a done day on the findings board', () => {
    const local = new Map<string, string>();
    const session = new Map<string, string>();
    const store = (bag: Map<string, string>) => ({
      getItem: (key: string) => bag.get(key) ?? null,
      setItem: (key: string, value: string) => { bag.set(key, value); },
      removeItem: (key: string) => { bag.delete(key); },
    });
    vi.stubGlobal('localStorage', store(local));
    vi.stubGlobal('sessionStorage', store(session));
    dismissPrompt('competitor', store(local), '2026-10-22');
    expect(isPromptDismissed('competitor', local.get(UPGRADE_DISMISS_KEY) ?? null, '2026-10-23')).toBe(true);
    dismissPrompt('quota', store(local), '2026-10-22');
    expect(isPromptDismissed('quota', local.get(UPGRADE_DISMISS_KEY) ?? null, '2026-10-22')).toBe(true);
    expect(isPromptDismissed('quota', local.get(UPGRADE_DISMISS_KEY) ?? null, '2026-10-23')).toBe(false);
    const saved = setFindingStatusLocal('raywhite.com.au', [finding({ id: 'easy', title: 'Add the agency name', severity: 'low' })], 'easy', 'done');
    expect(saved[0].status).toBe('done');
    expect(saved[0].doneOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('recheck spends one check', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function dns(url: string): Response | null {
    if (!url.includes('cloudflare-dns.com')) return null;
    const type = url.includes('type=AAAA') ? 28 : 1;
    const data = type === 1 ? '8.8.8.8' : '';
    const answer = data ? [{ type, data }] : [];
    return new Response(JSON.stringify({ Status: 0, Answer: answer }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  it('keeps the check when the title is measured and refunds it when the page is missing', async () => {
    const env = envFor();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return dns(url) || new Response(TITLE_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const pass = await handleAuditScoutRun(new Request('https://luminarasuite.com/api/audit/scout-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 11, first_name: 'Ada' }) }) },
      body: JSON.stringify({ recheck: true, domain: 'raywhite.com.au', checkId: 'title', expect: 'Ray White' }),
    }), env);
    const passBody = await pass.json() as { measured: boolean; passed: boolean };
    expect(passBody.measured).toBe(true);
    expect(passBody.passed).toBe(true);
    expect(await readFreeUsed(env, '11', 3)).toBe(1);

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return dns(url) || new Response('nope', { status: 500 });
    }) as typeof fetch;
    const miss = await handleAuditScoutRun(new Request('https://luminarasuite.com/api/audit/scout-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 11, first_name: 'Ada' }) }) },
      body: JSON.stringify({ recheck: true, domain: 'raywhite.com.au', checkId: 'title', expect: 'Ray White' }),
    }), env);
    const missBody = await miss.json() as { measured: boolean };
    expect(missBody.measured).toBe(false);
    expect(await readFreeUsed(env, '11', 3)).toBe(1);
  });
});
