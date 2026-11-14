/**
 * Industry choice and the multi-client workspace HTTP API.
 *   GET  /industries
 *   GET  /account/industry
 *   PUT  /account/industry          { industryId }
 *   GET  /workspaces/current
 *   POST /workspaces/current        { name }
 *   PATCH /workspaces/current       brand fields, owner only
 *   GET  /workspaces/current/members
 *   POST /workspaces/current/invites { email, role, clientId? }
 *   DELETE /workspaces/current/invites/:id      owner, pending invite (id or email)
 *   DELETE /workspaces/current/members/:id      owner, cannot remove the last owner (id or email)
 *   GET  /workspaces/invites                    pending invites, or a count when email is unverified
 *   POST /workspaces/invites/:id/accept
 *   POST /workspaces/invites/:id/decline
 *   GET  /workspaces/current/clients
 *   POST /workspaces/current/clients { name, domain, industryId? }
 *   DELETE /workspaces/current/clients/:clientId  owner or staff
 *   DELETE /workspaces/current  owner; refuses while clients remain unless confirm is true
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { json, identify, billingId } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import {
  listIndustryProfiles,
  parseIndustryId,
  readOptionalIndustry,
  fillKeywordTemplate,
  competitorDiscoveryHints,
  industryProfile,
} from '../services/industries/industryProfiles';
import { accountIndustryId, setAccountIndustry } from './projectService';
import {
  addWorkspaceClient,
  countClients,
  createWorkspace,
  deleteWorkspace,
  deleteWorkspaceClient,
  inviteMember,
  listMembers,
  inviteInbox,
  listWorkspaceClients,
  membershipsForUser,
  parseBrandPatch,
  removeWorkspacePerson,
  respondToInvite,
  updateWorkspaceBrand,
  workspaceById,
  workspaceForAccount,
  type ClientWorkspace,
  type WorkspaceRole,
} from './clientWorkspace';
import { entitlementsFor } from '../services/plans/planEntitlements';
import { getActiveSubscription } from './quotaMiddleware';
import { inspectLogoUrl } from './logoInspect';

function industryPayload() {
  return listIndustryProfiles().map((profile) => ({
    id: profile.id,
    label: profile.label,
    defaultChecks: profile.defaultChecks,
    keywordTemplate: profile.keywordTemplate,
    competitorHints: profile.competitorHints,
    reportHeading: profile.reportHeading,
    reportAudience: profile.reportAudience,
    keywordExample: fillKeywordTemplate(profile, { service: 'service', suburb: 'Richmond' }),
    competitorExample: competitorDiscoveryHints(profile, { service: 'service', suburb: 'Richmond' }),
  }));
}

export async function handleIndustryWorkspaceRoute(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  if (path === '/industries' && request.method === 'GET') {
    return json({ ok: true, industries: industryPayload(), defaultIndustryId: industryProfile(null).id });
  }
  const invitePath = path === '/workspaces/invites' || path.startsWith('/workspaces/invites/');
  if (path !== '/account/industry' && path !== '/workspaces/current' && !path.startsWith('/workspaces/current/') && !invitePath) {
    return null;
  }
  const who = await identify(request, env);
  if (who.error || !who.user) return json({ ok: false, error: who.error || 'Unauthorized', code: 'AUTH_REQUIRED' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  if (invitePath) return answerInvite(request, env, path, who.user);
  const accountId = billingId(who.user);
  const current = await currentWorkspace(env, who.user, new URL(request.url).searchParams.get('workspaceId'));

  if (path === '/account/industry' && request.method === 'GET') {
    const industryId = await accountIndustryId(env, accountId);
    return json({ ok: true, industryId, profile: industryProfile(industryId) });
  }
  if (path === '/account/industry' && request.method === 'PUT') {
    const body = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!body.ok) return json({ error: body.error }, body.status);
    const raw = (body.value || {}) as Record<string, unknown>;
    const industryId = parseIndustryId(raw.industryId);
    if (!industryId) return json({ ok: false, error: 'industryId is not a known industry.' }, 400);
    await setAccountIndustry(env, accountId, industryId);
    return json({ ok: true, industryId, profile: industryProfile(industryId) });
  }

  if (path === '/workspaces/current' && request.method === 'GET') {
    if (!current) return json({ ok: false, error: 'No workspace yet' }, 404);
    return json({ ok: true, workspace: current.workspace, role: current.role });
  }
  if (path === '/workspaces/current' && request.method === 'POST') {
    const body = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!body.ok) return json({ error: body.error }, body.status);
    const raw = (body.value || {}) as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (!name.trim()) return json({ ok: false, error: 'name required' }, 400);
    const workspace = await createWorkspace(env, who.user, name);
    return json({ ok: true, workspace, role: 'owner' });
  }
  if (path === '/workspaces/current' && request.method === 'DELETE') {
    if (!current) return json({ ok: false, error: 'No workspace yet' }, 404);
    const refused = ownerOnly(current.role, 'delete the workspace');
    if (refused) return refused;
    const flag = await readConfirm(request);
    if (!flag.ok) return json({ error: flag.error }, flag.status);
    const deleted = await deleteWorkspace(env, current.workspace, flag.confirm, who.user.id);
    if (!deleted.ok) return json({ ok: false, error: deleted.error }, deleted.status);
    return json({ ok: true });
  }
  if (path === '/workspaces/current' && request.method === 'PATCH') {
    if (!current) return json({ ok: false, error: 'No workspace yet' }, 404);
    if (current.role !== 'owner') return json({ ok: false, error: 'Only the workspace owner can change the brand.' }, 403);
    const workspace = current.workspace;
    const body = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!body.ok) return json({ error: body.error }, body.status);
    const parsed = parseBrandPatch((body.value || {}) as Record<string, unknown>);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
    if (parsed.patch.logoUrl) {
      const logo = await inspectLogoUrl(parsed.patch.logoUrl);
      if (!logo.ok) return json({ ok: false, error: logo.error }, 400);
    }
    const updated = await updateWorkspaceBrand(env, workspace, parsed.patch);
    return json({ ok: true, workspace: updated });
  }

  if (!current) return json({ ok: false, error: 'No workspace yet' }, 404);
  const workspace = current.workspace;

  if (path === '/workspaces/current/members' && request.method === 'GET') {
    if (current.role === 'client_viewer') return json({ ok: false, error: 'Not found' }, 404);
    return json({ ok: true, members: await listMembers(env, workspace.id) });
  }
  if (path === '/workspaces/current/invites' && request.method === 'POST') {
    if (current.role !== 'owner') return json({ ok: false, error: 'Only the workspace owner can invite.' }, 403);
    const body = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!body.ok) return json({ error: body.error }, body.status);
    const raw = (body.value || {}) as Record<string, unknown>;
    const role = raw.role === 'staff' || raw.role === 'client_viewer' ? raw.role : null;
    if (!role) return json({ ok: false, error: 'role must be staff or client_viewer.' }, 400);
    const invited = await inviteMember(env, workspace, {
      email: typeof raw.email === 'string' ? raw.email : '',
      role,
      clientId: typeof raw.clientId === 'string' ? raw.clientId : undefined,
    });
    if (!invited.ok) return json({ ok: false, error: invited.error }, invited.status);
    return json({ ok: true, member: invited.member });
  }
  if (path === '/workspaces/current/clients' && request.method === 'GET') {
    const sub = await getActiveSubscription(env, { id: workspace.accountId, source: 'firebase', accountId: workspace.accountId });
    const limit = entitlementsFor(sub?.plan).workspaceClientLimit;
    return json({
      ok: true,
      clientLimit: limit,
      clientCount: await countClients(env, workspace.accountId),
      clients: await listWorkspaceClients(env, workspace.accountId, current.clientId),
    });
  }
  const clientMatch = path.match(/^\/workspaces\/current\/clients\/([^/]+)$/);
  if (clientMatch && request.method === 'DELETE') {
    const clientId = decodePathKey(clientMatch[1]);
    if (!clientId) return json({ ok: false, error: 'Not found' }, 404);
    if (current.role === 'client_viewer') {
      if (current.clientId !== clientId) return json({ ok: false, error: 'Not found' }, 404);
      return json({ ok: false, error: 'This client login is read-only.' }, 403);
    }
    const deleted = await deleteWorkspaceClient(env, workspace.accountId, clientId, who.user.id);
    if (!deleted.ok) return json({ ok: false, error: deleted.error }, deleted.status);
    return json({ ok: true });
  }
  const inviteMatch = path.match(/^\/workspaces\/current\/invites\/([^/]+)$/);
  if (inviteMatch && request.method === 'DELETE') {
    const refused = ownerOnly(current.role, 'revoke an invite');
    if (refused) return refused;
    const email = decodePathKey(inviteMatch[1]);
    if (!email) return json({ ok: false, error: 'Not found' }, 404);
    const revoked = await removeWorkspacePerson(env, workspace, email, 'invite', who.user.id);
    if (!revoked.ok) return json({ ok: false, error: revoked.error }, revoked.status);
    return json({ ok: true });
  }
  const memberMatch = path.match(/^\/workspaces\/current\/members\/([^/]+)$/);
  if (memberMatch && request.method === 'DELETE') {
    const refused = ownerOnly(current.role, 'remove a member');
    if (refused) return refused;
    const email = decodePathKey(memberMatch[1]);
    if (!email) return json({ ok: false, error: 'Not found' }, 404);
    const removed = await removeWorkspacePerson(env, workspace, email, 'member', who.user.id);
    if (!removed.ok) return json({ ok: false, error: removed.error }, removed.status);
    return json({ ok: true });
  }
  if (path === '/workspaces/current/clients' && request.method === 'POST') {
    if (current.role === 'client_viewer') return json({ ok: false, error: 'This client login is read-only.' }, 403);
    const body = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!body.ok) return json({ error: body.error }, body.status);
    const raw = (body.value || {}) as Record<string, unknown>;
    const domain = typeof raw.domain === 'string' ? raw.domain : '';
    const name = typeof raw.name === 'string' ? raw.name : domain;
    const industryId = readOptionalIndustry(raw.industryId);
    if (industryId === null) return json({ ok: false, error: 'industryId is not a known industry.' }, 400);
    const created = await addWorkspaceClient(env, workspace.accountId, { name, domain, industryId });
    if (!created.ok) return json({ ok: false, error: created.error }, created.status);
    return json(created);
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function answerInvite(request: Request, env: Env, path: string, user: HostedIdentity): Promise<Response> {
  if (path === '/workspaces/invites' && request.method === 'GET') {
    const inbox = await inviteInbox(env, user);
    if (!inbox.emailVerified) {
      return json({
        ok: true,
        emailVerified: false,
        pendingInviteCount: inbox.pendingInviteCount,
        invites: [],
      });
    }
    return json({ ok: true, invites: inbox.invites });
  }
  const decision = path.match(/^\/workspaces\/invites\/([^/]+)\/(accept|decline)$/);
  if (decision && request.method === 'POST') {
    const id = decodePathKey(decision[1]);
    if (!id) return json({ ok: false, error: 'Not found', code: 'NOT_FOUND' }, 404);
    const choice = decision[2] === 'accept' ? 'accept' : 'decline';
    const result = await respondToInvite(env, user, id, choice);
    if (!result.ok) return json({ ok: false, error: result.error, code: result.code }, result.status);
    return json({ ok: true, invite: result.invite });
  }
  return json({ error: 'Method not allowed' }, 405);
}

function ownerOnly(role: WorkspaceRole, action: string): Response | null {
  if (role === 'owner') return null;
  if (role === 'client_viewer') return json({ ok: false, error: 'This client login is read-only.' }, 403);
  return json({ ok: false, error: `Only the workspace owner can ${action}.` }, 403);
}

function decodePathKey(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const value = decodeURIComponent(raw).trim();
    if (!value || value.length > 200) return null;
    return value;
  } catch {
    return null;
  }
}

async function readConfirm(
  request: Request,
): Promise<{ ok: true; confirm: boolean } | { ok: false; status: number; error: string }> {
  const query = new URL(request.url).searchParams.get('confirm');
  if (query === '1' || query === 'true') return { ok: true, confirm: true };
  const body = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!body.ok) return { ok: false, status: body.status, error: body.error };
  const raw = body.value;
  const confirm = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    && (raw as { confirm?: unknown }).confirm === true;
  return { ok: true, confirm };
}

async function currentWorkspace(
  env: Env,
  user: HostedIdentity,
  requestedId: string | null,
): Promise<{ workspace: ClientWorkspace; role: WorkspaceRole; clientId: string | null } | null> {
  const accountId = billingId(user);
  const own = await workspaceForAccount(env, accountId);
  if (own && (!requestedId || requestedId === own.id)) {
    return { workspace: own, role: 'owner', clientId: null };
  }
  const members = await membershipsForUser(env, user.id);
  const member = members.find((row) => {
    if (row.role !== 'staff' && row.role !== 'client_viewer') return false;
    return requestedId ? row.workspaceId === requestedId : true;
  });
  if (!member) return own ? { workspace: own, role: 'owner', clientId: null } : null;
  const workspace = await workspaceById(env, member.workspaceId);
  if (!workspace) return null;
  return {
    workspace,
    role: member.role,
    clientId: member.role === 'client_viewer' ? member.clientId : null,
  };
}
