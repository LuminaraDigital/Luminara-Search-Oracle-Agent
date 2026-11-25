/**
 * Luminara Suite HTTP routes for the Agentic CRM Middle Layer (`/api/crm/*`).
 *
 * Dark-launched: returns 200 `{ enabled: false }` on `GET /api/crm/status` (zero console/5xx noise)
 * and 503 CRM_BRIDGE_DISABLED on all other routes when `CRM_BRIDGE_ENABLED !== 'true'`.
 */

import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import { auditOrgIdFor, recordAuditLogBestEffort } from './auditLog';
import { getEnquiryById } from './enquiryDeskService';
import { recordOutcomeStageEvent } from './outcomesLedgerService';
import {
  activateCrmWorkspace,
  callCrmAction,
  decideCrmApproval,
  getCrmLink,
  isCrmBridgeEnabled,
  mintLaunchAssertion,
  promoteEnquiryToCrm,
  sanitizeNextPath,
  verifySuiteHmac,
  type CrmMode,
} from './crmBridgeClient';

function isNonHumanAgentCaller(request: Request, user: HostedIdentity): boolean {
  const authHeader = (request.headers.get('Authorization') || '').trim();
  if (/^Bearer\s+(lm_live_|mcp_|lm_hab_)/i.test(authHeader)) return true;
  if (user.id.startsWith('apk:') || user.id.startsWith('hab:')) return true;
  return false;
}

export async function handleCrmOutcomeWebhook(request: Request, env: Env): Promise<Response> {
  if (!isCrmBridgeEnabled(env)) {
    return json({ ok: false, code: 'CRM_BRIDGE_DISABLED', error: 'CRM bridge is disabled.' }, 503);
  }
  const secret = (env.CRM_BRIDGE_SHARED_SECRET || '').trim();
  if (!secret) {
    return json({ ok: false, code: 'CRM_BRIDGE_UNCONFIGURED', error: 'CRM bridge shared secret is not configured.' }, 503);
  }

  const read = await readBody(request, MAX_SMALL_BODY_BYTES, false);
  if (!read.ok) {
    return json({ ok: false, error: read.error }, read.status);
  }
  const rawBody = typeof read.value === 'string' ? read.value : '';

  const valid = await verifySuiteHmac(
    secret,
    'POST',
    '/api/crm/webhooks/outcome',
    rawBody,
    request.headers.get('X-Luminara-Suite-Signature'),
    request.headers.get('X-Luminara-Suite-Timestamp'),
    undefined,
    env.CRM_BRIDGE_SHARED_SECRET_PREVIOUS,
  );
  if (!valid) {
    return json({ ok: false, code: 'INVALID_SIGNATURE', error: 'Invalid webhook signature.' }, 401);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const accountId = typeof parsed.account_id === 'string' ? parsed.account_id.trim() : '';
  const enquiryId = typeof parsed.enquiry_id === 'string' ? parsed.enquiry_id.trim() : '';
  const receiptCode = typeof parsed.receipt_code === 'string' ? parsed.receipt_code.trim() : '';

  if (!accountId || !enquiryId) {
    return json({ ok: false, error: 'account_id and enquiry_id are required.' }, 400);
  }

  const link = await getCrmLink(env, accountId);
  if (!link) {
    return json({ ok: false, code: 'CRM_LINK_NOT_FOUND', error: 'No active CRM link for this account.' }, 404);
  }

  const enquiry = await getEnquiryById(env, accountId, enquiryId);
  if (!enquiry) {
    return json({ ok: false, code: 'ENQUIRY_NOT_FOUND', error: 'Enquiry not found for this account.' }, 404);
  }

  const rec = await recordOutcomeStageEvent(env, {
    accountId,
    projectId: enquiry.projectId || 'default',
    enquiryId,
    stage: 'signed_listing',
    evidenceType: 'staff_confirmation',
    evidenceRef: receiptCode || `crm:${enquiryId}`,
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 500) : 'Closed-won outcome reported by Luminara CRM.',
    recordedBy: 'system:crm_bridge',
  });

  if (!rec.ok) {
    return json({ ok: false, error: rec.error || 'Failed to record outcome stage event.' }, rec.status || 500);
  }

  if (env.DB) {
    await env.DB.prepare(
      `UPDATE enquiry_crm_promotions
       SET status = 'won',
           crm_receipt_code = COALESCE(NULLIF(?, ''), crm_receipt_code),
           updated_at = ?
       WHERE enquiry_id = ? AND account_id = ?`,
    )
      .bind(receiptCode, Date.now(), enquiryId, accountId)
      .run()
      .catch(() => undefined);
  }

  return json({ ok: true, recorded: true });
}

export async function handleCrmBridgeRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response | null> {
  if (path !== '/crm' && !path.startsWith('/crm/')) return null;

  if (!isCrmBridgeEnabled(env)) {
    if (path === '/crm/status' && request.method === 'GET') {
      return json({ ok: true, enabled: false, activated: false, link: null }, 200);
    }
    return json(
      { ok: false, code: 'CRM_BRIDGE_DISABLED', error: 'CRM bridge is not enabled on this deployment.' },
      503,
    );
  }

  const accountId = billingId(user);

  if (path === '/crm/status' && request.method === 'GET') {
    const link = await getCrmLink(env, accountId);
    return json({
      ok: true,
      enabled: true,
      activated: link !== null,
      link,
    });
  }

  if (path === '/crm/activate' && request.method === 'POST') {
    const parsed = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
    const body = (parsed.value || {}) as Record<string, unknown>;
    const crmMode: CrmMode = body.crmMode === 'middle_layer' ? 'middle_layer' : 'standalone';
    const res = await activateCrmWorkspace(
      env,
      user,
      {
        crmMode,
        primaryExternalCrm: typeof body.primaryExternalCrm === 'string' ? body.primaryExternalCrm : null,
        businessName: typeof body.businessName === 'string' ? body.businessName : undefined,
        businessDna:
          body.businessDna && typeof body.businessDna === 'object'
            ? (body.businessDna as Record<string, unknown>)
            : undefined,
      },
      fetchFn,
    );
    if (!res.ok) return json({ ok: false, error: res.error }, res.status);
    return json(res, res.created ? 201 : 200);
  }

  if (path === '/crm/launch-token' && request.method === 'POST') {
    if (isNonHumanAgentCaller(request, user)) {
      return json(
        { ok: false, code: 'HUMAN_SESSION_REQUIRED', error: 'Agent tokens cannot mint human browser handoff assertions.' },
        403,
      );
    }
    const parsed = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
    const body = (parsed.value || {}) as Record<string, unknown>;
    const requestedMode: CrmMode | undefined =
      body.crmMode === 'middle_layer' ? 'middle_layer' : body.crmMode === 'standalone' ? 'standalone' : undefined;
    const requestedExternal = typeof body.primaryExternalCrm === 'string' ? body.primaryExternalCrm : null;

    let link = await getCrmLink(env, accountId);
    const modeChanged = link !== null && requestedMode !== undefined && link.crmMode !== requestedMode;
    if (!link || modeChanged) {
      const activated = await activateCrmWorkspace(
        env,
        user,
        {
          crmMode: requestedMode ?? link?.crmMode ?? 'standalone',
          primaryExternalCrm: requestedExternal ?? link?.primaryExternalCrm ?? null,
        },
        fetchFn,
      );
      if (!activated.ok) return json({ ok: false, error: activated.error }, activated.status);
      link = activated.link;
    }

    const safeNextPath = sanitizeNextPath(body.nextPath);
    if (typeof body.nextPath === 'string' && body.nextPath.trim() && !safeNextPath) {
      return json({ ok: false, code: 'INVALID_NEXT_PATH', error: 'Invalid redirect path.' }, 400);
    }

    try {
      const launch = await mintLaunchAssertion(env, {
        sub: accountId,
        email: user.emailVerified === true ? user.email : undefined,
        crmMode: link.crmMode,
        nextPath: safeNextPath,
      });
      return json({ ok: true, link, ...launch });
    } catch (err: unknown) {
      return json(
        { ok: false, error: err instanceof Error ? err.message : 'Unable to mint CRM launch assertion.' },
        503,
      );
    }
  }

  if (path === '/crm/briefing' && request.method === 'GET') {
    const res = await callCrmAction(env, accountId, 'briefing_today', {}, {}, fetchFn);
    return json({ ok: res.ok, ...res.body }, res.status);
  }

  const promoteMatch = path.match(/^\/crm\/enquiries\/([^/]+)\/promote$/);
  if (promoteMatch && request.method === 'POST') {
    const enquiryId = decodeURIComponent(promoteMatch[1]!);
    const res = await promoteEnquiryToCrm(env, user, enquiryId, fetchFn);
    if (!res.ok) return json({ ok: false, error: res.error }, res.status);
    return json(res, res.duplicate ? 200 : 201);
  }

  const approvalMatch = path.match(/^\/crm\/approvals\/(\d+)\/decide$/);
  if (approvalMatch && request.method === 'POST') {
    if (isNonHumanAgentCaller(request, user)) {
      return json(
        { ok: false, code: 'HUMAN_SESSION_REQUIRED', error: 'Agent tokens cannot approve their own CRM actions.' },
        403,
      );
    }
    const parsed = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
    const body = (parsed.value || {}) as Record<string, unknown>;
    const decision = body.decision === 'approve' ? 'approve' : body.decision === 'reject' ? 'reject' : null;
    if (!decision) {
      return json({ ok: false, error: 'decision must be "approve" or "reject".' }, 400);
    }
    const callId = approvalMatch[1]!;
    const res = await decideCrmApproval(
      env,
      accountId,
      callId,
      decision,
      typeof body.feedbackNote === 'string' ? body.feedbackNote : undefined,
      fetchFn,
    );
    await recordAuditLogBestEffort(env, {
      org_id: auditOrgIdFor(accountId),
      actor_id: user.id,
      action: decision === 'approve' ? 'crm_approval_approved' : 'crm_approval_rejected',
      target_id: callId,
      details: { ok: res.ok, status: res.status },
    });
    return json({ ok: res.ok, ...res.body }, res.status);
  }

  return json({ ok: false, error: 'Not found' }, 404);
}
