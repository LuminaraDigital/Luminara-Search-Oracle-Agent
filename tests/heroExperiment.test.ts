import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJsonc } from '../scripts/lib/jsonc.mjs';
import { heroVariantInBrowser, signupHeroData } from '../services/marketing/heroExperimentClient';
import {
  HERO_AB_COOKIE,
  HERO_AB_MAX_AGE_SEC,
  assignHomeHero,
  claimHeroExposure,
  heroSetCookie,
  heroVariantFromCookie,
} from '../services/marketing/heroExperiment';
import { ANSWER_HERO, HOME_HERO } from '../services/marketing/marketingHeroCopy';
import { handleAuditScoutRun } from '../worker/auditScoutRun';
import type { Env } from '../worker/env';
import { ingestProductAnalytics } from '../worker/productAnalytics';
import { maybeServeMarketingHtml } from '../worker/marketingShell';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';
import { createSqliteD1 } from './helpers/sqliteD1';

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const SHELL = `<!DOCTYPE html><html lang="en"><head><title>Old</title></head><body><div id="root"></div></body></html>`;

const assets = {
  fetch: async () => new Response(SHELL, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
} as unknown as Fetcher;

function homeRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers: { accept: 'text/html', 'user-agent': BROWSER, ...headers } });
}

function enabledEnv(flag = 'true'): { HERO_AB_ENABLED: string } {
  return { HERO_AB_ENABLED: flag };
}

describe('hero assignment', () => {
  it('splits a new browser 50/50 and sets the cookie once', () => {
    const answer = assignHomeHero({
      enabled: true,
      cookieHeader: null,
      heroQuery: null,
      userAgent: BROWSER,
      random: () => 0,
    });
    const employee = assignHomeHero({
      enabled: true,
      cookieHeader: null,
      heroQuery: null,
      userAgent: BROWSER,
      random: () => 0.5,
    });
    expect(answer).toEqual({ variant: 'answer', setCookie: heroSetCookie('answer') });
    expect(employee).toEqual({ variant: 'employee', setCookie: heroSetCookie('employee') });
    expect(heroSetCookie('answer')).toBe(
      `${HERO_AB_COOKIE}=answer; Max-Age=${HERO_AB_MAX_AGE_SEC}; Path=/; SameSite=Lax; Secure`,
    );
    expect(heroSetCookie('answer')).not.toContain('HttpOnly');
    expect(HERO_AB_MAX_AGE_SEC).toBe(180 * 24 * 60 * 60);

    const again = assignHomeHero({
      enabled: true,
      cookieHeader: 'theme=dark; lx_hero=answer; session=abc',
      heroQuery: null,
      userAgent: BROWSER,
      random: () => 0.99,
    });
    expect(again).toEqual({ variant: 'answer', setCookie: null });
    expect(heroVariantFromCookie('lx_hero=employee')).toBe('employee');
  });

  it('replaces the cookie for a QA override and ignores any other query value', () => {
    const override = assignHomeHero({
      enabled: true,
      cookieHeader: 'lx_hero=employee',
      heroQuery: 'ANSWER',
      userAgent: BOT,
      random: () => 0,
    });
    expect(override).toEqual({ variant: 'answer', setCookie: heroSetCookie('answer') });
    const ignored = assignHomeHero({
      enabled: true,
      cookieHeader: 'lx_hero=employee',
      heroQuery: 'nope',
      userAgent: BROWSER,
      random: () => 0,
    });
    expect(ignored).toEqual({ variant: 'employee', setCookie: null });
  });

  it('keeps employee and writes nothing when the flag is off', () => {
    const off = assignHomeHero({
      enabled: false,
      cookieHeader: 'lx_hero=answer',
      heroQuery: 'answer',
      userAgent: BROWSER,
      random: () => 0,
    });
    expect(off).toEqual({ variant: 'employee', setCookie: null });
  });

  it('does not assign a crawler, and does assign an invalid cookie', () => {
    const bot = assignHomeHero({
      enabled: true,
      cookieHeader: null,
      heroQuery: null,
      userAgent: BOT,
      random: () => 0,
    });
    const blank = assignHomeHero({
      enabled: true,
      cookieHeader: null,
      heroQuery: null,
      userAgent: '   ',
      random: () => 0,
    });
    expect(bot.setCookie).toBeNull();
    expect(blank.setCookie).toBeNull();
    expect(bot.variant).toBe('employee');
    const invalid = assignHomeHero({
      enabled: true,
      cookieHeader: 'lx_hero=nope',
      heroQuery: null,
      userAgent: BROWSER,
      random: () => 0,
    });
    expect(invalid.variant).toBe('answer');
    expect(invalid.setCookie).toBe(heroSetCookie('answer'));
  });

  it('serves the same headline from the cookie, the override, and the kill switch', async () => {
    const held = await maybeServeMarketingHtml(
      homeRequest('https://staging.luminarasuite.com/', { cookie: 'lx_hero=answer' }),
      assets,
      enabledEnv(),
    );
    expect(held?.headers.get('set-cookie')).toBeNull();
    expect(held?.headers.get('cache-control')).toBe('private, no-store');
    const heldHtml = await held!.text();
    expect(heldHtml).toContain(ANSWER_HERO.titleLead);
    expect(heldHtml).toContain(ANSWER_HERO.titleEm);
    expect(heldHtml).toContain('data-variant="answer"');
    expect(heldHtml).toContain('data-hero-ab="on"');
    expect(heldHtml.match(/<h1\b/g)).toHaveLength(1);

    const override = await maybeServeMarketingHtml(
      homeRequest('https://staging.luminarasuite.com/?hero=employee', { cookie: 'lx_hero=answer' }),
      assets,
      enabledEnv(),
    );
    expect(override?.headers.get('set-cookie')).toBe(heroSetCookie('employee'));
    expect(await override!.text()).toContain(HOME_HERO.titleLead);

    const killed = await maybeServeMarketingHtml(
      homeRequest('https://staging.luminarasuite.com/?hero=answer', { cookie: 'lx_hero=answer' }),
      assets,
      enabledEnv('false'),
    );
    expect(killed?.headers.get('set-cookie')).toBeNull();
    expect(killed?.headers.get('cache-control')).toBe('no-cache');
    const killedHtml = await killed!.text();
    expect(killedHtml).toContain(HOME_HERO.titleLead);
    expect(killedHtml).not.toContain(ANSWER_HERO.titleLead);
    expect(killedHtml).toContain('data-hero-ab="off"');

    const bot = await maybeServeMarketingHtml(
      homeRequest('https://staging.luminarasuite.com/', { 'user-agent': BOT }),
      assets,
      enabledEnv(),
    );
    expect(bot?.headers.get('set-cookie')).toBeNull();
    expect(await bot!.text()).not.toContain(ANSWER_HERO.titleLead);

    const fresh = await maybeServeMarketingHtml(homeRequest('https://staging.luminarasuite.com/'), assets, enabledEnv());
    const set = fresh?.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/^lx_hero=(answer|employee); Max-Age=\d+; Path=\/; SameSite=Lax; Secure$/);
    const painted = set.startsWith('lx_hero=answer') ? ANSWER_HERO.titleLead : HOME_HERO.titleLead;
    expect(await fresh!.text()).toContain(painted);

    const pricing = await maybeServeMarketingHtml(
      homeRequest('https://staging.luminarasuite.com/pricing'),
      assets,
      enabledEnv(),
    );
    expect(pricing?.headers.get('set-cookie')).toBeNull();
    expect(pricing?.headers.get('cache-control')).toBe('no-cache');
    const pricingHtml = await pricing!.text();
    expect(pricingHtml).not.toContain('data-variant=');
    expect(pricingHtml).toContain('data-hero-ab="on"');

    const head = await maybeServeMarketingHtml(
      new Request('https://staging.luminarasuite.com/', { method: 'HEAD', headers: { accept: 'text/html', 'user-agent': BROWSER } }),
      assets,
      enabledEnv(),
    );
    expect(head?.status).toBe(200);
    expect(head?.headers.get('set-cookie')).toMatch(/^lx_hero=(answer|employee);/);
    expect(await head!.text()).toBe('');
  });

  it('ships the flag on in staging and off in production', () => {
    const wrangler = parseJsonc(readFileSync(resolve(__dirname, '..', 'wrangler.jsonc'), 'utf8')) as {
      vars: Record<string, string>;
      env: { staging: { vars: Record<string, string> }; production: { vars: Record<string, string> } };
    };
    expect(wrangler.vars.HERO_AB_ENABLED).toBe('false');
    expect(wrangler.env.production.vars.HERO_AB_ENABLED).toBe('false');
    expect(wrangler.env.staging.vars.HERO_AB_ENABLED).toBe('true');
  });
});

describe('hero exposure claim', () => {
  it('sends one exposure per variant and none while the experiment is off', () => {
    expect(claimHeroExposure({ experimentOn: false, variant: 'answer', seen: null })).toBeNull();
    expect(claimHeroExposure({ experimentOn: true, variant: 'employee', seen: null })).toBe('employee');
    expect(claimHeroExposure({ experimentOn: true, variant: 'employee', seen: 'employee' })).toBeNull();
    expect(claimHeroExposure({ experimentOn: true, variant: 'answer', seen: 'employee' })).toBe('answer');
  });
});

describe('hero events', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the variant to signup only while the experiment is on', () => {
    vi.stubGlobal('document', { cookie: 'lx_hero=answer', documentElement: { dataset: { heroAb: 'on' } } });
    expect(heroVariantInBrowser()).toBe('answer');
    expect(signupHeroData()).toEqual({ variant: 'answer' });
    vi.stubGlobal('document', { cookie: '', documentElement: { dataset: { heroAb: 'on' } } });
    expect(heroVariantInBrowser()).toBe('employee');
    expect(signupHeroData()).toEqual({ variant: 'employee' });
    vi.stubGlobal('document', { cookie: 'lx_hero=answer', documentElement: { dataset: {} } });
    expect(heroVariantInBrowser()).toBe('employee');
    expect(signupHeroData()).toEqual({});
  });

  it('stores hero_exposed through the allowlist and drops an email field', async () => {
    const db = createSqliteD1();
    const env = { DB: db } as Env;
    const res = await ingestProductAnalytics(new Request('https://staging.luminarasuite.com/api/analytics/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        events: [
          { type: 'hero_exposed', path: '/', data: { variant: 'answer', email: 'secret@example.com' } },
          { type: 'not_a_real_event', data: { variant: 'answer' } },
          { type: 'signup_completed', data: { method: 'email', variant: 'employee' } },
        ],
      }),
    }), env, null);
    expect(await res.json()).toMatchObject({ ok: true, inserted: 2 });
    const rows = await db.prepare(
      `SELECT event_type, payload_json, account_id FROM product_analytics_events ORDER BY event_type`,
    ).all<{ event_type: string; payload_json: string; account_id: string | null }>();
    const stored = rows.results;
    expect(stored.map((row) => row.event_type)).toEqual(['hero_exposed', 'signup_completed']);
    expect(stored[0].payload_json).toContain('"variant":"answer"');
    expect(stored[0].payload_json).not.toContain('secret@example.com');
    expect(stored[0].payload_json).not.toContain('email');
    expect(stored[1].payload_json).toContain('"variant":"employee"');
  });

  it('records instant_audit_started with the variant when a scout run is minted', async () => {
    const { env, db } = scoutEnv('true');
    const minted = await handleAuditScoutRun(scoutRequest('lx_hero=answer', { domain: 'https://movida.com.au' }), env);
    expect(minted.status).toBe(200);
    expect((await minted.json() as { token?: string }).token).toBeTruthy();
    const row = await db.prepare(
      `SELECT payload_json, account_id FROM product_analytics_events WHERE event_type = 'instant_audit_started'`,
    ).first<{ payload_json: string; account_id: string | null }>();
    expect(row).toEqual({ payload_json: '{"variant":"answer"}', account_id: null });

    const fallback = await handleAuditScoutRun(scoutRequest(null, { domain: 'https://movida.com.au' }), env);
    expect(fallback.status).toBe(200);
    const both = await db.prepare(
      `SELECT payload_json FROM product_analytics_events WHERE event_type = 'instant_audit_started' ORDER BY created_at`,
    ).all<{ payload_json: string }>();
    expect(both.results.map((item) => item.payload_json).sort()).toEqual([
      '{"variant":"answer"}',
      '{"variant":"employee"}',
    ]);

    const off = scoutEnv('false');
    const silent = await handleAuditScoutRun(scoutRequest('lx_hero=answer', { domain: 'https://movida.com.au' }), off.env);
    expect(silent.status).toBe(200);
    const none = await off.db.prepare(
      `SELECT COUNT(*) AS n FROM product_analytics_events WHERE event_type = 'instant_audit_started'`,
    ).first<{ n: number }>();
    expect(none).toEqual({ n: 0 });
  });

  it('runs the owner readout query from the runbook', async () => {
    const doc = readFileSync(resolve(__dirname, '..', 'docs/runbooks/hero-ab.md'), 'utf8');
    const sql = doc.match(/```sql\n([\s\S]*?)```/)?.[1];
    if (!sql) throw new Error('runbook SQL missing');
    const db = createSqliteD1();
    const insert = (type: string, variant: string | null) => db.prepare(
      `INSERT INTO product_analytics_events
        (id, account_id, session_id, event_type, path, payload_json, created_at)
       VALUES (?, NULL, NULL, ?, '/', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      type,
      variant ? JSON.stringify({ variant }) : '{}',
      Date.now(),
    ).run();
    for (let i = 0; i < 4; i += 1) await insert('hero_exposed', 'answer');
    await insert('instant_audit_started', 'answer');
    await insert('signup_completed', 'answer');
    await insert('signup_completed', 'employee');
    await insert('page_view', 'answer');
    await insert('hero_exposed', null);
    const rows = await db.prepare(sql).all<{
      variant: string;
      exposures: number;
      audits_started: number;
      signups: number;
      signup_per_exposure: number | null;
    }>();
    const byVariant = Object.fromEntries(rows.results.map((row) => [row.variant, row]));
    expect(byVariant.answer).toMatchObject({
      exposures: 4,
      audits_started: 1,
      signups: 1,
      signup_per_exposure: 0.25,
    });
    expect(byVariant.employee).toMatchObject({
      exposures: 0,
      audits_started: 0,
      signups: 1,
      signup_per_exposure: null,
    });
  });
});

const BOT_TOKEN = '123456:HERO_TEST';

function signInitData(id: number): string {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Ada' }),
  };
  const dcs = Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function memoryKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function scoutEnv(flag: string) {
  const db = createSqliteD1();
  const env = {
    LUMINARA_KV: memoryKv(),
    DAILY_QUOTA: memoryDailyQuotaNamespace(),
    DB: db,
    BOT_TOKEN,
    REQUIRE_TG_AUTH: 'true',
    FREE_DAILY_LIMIT: '25',
    WEBAPP_URL: 'https://staging.luminarasuite.com',
    HERO_AB_ENABLED: flag,
  } as Env;
  return { env, db };
}

function scoutRequest(cookie: string | null, body: Record<string, unknown>): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-telegram-init-data': signInitData(11),
  };
  if (cookie) headers.cookie = cookie;
  return new Request('https://staging.luminarasuite.com/api/audit/scout-run', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}
