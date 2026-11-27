/**
 * Browser/TMA/Electron client for the dark-launched Luminara CRM Agentic Middle Layer (`/api/crm/*`).
 * Uses canonical `apiBase()` + `workerFetchWithAuthRetry()` so Firebase Bearer tokens, Telegram
 * initData, opaque cookies, and App Check headers attach automatically.
 */

import { apiBase, workerFetchWithAuthRetry } from '../apiClient';

export type CrmMode = 'standalone' | 'middle_layer';

export interface CrmLinkStatus {
  ok: boolean;
  enabled: boolean;
  activated: boolean;
  link: {
    workspaceSlug: string;
    crmBaseUrl: string;
    crmMode: CrmMode;
    primaryExternalCrm: string | null;
    status: string;
  } | null;
}

export async function fetchCrmBridgeStatus(): Promise<CrmLinkStatus> {
  try {
    const base = apiBase() || '';
    const res = await workerFetchWithAuthRetry(`${base}/api/crm/status`);
    if (res.status === 503 || res.status === 404 || res.status === 401) {
      return { ok: false, enabled: false, activated: false, link: null };
    }
    const body = (await res.json().catch(() => ({}))) as Partial<CrmLinkStatus>;
    return {
      ok: Boolean(body.ok),
      enabled: Boolean(body.enabled),
      activated: Boolean(body.activated),
      link: body.link ?? null,
    };
  } catch {
    return { ok: false, enabled: false, activated: false, link: null };
  }
}

export async function requestCrmLaunchAssertion(opts: {
  crmMode?: CrmMode;
  primaryExternalCrm?: string;
  nextPath?: string;
} = {}): Promise<{ ok: true; handoffUrl: string; assertion: string; expiresAt: number } | { ok: false; error: string }> {
  try {
    const base = apiBase() || '';
    const res = await workerFetchWithAuthRetry(`${base}/api/crm/launch-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !body.ok || typeof body.handoffUrl !== 'string' || typeof body.assertion !== 'string') {
      return { ok: false, error: String(body.error || `HTTP ${res.status}`) };
    }
    return {
      ok: true,
      handoffUrl: body.handoffUrl,
      assertion: body.assertion,
      expiresAt: Number(body.expiresAt || 0),
    };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unable to reach CRM bridge.' };
  }
}

function isSafeHandoffUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/**
 * Submits the single-use 60s Ed25519 assertion via POST form so the token never appears in URLs or Referer headers.
 */
export function submitCrmHandoffPost(handoffUrl: string, assertion: string): void {
  if (!isSafeHandoffUrl(handoffUrl)) {
    throw new Error('Refused CRM handoff to an unsafe URL.');
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = handoffUrl;
  form.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'assertion';
  input.value = assertion;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

export async function promoteEnquiryToLuminaraCrm(
  enquiryId: string,
): Promise<{ ok: true; duplicate: boolean; crmLeadId: string; crmReceiptCode: string | null; status: string } | { ok: false; error: string }> {
  try {
    const base = apiBase() || '';
    const res = await workerFetchWithAuthRetry(`${base}/api/crm/enquiries/${encodeURIComponent(enquiryId)}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !body.ok) {
      return { ok: false, error: String(body.error || `HTTP ${res.status}`) };
    }
    return {
      ok: true,
      duplicate: Boolean(body.duplicate),
      crmLeadId: String(body.crmLeadId || ''),
      crmReceiptCode: typeof body.crmReceiptCode === 'string' ? body.crmReceiptCode : null,
      status: String(body.status || 'staged'),
    };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Promotion failed.' };
  }
}
