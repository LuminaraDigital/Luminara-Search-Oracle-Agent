/**
 * One workspace per billing account. The account owner is the owner.
 * Staff can work every client. A client-viewer can only read one client_id.
 * Brand fields are stored for a later white-label report. This file does not render them.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId } from './workerUtils';
import { randomId } from '../services/projects/projectUtils';
import { createProject, listProjects } from './projectService';
import { entitlementsFor } from '../services/plans/planEntitlements';
import { getActiveSubscription } from './quotaMiddleware';
import type { IndustryId } from '../services/industries/industryProfiles';

export type WorkspaceRole = 'owner' | 'staff' | 'client_viewer';

export interface ClientWorkspace {
  id: string;
  accountId: string;
  name: string;
  displayName: string | null;
  logoUrl: string | null;
  primaryColour: string | null;
  reportDomain: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceMember {
  workspaceId: string;
  email: string;
  userId: string | null;
  role: WorkspaceRole;
  clientId: string | null;
  status: 'invited' | 'active';
}

type WorkspaceRow = {
  id: string;
  account_id: string;
  name: string;
  display_name: string | null;
  logo_url: string | null;
  primary_colour: string | null;
  report_domain: string | null;
  created_at: number;
  updated_at: number;
};

function rowToWorkspace(row: WorkspaceRow): ClientWorkspace {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    displayName: row.display_name,
    logoUrl: row.logo_url,
    primaryColour: row.primary_colour,
    reportDomain: row.report_domain,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const WORKSPACE_SELECT = `id, account_id, name, display_name, logo_url, primary_colour, report_domain, created_at, updated_at`;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  return value.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function workspaceForAccount(env: Env, accountId: string): Promise<ClientWorkspace | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`SELECT ${WORKSPACE_SELECT} FROM client_workspaces WHERE account_id = ?`)
    .bind(accountId)
    .first<WorkspaceRow>();
  return row ? rowToWorkspace(row) : null;
}

export async function workspaceById(env: Env, workspaceId: string): Promise<ClientWorkspace | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`SELECT ${WORKSPACE_SELECT} FROM client_workspaces WHERE id = ?`)
    .bind(workspaceId)
    .first<WorkspaceRow>();
  return row ? rowToWorkspace(row) : null;
}

export async function createWorkspace(env: Env, user: HostedIdentity, name: string): Promise<ClientWorkspace> {
  const accountId = billingId(user);
  const existing = await workspaceForAccount(env, accountId);
  if (existing) return existing;
  const now = Date.now();
  const id = randomId('ws');
  const trimmed = name.trim().slice(0, 120) || 'Workspace';
  await env.DB!.prepare(
    `INSERT INTO client_workspaces
      (id, account_id, name, display_name, logo_url, primary_colour, report_domain, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
  )
    .bind(id, accountId, trimmed, now, now)
    .run();
  const email = user.email ? normalizeEmail(user.email) : `user:${user.id}`;
  await env.DB!.prepare(
    `INSERT INTO client_workspace_members
      (workspace_id, email, user_id, role, client_id, status, invited_at, accepted_at)
     VALUES (?, ?, ?, 'owner', NULL, 'active', ?, ?)`,
  )
    .bind(id, email, user.id, now, now)
    .run();
  const created = await workspaceForAccount(env, accountId);
  if (!created) throw new Error('Workspace created but not readable');
  return created;
}

export interface BrandPatch {
  displayName: string | null;
  logoUrl: string | null;
  primaryColour: string | null;
  reportDomain: string | null;
}

export function parseBrandPatch(raw: Record<string, unknown>): { ok: true; patch: BrandPatch } | { ok: false; error: string } {
  const displayName = raw.displayName === null || raw.displayName === undefined
    ? null
    : typeof raw.displayName === 'string'
      ? raw.displayName.trim().slice(0, 120)
      : undefined;
  if (displayName === undefined) return { ok: false, error: 'displayName must be text or null.' };
  let logoUrl: string | null = null;
  if (raw.logoUrl !== null && raw.logoUrl !== undefined && raw.logoUrl !== '') {
    if (typeof raw.logoUrl !== 'string' || raw.logoUrl.length > 500) return { ok: false, error: 'logoUrl must be an https URL or null.' };
    try {
      const url = new URL(raw.logoUrl);
      if (url.protocol !== 'https:') return { ok: false, error: 'logoUrl must be an https URL or null.' };
      logoUrl = url.toString();
    } catch {
      return { ok: false, error: 'logoUrl must be an https URL or null.' };
    }
  }
  let primaryColour: string | null = null;
  if (raw.primaryColour !== null && raw.primaryColour !== undefined && raw.primaryColour !== '') {
    if (typeof raw.primaryColour !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw.primaryColour)) {
      return { ok: false, error: 'primaryColour must be a hex colour like #1B4D3E, or null.' };
    }
    primaryColour = raw.primaryColour.toLowerCase();
  }
  let reportDomain: string | null = null;
  if (raw.reportDomain !== null && raw.reportDomain !== undefined && raw.reportDomain !== '') {
    if (typeof raw.reportDomain !== 'string') return { ok: false, error: 'reportDomain must be a hostname or null.' };
    const host = raw.reportDomain.trim().toLowerCase();
    if (host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) {
      return { ok: false, error: 'reportDomain must be a hostname or null.' };
    }
    reportDomain = host;
  }
  return { ok: true, patch: { displayName: displayName || null, logoUrl, primaryColour, reportDomain } };
}

export async function updateWorkspaceBrand(env: Env, workspace: ClientWorkspace, patch: BrandPatch): Promise<ClientWorkspace> {
  const now = Date.now();
  await env.DB!.prepare(
    `UPDATE client_workspaces
     SET display_name = ?, logo_url = ?, primary_colour = ?, report_domain = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(patch.displayName, patch.logoUrl, patch.primaryColour, patch.reportDomain, now, workspace.id)
    .run();
  const next = await workspaceById(env, workspace.id);
  if (!next) throw new Error('Workspace updated but not readable');
  return next;
}

export async function acceptPendingInvites(env: Env, user: HostedIdentity): Promise<void> {
  if (!env.DB || !user.email) return;
  const email = normalizeEmail(user.email);
  if (!isEmail(email)) return;
  await env.DB.prepare(
    `UPDATE client_workspace_members
     SET user_id = ?, status = 'active', accepted_at = COALESCE(accepted_at, ?)
     WHERE email = ? AND status = 'invited'`,
  )
    .bind(user.id, Date.now(), email)
    .run();
}

type MemberRow = {
  workspace_id: string;
  email: string;
  user_id: string | null;
  role: string;
  client_id: string | null;
  status: string;
  account_id: string;
};

function isRole(value: string): value is WorkspaceRole {
  return value === 'owner' || value === 'staff' || value === 'client_viewer';
}

export async function membershipsForUser(env: Env, userId: string): Promise<Array<WorkspaceMember & { accountId: string }>> {
  if (!env.DB) return [];
  const res = await env.DB.prepare(
    `SELECT m.workspace_id, m.email, m.user_id, m.role, m.client_id, m.status, w.account_id
     FROM client_workspace_members m
     JOIN client_workspaces w ON w.id = m.workspace_id
     WHERE m.user_id = ? AND m.status = 'active'`,
  )
    .bind(userId)
    .all<MemberRow>();
  const rows: Array<WorkspaceMember & { accountId: string }> = [];
  for (const row of res.results || []) {
    if (!isRole(row.role) || (row.status !== 'active' && row.status !== 'invited')) continue;
    rows.push({
      workspaceId: row.workspace_id,
      email: row.email,
      userId: row.user_id,
      role: row.role,
      clientId: row.client_id,
      status: row.status,
      accountId: row.account_id,
    });
  }
  return rows;
}

export async function listMembers(env: Env, workspaceId: string): Promise<WorkspaceMember[]> {
  if (!env.DB) return [];
  const res = await env.DB.prepare(
    `SELECT workspace_id, email, user_id, role, client_id, status
     FROM client_workspace_members WHERE workspace_id = ? ORDER BY invited_at ASC`,
  )
    .bind(workspaceId)
    .all<{
      workspace_id: string;
      email: string;
      user_id: string | null;
      role: string;
      client_id: string | null;
      status: string;
    }>();
  const members: WorkspaceMember[] = [];
  for (const row of res.results || []) {
    if (!isRole(row.role) || (row.status !== 'active' && row.status !== 'invited')) continue;
    members.push({
      workspaceId: row.workspace_id,
      email: row.email,
      userId: row.user_id,
      role: row.role,
      clientId: row.client_id,
      status: row.status,
    });
  }
  return members;
}

async function userIdForEmail(env: Env, email: string): Promise<string | null> {
  const row = await env.DB!.prepare(`SELECT id FROM users WHERE lower(email) = ? LIMIT 1`)
    .bind(email)
    .first<{ id: string }>();
  return row?.id || null;
}

export async function inviteMember(
  env: Env,
  workspace: ClientWorkspace,
  input: { email: string; role: 'staff' | 'client_viewer'; clientId?: string },
): Promise<{ ok: true; member: WorkspaceMember } | { ok: false; error: string; status: number }> {
  const email = normalizeEmail(input.email);
  if (!isEmail(email)) return { ok: false, error: 'Enter a valid email address.', status: 400 };
  if (input.role === 'client_viewer' && !input.clientId?.trim()) {
    return { ok: false, error: 'A client viewer invite needs clientId.', status: 400 };
  }
  const clientId = input.role === 'client_viewer' ? input.clientId!.trim().slice(0, 80) : null;
  if (clientId) {
    const projects = await listProjects(env, workspace.accountId, clientId);
    if (projects.length === 0) return { ok: false, error: 'That client has no project yet.', status: 400 };
  }
  const existingUser = await userIdForEmail(env, email);
  const now = Date.now();
  const status = existingUser ? 'active' : 'invited';
  await env.DB!.prepare(
    `INSERT INTO client_workspace_members
      (workspace_id, email, user_id, role, client_id, status, invited_at, accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, email) DO UPDATE SET
       user_id = excluded.user_id,
       role = excluded.role,
       client_id = excluded.client_id,
       status = excluded.status,
       accepted_at = excluded.accepted_at`,
  )
    .bind(workspace.id, email, existingUser, input.role, clientId, status, now, existingUser ? now : null)
    .run();
  return {
    ok: true,
    member: {
      workspaceId: workspace.id,
      email,
      userId: existingUser,
      role: input.role,
      clientId,
      status,
    },
  };
}

export async function assertNewClientAllowed(
  env: Env,
  accountId: string,
  clientId: string | undefined,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const id = (clientId || '').trim();
  if (!id || !env.DB) return { ok: true };
  const existing = await listProjects(env, accountId, id);
  if (existing.length > 0) return { ok: true };
  const sub = await getActiveSubscription(env, { id: accountId, source: 'firebase', accountId });
  const limit = entitlementsFor(sub?.plan).workspaceClientLimit;
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT client_id) AS n FROM projects WHERE account_id = ? AND client_id != ''`,
  )
    .bind(accountId)
    .first<{ n: number }>();
  const count = Number(row?.n || 0);
  if (count >= limit) {
    return {
      ok: false,
      status: 403,
      error: `This plan includes ${limit} client${limit === 1 ? '' : 's'}. The client limit is a placeholder until a paid workspace price exists.`,
    };
  }
  return { ok: true };
}

export async function countClients(env: Env, accountId: string): Promise<number> {
  if (!env.DB) return 0;
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT client_id) AS n FROM projects WHERE account_id = ? AND client_id != ''`,
  )
    .bind(accountId)
    .first<{ n: number }>();
  return Number(row?.n || 0);
}

export interface WorkspaceClientCard {
  clientId: string;
  name: string;
  projectId: string;
  domain: string;
  latestAudit: { measurement: 'measured'; score: number } | { measurement: 'not_measured'; score: null };
  monitor: 'on' | 'off' | 'not_set';
}

function readScore(raw: string | null): WorkspaceClientCard['latestAudit'] {
  if (!raw) return { measurement: 'not_measured', score: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { measurement: 'not_measured', score: null };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { measurement: 'not_measured', score: null };
  const scoreValue = 'score' in parsed ? parsed.score : undefined;
  const statusValue = 'measurementStatus' in parsed ? parsed.measurementStatus : undefined;
  const score = typeof scoreValue === 'number' && Number.isFinite(scoreValue) ? scoreValue : null;
  if (statusValue === 'measured' && score !== null) return { measurement: 'measured', score };
  return { measurement: 'not_measured', score: null };
}

export async function listWorkspaceClients(
  env: Env,
  accountId: string,
  clientId: string | null,
): Promise<WorkspaceClientCard[]> {
  if (!env.DB) return [];
  const res = await env.DB.prepare(
    `SELECT p.id, p.client_id, p.name, p.domain,
        (SELECT signals_json FROM project_measurement_snapshots s
          WHERE s.account_id = p.account_id AND s.project_id = p.id AND s.kind IN ('audit', 'instant_audit')
          ORDER BY s.measured_at DESC LIMIT 1) AS signals_json,
        (SELECT measured_at FROM project_measurement_snapshots s
          WHERE s.account_id = p.account_id AND s.project_id = p.id AND s.kind IN ('audit', 'instant_audit')
          ORDER BY s.measured_at DESC LIMIT 1) AS measured_at,
        m.enabled AS monitor_enabled
     FROM projects p
     LEFT JOIN project_monitors m ON m.account_id = p.account_id AND m.project_id = p.id
     WHERE p.account_id = ?${clientId ? ' AND p.client_id = ?' : ''}
     ORDER BY p.updated_at DESC
     LIMIT 200`,
  )
    .bind(...(clientId ? [accountId, clientId] : [accountId]))
    .all<{
      id: string;
      client_id: string;
      name: string;
      domain: string;
      signals_json: string | null;
      measured_at: number | null;
      monitor_enabled: number | null;
    }>();
  const grouped = new Map<string, WorkspaceClientCard & { measuredAt: number }>();
  for (const row of res.results || []) {
    const key = row.client_id || '';
    const measuredAt = Number(row.measured_at || 0);
    const audit = readScore(row.signals_json);
    const monitor: WorkspaceClientCard['monitor'] = row.monitor_enabled === null ? 'not_set' : row.monitor_enabled ? 'on' : 'off';
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        clientId: key,
        name: row.name,
        projectId: row.id,
        domain: row.domain,
        latestAudit: audit,
        monitor,
        measuredAt,
      });
      continue;
    }
    if (monitor === 'on') current.monitor = 'on';
    else if (current.monitor === 'not_set' && monitor === 'off') current.monitor = 'off';
    if (measuredAt > current.measuredAt) {
      current.measuredAt = measuredAt;
      current.latestAudit = audit;
      current.projectId = row.id;
      current.domain = row.domain;
      current.name = row.name;
    }
  }
  return [...grouped.values()].map(({ measuredAt: _measuredAt, ...card }) => card);
}

export async function addWorkspaceClient(
  env: Env,
  accountId: string,
  input: { name: string; domain: string; industryId?: IndustryId },
): Promise<{ ok: true; projectId: string; clientId: string } | { ok: false; error: string; status: number }> {
  const clientId = randomId('client');
  const slot = await assertNewClientAllowed(env, accountId, clientId);
  if (!slot.ok) return slot;
  const created = await createProject(env, accountId, {
    domain: input.domain,
    name: input.name,
    clientId,
    industryId: input.industryId,
  });
  if (!created.ok) return created;
  return { ok: true, projectId: created.project.id, clientId };
}
