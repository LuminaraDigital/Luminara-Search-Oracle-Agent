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
import { monitorAlertKind, planMonitorCadence } from '../services/monitor/monitorRules';
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
    `INSERT INTO users (id, source, email, display_name, created_at, last_seen_at, account_id, email_unsub_token)
     VALUES (?, 'firebase', ?, 'Ada', 1, 1, ?, ?)`,
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

    const read = vi.fn(async () => ({ status: 200, html: RICH }));
    const first = await runProjectMonitorTick(env, { now: Date.UTC(2026, 0, 5), scheduledAt: Date.UTC(2026, 0, 5), read });
    expect(first).toEqual({ checked: 1, skipped: null });
    const history = await getProjectHistory(env, 'acct_a', owned.project.id, 5);
    expect(history?.trends.find((row) => row.metric === 're_coverage')?.latestScore).toBe(6);

    read.mockResolvedValue({ status: 200, html: THIN });
    const later = Date.UTC(2026, 0, 5) + 31 * 86_400_000;
    await runProjectMonitorTick(env, { now: later, scheduledAt: later, read });
    const alerts = await listProjectAlerts(env, 'acct_a', owned.project.id);
    expect(alerts?.map((alert) => alert.kind)).toEqual(['regression', 'weekly']);
    expect(alerts?.[0]?.summary).toBe('Real estate coverage fell. Change vs previous: -6 (6 to 0).');
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
    const monday = Date.UTC(2026, 0, 5);
    await saveProjectMonitor(env, 'acct_a', owned.project.id, { enabled: true, cadence: 'monthly', emailOptIn: true }, monday);
    await saveProjectMonitor(env, 'acct_b', other.project.id, { enabled: true, cadence: 'monthly', emailOptIn: true }, monday);
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
});
