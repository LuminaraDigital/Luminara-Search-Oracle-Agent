/**
 * Luminara Suite <-> Luminara CRM Agentic Middle Layer Client (0060).
 *
 * Dark-launched behind `CRM_BRIDGE_ENABLED === 'true'` and a valid `CRM_BASE_URL`.
 * Zero runtime effect on live production while disabled.
 */

import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId } from './workerUtils';
import { getEnquiryById } from './enquiryDeskService';
import {
  base64UrlDecode,
  base64UrlEncode,
  crmBaseUrl,
  crmBridgeOrigin,
  decryptPassportToken,
  encryptPassportToken,
  isCrmBridgeEnabled,
  isStrongBridgeSecret,
  mintLaunchAssertion,
  sanitizeNextPath,
  signSuiteHmac,
  verifySuiteHmac,
  type CrmMode,
} from './crmBridgeCrypto';

export {
  base64UrlDecode,
  base64UrlEncode,
  crmBaseUrl,
  crmBridgeOrigin,
  decryptPassportToken,
  encryptPassportToken,
  isCrmBridgeEnabled,
  mintLaunchAssertion,
  sanitizeNextPath,
  signSuiteHmac,
  verifySuiteHmac,
  type CrmMode,
};

export interface SuiteCrmLink {
  accountId: string;
  crmBaseUrl: string;
  workspaceSlug: string;
  crmMode: CrmMode;
  primaryExternalCrm: string | null;
  autoPromoteEnquiries: boolean;
  status: string;
  lastSyncedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface SuiteCrmLinkRow {
  account_id: string;
  crm_base_url: string;
  workspace_slug: string;
  crm_mode: string;
  primary_external_crm: string | null;
  passport_token_enc?: string;
  auto_promote_enquiries: number;
  status: string;
  last_synced_at: number | null;
  created_at: number;
  updated_at: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DELETION_FETCH_TIMEOUT_MS = 5_000;

function mapLinkRow(row: SuiteCrmLinkRow): SuiteCrmLink {
  return {
    accountId: row.account_id,
    crmBaseUrl: row.crm_base_url,
    workspaceSlug: row.workspace_slug,
    crmMode: row.crm_mode === 'middle_layer' ? 'middle_layer' : 'standalone',
    primaryExternalCrm: row.primary_external_crm,
    autoPromoteEnquiries: Boolean(row.auto_promote_enquiries),
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response | null> {
  try {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
    return await fetchFn(url, signal ? { ...init, signal } : init);
  } catch {
    return null;
  }
}

async function loadStoredBusinessDna(env: Env, accountId: string): Promise<Record<string, unknown> | undefined> {
  if (!env.DB) return undefined;
  try {
    const row = await env.DB.prepare(`SELECT payload_json FROM user_workspace WHERE user_id = ? LIMIT 1`)
      .bind(accountId)
      .first<{ payload_json: string | null }>();
    if (!row?.payload_json) return undefined;
    const payload = JSON.parse(row.payload_json) as { storage?: Record<string, unknown> };
    const rawDna = payload?.storage?.luminara_business_dna;
    if (typeof rawDna === 'string' && rawDna.trim()) {
      const parsed = JSON.parse(rawDna) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    }
    if (rawDna && typeof rawDna === 'object' && !Array.isArray(rawDna)) {
      return rawDna as Record<string, unknown>;
    }
  } catch {
    // Best-effort DNA lookup; activation succeeds without DNA.
  }
  return undefined;
}

export async function getCrmLink(env: Env, accountId: string): Promise<SuiteCrmLink | null> {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT account_id, crm_base_url, workspace_slug, crm_mode, primary_external_crm,
              auto_promote_enquiries, status, last_synced_at, created_at, updated_at
       FROM suite_crm_links WHERE account_id = ?`,
    )
      .bind(accountId)
      .first<SuiteCrmLinkRow>();
    return row ? mapLinkRow(row) : null;
  } catch {
    return null;
  }
}

async function getDecryptedLink(
  env: Env,
  accountId: string,
): Promise<
  | { ok: true; link: SuiteCrmLink; passportToken: string }
  | { ok: false; reason: 'not_found' | 'decrypt_failed' | 'unconfigured' }
> {
  if (!env.DB) return { ok: false, reason: 'unconfigured' };
  const encKey = (env.CRM_BRIDGE_ENCRYPTION_KEY || '').trim();
  if (!encKey) return { ok: false, reason: 'unconfigured' };

  const row = await env.DB.prepare(
    `SELECT account_id, crm_base_url, workspace_slug, crm_mode, primary_external_crm,
            passport_token_enc, auto_promote_enquiries, status, last_synced_at, created_at, updated_at
     FROM suite_crm_links WHERE account_id = ?`,
  )
    .bind(accountId)
    .first<SuiteCrmLinkRow>();
  if (!row || !row.passport_token_enc) return { ok: false, reason: 'not_found' };

  try {
    const passportToken = await decryptPassportToken(
      row.passport_token_enc,
      encKey,
      accountId,
      env.CRM_BRIDGE_ENCRYPTION_KEY_PREVIOUS,
    );
    return { ok: true, link: mapLinkRow(row), passportToken };
  } catch {
    return { ok: false, reason: 'decrypt_failed' };
  }
}

export async function activateCrmWorkspace(
  env: Env,
  user: HostedIdentity,
  opts: {
    crmMode?: CrmMode;
    primaryExternalCrm?: string | null;
    businessName?: string;
    businessDna?: Record<string, unknown>;
    rotatePassport?: boolean;
  } = {},
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; link: SuiteCrmLink; created: boolean } | { ok: false; error: string; status: number }> {
  if (!isCrmBridgeEnabled(env)) {
    return { ok: false, error: 'CRM bridge is disabled on this deployment.', status: 503 };
  }
  if (!env.DB) {
    return { ok: false, error: 'Database unavailable.', status: 503 };
  }

  const sharedSecret = (env.CRM_BRIDGE_SHARED_SECRET || '').trim();
  const encKey = (env.CRM_BRIDGE_ENCRYPTION_KEY || '').trim();
  if (!isStrongBridgeSecret(env, sharedSecret) || !isStrongBridgeSecret(env, encKey)) {
    return { ok: false, error: 'CRM bridge secrets are not configured.', status: 503 };
  }

  const accountId = billingId(user);
  const base = crmBaseUrl(env);
  const crmMode: CrmMode = opts.crmMode === 'middle_layer' ? 'middle_layer' : 'standalone';
  const businessDna = opts.businessDna ?? (await loadStoredBusinessDna(env, accountId));
  const verifiedEmail = user.emailVerified === true && user.email ? user.email : undefined;

  const bodyObj = {
    suite_account_id: accountId,
    email: verifiedEmail,
    email_verified: Boolean(verifiedEmail),
    telegram_user_id: user.source === 'telegram' ? user.id : undefined,
    name: user.name || 'Luminara Owner',
    business_name: opts.businessName || (typeof businessDna?.name === 'string' && businessDna.name.trim() ? businessDna.name.trim() : user.name || 'Luminara Workspace'),
    crm_mode: crmMode,
    primary_external_crm: opts.primaryExternalCrm || undefined,
    rotate_passport: Boolean(opts.rotatePassport),
    business_dna: businessDna || undefined,
  };
  const rawBody = JSON.stringify(bodyObj);
  const path = '/api/suite/provision';
  const { timestamp, signature } = await signSuiteHmac(sharedSecret, 'POST', path, rawBody);

  const res = await fetchWithTimeout(fetchFn, `${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Luminara-Suite-Timestamp': timestamp,
      'X-Luminara-Suite-Signature': signature,
    },
    body: rawBody,
  });

  if (!res) {
    return { ok: false, error: 'CRM workspace provisioning timed out or failed to connect.', status: 502 };
  }

  if (!res.ok) {
    return { ok: false, error: `CRM workspace provisioning returned HTTP ${res.status}.`, status: 502 };
  }

  const parsed = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    created?: boolean;
    workspace_slug?: string;
    crm_mode?: string;
    primary_external_crm?: string | null;
    passport_token?: string | null;
  };

  if (!parsed.ok || !parsed.workspace_slug) {
    return { ok: false, error: 'CRM provisioning response was incomplete.', status: 502 };
  }

  const now = Date.now();
  const existingRow = await env.DB.prepare(
    `SELECT passport_token_enc, primary_external_crm, created_at FROM suite_crm_links WHERE account_id = ?`,
  )
    .bind(accountId)
    .first<{ passport_token_enc: string; primary_external_crm: string | null; created_at: number }>();

  const tokenEnc = parsed.passport_token
    ? await encryptPassportToken(parsed.passport_token, encKey, accountId)
    : existingRow?.passport_token_enc;

  if (!tokenEnc) {
    return { ok: false, error: 'CRM did not issue a Service Passport token.', status: 502 };
  }

  const resolvedMode: CrmMode = parsed.crm_mode === 'middle_layer' ? 'middle_layer' : 'standalone';
  const resolvedPrimaryExternal = parsed.primary_external_crm ?? existingRow?.primary_external_crm ?? null;

  await env.DB.prepare(
    `INSERT INTO suite_crm_links (
      account_id, crm_base_url, workspace_slug, crm_mode, primary_external_crm,
      passport_token_enc, auto_promote_enquiries, status, last_synced_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      crm_base_url = excluded.crm_base_url,
      workspace_slug = excluded.workspace_slug,
      crm_mode = excluded.crm_mode,
      primary_external_crm = COALESCE(excluded.primary_external_crm, suite_crm_links.primary_external_crm),
      passport_token_enc = excluded.passport_token_enc,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at`,
  )
    .bind(
      accountId,
      base,
      parsed.workspace_slug,
      resolvedMode,
      parsed.primary_external_crm ?? null,
      tokenEnc,
      now,
      existingRow?.created_at ?? now,
      now,
    )
    .run();

  return {
    ok: true,
    created: Boolean(parsed.created),
    link: {
      accountId,
      crmBaseUrl: base,
      workspaceSlug: parsed.workspace_slug,
      crmMode: resolvedMode,
      primaryExternalCrm: resolvedPrimaryExternal,
      autoPromoteEnquiries: true,
      status: 'active',
      lastSyncedAt: now,
      createdAt: existingRow?.created_at ?? now,
      updatedAt: now,
    },
  };
}

export async function callCrmAction(
  env: Env,
  accountId: string,
  action: string,
  params: Record<string, unknown> = {},
  opts: { dryRun?: boolean; idempotencyKey?: string } = {},
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown>; link?: SuiteCrmLink }> {
  if (!isCrmBridgeEnabled(env)) {
    return {
      ok: false,
      status: 503,
      body: { ok: false, code: 'CRM_BRIDGE_DISABLED', error: 'CRM bridge is disabled.' },
    };
  }

  const resolved = await getDecryptedLink(env, accountId);
  if (!resolved.ok) {
    if (resolved.reason === 'decrypt_failed') {
      return {
        ok: false,
        status: 503,
        body: { ok: false, code: 'CRM_CREDENTIAL_ROTATION_REQUIRED', error: 'Stored CRM link credentials could not be decrypted. Re-activate CRM link.' },
      };
    }
    return {
      ok: false,
      status: 404,
      body: {
        ok: false,
        code: 'CRM_NOT_ACTIVATED',
        error: 'No Luminara CRM workspace is linked yet. Call crm_activate_workspace or click Open Free CRM first.',
      },
    };
  }

  const base = crmBaseUrl(env);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${resolved.passportToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Luminara-Workspace': resolved.link.workspaceSlug,
  };
  if (opts.dryRun) headers['X-Luminara-Dry-Run'] = '1';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const res = await fetchWithTimeout(
    fetchFn,
    `${base}/api/agent/actions/${encodeURIComponent(action)}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    },
  );

  if (!res) {
    return {
      ok: false,
      status: 502,
      body: { ok: false, code: 'CRM_UPSTREAM_TIMEOUT', error: 'CRM action request timed out or failed to connect.' },
      link: resolved.link,
    };
  }

  const body = (await res.json().catch(() => ({ ok: false, error: `CRM returned HTTP ${res.status}` }))) as Record<
    string,
    unknown
  >;

  return {
    ok: res.ok || res.status === 202,
    status: res.status,
    body,
    link: resolved.link,
  };
}

export async function promoteEnquiryToCrm(
  env: Env,
  user: HostedIdentity,
  enquiryId: string,
  fetchFn: typeof fetch = fetch,
): Promise<
  | { ok: true; duplicate: boolean; crmLeadId: string; crmReceiptCode: string | null; status: string }
  | { ok: false; error: string; status: number }
> {
  if (!isCrmBridgeEnabled(env) || !env.DB) {
    return { ok: false, error: 'CRM bridge unavailable.', status: 503 };
  }
  const accountId = billingId(user);
  const existing = await env.DB.prepare(
    `SELECT crm_lead_id, crm_receipt_code, status FROM enquiry_crm_promotions WHERE enquiry_id = ? AND account_id = ?`,
  )
    .bind(enquiryId, accountId)
    .first<{ crm_lead_id: string; crm_receipt_code: string | null; status: string }>();

  if (existing) {
    return {
      ok: true,
      duplicate: true,
      crmLeadId: existing.crm_lead_id,
      crmReceiptCode: existing.crm_receipt_code,
      status: existing.status,
    };
  }

  const enquiry = await getEnquiryById(env, accountId, enquiryId);
  if (!enquiry) {
    return { ok: false, error: 'Enquiry not found.', status: 404 };
  }

  // Ensure workspace exists automatically so mobile/web 1-click promotion never dead-ends with 404.
  const currentLink = await getCrmLink(env, accountId);
  if (!currentLink) {
    const activated = await activateCrmWorkspace(env, user, { crmMode: 'standalone' }, fetchFn);
    if (!activated.ok) {
      return { ok: false, error: activated.error, status: activated.status };
    }
  }

  // Matches IntakeCapture::parseRawText() fields AND embeds `Suite Enquiry: <id>` for closed-loop outcome attribution.
  const rawTextParts = [
    `Subject: ${enquiry.qualificationBrief?.playbookName || enquiry.intentType} - ${enquiry.contactName}`,
    `Contact: ${enquiry.contactName}`,
    enquiry.contactEmail ? `Email: ${enquiry.contactEmail}` : '',
    enquiry.contactPhone ? `Phone: ${enquiry.contactPhone}` : '',
    enquiry.propertyAddress ? `Property: ${enquiry.propertyAddress}` : '',
    `Intent: ${enquiry.intentType}`,
    enquiry.qualificationBrief?.summaryVerdict ? `Brief: ${enquiry.qualificationBrief.summaryVerdict}` : '',
    enquiry.attributionAuditId ? `Attribution Audit: ${enquiry.attributionAuditId}` : '',
    `Suite Enquiry: ${enquiry.id}`,
  ].filter(Boolean);

  const actionRes = await callCrmAction(
    env,
    accountId,
    'intake_capture',
    {
      raw_text: rawTextParts.join('\n'),
      source_channel: 'luminara_suite',
      reason: `Promoted from Luminara Suite Enquiry Desk (${enquiry.id})`,
    },
    { idempotencyKey: `suite_enq_${enquiry.id}` },
    fetchFn,
  );

  if (!actionRes.ok) {
    return {
      ok: false,
      error: String(actionRes.body.message || actionRes.body.error || 'Failed to promote enquiry to CRM.'),
      status: actionRes.status,
    };
  }

  if (actionRes.status === 202 || actionRes.body.status === 'pending_approval') {
    const callId = String(actionRes.body.call_id ?? '');
    return {
      ok: true,
      duplicate: false,
      crmLeadId: callId ? `pending:${callId}` : 'pending',
      crmReceiptCode: null,
      status: 'pending_approval',
    };
  }

  const resultNode = (actionRes.body.result || actionRes.body.data || actionRes.body) as Record<string, unknown>;
  const leadNode = resultNode.lead as Record<string, unknown> | undefined;
  const personNode = resultNode.person as Record<string, unknown> | undefined;
  const rawLeadId = leadNode?.id ?? resultNode.lead_id;

  if (rawLeadId === undefined || rawLeadId === null || String(rawLeadId).trim() === '') {
    return { ok: false, error: 'CRM intake response did not include a created lead ID.', status: 502 };
  }

  const crmLeadId = String(rawLeadId);
  const rawPersonId = personNode?.id ?? resultNode.person_id;
  const crmPersonId = rawPersonId !== undefined && rawPersonId !== null && String(rawPersonId).trim() !== ''
    ? String(rawPersonId)
    : null;
  const crmReceiptCode = typeof actionRes.body.receipt_code === 'string' ? actionRes.body.receipt_code : null;
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO enquiry_crm_promotions (
      enquiry_id, account_id, crm_lead_id, crm_person_id, crm_receipt_code, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'staged', ?)
    ON CONFLICT(enquiry_id) DO UPDATE SET
      crm_lead_id = excluded.crm_lead_id,
      crm_person_id = COALESCE(excluded.crm_person_id, enquiry_crm_promotions.crm_person_id),
      crm_receipt_code = COALESCE(excluded.crm_receipt_code, enquiry_crm_promotions.crm_receipt_code),
      updated_at = excluded.updated_at`,
  )
    .bind(enquiry.id, accountId, crmLeadId, crmPersonId, crmReceiptCode, now)
    .run();

  return {
    ok: true,
    duplicate: false,
    crmLeadId,
    crmReceiptCode,
    status: 'staged',
  };
}

export async function decideCrmApproval(
  env: Env,
  accountId: string,
  callId: string,
  decision: 'approve' | 'reject',
  feedbackNote?: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  if (!isCrmBridgeEnabled(env)) {
    return { ok: false, status: 503, body: { ok: false, code: 'CRM_BRIDGE_DISABLED', error: 'CRM bridge is disabled.' } };
  }
  const secret = (env.CRM_BRIDGE_SHARED_SECRET || '').trim();
  const base = crmBaseUrl(env);
  if (!isStrongBridgeSecret(env, secret) || !base) {
    return { ok: false, status: 503, body: { ok: false, error: 'CRM bridge secrets are not configured.' } };
  }

  const path = `/api/suite/approvals/${encodeURIComponent(callId)}/decide`;
  const rawBody = JSON.stringify({
    suite_account_id: accountId,
    decision,
    ...(feedbackNote?.trim() ? { feedback_note: feedbackNote.trim().slice(0, 500) } : {}),
  });
  const { timestamp, signature } = await signSuiteHmac(secret, 'POST', path, rawBody);

  const res = await fetchWithTimeout(fetchFn, `${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Luminara-Suite-Timestamp': timestamp,
      'X-Luminara-Suite-Signature': signature,
    },
    body: rawBody,
  });

  if (!res) {
    return { ok: false, status: 502, body: { ok: false, error: 'CRM approval proxy timed out or failed to connect.' } };
  }

  const body = (await res.json().catch(() => ({ ok: false, error: `CRM returned HTTP ${res.status}` }))) as Record<
    string,
    unknown
  >;
  return { ok: res.ok, status: res.status, body };
}

export async function notifyCrmAccountDeletion(
  env: Env,
  accountId: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (env.DB) {
    await env.DB.prepare(`DELETE FROM enquiry_crm_promotions WHERE account_id = ?`).bind(accountId).run().catch(() => undefined);
    await env.DB.prepare(`DELETE FROM suite_crm_links WHERE account_id = ?`).bind(accountId).run().catch(() => undefined);
  }
  if (!isCrmBridgeEnabled(env)) return false;
  const secret = (env.CRM_BRIDGE_SHARED_SECRET || '').trim();
  const base = crmBaseUrl(env);
  if (!secret || !base) return false;

  const path = '/api/suite/account';
  const rawBody = JSON.stringify({ suite_account_id: accountId });
  const { timestamp, signature } = await signSuiteHmac(secret, 'DELETE', path, rawBody);
  const res = await fetchWithTimeout(
    fetchFn,
    `${base}${path}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Luminara-Suite-Timestamp': timestamp,
        'X-Luminara-Suite-Signature': signature,
      },
      body: rawBody,
    },
    DELETION_FETCH_TIMEOUT_MS,
  );
  return Boolean(res?.ok);
}
