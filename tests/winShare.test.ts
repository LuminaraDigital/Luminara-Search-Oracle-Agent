import { createHmac } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UpgradeSurfaces } from '../components/upgrade/UpgradeSurfaces';
import { WinSharePanel } from '../components/share/WinSharePanel';
import { PastReports } from '../components/audit/PastReports';
import { recordAudit } from '../services/audit/auditHistoryService';
import {
  parseWinCreate,
  shareIntent,
  trackedWinUrl,
  winEligibility,
  winPostText,
  publicWin,
  WIN_CTA,
  WIN_FOOTER,
} from '../services/share/winShare';
import { rememberWinShare } from '../services/share/winShareClient';
import { handleShareRoute } from '../worker/shareService';
import { maybeServeWinHtml } from '../worker/winShare';
import { WIN_PNG_HEIGHT, WIN_PNG_WIDTH } from '../worker/winPng';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';

const BOT_TOKEN = '123456:WIN_TEST';
const FINDING = 'Secret roof leak in the evidence drawer';

function signInitData(userId: number): string {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Agent' }),
  };
  const dcs = Object.keys(fields).sort().map((key) => `${key}=${fields[key as keyof typeof fields]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function env(): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as unknown as KVNamespace,
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    BOT_TOKEN,
  } as Env;
}

function publish(target: Env, userId: number, body: Record<string, unknown>) {
  return handleShareRoute(
    new Request('https://luminarasuite.com/api/wins', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(userId) },
      body: JSON.stringify(body),
    }),
    target,
    '/wins',
  );
}

describe('win eligibility', () => {
  it('stays closed for an unmeasured run, a failed run, and a failed recheck', () => {
    expect(winEligibility({ measured: false, reportText: 'passed 4 of 4 checks', recheckPassed: false, fixesDone: 1 })).toBeNull();
    expect(winEligibility({ measured: true, reportText: 'passed 2 of 4 checks', recheckPassed: false, fixesDone: 1 })).toBeNull();
    expect(winEligibility({ measured: true, reportText: 'no count here', recheckPassed: false, fixesDone: 0 })).toBeNull();
    expect(winEligibility({ measured: false, reportText: '', recheckPassed: false, fixesDone: 3 })).toBeNull();
  });

  it('stays closed when the page-health line still has an unmeasured check', () => {
    expect(winEligibility({
      measured: true,
      reportText: 'Right now, your site passed 3 of 4; 1 not measured this run made.',
      recheckPassed: false,
      fixesDone: 1,
    })).toBeNull();
    expect(winEligibility({
      measured: true,
      reportText: 'Right now, your site passed 4 of 4; 0 not measured this run made.',
      recheckPassed: false,
      fixesDone: 0,
    })).toEqual({ kind: 'score', passed: 4, total: 4, fixesDone: 0 });
  });

  it('opens for a measured pass at 3 of 4, or a measured recheck pass', () => {
    expect(winEligibility({ measured: true, reportText: 'passed 3 of 4 checks', recheckPassed: false, fixesDone: 2 })).toEqual({
      kind: 'score',
      passed: 3,
      total: 4,
      fixesDone: 2,
    });
    expect(winEligibility({ measured: false, reportText: 'passed 1 of 4 checks', recheckPassed: true, fixesDone: 1 })).toEqual({
      kind: 'improvement',
      fixesDone: 1,
    });
    const text = winPostText({
      win: publicWin({ agencyName: 'Ray White', claim: { kind: 'score', passed: 3, total: 4, fixesDone: 2 }, hideScore: false, createdAt: Date.parse('2026-10-22T00:00:00Z') }),
      claim: { kind: 'score', passed: 3, total: 4, fixesDone: 2 },
      link: 'https://luminarasuite.com/win/abc',
    });
    expect(text).toBe('We just checked how AI search sees Ray White: passed 3 of 4 checks. Fixed 2 issues. Free check: https://luminarasuite.com/win/abc');
    expect(text).not.toMatch(/amazing|guaranteed|hurry|countdown|limited time|GST/i);
    expect(shareIntent('linkedin', 'https://luminarasuite.com/win/abc', text)).toBe(
      'https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fluminarasuite.com%2Fwin%2Fabc',
    );
    expect(shareIntent('x', 'https://luminarasuite.com/win/abc', 'Hello')).toContain('https://x.com/intent/post?text=');
    expect(trackedWinUrl('https://luminarasuite.com/win/abc', 'linkedin')).toContain('utm_source=linkedin');
    expect(trackedWinUrl('https://luminarasuite.com/win/abc', 'linkedin')).toContain('utm_campaign=win');
  });

  it('refuses findings and a score under the threshold', () => {
    expect(parseWinCreate({ kind: 'score', passed: 3, total: 4, fixesDone: 1, hideScore: false, findings: [FINDING] }).ok).toBe(false);
    expect(parseWinCreate({ kind: 'score', passed: 2, total: 4, fixesDone: 0, hideScore: false }).ok).toBe(false);
    expect(parseWinCreate({ kind: 'score', passed: 3, total: 4, agencyName: 'raywhite.com.au', hideScore: true }).ok).toBe(true);
  });
});

describe('win page', () => {
  it('publishes only the public fields, then revoke removes the page', async () => {
    const target = env();
    const anon = await handleShareRoute(
      new Request('https://luminarasuite.com/api/wins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'score', passed: 4, total: 4, hideScore: false, agencyName: 'Ray White' }),
      }),
      target,
      '/wins',
    );
    expect(anon.status).toBe(401);
    const denied = await publish(target, 11, {
      kind: 'score',
      passed: 3,
      total: 4,
      fixesDone: 1,
      hideScore: false,
      agencyName: 'Ray White',
      findings: [FINDING],
      evidence: 'private',
    });
    expect(denied.status).toBe(400);
    expect(await target.DB!.prepare('SELECT COUNT(*) AS n FROM win_shares').first<{ n: number }>()).toEqual({ n: 0 });

    const created = await publish(target, 11, {
      kind: 'score',
      passed: 3,
      total: 4,
      fixesDone: 1,
      hideScore: false,
      agencyName: 'Ray White',
    });
    expect(created.status).toBe(200);
    const body = await created.json() as { id: string; url: string };
    const page = await maybeServeWinHtml(new Request(body.url), target);
    const html = await page!.text();
    expect(html).toContain('Ray White');
    expect(html).toContain('Passed 3 of 4 checks');
    expect(html).toContain(WIN_FOOTER);
    expect(html).toContain(WIN_CTA);
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('index, follow');
    expect(html).not.toContain(FINDING);
    expect(html).not.toMatch(/evidence|how to fix|finding/i);
    const views = await target.DB!.prepare(
      `SELECT event_type, path FROM product_analytics_events WHERE event_type = 'share_page_view'`,
    ).all<{ event_type: string; path: string }>();
    expect(views.results).toEqual([{ event_type: 'share_page_view', path: `/win/${body.id}` }]);

    const image = await maybeServeWinHtml(new Request(`${body.url}/og.png`), target);
    const png = new Uint8Array(await image!.arrayBuffer());
    expect(png[0]).toBe(137);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(WIN_PNG_WIDTH);
    expect(view.getUint32(20)).toBe(WIN_PNG_HEIGHT);
    expect(Buffer.from(png).includes(Buffer.from(FINDING))).toBe(false);
    const idatAt = Buffer.from(png).indexOf('IDAT');
    const idatLength = view.getUint32(idatAt - 4);
    expect(inflateSync(Buffer.from(png.subarray(idatAt + 4, idatAt + 4 + idatLength))).byteLength).toBeGreaterThan(1000);

    const hidden = await publish(target, 11, {
      kind: 'score',
      passed: 4,
      total: 4,
      fixesDone: 0,
      hideScore: true,
      agencyName: 'Ray White',
    });
    const hiddenBody = await hidden.json() as { url: string };
    const hiddenHtml = await (await maybeServeWinHtml(new Request(hiddenBody.url), target))!.text();
    expect(hiddenHtml).not.toContain('4 of 4');
    expect(hiddenHtml).toContain(WIN_FOOTER);

    const stranger = await handleShareRoute(
      new Request(`https://luminarasuite.com/api/wins/${body.id}`, {
        method: 'DELETE',
        headers: { 'x-telegram-init-data': signInitData(99) },
      }),
      target,
      `/wins/${body.id}`,
    );
    expect(stranger.status).toBe(404);
    expect((await maybeServeWinHtml(new Request(body.url), target))!.status).toBe(200);

    const revoked = await handleShareRoute(
      new Request(`https://luminarasuite.com/api/wins/${body.id}`, {
        method: 'DELETE',
        headers: { 'x-telegram-init-data': signInitData(11) },
      }),
      target,
      `/wins/${body.id}`,
    );
    expect(revoked.status).toBe(200);
    const gone = await maybeServeWinHtml(new Request(body.url), target);
    const goneHtml = await gone!.text();
    expect(gone!.status).toBe(404);
    expect(goneHtml).not.toContain('Ray White');
    expect(goneHtml).not.toContain(FINDING);
  });
});

describe('win panel', () => {
  it('renders the preview only for a qualifying result', () => {
    const closed = renderToStaticMarkup(createElement(UpgradeSurfaces, {
      domain: 'example.com.au',
      findings: [],
      measured: true,
      reportText: 'passed 2 of 4 checks',
    }));
    expect(closed).not.toContain('Share your win');
    const open = renderToStaticMarkup(createElement(WinSharePanel, {
      domain: 'example.com.au',
      claim: { kind: 'score', passed: 3, total: 4, fixesDone: 1 },
    }));
    expect(open).toContain('Share your win');
    expect(open).toContain('Hide the score');
    expect(open).toContain('LinkedIn');
    expect(open).toContain('Copy link');
    expect(open).toContain('passed 3 of 4 checks');
    expect(open).toContain('This agency');
    expect(open).not.toContain(FINDING);
    const local = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => { local.set(key, value); },
      removeItem: (key: string) => { local.delete(key); },
    });
    const entry = recordAudit({ domain: 'example.com.au', focus: 'audit', reportText: 'passed 3 of 4 checks on a long enough line for the summary store' });
    rememberWinShare(entry.id, 'a'.repeat(32));
    const past = renderToStaticMarkup(createElement(PastReports, { onOpen: () => {} }));
    expect(past).toContain('Revoke public page');
    expect(past).not.toContain(FINDING);
  });
});
