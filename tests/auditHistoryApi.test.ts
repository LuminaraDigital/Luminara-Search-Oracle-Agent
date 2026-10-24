import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAuditHistoryRoute } from '../worker/auditHistoryRoute';
import { eraseAccountRows } from '../worker/privacyService';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:AUDIT_HISTORY_TEST';
const ORIGIN = 'https://luminarasuite.com';

function initDataFor(userId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Owner' }),
  };
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}

function makeEnv(): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    DB: createSqliteD1(),
    WEBAPP_URL: `${ORIGIN}/`,
    ALLOWED_ORIGINS: ORIGIN,
    BOT_TOKEN: botToken,
  } as Env;
}

function entry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    domain: 'https://www.Acme.example/pricing',
    focus: 'AEO',
    measuredAt: 1_760_000_000_000,
    healthScore: 72,
    citationRatePercent: null,
    schemaGapCount: 2,
    topCompetitor: null,
    competitorsMentioned: ['Rival'],
    title: 'AEO audit · acme.example',
    summary: 'Organization schema is missing on the home page.',
    reportExcerpt: '# Report\n\nHealth Score: 72/100',
    clientId: null,
    tags: ['aeo', 'acme.example'],
    ...overrides,
  };
}

async function call(env: Env, userId: number | null, method: string, query = '', body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (userId !== null) headers['x-telegram-init-data'] = initDataFor(userId);
  const res = await handleAuditHistoryRoute(
    new Request(`${ORIGIN}/api/audits/history${query}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as any };
}

describe('audit history API (D1)', () => {
  it('refuses callers who are not signed in', async () => {
    const env = makeEnv();
    expect((await call(env, null, 'GET')).status).toBe(401);
    expect((await call(env, null, 'PUT', '', { entry: entry('audit-1') })).status).toBe(401);
  });

  it('upserts by id, keeps the first measuredAt, and lists newest first', async () => {
    const env = makeEnv();
    const first = await call(env, 42, 'PUT', '', { entry: entry('audit-1') });
    expect(first.status).toBe(200);
    expect(first.body.entry.domain).toBe('acme.example');

    await call(env, 42, 'PUT', '', { entry: entry('audit-2', { measuredAt: 1_760_000_100_000 }) });
    const resave = await call(env, 42, 'PUT', '', {
      entry: entry('audit-1', { measuredAt: 1_760_000_900_000, summary: 'Updated summary' }),
    });
    expect(resave.body.entry.measuredAt).toBe(1_760_000_000_000);
    expect(resave.body.entry.summary).toBe('Updated summary');

    const list = await call(env, 42, 'GET');
    expect(list.status).toBe(200);
    expect(list.body.entries.map((e: { id: string }) => e.id)).toEqual(['audit-2', 'audit-1']);
    expect(list.body.entries[1].reportExcerpt).toContain('Health Score: 72/100');

    const limited = await call(env, 42, 'GET', '?limit=1');
    expect(limited.body.entries).toHaveLength(1);
    const byDomain = await call(env, 42, 'GET', '?domain=other.example');
    expect(byDomain.body.entries).toHaveLength(0);
  });

  it('keeps each account to its own rows, even for the same audit id', async () => {
    const env = makeEnv();
    await call(env, 42, 'PUT', '', { entry: entry('audit-1') });
    await call(env, 77, 'PUT', '', { entry: entry('audit-1', { summary: 'Second account' }) });
    const mine = await call(env, 42, 'GET');
    const theirs = await call(env, 77, 'GET');
    expect(mine.body.entries).toHaveLength(1);
    expect(mine.body.entries[0].summary).toBe('Organization schema is missing on the home page.');
    expect(theirs.body.entries[0].summary).toBe('Second account');
  });

  it('rejects bad entries and does not store keys the client made up', async () => {
    const env = makeEnv();
    expect((await call(env, 42, 'PUT', '', {})).status).toBe(400);
    expect((await call(env, 42, 'PUT', '', { entry: entry('bad id with spaces') })).status).toBe(400);
    expect((await call(env, 42, 'PUT', '', { entry: entry('audit-1', { domain: '' }) })).status).toBe(400);
    expect((await call(env, 42, 'PUT', '', { entry: entry('audit-1', { measuredAt: 'today' }) })).status).toBe(400);
    expect((await call(env, 42, 'PUT', '', { entry: entry('audit-1', { reportExcerpt: 'x'.repeat(80_001) }) })).status).toBe(400);

    const saved = await call(env, 42, 'PUT', '', { entry: entry('audit-1', { injected: '<script>' }) });
    expect(saved.status).toBe(200);
    expect(saved.body.entry).not.toHaveProperty('injected');
  });

  it('keeps the newest 500 rows per account', async () => {
    const env = makeEnv();
    await call(env, 42, 'PUT', '', { entry: entry('audit-seed') });
    const accountId = (await env.DB!.prepare(`SELECT account_id FROM audit_history`).first<{ account_id: string }>())!.account_id;
    for (let i = 0; i < 500; i += 1) {
      await env.DB!.prepare(
        `INSERT INTO audit_history (account_id, id, domain, measured_at, entry_json, updated_at) VALUES (?, ?, 'acme.example', ?, '{}', 0)`,
      ).bind(accountId, `bulk-${i}`, 1_800_000_000_000 + i).run();
    }
    await call(env, 42, 'PUT', '', { entry: entry('audit-new', { measuredAt: 1_900_000_000_000 }) });
    const rows = await env.DB!.prepare(`SELECT id FROM audit_history WHERE account_id = ?`).bind(accountId).all<{ id: string }>();
    const ids = (rows.results || []).map((r) => r.id);
    expect(ids).toHaveLength(500);
    expect(ids).toContain('audit-new');
    expect(ids).not.toContain('audit-seed');
    expect(ids).not.toContain('bulk-0');
  });

  it('is deleted with the account', async () => {
    const env = makeEnv();
    await call(env, 42, 'PUT', '', { entry: entry('audit-1') });
    const before = await env.DB!.prepare(`SELECT COUNT(*) AS n FROM audit_history`).first<{ n: number }>();
    expect(before?.n).toBe(1);
    const accountId = (await env.DB!.prepare(`SELECT account_id FROM audit_history`).first<{ account_id: string }>())!.account_id;
    await eraseAccountRows(env, accountId);
    const after = await env.DB!.prepare(`SELECT COUNT(*) AS n FROM audit_history`).first<{ n: number }>();
    expect(after?.n).toBe(0);
  });
});

// Client: the browser list loads from the API first and uploads browser-only entries.
const routeEnv = { current: makeEnv() };
const signedIn = { current: true };
const workspaceOwner: { current: string | undefined } = { current: undefined };

vi.mock('../services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/apiClient')>();
  return {
    ...actual,
    apiBase: () => ORIGIN,
    accountKnownSignedIn: () => signedIn.current,
    workerFetchWithAuthRetry: async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers || {});
      headers.set('x-telegram-init-data', initDataFor(42));
      return handleAuditHistoryRoute(new Request(url, { ...init, headers }), routeEnv.current);
    },
  };
});

vi.mock('../services/sync/workspaceSyncService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/sync/workspaceSyncService')>();
  return {
    ...actual,
    workspaceHistoryReady: () => true,
    workspaceAccountId: () => workspaceOwner.current,
    flushWorkspacePush: async () => {},
    noteWorkspaceDirty: () => {},
  };
});

const { auditHistoryService, pushAuditToServer } = await import('../services/audit/auditHistoryService');

describe('audit history client (API first)', () => {
  beforeEach(async () => {
    routeEnv.current = makeEnv();
    signedIn.current = true;
    auditHistoryService.clear();
    // The account id the API reports for Telegram user 42, so the browser copy can be marked as its own.
    workspaceOwner.current = (await call(routeEnv.current, 42, 'GET')).body.accountId;
  });
  afterEach(() => auditHistoryService.clear());

  it('saves a new audit to the account history', async () => {
    const saved = auditHistoryService.record({ domain: 'acme.example', focus: 'AEO', reportText: 'Health Score: 64/100' });
    await vi.waitFor(async () => {
      const list = await call(routeEnv.current, 42, 'GET');
      expect(list.body.entries.map((e: { id: string }) => e.id)).toEqual([saved.id]);
    });
  });

  it('loads reports saved on another device into this browser', async () => {
    await call(routeEnv.current, 42, 'PUT', '', { entry: entry('audit-remote') });
    expect(auditHistoryService.list()).toHaveLength(0);
    const result = await auditHistoryService.syncFromServer(8);
    expect(result.ok).toBe(true);
    expect(auditHistoryService.list().map((e) => e.id)).toEqual(['audit-remote']);
    expect(auditHistoryService.get('audit-remote')?.reportExcerpt).toContain('Health Score: 72/100');
  });

  it('uploads browser-only reports it finds while loading', async () => {
    signedIn.current = false;
    const local = auditHistoryService.record({ domain: 'acme.example', focus: 'SEO', reportText: 'Health Score: 50/100' });
    signedIn.current = true;
    const result = await auditHistoryService.syncFromServer(8);
    expect(result.ok).toBe(true);
    await vi.waitFor(async () => {
      const list = await call(routeEnv.current, 42, 'GET');
      expect(list.body.entries.map((e: { id: string }) => e.id)).toContain(local.id);
    });
  });

  it('does not upload a browser copy that belongs to another account, and replaces it', async () => {
    signedIn.current = false;
    const other = auditHistoryService.record({ domain: 'previous.example', focus: 'SEO', reportText: 'Health Score: 40/100' });
    signedIn.current = true;
    workspaceOwner.current = 'acct_someone_else';
    await call(routeEnv.current, 42, 'PUT', '', { entry: entry('audit-remote') });
    const result = await auditHistoryService.syncFromServer(8);
    expect(result.ok).toBe(true);
    expect(auditHistoryService.list().map((e) => e.id)).toEqual(['audit-remote']);
    await new Promise((done) => setTimeout(done, 20));
    const list = await call(routeEnv.current, 42, 'GET');
    expect(list.body.entries.map((e: { id: string }) => e.id)).not.toContain(other.id);
  });

  it('does not adopt a guest copy into the account', async () => {
    signedIn.current = false;
    const guest = auditHistoryService.record({ domain: 'guest.example', focus: 'SEO', reportText: 'Health Score: 40/100' });
    signedIn.current = true;
    workspaceOwner.current = undefined;
    await auditHistoryService.syncFromServer(8);
    await new Promise((done) => setTimeout(done, 20));
    const list = await call(routeEnv.current, 42, 'GET');
    expect(list.body.entries.map((e: { id: string }) => e.id)).not.toContain(guest.id);
    expect(auditHistoryService.get(guest.id)).not.toBeNull();
  });

  it('does not resend browser reports older than a full server page', async () => {
    signedIn.current = false;
    const old = auditHistoryService.record({ domain: 'acme.example', focus: 'SEO', reportText: 'x', measuredAt: 1_000 });
    signedIn.current = true;
    await call(routeEnv.current, 42, 'PUT', '', { entry: entry('audit-newer') });
    await auditHistoryService.syncFromServer(1);
    await new Promise((done) => setTimeout(done, 20));
    const list = await call(routeEnv.current, 42, 'GET');
    expect(list.body.entries.map((e: { id: string }) => e.id)).not.toContain(old.id);
  });

  it('reports a failed load and keeps the browser copy', async () => {
    routeEnv.current = { ...makeEnv(), DB: undefined } as Env;
    signedIn.current = false;
    auditHistoryService.record({ domain: 'acme.example', focus: 'SEO', reportText: 'Health Score: 50/100' });
    signedIn.current = true;
    const result = await auditHistoryService.syncFromServer(8);
    expect(result.ok).toBe(false);
    expect(auditHistoryService.list()).toHaveLength(1);
  });

  it('does not call the API for guests', async () => {
    signedIn.current = false;
    expect(await pushAuditToServer(entry('audit-1') as never)).toBe(false);
    const result = await auditHistoryService.syncFromServer(8);
    expect(result.ok).toBe(false);
  });
});
