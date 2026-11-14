/**
 * One workspace per billing account. The account owner is the owner.
 * Staff can work every client. A client-viewer can only read one client_id.
 * An invite stays pending until that person accepts. A pending invite grants nothing.
 * Brand fields are stored for a later white-label report. This file does not render them.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId } from './workerUtils';
import { randomId } from '../services/projects/projectUtils';
import { createProject, deleteProject, listProjects } from './projectService';
import { auditOrgIdFor, recordAuditLogBestEffort } from './auditLog';
import { entitlementsFor } from '../services/plans/planEntitlements';
import { getActiveSubscription } from './quotaMiddleware';
import type { IndustryId } from '../services/industries/industryProfiles';

export type WorkspaceRole = 'owner' | 'staff' | 'client_viewer';

/** New invites expire after 14 days. Rows from before this column have no expiry. */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

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
  id: string;
  workspaceId: string;
  email: string;
  userId: string | null;
  role: WorkspaceRole;
  clientId: string | null;
  status: 'invited' | 'active';
  expiresAt: number | null;
}

export interface PendingInvite {
  id: string;
  workspaceId: string;
  workspaceName: string;
  role: 'staff' | 'client_viewer';
  clientId: string | null;
  expiresAt: number | null;
  invitedAt: number;
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
      (id, workspace_id, email, user_id, role, client_id, status, invited_at, accepted_at)
     VALUES (?, ?, ?, ?, 'owner', NULL, 'active', ?, ?)`,
  )
    .bind(randomId('inv'), id, email, user.id, now, now)
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

type MemberRow = {
  id: string | null;
  workspace_id: string;
  email: string;
  user_id: string | null;
  role: string;
  client_id: string | null;
  status: string;
  expires_at?: number | null;
  account_id: string;
};

function isRole(value: string): value is WorkspaceRole {
  return value === 'owner' || value === 'staff' || value === 'client_viewer';
}

export async function membershipsForUser(env: Env, userId: string): Promise<Array<WorkspaceMember & { accountId: string }>> {
  if (!env.DB) return [];
  const res = await env.DB.prepare(
    `SELECT m.id, m.workspace_id, m.email, m.user_id, m.role, m.client_id, m.status, m.expires_at, w.account_id
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
      id: row.id || row.email,
      workspaceId: row.workspace_id,
      email: row.email,
      userId: row.user_id,
      role: row.role,
      clientId: row.client_id,
      status: row.status,
      expiresAt: row.expires_at ?? null,
      accountId: row.account_id,
    });
  }
  return rows;
}

export async function listMembers(env: Env, workspaceId: string): Promise<WorkspaceMember[]> {
  if (!env.DB) return [];
  const res = await env.DB.prepare(
    `SELECT id, workspace_id, email, user_id, role, client_id, status, expires_at
     FROM client_workspace_members
     WHERE workspace_id = ? AND declined_at IS NULL
     ORDER BY invited_at ASC`,
  )
    .bind(workspaceId)
    .all<{
      id: string | null;
      workspace_id: string;
      email: string;
      user_id: string | null;
      role: string;
      client_id: string | null;
      status: string;
      expires_at: number | null;
    }>();
  const members: WorkspaceMember[] = [];
  for (const row of res.results || []) {
    if (!isRole(row.role) || (row.status !== 'active' && row.status !== 'invited')) continue;
    members.push({
      id: row.id || row.email,
      workspaceId: row.workspace_id,
      email: row.email,
      userId: row.user_id,
      role: row.role,
      clientId: row.client_id,
      status: row.status,
      expiresAt: row.expires_at,
    });
  }
  return members;
}

async function verifiedEmail(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB!.prepare(`SELECT email, email_verified FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ email: string | null; email_verified: number | null }>();
  if (!row?.email || row.email_verified !== 1) return null;
  const email = normalizeEmail(row.email);
  return isEmail(email) ? email : null;
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
  const existing = await env.DB!.prepare(
    `SELECT status FROM client_workspace_members WHERE workspace_id = ? AND email = ?`,
  )
    .bind(workspace.id, email)
    .first<{ status: string }>();
  if (existing?.status === 'active') {
    return { ok: false, error: 'That email is already a member of this workspace.', status: 409 };
  }
  const now = Date.now();
  const id = randomId('inv');
  const expiresAt = now + INVITE_TTL_MS;
  await env.DB!.prepare(
    `INSERT INTO client_workspace_members
      (id, workspace_id, email, user_id, role, client_id, status, invited_at, accepted_at, expires_at, declined_at)
     VALUES (?, ?, ?, NULL, ?, ?, 'invited', ?, NULL, ?, NULL)
     ON CONFLICT(workspace_id, email) DO UPDATE SET
       id = CASE WHEN client_workspace_members.status = 'active' THEN client_workspace_members.id ELSE excluded.id END,
       user_id = CASE WHEN client_workspace_members.status = 'active' THEN client_workspace_members.user_id ELSE NULL END,
       role = CASE WHEN client_workspace_members.status = 'active' THEN client_workspace_members.role ELSE excluded.role END,
       client_id = CASE WHEN client_workspace_members.status = 'active' THEN client_workspace_members.client_id ELSE excluded.client_id END,
       status = CASE WHEN client_workspace_members.status = 'active' THEN client_workspace_members.status ELSE 'invited' END,
       invited_at = CASE WHEN client_workspace_members.status = 'active' THEN client_workspace_members.invited_at ELSE excluded.invited_at END,
       accepted_at = CASE WHEN client_workspace_members.status = 'active' THEN client_workspace_members.accepted_at ELSE NULL END,
       expires_at = CASE WHEN client_workspace_members.status = 'active' THEN client_workspace_members.expires_at ELSE excluded.expires_at END,
       declined_at = CASE WHEN client_workspace_members.status = 'active' THEN client_workspace_members.declined_at ELSE NULL END`,
  )
    .bind(id, workspace.id, email, input.role, clientId, now, expiresAt)
    .run();
  const saved = await env.DB!.prepare(
    `SELECT id, status FROM client_workspace_members WHERE workspace_id = ? AND email = ?`,
  )
    .bind(workspace.id, email)
    .first<{ id: string; status: string }>();
  if (saved?.status === 'active') {
    return { ok: false, error: 'That email is already a member of this workspace.', status: 409 };
  }
  return {
    ok: true,
    member: {
      id: saved?.id || id,
      workspaceId: workspace.id,
      email,
      userId: null,
      role: input.role,
      clientId,
      status: 'invited',
      expiresAt,
    },
  };
}

type InviteRow = {
  id: string;
  workspace_id: string;
  account_id: string;
  email: string;
  role: string;
  client_id: string | null;
  status: string;
  expires_at: number | null;
  declined_at: number | null;
  invited_at: number;
  name: string;
};

function inviteClosed(row: InviteRow, now: number): { error: string; status: number; code: string } | null {
  if (row.status === 'active') return { error: 'This invite was already accepted.', status: 409, code: 'INVITE_ACCEPTED' };
  if (row.declined_at != null) return { error: 'This invite was declined.', status: 409, code: 'INVITE_DECLINED' };
  if (row.expires_at != null && row.expires_at <= now) return { error: 'This invite has expired.', status: 409, code: 'INVITE_EXPIRED' };
  if (row.status !== 'invited') return { error: 'This invite can no longer be used.', status: 409, code: 'INVITE_CLOSED' };
  return null;
}

export async function listPendingInvites(env: Env, user: HostedIdentity): Promise<PendingInvite[]> {
  if (!env.DB) return [];
  const email = await verifiedEmail(env, user.id);
  if (!email) return [];
  const now = Date.now();
  const res = await env.DB.prepare(
    `SELECT m.id, m.workspace_id, w.name, m.role, m.client_id, m.expires_at, m.invited_at
     FROM client_workspace_members m
     JOIN client_workspaces w ON w.id = m.workspace_id
     WHERE m.email = ? AND m.status = 'invited' AND m.declined_at IS NULL
       AND m.role IN ('staff', 'client_viewer')
       AND (m.expires_at IS NULL OR m.expires_at > ?)
     ORDER BY m.invited_at ASC`,
  )
    .bind(email, now)
    .all<{
      id: string;
      workspace_id: string;
      name: string;
      role: string;
      client_id: string | null;
      expires_at: number | null;
      invited_at: number;
    }>();
  const invites: PendingInvite[] = [];
  for (const row of res.results || []) {
    const role = row.role === 'staff' || row.role === 'client_viewer' ? row.role : null;
    if (!role) continue;
    invites.push({
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceName: row.name,
      role,
      clientId: row.client_id,
      expiresAt: row.expires_at,
      invitedAt: row.invited_at,
    });
  }
  return invites;
}

export async function respondToInvite(
  env: Env,
  user: HostedIdentity,
  inviteId: string,
  decision: 'accept' | 'decline',
): Promise<{ ok: true; invite: PendingInvite } | { ok: false; error: string; status: number; code: string }> {
  if (!env.DB) return { ok: false, error: 'Database unavailable', status: 503, code: 'DB_UNBOUND' };
  const email = await verifiedEmail(env, user.id);
  if (!email) {
    return { ok: false, error: 'Verify your email before answering an invite.', status: 403, code: 'EMAIL_UNVERIFIED' };
  }
  const row = await env.DB.prepare(
    `SELECT m.id, m.workspace_id, w.account_id, m.email, m.role, m.client_id, m.status, m.expires_at, m.declined_at, m.invited_at, w.name
     FROM client_workspace_members m
     JOIN client_workspaces w ON w.id = m.workspace_id
     WHERE m.id = ?`,
  )
    .bind(inviteId)
    .first<InviteRow>();
  const role = row?.role === 'staff' || row?.role === 'client_viewer' ? row.role : null;
  if (!row || !role) {
    return { ok: false, error: 'Not found', status: 404, code: 'NOT_FOUND' };
  }
  if (row.email !== email) {
    return { ok: false, error: 'This invite is for a different email.', status: 403, code: 'INVITE_EMAIL_MISMATCH' };
  }
  const now = Date.now();
  const closed = inviteClosed(row, now);
  if (closed) return { ok: false, ...closed };
  const invite: PendingInvite = {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.name,
    role,
    clientId: row.client_id,
    expiresAt: row.expires_at,
    invitedAt: row.invited_at,
  };
  if (decision === 'decline') {
    const result = await env.DB.prepare(
      `UPDATE client_workspace_members
       SET declined_at = ?
       WHERE id = ? AND email = ? AND status = 'invited' AND declined_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`,
    )
      .bind(now, row.id, email, now)
      .run();
    if (Number(result.meta?.changes ?? 0) !== 1) {
      return { ok: false, error: 'This invite can no longer be used.', status: 409, code: 'INVITE_CLOSED' };
    }
    await recordAuditLogBestEffort(env, {
      org_id: auditOrgIdFor(row.account_id),
      actor_id: user.id,
      action: 'workspace_invite_declined',
      target_id: row.id,
      details: { email, role: row.role },
    });
    return { ok: true, invite };
  }
  const result = await env.DB.prepare(
    `UPDATE client_workspace_members
     SET user_id = ?, status = 'active', accepted_at = ?, declined_at = NULL
     WHERE id = ? AND email = ? AND status = 'invited' AND declined_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)`,
  )
    .bind(user.id, now, row.id, email, now)
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    return { ok: false, error: 'This invite can no longer be used.', status: 409, code: 'INVITE_CLOSED' };
  }
  await recordAuditLogBestEffort(env, {
    org_id: auditOrgIdFor(row.account_id),
    actor_id: user.id,
    action: 'workspace_invite_accepted',
    target_id: row.id,
    details: { email, role, clientId: row.client_id },
  });
  return { ok: true, invite };
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

export async function deleteWorkspaceClient(
  env: Env,
  accountId: string,
  clientId: string,
  actorId: string,
): Promise<{ ok: true; projectIds: string[] } | { ok: false; error: string; status: number }> {
  if (!env.DB) return { ok: false, error: 'Database unavailable', status: 503 };
  const id = clientId.trim();
  if (!id || id.length > 80) return { ok: false, error: 'Not found', status: 404 };
  const rows = await env.DB.prepare(`SELECT id FROM projects WHERE account_id = ? AND client_id = ?`)
    .bind(accountId, id)
    .all<{ id: string }>();
  const ids = (rows.results || []).map((row) => row.id);
  if (ids.length === 0) return { ok: false, error: 'Not found', status: 404 };
  for (const projectId of ids) {
    const deleted = await deleteProject(env, accountId, projectId, actorId);
    if (!deleted.ok) return deleted;
  }
  await recordAuditLogBestEffort(env, {
    org_id: auditOrgIdFor(accountId),
    actor_id: actorId,
    action: 'workspace_client_deleted',
    target_id: id,
    details: { projectIds: ids },
  });
  return { ok: true, projectIds: ids };
}

/** Member and invite rows share one table. The path key is the stored email (owner rows may be `user:<id>`). */
export async function removeWorkspacePerson(
  env: Env,
  workspace: ClientWorkspace,
  emailRaw: string,
  kind: 'invite' | 'member',
  actorId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!env.DB) return { ok: false, error: 'Database unavailable', status: 503 };
  const email = normalizeEmail(emailRaw);
  if (!email || email.length > 200) return { ok: false, error: 'Not found', status: 404 };
  const status = kind === 'invite' ? 'invited' : 'active';
  const row = await env.DB.prepare(
    `SELECT email, role, status FROM client_workspace_members
     WHERE workspace_id = ? AND (id = ? OR email = ?)`,
  )
    .bind(workspace.id, emailRaw.trim(), email)
    .first<{ email: string; role: string; status: string }>();
  if (!row || row.status !== status || !isRole(row.role)) return { ok: false, error: 'Not found', status: 404 };
  const memberEmail = row.email;
  if (kind === 'member' && row.role === 'owner') {
    const removed = await env.DB.prepare(
      `DELETE FROM client_workspace_members
       WHERE workspace_id = ? AND email = ? AND status = 'active' AND role = 'owner'
         AND (
           SELECT COUNT(*) FROM client_workspace_members
           WHERE workspace_id = ? AND role = 'owner' AND status = 'active'
         ) > 1`,
    )
      .bind(workspace.id, memberEmail, workspace.id)
      .run();
    if (Number(removed.meta?.changes ?? 0) !== 1) {
      const still = await env.DB.prepare(
        `SELECT role FROM client_workspace_members WHERE workspace_id = ? AND email = ? AND status = 'active' AND role = 'owner'`,
      )
        .bind(workspace.id, memberEmail)
        .first<{ role: string }>();
      if (still) return { ok: false, error: 'The workspace needs an owner.', status: 409 };
      return { ok: false, error: 'Not found', status: 404 };
    }
  } else {
    const removed = await env.DB.prepare(
      `DELETE FROM client_workspace_members WHERE workspace_id = ? AND email = ? AND status = ?`,
    )
      .bind(workspace.id, memberEmail, status)
      .run();
    if (Number(removed.meta?.changes ?? 0) !== 1) return { ok: false, error: 'Not found', status: 404 };
  }
  await recordAuditLogBestEffort(env, {
    org_id: auditOrgIdFor(workspace.accountId),
    actor_id: actorId,
    action: kind === 'invite' ? 'workspace_invite_revoked' : 'workspace_member_removed',
    target_id: memberEmail,
    details: { workspaceId: workspace.id, role: row.role },
  });
  return { ok: true };
}

export async function deleteWorkspace(
  env: Env,
  workspace: ClientWorkspace,
  confirm: boolean,
  actorId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!env.DB) return { ok: false, error: 'Database unavailable', status: 503 };
  const flag = confirm ? 1 : 0;
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM client_workspace_members
       WHERE workspace_id = ?
         AND (
           ? = 1
           OR (SELECT COUNT(DISTINCT client_id) FROM projects WHERE account_id = ? AND client_id != '') = 0
         )`,
    ).bind(workspace.id, flag, workspace.accountId),
    env.DB.prepare(
      `DELETE FROM client_workspaces
       WHERE id = ? AND account_id = ?
         AND (
           ? = 1
           OR (SELECT COUNT(DISTINCT client_id) FROM projects WHERE account_id = ? AND client_id != '') = 0
         )`,
    ).bind(workspace.id, workspace.accountId, flag, workspace.accountId),
  ]);
  const still = await workspaceById(env, workspace.id);
  if (still) {
    const clients = await countClients(env, workspace.accountId);
    if (clients > 0 && !confirm) {
      return {
        ok: false,
        status: 409,
        error: 'Clients are still on this workspace. Delete them first, or send confirm: true.',
      };
    }
    return { ok: false, error: 'Could not delete workspace', status: 500 };
  }
  await recordAuditLogBestEffort(env, {
    org_id: auditOrgIdFor(workspace.accountId),
    actor_id: actorId,
    action: 'workspace_deleted',
    target_id: workspace.id,
    details: { confirmed: confirm },
  });
  return { ok: true };
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
