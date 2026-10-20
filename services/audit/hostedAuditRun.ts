/**
 * Opens one hosted Instant Audit run (one free check) and closes it.
 * Provider calls made while it is open send the run token. Chat does not.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import { currentAuditRun, setAuditRun } from './auditRunSlot';

function auditHostname(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

export async function beginHostedAuditRun(rawUrl: string): Promise<void> {
  setAuditRun(null);
  const domain = auditHostname(rawUrl);
  const base = apiBase();
  if (!domain || !base) return;
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/audit/scout-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain }),
    });
    if (!res.ok) return;
    const body = (await res.json()) as { token?: string; domain?: string };
    if (body.token && body.domain) setAuditRun({ token: body.token, domain: body.domain });
  } catch {
    setAuditRun(null);
  }
}

/** Refunds the one check when the run measured nothing. Clears the token either way. */
export async function finishHostedAuditRun(measured: boolean): Promise<void> {
  const open = currentAuditRun();
  setAuditRun(null);
  const base = apiBase();
  if (!open || measured || !base) return;
  try {
    await workerFetchWithAuthRetry(`${base}/api/audit/scout-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: open.token, domain: open.domain, refund: true }),
    });
  } catch {
    /* a missed refund leaves the one check spent */
  }
}
