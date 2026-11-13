import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import { createProject } from '../worker/projectService';
import { getProjectHistory } from '../worker/projectHistoryService';
import {
  getProjectMonitor,
  handleProjectMonitorRoute,
  listProjectAlerts,
  runProjectMonitorTick,
  saveProjectMonitor,
} from '../worker/projectMonitor';
import { PROJECT_MONITOR_MCP_TOOLS } from '../worker/mcpProjectMonitorTools';
import { handleEmailUnsubscribe } from '../worker/welcomeEmail';
import { monitorAlertKind, nextMonitorRunAt, planMonitorCadence } from '../services/monitor/monitorRules';
import { handleMcpRequest } from '../worker/mcpServer';
import type { McpCredential } from '../worker/userTypes';
import { SESSION_MCP_CREDENTIAL } from '../worker/userTypes';

const RICH = `<!DOCTYPE html><html><head><title>Harbour and Co</title>
<script type="application/ld+json">{"@type":"RealEstateAgent","name":"Harbour and Co","telephone":"03 9999 8888","address":{"streetAddress":"12 Harbour Street","addressLocality":"Richmond","addressRegion":"VIC","postalCode":"3121"},"areaServed":"Richmond"}</script>
</head><body>
<a href="https://harbour.example/team/ada">Ada</a>
<a href="https://harbour.example/listings/1-bridge">Listing</a>
</body></html>`;

const THIN = '<!DOCTYPE html><html><head><title>Hi</title></head><body><p>Hello</p></body></html>';

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function envFor(extra: Partial<Env> = {}): Env {
  return {
    DB: createSqliteD1(),
    LUMINARA_KV: mockKv(),
    WEBAPP_URL: 'https://www.luminarasuite.com/',
    RESEND_API_KEY: 'test-key',
    ...extra,
  } as Env;
}

async function addUser(env: Env, id: string, email: string, token: string) {
  await env.DB!.prepare(
    `INSERT INTO users (id, source, email, display_name, created_at, last_seen_at, account_id, email_unsub_token, email_verified)
     VALUES (?, 'firebase', ?, 'Ada', 1, 1, ?, ?, 1)`,
  ).bind(id, email, id, token).run();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('monitor rules', () => {
  it('keeps Free on a monthly check and calls a drop a regression', () => {
    expect(planMonitorCadence('free')).toBe('monthly');
    expect(planMonitorCadence('starter')).toBe('monthly');
    expect(planMonitorCadence('growth')).toBe('weekly');
    expect(planMonitorCadence('agency')).toBe('daily');
    expect(monitorAlertKind({ label: 'measured', scoreDelta: -2, droppedEngines: [], gainedEngines: [] })).toBe('regression');
    expect(monitorAlertKind({ label: 'measured', scoreDelta: 1, droppedEngines: [], gainedEngines: [] })).toBe('lift');
    expect(monitorAlertKind({ label: 'too_little_data', scoreDelta: null, droppedEngines: [], gainedEngines: [] })).toBe(null);
  });
});

describe('project monitor', () => {
  it('refuses a daily check on Free, isolates tenants, and writes a regression from two page reads', async () => {
    const env = envFor();
    const owned = await createProject(env, 'acct_a', { domain: 'harbour.example', name: 'Harbour' });
    if (!owned.ok) throw new Error(owned.error);
    const refused = await handleProjectMonitorRoute(
      new Request('https://www.luminarasuite.com/api/projects/x/monitor', {
        method: 'PUT',
        body: JSON.stringify({ enabled: true, cadence: 'daily', emailOptIn: true }),
      }),
      env,
      `/projects/${owned.project.id}/monitor`,
      'acct_a',
    );
    expect(await refused?.json()).toEqual({ ok: false, error: "This plan's fastest check is monthly." });

    const saved = await saveProjectMonitor(env, 'acct_a', owned.project.id, {
      enabled: true,
      cadence: 'monthly',
      emailOptIn: false,
    }, Date.UTC(2026, 0, 5));
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.monitor.cadence).toBe('monthly');
    expect(await getProjectMonitor(env, 'acct_b', owned.project.id)).toBe(null);

    const schemaPage = '<!DOCTYPE html><html><head><title>Harbour</title><script type="application/ld+json">{"@type":"RealEstateAgent","name":"Harbour and Co"}</script></head><body><p>Harbour and Co</p></body></html>';
    const plainPage = '<!DOCTYPE html><html><head><title>Hi</title></head><body><p>Hello</p></body></html>';
    const read = vi.fn(async () => ({ status: 200, html: schemaPage }));
    const start = Date.UTC(2026, 0, 6, 8, 0, 0);
    const first = await runProjectMonitorTick(env, { now: start, scheduledAt: start, read });
    expect(first).toEqual({ checked: 1, skipped: null });
    const history = await getProjectHistory(env, 'acct_a', owned.project.id, 5);
    expect(history?.trends.find((row) => row.metric === 're_coverage')?.latestScore).toBe(1);

    read.mockResolvedValue({ status: 200, html: plainPage });
    const later = nextMonitorRunAt(start, 'monthly') + 60_000;
    await runProjectMonitorTick(env, { now: later, scheduledAt: later, read });
    const alerts = await listProjectAlerts(env, 'acct_a', owned.project.id);
    expect(alerts?.find((alert) => alert.kind === 'regression')?.summary).toBe(
      'Real estate coverage fell. Change vs previous: -1 (1 to 0).',
    );
    expect(await listProjectAlerts(env, 'acct_b', owned.project.id)).toBe(null);
    expect(read).toHaveBeenCalled();
  });

  it('emails only an opted-in account and the unsubscribe link turns that email off', async () => {
    const env = envFor();
    const token = 'a'.repeat(43);
    await addUser(env, 'acct_a', 'ada@example.com', token);
    await addUser(env, 'acct_b', 'bea@example.com', 'b'.repeat(43));
    const owned = await createProject(env, 'acct_a', { domain: 'harbour.example', name: 'Harbour' });
    const other = await createProject(env, 'acct_b', { domain: 'other.example', name: 'Other' });
    if (!owned.ok || !other.ok) throw new Error('project');
    const sunday = Date.UTC(2026, 0, 4, 8, 0, 0);
    const monday = Date.UTC(2026, 0, 5, 8, 0, 0);
    await saveProjectMonitor(env, 'acct_a', owned.project.id, { enabled: true, cadence: 'monthly', emailOptIn: true }, sunday);
    await saveProjectMonitor(env, 'acct_b', other.project.id, { enabled: true, cadence: 'monthly', emailOptIn: true }, sunday);
    await runProjectMonitorTick(env, { now: sunday, scheduledAt: sunday, read: async () => ({ status: 200, html: RICH }) });
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body || ''));
      return new Response('{"id":"em_1"}', { status: 200 });
    });
    await runProjectMonitorTick(env, {
      now: monday,
      scheduledAt: monday,
      read: async () => ({ status: 200, html: RICH }),
    });
    expect(bodies).toHaveLength(2);
    expect(bodies.join('\n')).toContain('list=monitor');
    expect(bodies.join('\n')).toContain('ada@example.com');
    expect(bodies.join('\n')).toContain('bea@example.com');

    const page = await handleEmailUnsubscribe(
      new Request(`https://www.luminarasuite.com/api/email/unsubscribe?token=${token}&list=monitor`),
      env,
    );
    expect(await page?.text()).toContain('project check emails');
    expect((await getProjectMonitor(env, 'acct_a', owned.project.id))?.emailOptIn).toBe(false);
    expect((await getProjectMonitor(env, 'acct_b', other.project.id))?.emailOptIn).toBe(true);
  });

  it('exposes the schedule through the MCP tools without a credit class other than free', async () => {
    const env = envFor();
    const owned = await createProject(env, 'acct_a', { domain: 'harbour.example', name: 'Harbour' });
    if (!owned.ok) throw new Error(owned.error);
    const setTool = PROJECT_MONITOR_MCP_TOOLS.find((tool) => tool.name === 'set_project_monitor');
    const getTool = PROJECT_MONITOR_MCP_TOOLS.find((tool) => tool.name === 'get_project_monitor');
    const ctx = {
      env,
      accountId: 'acct_a',
      user: { id: 'acct_a', source: 'firebase' as const, accountId: 'acct_a' },
      credential: SESSION_MCP_CREDENTIAL,
      planId: 'free',
    };
    const denied = await setTool?.handler(
      { projectId: owned.project.id, enabled: true, cadence: 'weekly', emailOptIn: false },
      ctx,
    );
    expect(denied?.isError).toBe(true);
    expect(denied?.text).toBe("This plan's fastest check is monthly.");
    const saved = await setTool?.handler(
      { projectId: owned.project.id, enabled: true, cadence: 'monthly', emailOptIn: false },
      ctx,
    );
    expect(saved?.text).toBe('On, monthly. Email off.');
    const loaded = await getTool?.handler({ projectId: owned.project.id }, ctx);
    expect(loaded?.text).toBe('On, monthly. Email off. Prompts: none built from the last page read.');
    expect(PROJECT_MONITOR_MCP_TOOLS.every((tool) => tool.creditClass === 'free')).toBe(true);
  });

  it('keeps the next daily tick due when this tick started late and the next one starts earlier', async () => {
    const store = new Map<string, string>();
    store.set('sub:acct_a', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 40 * 86_400_000 }));
    const env = envFor({ LUMINARA_KV: mockKv(store) });
    const owned = await createProject(env, 'acct_a', { domain: 'harbour.example', name: 'Harbour' });
    if (!owned.ok) throw new Error(owned.error);
    const start = Date.UTC(2026, 0, 6, 8, 0, 0);
    await saveProjectMonitor(env, 'acct_a', owned.project.id, { enabled: true, cadence: 'daily', emailOptIn: false }, start);
    const read = vi.fn(async () => ({ status: 200, html: THIN }));
    await runProjectMonitorTick(env, { now: start + 40 * 60_000, scheduledAt: start, read });
    const row = await env.DB!.prepare(`SELECT next_run_at AS nextRunAt FROM project_monitors WHERE account_id = ?`).bind('acct_a').first<{ nextRunAt: number }>();
    expect(row?.nextRunAt).toBe(nextMonitorRunAt(start, 'daily'));
    const nextFire = start + 86_400_000;
    const second = await runProjectMonitorTick(env, { now: nextFire + 5 * 60_000, scheduledAt: nextFire, read });
    expect(second.checked).toBe(1);
  });

  it('does not call a fetch failure a coverage drop', async () => {
    const env = envFor();
    const owned = await createProject(env, 'acct_a', { domain: 'harbour.example', name: 'Harbour' });
    if (!owned.ok) throw new Error(owned.error);
    const start = Date.UTC(2026, 0, 6, 8, 0, 0);
    await saveProjectMonitor(env, 'acct_a', owned.project.id, { enabled: true, cadence: 'monthly', emailOptIn: false }, start);
    const home = '<!DOCTYPE html><html><head><title>Harbour</title><script type="application/ld+json">{"@type":"RealEstateAgent","name":"Harbour and Co"}</script></head><body><a href="https://harbour.example/team/ada">Ada</a></body></html>';
    const profile = '<!DOCTYPE html><html><head><script type="application/ld+json">{"@type":"Person","name":"Ada Harbour"}</script></head><body><p>Ada</p></body></html>';
    let follow = true;
    const read = vi.fn(async (url: string) => {
      if (url.includes('/team/')) return follow ? { status: 200, html: profile } : { status: 500, html: '' };
      return { status: 200, html: home };
    });
    await runProjectMonitorTick(env, { now: start, scheduledAt: start, read });
    follow = false;
    const later = nextMonitorRunAt(start, 'monthly') + 60_000;
    await runProjectMonitorTick(env, { now: later, scheduledAt: later, read });
    const alerts = await listProjectAlerts(env, 'acct_a', owned.project.id);
    expect(alerts?.some((alert) => alert.kind === 'regression')).toBe(false);
  });

  it('writes the Monday weekly report for a weekly and a monthly monitor whose first check was Tuesday', async () => {
    const store = new Map<string, string>();
    store.set('sub:acct_a', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 40 * 86_400_000 }));
    const env = envFor({ LUMINARA_KV: mockKv(store) });
    const weekly = await createProject(env, 'acct_a', { domain: 'weekly.example', name: 'Weekly' });
    const monthly = await createProject(env, 'acct_a', { domain: 'monthly.example', name: 'Monthly' });
    if (!weekly.ok || !monthly.ok) throw new Error('project');
    const tuesday = Date.UTC(2026, 0, 6, 8, 0, 0);
    await saveProjectMonitor(env, 'acct_a', weekly.project.id, { enabled: true, cadence: 'weekly', emailOptIn: false }, tuesday);
    await saveProjectMonitor(env, 'acct_a', monthly.project.id, { enabled: true, cadence: 'monthly', emailOptIn: false }, tuesday);
    const read = vi.fn(async () => ({ status: 200, html: THIN }));
    await runProjectMonitorTick(env, { now: tuesday, scheduledAt: tuesday, read });
    expect((await listProjectAlerts(env, 'acct_a', weekly.project.id))?.some((alert) => alert.kind === 'weekly')).toBe(false);
    const readsAfterTuesday = read.mock.calls.length;
    const monday = Date.UTC(2026, 0, 12, 8, 0, 0);
    await runProjectMonitorTick(env, { now: monday, scheduledAt: monday, read });
    expect(read.mock.calls.length).toBe(readsAfterTuesday);
    expect((await listProjectAlerts(env, 'acct_a', weekly.project.id))?.filter((alert) => alert.kind === 'weekly')).toHaveLength(1);
    expect((await listProjectAlerts(env, 'acct_a', monthly.project.id))?.filter((alert) => alert.kind === 'weekly')).toHaveLength(1);
  });

  it('checks every due monitor in one tick, past the first batch of 8', async () => {
    const env = envFor();
    const start = Date.UTC(2026, 0, 6, 8, 0, 0);
    for (let i = 0; i < 9; i += 1) {
      const owned = await createProject(env, 'acct_a', { domain: `agency${i}.example`, name: `Agency ${i}` });
      if (!owned.ok) throw new Error(owned.error);
      await saveProjectMonitor(env, 'acct_a', owned.project.id, { enabled: true, cadence: 'monthly', emailOptIn: false }, start);
    }
    const result = await runProjectMonitorTick(env, {
      now: start,
      scheduledAt: start,
      read: async () => ({ status: 200, html: THIN }),
    });
    expect(result.checked).toBe(9);
  });

  it('leaves a paid cadence in place when the plan store cannot be read', async () => {
    const env = envFor({ LUMINARA_KV: undefined });
    const owned = await createProject(env, 'acct_a', { domain: 'harbour.example', name: 'Harbour' });
    if (!owned.ok) throw new Error(owned.error);
    const start = Date.UTC(2026, 0, 6, 8, 0, 0);
    await env.DB!.prepare(
      `INSERT INTO project_monitors
        (id, account_id, project_id, enabled, cadence, email_opt_in, query_list_json, next_run_at, created_at, updated_at)
       VALUES ('mon_paid', 'acct_a', ?, 1, 'daily', 0, '[]', ?, ?, ?)`,
    ).bind(owned.project.id, start, start, start).run();
    const read = vi.fn(async () => ({ status: 200, html: THIN }));
    const result = await runProjectMonitorTick(env, { now: start, scheduledAt: start, read });
    expect(result.checked).toBe(0);
    expect(read).not.toHaveBeenCalled();
    const row = await env.DB!.prepare(`SELECT cadence, next_run_at AS nextRunAt FROM project_monitors WHERE id = 'mon_paid'`).first<{ cadence: string; nextRunAt: number }>();
    expect(row).toEqual({ cadence: 'daily', nextRunAt: start });
  });

  it('sends the Monday regression and the weekly report as two emails', async () => {
    const store = new Map<string, string>();
    store.set('sub:acct_a', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 40 * 86_400_000 }));
    const env = envFor({ LUMINARA_KV: mockKv(store) });
    await addUser(env, 'acct_a', 'ada@example.com', 'd'.repeat(43));
    const owned = await createProject(env, 'acct_a', { domain: 'harbour.example', name: 'Harbour' });
    if (!owned.ok) throw new Error(owned.error);
    const sunday = Date.UTC(2026, 0, 4, 8, 0, 0);
    const monday = Date.UTC(2026, 0, 5, 8, 0, 0);
    const schemaPage = '<!DOCTYPE html><html><head><title>Harbour</title><script type="application/ld+json">{"@type":"RealEstateAgent","name":"Harbour and Co"}</script></head><body><p>Harbour and Co</p></body></html>';
    await saveProjectMonitor(env, 'acct_a', owned.project.id, { enabled: true, cadence: 'daily', emailOptIn: true }, sunday);
    await runProjectMonitorTick(env, { now: sunday, scheduledAt: sunday, read: async () => ({ status: 200, html: schemaPage }) });
    const keys: string[] = [];
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get('Idempotency-Key') || '');
      bodies.push(String(init?.body || ''));
      return new Response('{"id":"em_1"}', { status: 200 });
    });
    await runProjectMonitorTick(env, {
      now: monday,
      scheduledAt: monday,
      read: async () => ({ status: 200, html: THIN }),
    });
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.some((key) => key.includes('regression'))).toBe(true);
    expect(keys.some((key) => key.includes('weekly'))).toBe(true);
    expect(keys.every((key) => key.includes('2026-W02'))).toBe(true);
    expect(bodies.some((body) => body.includes('Real estate coverage fell'))).toBe(true);
    expect(bodies.some((body) => body.includes('Weekly project check'))).toBe(true);
  });

  it('checks a later due monitor when the first batch was skipped', async () => {
    const store = new Map<string, string>();
    const base = mockKv(store);
    const kv = {
      ...base,
      get: async (key: string, type?: string) => {
        if (String(key).startsWith('sub:skip')) throw new Error('kv down');
        return base.get(key, type);
      },
    } as KVNamespace;
    const env = envFor({ LUMINARA_KV: kv });
    const start = Date.UTC(2026, 0, 6, 8, 0, 0);
    for (let i = 0; i < 8; i += 1) {
      const skipped = await createProject(env, 'skip', { domain: `skip${i}.example`, name: `Skip ${i}` });
      if (!skipped.ok) throw new Error(skipped.error);
      await env.DB!.prepare(
        `INSERT INTO project_monitors
          (id, account_id, project_id, enabled, cadence, email_opt_in, query_list_json, next_run_at, created_at, updated_at)
         VALUES (?, 'skip', ?, 1, 'daily', 0, '[]', ?, ?, ?)`,
      ).bind(`skip${i}`, skipped.project.id, start, start, start).run();
    }
    const owned = await createProject(env, 'acct_ok', { domain: 'ok.example', name: 'Ok' });
    if (!owned.ok) throw new Error(owned.error);
    await saveProjectMonitor(env, 'acct_ok', owned.project.id, { enabled: true, cadence: 'monthly', emailOptIn: false }, start + 1);
    const result = await runProjectMonitorTick(env, {
      now: start + 1_000,
      scheduledAt: start,
      read: async () => ({ status: 200, html: THIN }),
    });
    expect(result.checked).toBe(1);
    const skippedRow = await env.DB!.prepare(
      `SELECT cadence, next_run_at AS nextRunAt FROM project_monitors WHERE id = 'skip0'`,
    ).first<{ cadence: string; nextRunAt: number }>();
    expect(skippedRow).toEqual({ cadence: 'daily', nextRunAt: start });
  });

  it('does not email an unverified Firebase address', async () => {
    const env = envFor();
    await env.DB!.prepare(
      `INSERT INTO users (id, source, email, display_name, created_at, last_seen_at, account_id, email_unsub_token, email_verified)
       VALUES ('acct_a', 'firebase', 'ada@example.com', 'Ada', 1, 1, 'acct_a', ?, 0)`,
    ).bind('c'.repeat(43)).run();
    const owned = await createProject(env, 'acct_a', { domain: 'harbour.example', name: 'Harbour' });
    if (!owned.ok) throw new Error(owned.error);
    const sunday = Date.UTC(2026, 0, 4, 8, 0, 0);
    const monday = Date.UTC(2026, 0, 5, 8, 0, 0);
    await saveProjectMonitor(env, 'acct_a', owned.project.id, { enabled: true, cadence: 'monthly', emailOptIn: true }, sunday);
    await runProjectMonitorTick(env, { now: sunday, scheduledAt: sunday, read: async () => ({ status: 200, html: RICH }) });
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body || ''));
      return new Response('{"id":"em_1"}', { status: 200 });
    });
    await runProjectMonitorTick(env, { now: monday, scheduledAt: monday, read: async () => ({ status: 200, html: RICH }) });
    expect(bodies).toEqual([]);
    expect((await listProjectAlerts(env, 'acct_a', owned.project.id))?.some((alert) => alert.kind === 'weekly')).toBe(true);
  });

  it('does not spend the MCP daily cap when the project is missing or the cadence is too fast', async () => {
    const env = envFor();
    const owned = await createProject(env, 'acct_a', { domain: 'harbour.example', name: 'Harbour' });
    if (!owned.ok) throw new Error(owned.error);
    const account = { id: 'acct_a', source: 'telegram' as const, accountId: 'acct_a' };
    const credential: McpCredential = { kind: 'oauth', id: null, scopes: ['mcp:free'], clientId: 'client-a' };
    const call = (name: string, args: Record<string, unknown>) => new Request('https://www.luminarasuite.com/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const missing = await (await handleMcpRequest(
      call('set_project_monitor', { projectId: 'missing_project', enabled: true, cadence: 'monthly', emailOptIn: false }),
      env,
      account,
      credential,
    )).json() as { result?: { isError?: boolean; structuredContent?: { callsUsedToday?: number } } };
    expect(missing.result?.isError).toBe(true);
    const refused = await (await handleMcpRequest(
      call('set_project_monitor', { projectId: owned.project.id, enabled: true, cadence: 'daily', emailOptIn: false }),
      env,
      account,
      credential,
    )).json() as { result?: { isError?: boolean; text?: string; structuredContent?: { callsUsedToday?: number } } };
    expect(refused.result?.isError).toBe(true);
    const who = await (await handleMcpRequest(call('whoami', {}), env, account, credential)).json() as {
      result?: { structuredContent?: { callsUsedToday?: number } };
    };
    expect(who.result?.structuredContent?.callsUsedToday).toBe(1);
  });
});
