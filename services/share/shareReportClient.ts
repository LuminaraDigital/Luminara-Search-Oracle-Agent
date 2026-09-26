/**
 * Client helpers for Growth+/Agency shareable audit report links.
 */
import { apiBase, getCurrentQuotaSync, hasActivePaidPlanSync, workerFetchWithAuthRetry } from '../apiClient';
import { entitlementsFor } from '../plans/planEntitlements';
import { getFirebaseIdTokenSync } from '../auth/firebaseAuthService';
import { getInitDataRaw } from '../telegram/tma';

export interface CreateShareReportInput {
  markdownText: string;
  domain?: string;
  dnaName?: string;
  sources?: Array<{ uri: string; title: string }>;
  branding?: {
    agencyName?: string;
    logoUrl?: string;
    accentColor?: string;
    preparedBy?: string;
    clientName?: string;
  };
  password?: string;
  clientId?: string;
  expiresInMs?: number;
}

export interface CreateShareReportResult {
  ok: boolean;
  id?: string;
  token?: string;
  url?: string;
  expiresAt?: number;
  error?: string;
  code?: string;
}

export interface SharedReportResponse {
  ok: boolean;
  id?: string;
  report?: {
    version: 1;
    domain?: string;
    dnaName?: string;
    markdownText: string;
    sources?: Array<{ uri: string; title: string }>;
    branding?: CreateShareReportInput['branding'];
    createdAt: number;
    expiresAt: number | null;
    passwordRequired: boolean;
  };
  error?: string;
  code?: string;
  passwordRequired?: boolean;
}

export function canCreateShareLinks(): boolean {
  const quota = getCurrentQuotaSync();
  if (!quota) return false;
  const plan = quota.plan || 'free';
  // Named plans from /api/auth/quota (starter/growth/agency).
  if (plan !== 'free' && plan !== 'active') {
    return entitlementsFor(plan).shareLinks;
  }
  // updateQuotaFromHeaders sets plan:'active' for unlimited subscribers; that must
  // not normalize to free via entitlementsFor. Share links are Growth+; grant when
  // the client already sees an active paid/unlimited plan.
  if (hasActivePaidPlanSync()) {
    return entitlementsFor('growth').shareLinks;
  }
  return false;
}

export async function createShareReport(input: CreateShareReportInput): Promise<CreateShareReportResult> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable', code: 'NO_API' };
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/share/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as CreateShareReportResult;
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || `HTTP ${res.status}`,
        code: data.code,
      };
    }
    return data;
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export async function fetchSharedReport(token: string, password?: string): Promise<SharedReportResponse> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable', code: 'NO_API' };
  const q = password ? `?password=${encodeURIComponent(password)}` : '';
  try {
    const res = await fetch(`${base}/api/share/reports/${encodeURIComponent(token)}${q}`, {
      method: 'GET',
      credentials: 'omit',
    });
    const data = (await res.json().catch(() => ({}))) as SharedReportResponse;
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || `HTTP ${res.status}`,
        code: data.code,
        passwordRequired: data.passwordRequired || data.code === 'SHARE_PASSWORD_REQUIRED',
      };
    }
    return data;
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export async function revokeShareReport(id: string): Promise<{ ok: boolean; error?: string }> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable' };
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/share/reports/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export interface TeaserPublic {
  version: 1;
  kind: 'teaser';
  domain: string;
  verdict: string;
  topFix: string;
  evidenceNote: string;
  badges: Array<{ label: string; status: 'measured' | 'estimated' | 'not_measured'; value?: string }>;
  crawlerChecks: Array<{ id: string; label: string; status: 'pass' | 'fail' | 'not_measured'; detail: string }>;
  failed: string[];
  createdAt: number;
  ctaUrl: string;
}

/** True when Telegram initData or a Firebase token can mint a redacted teaser. Not a plan check. */
export function canMintTeaserShare(): boolean {
  return Boolean(getInitDataRaw() || getFirebaseIdTokenSync());
}

export async function createShareTeaser(input: Omit<TeaserPublic, 'version' | 'kind' | 'createdAt' | 'ctaUrl'>): Promise<{
  ok: boolean;
  url?: string;
  token?: string;
  error?: string;
  code?: string;
}> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable', code: 'NO_API' };
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/share/teasers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; token?: string; error?: string; code?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}`, code: data.code };
    }
    return { ok: true, url: data.url, token: data.token };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export async function fetchShareTeaser(token: string): Promise<{ ok: boolean; teaser?: TeaserPublic; error?: string; code?: string }> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable', code: 'NO_API' };
  try {
    const res = await fetch(`${base}/api/share/teasers/${encodeURIComponent(token)}`, {
      method: 'GET',
      credentials: 'omit',
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; teaser?: TeaserPublic; error?: string; code?: string };
    if (!res.ok || !data.ok || !data.teaser) {
      return { ok: false, error: data.error || `HTTP ${res.status}`, code: data.code };
    }
    return { ok: true, teaser: data.teaser };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export async function fetchAttestationByDigest(digest: string): Promise<{
  ok: boolean;
  attestation?: Record<string, unknown>;
  error?: string;
}> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable' };
  try {
    const res = await fetch(`${base}/api/agent/attest?digest=${encodeURIComponent(digest)}`, {
      method: 'GET',
      credentials: 'omit',
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      attestation?: Record<string, unknown>;
      error?: string;
    };
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, attestation: data.attestation };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}
