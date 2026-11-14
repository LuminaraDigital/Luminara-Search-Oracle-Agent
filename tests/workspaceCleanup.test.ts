import { createHmac } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';
import { createProject } from '../worker/projectService';
import { handleMcpRequest } from '../worker/mcpServer';
import { runProjectMonitorTick } from '../worker/projectMonitor';
import { SESSION_MCP_CREDENTIAL } from '../worker/userTypes';
import { InviteBannerList } from '../components/suite/WorkspaceInviteBanner';

const botToken = '123456:CLEANUP_TEST_TOKEN';

function signInitData(userId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Tester' }),
  };
  const dcs = Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function makeEnv(): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: { get: async () => null, put: async () => {}, delete: async () => {} } as unknown as KVNamespace,
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    BOT_TOKEN: botToken,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function headers(userId: number): HeadersInit {
  return { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(userId) };
}

async function call(env: Env, userId: number, path: string, init?: RequestInit) {
  return worker.fetch(new Request(`https://luminarasuite.com/api${path}`, { ...init, headers: headers(userId) }), env, ctx);
}

async function insertUser(env: Env, id: string, email: string, verified = 1) {
  await env.DB!.prepare(
    `INSERT INTO users (id, source, email, display_name, created_at, last_seen_at, account_id, email_verified)
     VALUES (?, 'firebase', ?, 'Ada', 1, 1, ?, ?)`,
  ).bind(id, email, id, verified).run();
}

async function count(env: Env, sql: string, ...params: string[]) {
  const row = await env.DB!.prepare(sql).bind(...params).first<{ n: number }>();
  return Number(row?.n || 0);
}

describe('workspace invite acceptance', () => {
  it('keeps an existing account pending until that person accepts, and limits them to the invited client', async () => {
    const env = makeEnv();
    await insertUser(env, '802', 'viewer@example.com');
    await insertUser(env, '803', 'other@example.com');
    await call(env, 701, '/workspaces/current', { method: 'POST', body: JSON.stringify({ name: 'Harbour' }) });
    const ada = await call(env, 701, '/workspaces/current/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ada', domain: 'ada.example' }),
    });
    const adaBody = (await ada.json()) as { projectId: string; clientId: string };
    const other = await createProject(env, '701', { domain: 'bea.example', name: 'Bea', clientId: 'bea' });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    const invited = await call(env, 701, '/workspaces/current/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'viewer@example.com', role: 'client_viewer', clientId: adaBody.clientId }),
    });
    expect(invited.status).toBe(200);
    const invite = (await invited.json()) as { member: { id: string; status: string; userId: string | null } };
    expect(invite.member.status).toBe('invited');
    expect(invite.member.userId).toBeNull();

    expect((await call(env, 802, `/projects/${adaBody.projectId}`)).status).toBe(404);
    expect((await call(env, 802, '/workspaces/current')).status).toBe(404);
    const listed = await handleMcpRequest(
      new Request('https://luminarasuite.com/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }),
      }),
      env,
      { id: '802', source: 'telegram', accountId: '802' },
      SESSION_MCP_CREDENTIAL,
    );
    const listedBody = (await listed.json()) as { result?: { structuredContent?: { projects?: Array<{ id: string }> } } };
    expect(listedBody.result?.structuredContent?.projects?.map((project) => project.id) || []).not.toContain(adaBody.projectId);

    const wrong = await call(env, 803, `/workspaces/invites/${invite.member.id}/accept`, { method: 'POST' });
    expect(wrong.status).toBe(403);
    expect((await call(env, 802, `/projects/${adaBody.projectId}`)).status).toBe(404);

    const accepted = await call(env, 802, `/workspaces/invites/${invite.member.id}/accept`, { method: 'POST' });
    expect(accepted.status).toBe(200);
    expect((await call(env, 802, `/projects/${adaBody.projectId}`)).status).toBe(200);
    expect((await call(env, 802, `/projects/${other.project.id}`)).status).toBe(404);
    const write = await call(env, 802, `/projects/${adaBody.projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ industryId: 'mortgage_broker' }),
    });
    expect(write.status).toBe(403);
    const again = await call(env, 802, `/workspaces/invites/${invite.member.id}/accept`, { method: 'POST' });
    expect(again.status).toBe(409);
  });

  it('declines, revokes, and rejects an expired or unverified invite', async () => {
    const env = makeEnv();
    await insertUser(env, '802', 'viewer@example.com');
    await insertUser(env, '804', 'plain@example.com', 0);
    await call(env, 701, '/workspaces/current', { method: 'POST', body: JSON.stringify({ name: 'Harbour' }) });
    async function invite(email: string) {
      const response = await call(env, 701, '/workspaces/current/invites', {
        method: 'POST',
        body: JSON.stringify({ email, role: 'staff' }),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as { member: { id: string } };
    }
    const declineInvite = await invite('viewer@example.com');
    const open = await call(env, 802, '/workspaces/invites');
    const openBody = (await open.json()) as { invites: Array<{ id: string }> };
    expect(openBody.invites.map((row) => row.id)).toEqual([declineInvite.member.id]);
    expect((await call(env, 802, `/workspaces/invites/${declineInvite.member.id}/decline`, { method: 'POST' })).status).toBe(200);
    expect((await call(env, 802, `/workspaces/invites/${declineInvite.member.id}/accept`, { method: 'POST' })).status).toBe(409);
    expect(((await (await call(env, 802, '/workspaces/invites')).json()) as { invites: unknown[] }).invites).toEqual([]);

    const revoked = await invite('viewer@example.com');
    expect((await call(env, 701, `/workspaces/current/invites/${revoked.member.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(env, 802, `/workspaces/invites/${revoked.member.id}/accept`, { method: 'POST' })).status).toBe(404);

    const expired = await invite('viewer@example.com');
    await env.DB!.prepare(`UPDATE client_workspace_members SET expires_at = 1 WHERE id = ?`).bind(expired.member.id).run();
    const expiredReply = await call(env, 802, `/workspaces/invites/${expired.member.id}/accept`, { method: 'POST' });
    expect(expiredReply.status).toBe(409);
    expect(((await expiredReply.json()) as { code: string }).code).toBe('INVITE_EXPIRED');

    const unverified = await invite('plain@example.com');
    const refused = await call(env, 804, `/workspaces/invites/${unverified.member.id}/accept`, { method: 'POST' });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('EMAIL_UNVERIFIED');
  });
});

describe('safe deletes', () => {
  it('removes a project and the rows the crons read, and refuses a client viewer and another account', async () => {
    const env = makeEnv();
    await insertUser(env, '802', 'viewer@example.com');
    await insertUser(env, '803', 'staff@example.com');
    await call(env, 701, '/workspaces/current', { method: 'POST', body: JSON.stringify({ name: 'Harbour' }) });
    const created = await call(env, 701, '/projects', {
      method: 'POST',
      body: JSON.stringify({ domain: 'solo.example', name: 'Solo' }),
    });
    expect(created.status).toBe(200);
    const projectId = ((await created.json()) as { project: { id: string } }).project.id;
    const kept = await createProject(env, '904', { domain: 'kept.example', name: 'Kept' });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    const now = 1;
    await env.DB!.prepare(
      `INSERT INTO project_monitors
        (id, account_id, project_id, enabled, cadence, email_opt_in, query_list_json, next_run_at, created_at, updated_at)
       VALUES ('mon_solo', '701', ?, 1, 'monthly', 0, '[]', ?, ?, ?)`,
    ).bind(projectId, now, now, now).run();
    await env.DB!.prepare(
      `INSERT INTO project_monitors
        (id, account_id, project_id, enabled, cadence, email_opt_in, query_list_json, next_run_at, created_at, updated_at)
       VALUES ('mon_kept', '904', ?, 0, 'monthly', 0, '[]', ?, ?, ?)`,
    ).bind(kept.project.id, now, now, now).run();
    await env.DB!.prepare(
      `INSERT INTO project_measurement_snapshots
        (id, account_id, project_id, kind, measured_at, source_ref, signals_json, created_at)
       VALUES ('snap_solo', '701', ?, 'audit', ?, 'src', '{}', ?)`,
    ).bind(projectId, now, now).run();
    await env.DB!.prepare(
      `INSERT INTO project_action_outcomes
        (id, account_id, project_id, action_key, title, kind, status, metric, data_label, recommended_at)
       VALUES ('out_solo', '701', ?, 'k', 'Title', 'audit', 'recommended', 'score', 'too_little_data', ?)`,
    ).bind(projectId, now).run();
    await env.DB!.prepare(
      `INSERT INTO recovery_runs
        (id, account_id, project_id, enquiry_id, contact_id, playbook_id, status, next_wake_at, created_at, updated_at)
       VALUES ('run_solo', '701', ?, 'enq', 'con', 'play', 'active', ?, ?, ?)`,
    ).bind(projectId, now, now, now).run();
    await env.DB!.prepare(
      `INSERT INTO citation_watches
        (id, account_id, client_id, domain, engine, prompts_json, prompts_sha256, cadence, active, next_run_at, created_at)
       VALUES ('watch_solo', '701', '', 'solo.example', 'chatgpt', '[]', 'abc', 'monthly', 1, ?, ?)`,
    ).bind(now, now).run();
    await env.DB!.prepare(
      `INSERT INTO citation_watches
        (id, account_id, client_id, domain, engine, prompts_json, prompts_sha256, cadence, active, next_run_at, created_at)
       VALUES ('watch_kept', '904', '', 'kept.example', 'chatgpt', '[]', 'def', 'monthly', 1, ?, ?)`,
    ).bind(now, now).run();

    const client = await call(env, 701, '/workspaces/current/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ada', domain: 'ada.example' }),
    });
    const clientBody = (await client.json()) as { projectId: string; clientId: string };
    const invited = await call(env, 701, '/workspaces/current/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'viewer@example.com', role: 'client_viewer', clientId: clientBody.clientId }),
    });
    const invite = (await invited.json()) as { member: { id: string } };
    await call(env, 802, `/workspaces/invites/${invite.member.id}/accept`, { method: 'POST' });
    expect((await call(env, 802, `/projects/${clientBody.projectId}`, { method: 'DELETE' })).status).toBe(403);
    expect((await call(env, 904, `/projects/${projectId}`, { method: 'DELETE' })).status).toBe(404);
    expect((await call(env, 701, `/projects/${projectId}`)).status).toBe(200);

    const removed = await call(env, 701, `/projects/${projectId}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect((await call(env, 701, `/projects/${projectId}`)).status).toBe(404);
    expect(await count(env, `SELECT COUNT(*) AS n FROM project_monitors WHERE project_id = ?`, projectId)).toBe(0);
    expect(await count(env, `SELECT COUNT(*) AS n FROM project_measurement_snapshots WHERE project_id = ?`, projectId)).toBe(0);
    expect(await count(env, `SELECT COUNT(*) AS n FROM project_action_outcomes WHERE project_id = ?`, projectId)).toBe(0);
    expect(await count(env, `SELECT COUNT(*) AS n FROM recovery_runs WHERE project_id = ?`, projectId)).toBe(0);
    expect(await count(env, `SELECT COUNT(*) AS n FROM citation_watches WHERE id = 'watch_solo'`)).toBe(0);
    expect(await count(env, `SELECT COUNT(*) AS n FROM project_monitors WHERE id = 'mon_kept'`)).toBe(1);
    expect(await count(env, `SELECT COUNT(*) AS n FROM citation_watches WHERE id = 'watch_kept'`)).toBe(1);
    const tick = await runProjectMonitorTick(env, { now: Date.UTC(2026, 0, 5, 8, 0, 0), scheduledAt: Date.UTC(2026, 0, 5, 8, 0, 0), read: async () => { throw new Error('read'); } });
    expect(tick.checked).toBe(0);
    const audit = await env.DB!.prepare(`SELECT actor_id FROM org_audit_logs WHERE action = 'project_deleted' AND target_id = ?`)
      .bind(projectId)
      .first<{ actor_id: string }>();
    expect(audit?.actor_id).toBe('701');

    const staffInvite = await call(env, 701, '/workspaces/current/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'staff@example.com', role: 'staff' }),
    });
    const staff = (await staffInvite.json()) as { member: { id: string } };
    expect((await call(env, 803, `/workspaces/invites/${staff.member.id}/accept`, { method: 'POST' })).status).toBe(200);
    expect((await call(env, 803, `/projects/${clientBody.projectId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(env, 701, `/projects/${clientBody.projectId}`)).status).toBe(404);
  });

  it('frees a client slot, blocks the last owner removal, and deletes a workspace only when allowed', async () => {
    const env = makeEnv();
    await insertUser(env, '802', 'viewer@example.com');
    await insertUser(env, '803', 'staff@example.com');
    await call(env, 701, '/workspaces/current', { method: 'POST', body: JSON.stringify({ name: 'Harbour' }) });
    await call(env, 904, '/workspaces/current', { method: 'POST', body: JSON.stringify({ name: 'Other' }) });
    const first = await call(env, 701, '/workspaces/current/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ada', domain: 'ada.example' }),
    });
    const firstBody = (await first.json()) as { clientId: string; projectId: string };
    expect((await call(env, 701, '/workspaces/current/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bea', domain: 'bea.example' }),
    })).status).toBe(403);

    const viewerInvite = await call(env, 701, '/workspaces/current/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'viewer@example.com', role: 'client_viewer', clientId: firstBody.clientId }),
    });
    const viewer = (await viewerInvite.json()) as { member: { id: string } };
    await call(env, 802, `/workspaces/invites/${viewer.member.id}/accept`, { method: 'POST' });
    expect((await call(env, 802, `/workspaces/current/clients/${firstBody.clientId}`, { method: 'DELETE' })).status).toBe(403);
    expect((await call(env, 904, `/workspaces/current/clients/${firstBody.clientId}`, { method: 'DELETE' })).status).toBe(404);
    expect((await call(env, 701, `/projects/${firstBody.projectId}`)).status).toBe(200);

    const staffInvite = await call(env, 701, '/workspaces/current/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'staff@example.com', role: 'staff' }),
    });
    const staff = (await staffInvite.json()) as { member: { id: string } };
    await call(env, 803, `/workspaces/invites/${staff.member.id}/accept`, { method: 'POST' });
    expect((await call(env, 803, `/workspaces/current/invites/${viewer.member.id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await call(env, 803, `/workspaces/current/clients/${firstBody.clientId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(env, 701, `/projects/${firstBody.projectId}`)).status).toBe(404);
    const second = await call(env, 701, '/workspaces/current/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bea', domain: 'bea.example' }),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { clientId: string };

    const blocked = await call(env, 701, '/workspaces/current', { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    expect((await call(env, 701, '/workspaces/current')).status).toBe(200);
    const confirmed = await call(env, 701, '/workspaces/current?confirm=true', { method: 'DELETE' });
    expect(confirmed.status).toBe(200);
    expect((await call(env, 701, '/workspaces/current')).status).toBe(404);

    await call(env, 701, '/workspaces/current', { method: 'POST', body: JSON.stringify({ name: 'Harbour' }) });
    const members = await call(env, 701, '/workspaces/current/members');
    const memberBody = (await members.json()) as { members: Array<{ email: string; role: string; id: string }> };
    const owner = memberBody.members.find((member) => member.role === 'owner');
    expect(owner?.email).toBe('user:701');
    const last = await call(env, 701, `/workspaces/current/members/${encodeURIComponent(owner!.email)}`, { method: 'DELETE' });
    expect(last.status).toBe(409);
    const staffAgain = await call(env, 701, '/workspaces/current/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'staff@example.com', role: 'staff' }),
    });
    const staffMember = (await staffAgain.json()) as { member: { id: string } };
    await call(env, 803, `/workspaces/invites/${staffMember.member.id}/accept`, { method: 'POST' });
    expect((await call(env, 701, `/workspaces/current/members/${staffMember.member.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(env, 701, `/workspaces/current/clients/${secondBody.clientId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(env, 701, '/workspaces/current', { method: 'DELETE' })).status).toBe(200);
    const audit = await count(env, `SELECT COUNT(*) AS n FROM org_audit_logs WHERE action = 'workspace_deleted'`);
    expect(audit).toBe(2);
  });
});

describe('invite banner', () => {
  it('shows accept and decline for a pending invite', () => {
    const html = renderToStaticMarkup(createElement(InviteBannerList, {
      invites: [{ id: 'inv_1', workspaceName: 'Harbour', role: 'client_viewer' }],
      busyId: null,
      onAccept: () => {},
      onDecline: () => {},
    }));
    expect(html).toContain('Harbour invited you as a client viewer.');
    expect(html).toContain('Accept');
    expect(html).toContain('Decline');
  });
});
