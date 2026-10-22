/**
 * Publishes and revokes a public win page. The body is the measured result only.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import { noteWorkspaceDirty } from '../sync/workspaceSyncService';
import { WIN_SHARES_KEY, type WinClaim } from './winShare';

export interface WinPageResult {
  ok: boolean;
  id?: string;
  url?: string;
  error?: string;
  code?: string;
}

function readBag(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(WIN_SHARES_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function writeBag(bag: Record<string, string>): void {
  try {
    localStorage.setItem(WIN_SHARES_KEY, JSON.stringify(bag));
    noteWorkspaceDirty();
  } catch {
    /* the page still exists on the server */
  }
}

export function rememberWinShare(auditId: string, winId: string): void {
  const bag = readBag();
  bag[auditId] = winId;
  writeBag(bag);
}

export function forgetWinShare(auditId: string): void {
  const bag = readBag();
  delete bag[auditId];
  writeBag(bag);
}

export function winShareFor(auditId: string): string | null {
  const id = readBag()[auditId];
  return typeof id === 'string' && /^[a-f0-9]{32}$/.test(id) ? id : null;
}

export async function createWinPage(input: {
  agencyName: string;
  claim: WinClaim;
  hideScore: boolean;
}): Promise<WinPageResult> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'Sign in on the hosted app to publish a public page.', code: 'NO_API' };
  const res = await workerFetchWithAuthRetry(`${base}/api/wins`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agencyName: input.agencyName,
      kind: input.claim.kind,
      passed: input.claim.kind === 'score' ? input.claim.passed : undefined,
      total: input.claim.kind === 'score' ? input.claim.total : undefined,
      fixesDone: input.claim.fixesDone,
      hideScore: input.hideScore,
    }),
  });
  const data = await res.json().catch(() => null) as WinPageResult | null;
  if (!data || data.ok !== true || !data.id || !data.url) {
    return { ok: false, error: data?.error || 'Could not publish the public page.', code: data?.code };
  }
  return { ok: true, id: data.id, url: data.url };
}

export async function revokeWinPage(id: string): Promise<WinPageResult> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'Sign in on the hosted app to revoke a public page.', code: 'NO_API' };
  const res = await workerFetchWithAuthRetry(`${base}/api/wins/${id}`, { method: 'DELETE' });
  const data = await res.json().catch(() => null) as WinPageResult | null;
  if (res.status === 404) return { ok: true, code: 'WIN_NOT_FOUND' };
  if (!data?.ok) return { ok: false, error: data?.error || 'Could not revoke the public page.', code: data?.code };
  return { ok: true };
}
