/**
 * Per-project scheduled real-estate checks.
 * The daily cron claims a due row, reads public pages, and writes one history snapshot.
 * A crash after the claim skips that window. The next window runs the check again.
 */
import type { Env } from './env';
import { json } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, fetchPublicUrl, readBody } from './security';
import { readCapped } from './domainVerification';
import { getProject } from './projectService';
import { getProjectHistory, recordProjectSnapshot, recordRecommendedAction } from './projectHistoryService';
import { randomId } from '../services/projects/projectUtils';
import {
  measureRealEstate,
  realEstateCoverage,
  realEstateFollowUps,
  realEstatePageFromHtml,
  type RealEstatePageInput,
} from '../services/audit/realEstateChecks';
import { realEstateSnapshot } from '../services/history/snapshotCapture';
import { isoWeekKey } from '../services/referrals/rules';
import {
  isMonitorCadence,
  monitorAlertKind,
  monitorCadenceAllowed,
  nextMonitorRunAt,
  planMonitorCadence,
  type MonitorCadence,
} from '../services/monitor/monitorRules';
import {
  WELCOME_FROM,
  WELCOME_REPLY_TO,
  newUnsubToken,
  unsubscribeUrl,
} from './welcomeEmail';

const BATCH = 8;
const CONCURRENCY = 4;
const BUDGET_MS = 8 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MONITOR_TOOLS = new Set(['get_project_monitor', 'set_project_monitor', 'list_project_alerts', 'ack_project_alert']);

export type ProjectMonitorView = {
  projectId: string;
  enabled: boolean;
  cadence: MonitorCadence;
  planCadence: MonitorCadence;
  emailOptIn: boolean;
  prompts: string[];
  lastRunAt: number | null;
  nextRunAt: number;
};

export type ProjectAlertView = {
  id: string;
  projectId: string;
  kind: 'regression' | 'lift' | 'weekly';
  summary: string;
  snapshotId: string | null;
  createdAt: number;
  readAt: number | null;
};

type MonitorRow = {
  id: string;
  project_id: string;
  enabled: number;
  cadence: string;
  email_opt_in: number;
  query_list_json: string;
  last_run_at: number | null;
  next_run_at: number;
};

type DueRow = {
  id: string;
  account_id: string;
  project_id: string;
  cadence: string;
  email_opt_in: number;
  next_run_at: number;
};

type AlertRow = {
  id: string;
  project_id: string;
  kind: string;
  summary: string;
  snapshot_id: string | null;
  created_at: number;
  read_at: number | null;
};

export type MonitorPageRead = (url: string) => Promise<{ status: number; html: string }>;

function parsePrompts(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, 6);
  } catch {
    return [];
  }
}

function viewOf(row: MonitorRow, plan: string): ProjectMonitorView | null {
  if (!isMonitorCadence(row.cadence)) return null;
  return {
    projectId: row.project_id,
    enabled: row.enabled === 1,
    cadence: row.cadence,
    planCadence: planMonitorCadence(plan),
    emailOptIn: row.email_opt_in === 1,
    prompts: parsePrompts(row.query_list_json),
    lastRunAt: typeof row.last_run_at === 'number' ? row.last_run_at : null,
    nextRunAt: row.next_run_at,
  };
}

type PlanRead = { known: true; plan: string } | { known: false };

async function readAccountPlan(env: Env, accountId: string): Promise<PlanRead> {
  if (!env.LUMINARA_KV) return { known: false };
  try {
    const sub = (await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as { plan?: string; expiresAt?: number } | null;
    if (!sub?.expiresAt || sub.expiresAt <= Date.now()) return { known: true, plan: 'free' };
    return { known: true, plan: sub.plan || 'free' };
  } catch {
    return { known: false };
  }
}

function planName(read: PlanRead): string {
  return read.known ? read.plan : 'free';
}

async function readMonitor(env: Env, accountId: string, projectId: string): Promise<MonitorRow | null> {
  if (!env.DB) return null;
  return env.DB.prepare(
    `SELECT id, project_id, enabled, cadence, email_opt_in, query_list_json, last_run_at, next_run_at
     FROM project_monitors WHERE account_id = ? AND project_id = ?`,
  ).bind(accountId, projectId).first<MonitorRow>();
}

export async function getProjectMonitor(env: Env, accountId: string, projectId: string): Promise<ProjectMonitorView | null> {
  const project = await getProject(env, accountId, projectId);
  if (!project) return null;
  const row = await readMonitor(env, accountId, projectId);
  if (!row) return null;
  return viewOf(row, planName(await readAccountPlan(env, accountId)));
}

export async function saveProjectMonitor(
  env: Env,
  accountId: string,
  projectId: string,
  input: { enabled: boolean; cadence: string; emailOptIn: boolean },
  now = Date.now(),
): Promise<{ ok: true; monitor: ProjectMonitorView } | { ok: false; error: string; status: number }> {
  if (!env.DB) return { ok: false, error: 'Database unavailable', status: 503 };
  const project = await getProject(env, accountId, projectId);
  if (!project) return { ok: false, error: 'Project not found', status: 404 };
  const plan = planName(await readAccountPlan(env, accountId));
  if (!monitorCadenceAllowed(plan, input.cadence)) {
    return {
      ok: false,
      error: `This plan's fastest check is ${planMonitorCadence(plan)}.`,
      status: 402,
    };
  }
  const id = randomId('mon');
  await env.DB.prepare(
    `INSERT INTO project_monitors
      (id, account_id, project_id, enabled, cadence, email_opt_in, query_list_json, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)
     ON CONFLICT(account_id, project_id) DO UPDATE SET
       enabled = excluded.enabled,
       cadence = excluded.cadence,
       email_opt_in = excluded.email_opt_in,
       updated_at = excluded.updated_at,
       next_run_at = CASE
         WHEN project_monitors.enabled = 0 AND excluded.enabled = 1 THEN excluded.next_run_at
         WHEN project_monitors.cadence != excluded.cadence THEN excluded.next_run_at
         ELSE project_monitors.next_run_at
       END`,
  ).bind(id, accountId, projectId, input.enabled ? 1 : 0, input.cadence, input.emailOptIn ? 1 : 0, now, now, now).run();
  const row = await readMonitor(env, accountId, projectId);
  const monitor = row ? viewOf(row, plan) : null;
  if (!monitor) return { ok: false, error: 'Could not save the check schedule.', status: 500 };
  return { ok: true, monitor };
}

function alertFromRow(row: AlertRow): ProjectAlertView {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind === 'lift' || row.kind === 'weekly' ? row.kind : 'regression',
    summary: row.summary,
    snapshotId: row.snapshot_id,
    createdAt: row.created_at,
    readAt: typeof row.read_at === 'number' ? row.read_at : null,
  };
}

export async function listProjectAlerts(env: Env, accountId: string, projectId: string): Promise<ProjectAlertView[] | null> {
  if (!env.DB) return null;
  const project = await getProject(env, accountId, projectId);
  if (!project) return null;
  const res = await env.DB.prepare(
    `SELECT id, project_id, kind, summary, snapshot_id, created_at, read_at
     FROM project_monitor_alerts WHERE account_id = ? AND project_id = ?
     ORDER BY created_at DESC LIMIT 50`,
  ).bind(accountId, projectId).all<AlertRow>();
  return (res.results || []).map(alertFromRow);
}

export async function ackProjectAlert(
  env: Env,
  accountId: string,
  projectId: string,
  alertId: string,
  now = Date.now(),
): Promise<ProjectAlertView | null> {
  if (!env.DB) return null;
  await env.DB.prepare(
    `UPDATE project_monitor_alerts SET read_at = ?
     WHERE account_id = ? AND project_id = ? AND id = ? AND read_at IS NULL`,
  ).bind(now, accountId, projectId, alertId).run();
  const row = await env.DB.prepare(
    `SELECT id, project_id, kind, summary, snapshot_id, created_at, read_at
     FROM project_monitor_alerts WHERE account_id = ? AND project_id = ? AND id = ?`,
  ).bind(accountId, projectId, alertId).first<AlertRow>();
  if (!row) return null;
  return alertFromRow(row);
}

async function defaultRead(url: string): Promise<{ status: number; html: string }> {
  try {
    const fetched = await fetchPublicUrl(url, {
      method: 'GET',
      headers: {
        accept: 'text/html',
        'user-agent': 'LuminaraProbe/1.0 (+https://www.luminarasuite.com/methodology)',
      },
      signal: AbortSignal.timeout(5_000),
    }, { maxRedirects: 3 });
    if (!fetched.ok) return { status: 0, html: '' };
    const html = await readCapped(fetched.response, 256_000);
    return { status: fetched.response.status, html };
  } catch {
    return { status: 0, html: '' };
  }
}

async function readSite(domain: string, read: MonitorPageRead): Promise<RealEstatePageInput[]> {
  const homeUrl = `https://${domain}/`;
  const home = await read(homeUrl);
  if (home.status < 200 || home.status >= 300 || !home.html.trim()) return [];
  const homePage = realEstatePageFromHtml(home.html, homeUrl, home.status);
  const pages = [homePage];
  for (const url of realEstateFollowUps(homePage, 3)) {
    const next = await read(url);
    if (next.status < 200 || next.status >= 300 || !next.html.trim()) continue;
    pages.push(realEstatePageFromHtml(next.html, url, next.status));
  }
  return pages;
}

function deltaSentence(earlier: number | null, later: number | null, delta: number | null): string {
  if (earlier === null || later === null || delta === null) return 'Too little data to measure lift.';
  return `Change vs previous: ${delta} (${earlier} to ${later}).`;
}

async function insertAlert(
  env: Env,
  row: Pick<DueRow, 'id' | 'account_id' | 'project_id'>,
  kind: 'regression' | 'lift' | 'weekly',
  summary: string,
  snapshotId: string,
  weekKey: string,
  now: number,
): Promise<boolean> {
  const conflict = kind === 'weekly'
    ? `ON CONFLICT(account_id, monitor_id, week_key) WHERE kind = 'weekly' AND week_key != '' DO NOTHING`
    : `ON CONFLICT(account_id, snapshot_id, kind) WHERE kind != 'weekly' DO NOTHING`;
  const result = await env.DB!.prepare(
    `INSERT INTO project_monitor_alerts
      (id, account_id, project_id, monitor_id, kind, summary, snapshot_id, week_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ${conflict}`,
  ).bind(randomId('alert'), row.account_id, row.project_id, row.id, kind, summary.slice(0, 500), snapshotId, weekKey, now).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function sendAlertEmail(
  env: Env,
  accountId: string,
  domain: string,
  lines: string[],
  snapshotId: string,
): Promise<void> {
  if (!env.DB || !env.RESEND_API_KEY || lines.length === 0) return;
  const user = await env.DB.prepare(
    `SELECT id, email, email_unsub_token, email_opt_out_at, source, email_verified
     FROM users WHERE (account_id = ? OR id = ?) AND email IS NOT NULL AND trim(email) != ''
     ORDER BY last_seen_at DESC LIMIT 1`,
  ).bind(accountId, accountId).first<{
    id: string;
    email: string;
    email_unsub_token: string | null;
    email_opt_out_at: number | null;
    source: string;
    email_verified: number | null;
  }>();
  if (!user?.email || user.email_opt_out_at != null) return;
  if (user.source !== 'telegram' && user.source !== 'firebase') return;
  if (user.email_verified !== 1) return;
  let token = user.email_unsub_token;
  if (!token) {
    token = newUnsubToken();
    await env.DB.prepare(
      `UPDATE users SET email_unsub_token = ? WHERE id = ? AND email_unsub_token IS NULL`,
    ).bind(token, user.id).run();
  }
  const unsub = `${unsubscribeUrl(env, token)}&list=monitor`;
  const text = [`Project check for ${domain}`, '', ...lines, '', `Unsubscribe: ${unsub}`].join('\n');
  const html = `<p>${escapeHtml(`Project check for ${domain}`)}</p><p>${lines.map(escapeHtml).join('<br>')}</p><p><a href="${escapeHtml(unsub)}">Unsubscribe</a></p>`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `monitor-${accountId}-${snapshotId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 256),
      },
      body: JSON.stringify({
        from: WELCOME_FROM,
        to: [user.email],
        reply_to: [WELCOME_REPLY_TO],
        subject: `Project check: ${domain}`,
        html,
        text,
        headers: {
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!response.ok && response.status !== 409) {
      console.warn(JSON.stringify({ event: 'monitor_email_failed', status: response.status }));
    }
  } catch {
    console.warn(JSON.stringify({ event: 'monitor_email_failed' }));
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function runOne(
  env: Env,
  row: DueRow,
  now: number,
  scheduledAt: number,
  read: MonitorPageRead,
): Promise<boolean> {
  const plan = await readAccountPlan(env, row.account_id);
  if (!plan.known) return false;
  if (!monitorCadenceAllowed(plan.plan, row.cadence)) {
    const cadence = planMonitorCadence(plan.plan);
    await env.DB!.prepare(
      `UPDATE project_monitors SET cadence = ?, next_run_at = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
    ).bind(cadence, nextMonitorRunAt(scheduledAt, cadence), now, row.id, row.account_id).run();
    return false;
  }
  if (!isMonitorCadence(row.cadence)) return false;
  const claimed = await env.DB!.prepare(
    `UPDATE project_monitors SET next_run_at = ?, last_run_at = ?, updated_at = ?
     WHERE id = ? AND account_id = ? AND enabled = 1 AND next_run_at <= ?`,
  ).bind(nextMonitorRunAt(scheduledAt, row.cadence), now, now, row.id, row.account_id, now).run();
  if (Number(claimed.meta?.changes ?? 0) !== 1) return false;
  const project = await getProject(env, row.account_id, row.project_id);
  if (!project) return false;
  const measured = measureRealEstate(await readSite(project.domain, read));
  const checks = measured.checks;
  const coverage = realEstateCoverage(checks);
  const prompts = measured.prompts;
  const saved = await recordProjectSnapshot(env, row.account_id, realEstateSnapshot({
    projectId: project.id,
    monitorId: row.id,
    windowAt: row.next_run_at,
    measuredAt: now,
    series: coverage.series,
    measurementStatus: coverage.measurementStatus,
    score: coverage.score,
    notes: coverage.notes,
  }), now);
  if (!saved) return true;
  await env.DB!.prepare(
    `UPDATE project_monitors SET query_list_json = ? WHERE id = ? AND account_id = ?`,
  ).bind(JSON.stringify(prompts), row.id, row.account_id).run();
  const missing = checks.filter((check) => check.id !== 'answer_prompts' && check.hit === false).map((check) => check.label);
  if (coverage.measurementStatus === 'measured' && missing.length > 0) {
    await recordRecommendedAction(env, {
      accountId: row.account_id,
      projectId: project.id,
      actionKey: 'monitor:re_coverage',
      title: `Fix missing real estate checks: ${missing.join(', ')}`.slice(0, 300),
      kind: 'audit',
      metric: 're_coverage',
      now,
    });
  }
  const history = await getProjectHistory(env, row.account_id, project.id, 20);
  const trend = history?.trends.find((item) => item.metric === 're_coverage' && item.subject === coverage.series);
  const delta = trend?.latestDelta ?? null;
  const kind = delta ? monitorAlertKind(delta) : null;
  if (!kind || !delta) return true;
  const sentence = kind === 'regression'
    ? `Real estate coverage fell. ${deltaSentence(delta.earlierScore, delta.laterScore, delta.scoreDelta)}`
    : `Real estate coverage rose. ${deltaSentence(delta.earlierScore, delta.laterScore, delta.scoreDelta)}`;
  if (await insertAlert(env, row, kind, sentence, saved.id, '', now) && row.email_opt_in === 1) {
    await sendAlertEmail(env, row.account_id, project.domain, [sentence], saved.id);
  }
  return true;
}

async function writeWeeklyReports(env: Env, scheduledAt: number, now: number): Promise<void> {
  if (new Date(scheduledAt).getUTCDay() !== 1 || !env.DB) return;
  const weekKey = isoWeekKey(new Date(scheduledAt));
  const due = await env.DB.prepare(
    `SELECT id, account_id, project_id, email_opt_in, query_list_json
     FROM project_monitors WHERE enabled = 1`,
  ).all<{ id: string; account_id: string; project_id: string; email_opt_in: number; query_list_json: string }>();
  for (const row of due.results || []) {
    const history = await getProjectHistory(env, row.account_id, row.project_id, 20);
    const point = history?.snapshots.find((item) => item.signals.metric === 're_coverage' && item.signals.score !== null);
    if (!point) continue;
    const trend = history?.trends.find((item) => item.metric === 're_coverage' && item.subject === point.signals.subject);
    const prompts = parsePrompts(row.query_list_json);
    const summary = [
      `Weekly project check. Real estate checks found: ${point.signals.score}.`,
      trend?.latestDelta
        ? deltaSentence(trend.latestDelta.earlierScore, trend.latestDelta.laterScore, trend.latestDelta.scoreDelta)
        : 'Too little data to measure lift.',
      prompts.length
        ? `Prompts from the pages we read, not sent to an answer engine: ${prompts.join('; ')}.`
        : 'No agency name or suburb was on the pages we read, so no prompt was built.',
    ].join(' ');
    const inserted = await insertAlert(env, { id: row.id, account_id: row.account_id, project_id: row.project_id }, 'weekly', summary, point.id, weekKey, now);
    if (!inserted || row.email_opt_in !== 1) continue;
    const project = await getProject(env, row.account_id, row.project_id);
    if (!project) continue;
    await sendAlertEmail(env, row.account_id, project.domain, [summary], point.id);
  }
}

async function runPool(rows: DueRow[], run: (row: DueRow) => Promise<boolean>): Promise<number> {
  const queue = [...rows];
  let ran = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const row = queue.shift();
      if (!row) return;
      try {
        if (await run(row)) ran += 1;
      } catch (err) {
        console.error('[Monitor] project failed', err instanceof Error ? err.name : 'error');
      }
    }
  });
  await Promise.all(workers);
  return ran;
}

export async function runProjectMonitorTick(
  env: Env,
  deps: { scheduledAt?: number; now?: number; read?: MonitorPageRead; budgetMs?: number; startedAt?: number } = {},
): Promise<{ checked: number; skipped: 'no_db' | null }> {
  if (!env.DB) return { checked: 0, skipped: 'no_db' };
  const now = deps.now ?? Date.now();
  const scheduledAt = deps.scheduledAt ?? now;
  const read = deps.read ?? defaultRead;
  const started = deps.startedAt ?? Date.now();
  const budget = deps.budgetMs ?? BUDGET_MS;
  let checked = 0;
  const seen = new Set<string>();
  let first = true;
  while (first || Date.now() - started < budget) {
    first = false;
    const due = await env.DB.prepare(
      `SELECT id, account_id, project_id, cadence, email_opt_in, next_run_at
       FROM project_monitors WHERE enabled = 1 AND next_run_at <= ?
       ORDER BY next_run_at ASC LIMIT ?`,
    ).bind(now, BATCH).all<DueRow>();
    const fresh = (due.results || []).filter((row) => !seen.has(row.id));
    if (fresh.length === 0) break;
    for (const row of fresh) seen.add(row.id);
    checked += await runPool(fresh, (row) => runOne(env, row, now, scheduledAt, read));
  }
  await writeWeeklyReports(env, scheduledAt, now);
  return { checked, skipped: null };
}

export async function refuseMonitorMeter(
  env: Env,
  accountId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  if (!MONITOR_TOOLS.has(name)) return null;
  const projectId = typeof args.projectId === 'string' ? args.projectId.trim() : '';
  if (!ID_RE.test(projectId)) return 'Project not found';
  const project = await getProject(env, accountId, projectId);
  if (!project) return 'Project not found';
  if (name !== 'set_project_monitor' || typeof args.cadence !== 'string') return null;
  const plan = planName(await readAccountPlan(env, accountId));
  if (!monitorCadenceAllowed(plan, args.cadence)) {
    return `This plan's fastest check is ${planMonitorCadence(plan)}.`;
  }
  return null;
}

function decodeId(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return ID_RE.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export async function handleProjectMonitorRoute(
  request: Request,
  env: Env,
  path: string,
  accountId: string,
): Promise<Response | null> {
  const matched = path.match(/^\/projects\/([^/]+)\/monitor(?:\/alerts(?:\/([^/]+)\/read)?)?$/);
  if (!matched) return null;
  const projectId = decodeId(matched[1] || '');
  if (!projectId) return json({ ok: false, error: 'Project not found' }, 404);
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const alertId = matched[2] ? decodeId(matched[2]) : null;

  if (alertId && request.method === 'POST') {
    const alert = await ackProjectAlert(env, accountId, projectId, alertId);
    if (!alert) return json({ ok: false, error: 'Alert not found' }, 404);
    return json({ ok: true, alert });
  }
  if (path.endsWith('/alerts') && request.method === 'GET') {
    const alerts = await listProjectAlerts(env, accountId, projectId);
    if (!alerts) return json({ ok: false, error: 'Project not found' }, 404);
    return json({ ok: true, alerts });
  }
  if (matched[2]) return json({ ok: false, error: 'Not found' }, 404);

  if (request.method === 'GET') {
    const project = await getProject(env, accountId, projectId);
    if (!project) return json({ ok: false, error: 'Project not found' }, 404);
    const monitor = await getProjectMonitor(env, accountId, projectId);
    return json({ ok: true, monitor, planCadence: planMonitorCadence(planName(await readAccountPlan(env, accountId))) });
  }
  if (request.method === 'PUT') {
    const body = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!body.ok) return json({ ok: false, error: body.error }, body.status);
    const raw = body.value;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return json({ ok: false, error: 'JSON object required.' }, 400);
    const record = raw as Record<string, unknown>;
    if (typeof record.enabled !== 'boolean' || typeof record.emailOptIn !== 'boolean' || typeof record.cadence !== 'string') {
      return json({ ok: false, error: 'enabled, emailOptIn, and cadence are required.' }, 400);
    }
    const saved = await saveProjectMonitor(env, accountId, projectId, {
      enabled: record.enabled,
      cadence: record.cadence,
      emailOptIn: record.emailOptIn,
    });
    if (!saved.ok) return json({ ok: false, error: saved.error }, saved.status);
    return json({ ok: true, monitor: saved.monitor });
  }
  return json({ error: 'Method not allowed' }, 405);
}
