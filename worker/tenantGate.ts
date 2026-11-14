/**
 * Tenant gate for projects, reports, and MCP.
 * A client-viewer who asks for another client's id gets the same 404 as a missing id.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId } from './workerUtils';
import { getProjectById, listProjects } from './projectService';
import type { SeoProject } from '../services/projects/types';
import {
  assertNewClientAllowed,
  membershipsForUser,
  workspaceById,
} from './clientWorkspace';

export type OpenResult =
  | { ok: true; accountId: string; project: SeoProject }
  | { ok: false; status: number; error: string };

export async function openProject(
  env: Env,
  user: HostedIdentity,
  projectId: string,
  write: boolean,
): Promise<OpenResult> {
  const project = await getProjectById(env, projectId);
  if (!project) return { ok: false, status: 404, error: 'Project not found' };
  const accountId = billingId(user);
  if (project.accountId === accountId) return { ok: true, accountId, project };
  const members = await membershipsForUser(env, user.id);
  const member = members.find((row) => row.accountId === project.accountId && (row.role === 'staff' || row.role === 'client_viewer'));
  if (!member) return { ok: false, status: 404, error: 'Project not found' };
  if (member.role === 'client_viewer' && member.clientId !== project.clientId) {
    return { ok: false, status: 404, error: 'Project not found' };
  }
  if (write && member.role === 'client_viewer') {
    return { ok: false, status: 403, error: 'This client login is read-only.' };
  }
  return { ok: true, accountId: project.accountId, project };
}

export async function listVisibleProjects(env: Env, user: HostedIdentity): Promise<SeoProject[]> {
  const accountId = billingId(user);
  const own = await listProjects(env, accountId);
  const seen = new Set(own.map((project) => project.id));
  const all = [...own];
  for (const member of await membershipsForUser(env, user.id)) {
    if (member.accountId === accountId) continue;
    if (member.role !== 'staff' && member.role !== 'client_viewer') continue;
    const clientId = member.role === 'client_viewer' ? member.clientId || '' : undefined;
    for (const project of await listProjects(env, member.accountId, clientId)) {
      if (seen.has(project.id)) continue;
      seen.add(project.id);
      all.push(project);
    }
  }
  return all;
}

export async function createTargetAccount(
  env: Env,
  user: HostedIdentity,
  workspaceId?: string | null,
): Promise<{ ok: true; accountId: string } | { ok: false; status: number; error: string }> {
  const accountId = billingId(user);
  if (!workspaceId) return { ok: true, accountId };
  const workspace = await workspaceById(env, workspaceId);
  if (!workspace) return { ok: false, status: 404, error: 'Workspace not found' };
  if (workspace.accountId === accountId) return { ok: true, accountId };
  const member = (await membershipsForUser(env, user.id)).find((row) => row.workspaceId === workspace.id);
  if (!member) return { ok: false, status: 404, error: 'Workspace not found' };
  if (member.role !== 'staff') return { ok: false, status: 403, error: 'This client login is read-only.' };
  return { ok: true, accountId: workspace.accountId };
}

export async function accountForProjectPath(
  env: Env,
  user: HostedIdentity,
  path: string,
  method: string,
): Promise<{ ok: true; accountId: string } | { ok: false; status: number; error: string }> {
  const match = path.match(/^\/projects\/([^/]+)/);
  if (!match) return { ok: true, accountId: billingId(user) };
  const projectId = decodeURIComponent(match[1] || '');
  const write = method !== 'GET' && method !== 'HEAD';
  const opened = await openProject(env, user, projectId, write);
  if (!opened.ok) return opened;
  return { ok: true, accountId: opened.accountId };
}

async function projectIdForReport(env: Env, reportId: string): Promise<string | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`SELECT project_id FROM agent_reports WHERE id = ?`)
    .bind(reportId)
    .first<{ project_id: string }>();
  return row?.project_id || null;
}

export async function accountForReportId(
  env: Env,
  user: HostedIdentity,
  reportId: string,
  write: boolean,
): Promise<{ ok: true; accountId: string } | { ok: false; status: number; error: string }> {
  const projectId = await projectIdForReport(env, reportId);
  if (!projectId) return { ok: false, status: 404, error: 'Not found' };
  const opened = await openProject(env, user, projectId, write);
  if (!opened.ok) return opened;
  return { ok: true, accountId: opened.accountId };
}

export async function gateMcpTenant(
  env: Env,
  user: HostedIdentity,
  billingAccountId: string,
  name: string,
  args: Record<string, unknown>,
  write: boolean,
): Promise<{ ok: true; dataAccountId: string } | { ok: false; error: string; code: string }> {
  const projectId = typeof args.projectId === 'string' ? args.projectId.trim() : '';
  const reportId = typeof args.reportId === 'string' ? args.reportId.trim() : '';
  if (projectId) {
    const project = await getProjectById(env, projectId);
    if (!project) return { ok: true, dataAccountId: billingAccountId };
    const opened = await openProject(env, user, projectId, write);
    if (!opened.ok) return { ok: false, error: opened.error, code: opened.status === 403 ? 'READ_ONLY' : 'PROJECT_NOT_FOUND' };
    return { ok: true, dataAccountId: opened.accountId };
  }
  if (reportId) {
    const ownerProject = await projectIdForReport(env, reportId);
    if (!ownerProject) return { ok: true, dataAccountId: billingAccountId };
    const opened = await openProject(env, user, ownerProject, write);
    if (!opened.ok) return { ok: false, error: opened.error, code: opened.status === 403 ? 'READ_ONLY' : 'PROJECT_NOT_FOUND' };
    return { ok: true, dataAccountId: opened.accountId };
  }
  if (name === 'create_project') {
    const workspaceId = typeof args.workspaceId === 'string' ? args.workspaceId : null;
    const target = await createTargetAccount(env, user, workspaceId);
    if (!target.ok) return { ok: false, error: target.error, code: target.status === 403 ? 'READ_ONLY' : 'NOT_FOUND' };
    const clientId = typeof args.clientId === 'string' ? args.clientId : undefined;
    const slot = await assertNewClientAllowed(env, target.accountId, clientId);
    if (!slot.ok) return { ok: false, error: slot.error, code: 'CLIENT_LIMIT' };
    return { ok: true, dataAccountId: target.accountId };
  }
  return { ok: true, dataAccountId: billingAccountId };
}
